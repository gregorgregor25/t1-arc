import * as Crypto from 'expo-crypto';

import {
  HealthRecordStore,
  ImportRawRecord,
} from '@/data/persistence/HealthRecordStore';
import {
  BasalDelivery,
  BolusDelivery,
  ContextNoteEvent,
  HealthContextEvent,
  MealEvent,
} from '@/domain/models';
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { NIGHTSCOUT_GLUCOSE_CAPABILITIES } from '@/domain/sourceCapabilities';
import { getZonedDateTimeParts } from '@/domain/time';

import { NightscoutConnection, NightscoutError, NightscoutTreatment } from './types';
import { nightscoutRequestHeaders } from './auth';
import { serviceStatusMessage } from '@/domain/serviceMessages';

const MAX_TREATMENTS = 5_000;
/** Eight full pages is about 40,000 treatments: roughly two months of AAPS SMB records. */
const MAX_TREATMENT_PAGES = 8;
const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

function numeric(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampFor(value: NightscoutTreatment) {
  const direct = numeric(value.mills ?? value.date);
  if (direct !== undefined && direct > 0) {
    return direct < 10_000_000_000 ? direct * 1_000 : direct;
  }
  const created = typeof value.created_at === 'string'
    ? parseExternalAbsoluteTimestamp(value.created_at)
    : undefined;
  return created;
}

function localHour(timestamp: number) {
  const regional = getRuntimeRegionalDefaults();
  return getZonedDateTimeParts(timestamp, regional.timeZone).hour;
}

function mealType(timestamp: number): MealEvent['mealType'] {
  const hour = localHour(timestamp);
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

function safeText(value: unknown, maximum = 180) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function fingerprint(value: string) {
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
  ];
  return seeds
    .map((seed) => {
      let hash = seed >>> 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    })
    .join('');
}

function externalId(treatment: NightscoutTreatment, index: number) {
  const supplied = safeText(treatment.identifier ?? treatment._id, 120);
  return supplied || `${index}:${fingerprint(JSON.stringify(treatment))}`;
}

function profileTimestamp(profile: Record<string, unknown>) {
  for (const candidate of [profile.startDate, profile.created_at, profile.date]) {
    if (typeof candidate === 'number') {
      return candidate < 10_000_000_000 ? candidate * 1_000 : candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = parseExternalAbsoluteTimestamp(candidate);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

export interface NormalizedNightscoutTreatments {
  basal: BasalDelivery[];
  boluses: BolusDelivery[];
  context: HealthContextEvent[];
  rawRecords: ImportRawRecord[];
  skipped: number;
  /** Source records Nightscout marks as withdrawn (`isValid: false`). */
  withdrawn: number;
  /**
   * Every derived record ID this payload is authoritative for. A revised or
   * withdrawn treatment replaces its earlier local copy on import.
   */
  revisedRecordIds: string[];
  dataStart?: number;
  dataThrough?: number;
}

const MAX_TEMP_BASAL_MS = 24 * 60 * 60_000;

/** AAPS uploads exact milliseconds; minutes remain the Nightscout default. */
function durationMs(treatment: NightscoutTreatment) {
  const exact = numeric(treatment.durationInMilliseconds);
  if (exact !== undefined && exact >= 0 && exact <= MAX_TEMP_BASAL_MS) {
    return exact;
  }
  const minutes = numeric(treatment.duration);
  return minutes !== undefined && minutes >= 0 && minutes <= 1_440
    ? minutes * 60_000
    : undefined;
}

function sourceDevice(treatment: NightscoutTreatment) {
  return (
    safeText(treatment.enteredBy, 120) ||
    safeText(treatment.device, 120) ||
    safeText(treatment.app, 120) ||
    undefined
  );
}

function bolusLabel(treatment: NightscoutTreatment, eventType: string) {
  if (
    treatment.isSMB === true ||
    safeText(treatment.type).toUpperCase() === 'SMB'
  ) {
    return 'SMB';
  }
  return eventType;
}

const THERAPY_EVENTS: Record<string, ContextNoteEvent['category']> = {
  'site change': 'pump',
  'insulin change': 'pump',
  'pump battery change': 'pump',
  'sensor change': 'sensor',
  'sensor start': 'sensor',
};

function formatTarget(treatment: NightscoutTreatment) {
  const bottom = numeric(treatment.targetBottom);
  const top = numeric(treatment.targetTop);
  if (bottom === undefined || top === undefined || bottom <= 0 || top <= 0) {
    return undefined;
  }
  const units = safeText(treatment.units, 12) || 'mg/dL';
  return bottom === top
    ? `target ${bottom} ${units} as recorded`
    : `target ${bottom} to ${top} ${units} as recorded`;
}

function noteDetail(treatment: NightscoutTreatment, eventType: string) {
  const parts: string[] = [];
  const profile = safeText(treatment.profile);
  if (profile) parts.push(profile);
  const percentage = numeric(treatment.percentage);
  if (
    /profile switch/i.test(eventType) &&
    percentage !== undefined &&
    percentage > 0 &&
    percentage !== 100
  ) {
    parts.push(`${percentage}%`);
  }
  const reason = safeText(treatment.reason);
  if (reason) parts.push(reason);
  if (/temporary target/i.test(eventType)) {
    const target = formatTarget(treatment);
    if (target) parts.push(target);
  }
  const notes = safeText(treatment.notes);
  if (notes && !parts.includes(notes)) parts.push(notes);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * AAPS writes the same treatment shape to Nightscout and to its local
 * xDrip+ broadcast, so one normalizer serves both with distinct provenance.
 */
export interface TreatmentRecordOrigin {
  sourceId: string;
  sourceFile: string;
  rawRecordKind: string;
}

export const NIGHTSCOUT_TREATMENT_ORIGIN: TreatmentRecordOrigin = {
  sourceId: 'nightscout',
  sourceFile: 'treatments.json',
  rawRecordKind: 'nightscout-treatment',
};

function derivedIds(prefix: string, sourceId: string) {
  return [
    `${prefix}:bolus:${sourceId}`,
    `${prefix}:meal:${sourceId}`,
    `${prefix}:basal:${sourceId}`,
    `${prefix}:note:${sourceId}`,
  ];
}

function isTempBasal(eventType: string) {
  return /temp(?:orary)? basal/i.test(eventType);
}

export function normalizeNightscoutTreatments(
  treatments: NightscoutTreatment[],
  profiles: Record<string, unknown>[],
  importedAt = Date.now(),
  origin: TreatmentRecordOrigin = NIGHTSCOUT_TREATMENT_ORIGIN,
): NormalizedNightscoutTreatments {
  const basal: BasalDelivery[] = [];
  const boluses: BolusDelivery[] = [];
  const context: HealthContextEvent[] = [];
  const rawRecords: ImportRawRecord[] = [];
  const revisedRecordIds: string[] = [];
  let skipped = 0;
  let withdrawn = 0;
  const sorted = treatments
    .map((treatment, index) => ({
      treatment,
      index,
      timestamp: timestampFor(treatment),
      externalId: externalId(treatment, index),
    }))
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
  const valid = sorted.filter((item) => item.treatment.isValid !== false);

  // Nightscout semantics: a later temporary basal, or a zero-duration
  // temporary basal (a cancel), ends the one before it. Keeping the full
  // programmed duration would count the overlapping insulin twice.
  const tempBasalStarts = valid
    .filter(
      (item) =>
        item.timestamp !== undefined &&
        isTempBasal(safeText(item.treatment.eventType)),
    )
    .map((item) => item.timestamp as number);

  sorted.forEach(({ treatment, index, timestamp, externalId: sourceId }) => {
    revisedRecordIds.push(...derivedIds(origin.sourceId, sourceId));
    rawRecords.push({
      id: `${origin.sourceId}:raw:treatment:${sourceId}`,
      sourceId: origin.sourceId,
      recordKind: origin.rawRecordKind,
      timestamp,
      sourceFile: origin.sourceFile,
      sourceRow: index + 1,
      payloadJson: JSON.stringify(treatment),
      importedAt,
    });
    if (treatment.isValid === false) {
      // Kept as raw evidence; its derived records are removed on import.
      withdrawn += 1;
      return;
    }
    if (timestamp === undefined) {
      skipped += 1;
      return;
    }

    const eventType = safeText(treatment.eventType) || 'Nightscout treatment';
    const device = sourceDevice(treatment);
    const enteredInsulin = numeric(treatment.enteredinsulin);
    const insulin = numeric(treatment.insulin);
    if (/combo bolus/i.test(eventType) && enteredInsulin !== undefined) {
      if (treatment.isEmulatingTempBasal === true) {
        // An extended bolus emulated as a temporary basal is already part of
        // that basal record; a bolus here would count it twice.
      } else if (enteredInsulin > 0 && enteredInsulin <= 100) {
        const splitNow = numeric(treatment.splitNow);
        const initial =
          insulin !== undefined && insulin >= 0 && insulin <= enteredInsulin
            ? insulin
            : splitNow !== undefined && splitNow >= 0 && splitNow <= 100
              ? (enteredInsulin * splitNow) / 100
              : undefined;
        const extendedMs = durationMs(treatment);
        boluses.push({
          id: `${origin.sourceId}:bolus:${sourceId}`,
          timestamp,
          units: enteredInsulin,
          initialUnits: initial,
          extendedUnits:
            initial !== undefined ? enteredInsulin - initial : undefined,
          deliveryType:
            extendedMs !== undefined && extendedMs > 0
              ? `${eventType} (extended over ${Math.round(extendedMs / 60_000)} min)`
              : eventType,
          sourceId: origin.sourceId,
          importedAt,
          sourceFile: origin.sourceFile,
          sourceRow: index + 1,
          sourceDeviceId: device,
        });
      } else {
        skipped += 1;
      }
    } else if (insulin !== undefined) {
      if (safeText(treatment.type).toUpperCase() === 'PRIMING') {
        // Priming fills the cannula or tubing; it is not insulin delivered
        // to the body.
      } else if (insulin > 0 && insulin <= 100) {
        boluses.push({
          id: `${origin.sourceId}:bolus:${sourceId}`,
          timestamp,
          units: insulin,
          deliveryType: bolusLabel(treatment, eventType),
          sourceId: origin.sourceId,
          importedAt,
          sourceFile: origin.sourceFile,
          sourceRow: index + 1,
          sourceDeviceId: device,
        });
      } else {
        skipped += 1;
      }
    }

    const carbs = numeric(treatment.carbs);
    if (carbs !== undefined) {
      if (carbs > 0 && carbs <= 1_000) {
        context.push({
          id: `${origin.sourceId}:meal:${sourceId}`,
          kind: 'meal',
          start: timestamp,
          title: safeText(treatment.notes) || eventType,
          mealType: mealType(timestamp),
          carbsGrams: carbs,
          sourceId: origin.sourceId,
          origin: 'imported',
          recordedAt: importedAt,
          sourceFile: origin.sourceFile,
          sourceRow: index + 1,
        });
      } else {
        skipped += 1;
      }
    }

    const duration = numeric(treatment.duration);
    const rate = numeric(treatment.absolute ?? treatment.rate);
    const tempBasalMs = durationMs(treatment);
    if (isTempBasal(eventType) && tempBasalMs !== undefined) {
      if (
        rate !== undefined &&
        rate >= 0 &&
        rate <= 50 &&
        tempBasalMs > 0
      ) {
        const nextStart = tempBasalStarts.find((start) => start > timestamp);
        const end = Math.min(
          timestamp + tempBasalMs,
          nextStart ?? Number.POSITIVE_INFINITY,
        );
        basal.push({
          id: `${origin.sourceId}:basal:${sourceId}`,
          start: timestamp,
          end,
          rateUnitsPerHour: rate,
          units: (rate * (end - timestamp)) / 3_600_000,
          deliveryType: eventType,
          percentage: numeric(treatment.percent),
          unitsEstimated: true,
          sourceId: origin.sourceId,
          importedAt,
          sourceFile: origin.sourceFile,
          sourceRow: index + 1,
          sourceDeviceId: device,
        });
      } else if (
        tempBasalMs > 0 &&
        (rate !== undefined || numeric(treatment.percent) !== undefined)
      ) {
        skipped += 1;
      }
    }

    const therapyCategory = THERAPY_EVENTS[eventType.toLowerCase()];
    if (/profile switch|temporary target|override/i.test(eventType)) {
      context.push({
        id: `${origin.sourceId}:note:${sourceId}`,
        kind: 'note',
        start: timestamp,
        end:
          duration !== undefined && duration > 0
            ? timestamp + duration * 60_000
            : undefined,
        title: eventType,
        category: 'pump',
        detail: noteDetail(treatment, eventType),
        sourceId: origin.sourceId,
        origin: 'imported',
        recordedAt: importedAt,
        sourceFile: origin.sourceFile,
        sourceRow: index + 1,
      });
    } else if (therapyCategory) {
      context.push({
        id: `${origin.sourceId}:note:${sourceId}`,
        kind: 'note',
        start: timestamp,
        title: eventType,
        category: therapyCategory,
        detail: safeText(treatment.notes) || undefined,
        sourceId: origin.sourceId,
        origin: 'imported',
        recordedAt: importedAt,
        sourceFile: origin.sourceFile,
        sourceRow: index + 1,
      });
    }
    // Temporary targets, profile switches and logged exercise are read as
    // typed therapy states from this raw record (see domain/therapyStates);
    // they are no longer stored as Omnipod-style "Activity mode" intervals.
  });

  valid.forEach((item, index) => {
    if (
      item.timestamp === undefined ||
      !/pump suspend/i.test(safeText(item.treatment.eventType))
    ) {
      return;
    }
    const duration = numeric(item.treatment.duration);
    const resume = valid.slice(index + 1).find(
      (candidate) =>
        candidate.timestamp !== undefined &&
        /pump resume/i.test(safeText(candidate.treatment.eventType)),
    );
    const end =
      duration !== undefined && duration > 0 && duration <= 1_440
        ? item.timestamp + duration * 60_000
        : resume?.timestamp;
    if (end === undefined || end <= item.timestamp) return;
    rawRecords.push({
      id: `${origin.sourceId}:pump-state:pause:${item.externalId}`,
      sourceId: origin.sourceId,
      recordKind: 'pump-state-interval',
      timestamp: item.timestamp,
      sourceFile: origin.sourceFile,
      sourceRow: item.index + 1,
      payloadJson: JSON.stringify({
        start: item.timestamp,
        end,
        kind: 'automated-pause',
      }),
      importedAt,
    });
  });

  profiles.forEach((profile, index) => {
    const supplied = safeText(profile._id ?? profile.identifier, 120);
    const id = supplied || `${index}:${fingerprint(JSON.stringify(profile))}`;
    rawRecords.push({
      id: `${origin.sourceId}:raw:profile:${id}`,
      sourceId: origin.sourceId,
      recordKind: 'nightscout-profile',
      timestamp: profileTimestamp(profile),
      sourceFile: 'profile.json',
      sourceRow: index + 1,
      payloadJson: JSON.stringify(profile),
      importedAt,
    });
  });

  const timestamps = sorted
    .map((item) => item.timestamp)
    .filter((value): value is number => value !== undefined);
  return {
    basal,
    boluses,
    context,
    rawRecords,
    skipped,
    withdrawn,
    revisedRecordIds,
    dataStart: timestamps.length ? Math.min(...timestamps) : undefined,
    dataThrough: timestamps.length ? Math.max(...timestamps) : undefined,
  };
}

function endpoint(
  connection: NightscoutConnection,
  path: string,
  query: string[] = [],
) {
  if (connection.accessToken) {
    query.push(`token=${encodeURIComponent(connection.accessToken)}`);
  }
  return `${connection.baseUrl}${path}${query.length ? `?${query.join('&')}` : ''}`;
}

export class NightscoutTreatmentImporter {
  readonly label = 'Nightscout';
  readonly capabilities = NIGHTSCOUT_GLUCOSE_CAPABILITIES;

  constructor(
    private readonly connection: NightscoutConnection,
    private readonly store: HealthRecordStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  refresh() {
    const end = this.clock();
    return this.importRange(end - 2 * 86_400_000, end);
  }

  async importRange(start: number, end: number) {
    await this.store.initialize();
    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // Each further page gets its own request allowance.
    const restartTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    };
    try {
      const treatmentResponse = await this.fetchTreatmentPages(
        start,
        end,
        controller.signal,
        restartTimeout,
      );
      let profileResponse: unknown = [];
      let profileWarning: string | undefined;
      try {
        profileResponse = await this.fetchJson(
          endpoint(this.connection, '/api/v1/profile.json'),
          controller.signal,
        );
      } catch (error) {
        profileWarning =
          error instanceof Error
            ? `Nightscout profile was unavailable: ${error.message}`
            : 'Nightscout profile was unavailable.';
      }
      const profiles = Array.isArray(profileResponse)
        ? profileResponse
        : profileResponse && typeof profileResponse === 'object'
          ? [profileResponse]
          : [];
      const importedAt = this.clock();
      const normalized = normalizeNightscoutTreatments(
        treatmentResponse,
        profiles as Record<string, unknown>[],
        importedAt,
      );
      const exactPayload = JSON.stringify({
        treatments: treatmentResponse,
        profiles,
      });
      const fileSha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        exactPayload,
      );
      return this.store.writeImport(
        {
          id: `nightscout:${fileSha256.slice(0, 32)}`,
          sourceId: 'nightscout',
          fileName: 'Nightscout API treatments and profile',
          fileSha256,
          importedAt,
          dataStart: normalized.dataStart,
          dataThrough: normalized.dataThrough,
          skippedCount: normalized.skipped,
          warnings: [
            'Programmed Nightscout profile schedules are retained as source evidence and are not presented as delivered basal insulin.',
            ...(normalized.withdrawn > 0
              ? [
                  `${normalized.withdrawn} Nightscout treatment${normalized.withdrawn === 1 ? ' was' : 's were'} marked withdrawn and ${normalized.withdrawn === 1 ? 'is' : 'are'} not counted.`,
                ]
              : []),
            ...(profileWarning ? [profileWarning] : []),
          ],
        },
        normalized.basal,
        normalized.boluses,
        normalized.context,
        undefined,
        [],
        normalized.rawRecords,
        { revisedRecordIds: normalized.revisedRecordIds },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Nightscout returns the newest treatments first and stops at `count`. A
   * full page means older records may remain, so the next page continues
   * from the oldest returned `created_at` instead of silently leaving a gap.
   */
  private async fetchTreatmentPages(
    start: number,
    end: number,
    signal: AbortSignal,
    restartTimeout: () => void = () => undefined,
  ): Promise<NightscoutTreatment[]> {
    const treatments: NightscoutTreatment[] = [];
    const seen = new Set<string>();
    let upperBound = new Date(end).toISOString();
    let upperOperator = '%24lt';
    for (let page = 0; page < MAX_TREATMENT_PAGES; page += 1) {
      if (page > 0) restartTimeout();
      const response = await this.fetchJson(
        endpoint(this.connection, '/api/v1/treatments.json', [
          `count=${MAX_TREATMENTS}`,
          `find%5Bcreated_at%5D%5B%24gte%5D=${encodeURIComponent(new Date(start).toISOString())}`,
          `find%5Bcreated_at%5D%5B${upperOperator}%5D=${encodeURIComponent(upperBound)}`,
        ]),
        signal,
      );
      if (!Array.isArray(response)) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned an unexpected treatment response.',
        );
      }
      if (response.length > MAX_TREATMENTS) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned more treatments than T1 Arc can safely process at once.',
        );
      }
      let added = 0;
      let oldest: string | undefined;
      for (const item of response as NightscoutTreatment[]) {
        const key =
          safeText(item?.identifier ?? item?._id, 120) || JSON.stringify(item);
        if (typeof item?.created_at === 'string') {
          oldest =
            oldest === undefined || item.created_at < oldest
              ? item.created_at
              : oldest;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        treatments.push(item);
        added += 1;
      }
      if (response.length < MAX_TREATMENTS) return treatments;
      if (added === 0 || oldest === undefined) break;
      upperBound = oldest;
      upperOperator = '%24lte';
    }
    throw new NightscoutError(
      'invalid-response',
      'Nightscout returned more treatments than T1 Arc can safely process at once.',
    );
  }

  private async fetchJson(url: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: await nightscoutRequestHeaders(this.connection),
        signal,
      });
    } catch {
      throw new NightscoutError(
        'network',
        'Nightscout treatment data could not be reached.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new NightscoutError(
        'authentication',
        'Nightscout rejected treatment or profile access for this token.',
      );
    }
    if (!response.ok) {
      throw new NightscoutError(
        'network',
        `Treatments could not be read from Nightscout. Glucose is not affected. ${serviceStatusMessage('Your Nightscout site', response.status)}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new NightscoutError(
        'invalid-response',
        'Nightscout returned unreadable treatment or profile data.',
      );
    }
  }
}
