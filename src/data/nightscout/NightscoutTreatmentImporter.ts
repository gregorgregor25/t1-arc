import * as Crypto from 'expo-crypto';

import {
  HealthRecordStore,
  ImportRawRecord,
} from '@/data/persistence/HealthRecordStore';
import {
  BasalDelivery,
  BolusDelivery,
  HealthContextEvent,
  MealEvent,
} from '@/domain/models';
import { NIGHTSCOUT_GLUCOSE_CAPABILITIES } from '@/domain/sourceCapabilities';

import { NightscoutConnection, NightscoutError, NightscoutTreatment } from './types';

const MAX_TREATMENTS = 5_000;
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
    ? Date.parse(value.created_at)
    : Number.NaN;
  return Number.isFinite(created) ? created : undefined;
}

function localHour(timestamp: number) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp),
  );
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
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return parsed;
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
  dataStart?: number;
  dataThrough?: number;
}

export function normalizeNightscoutTreatments(
  treatments: NightscoutTreatment[],
  profiles: Record<string, unknown>[],
  importedAt = Date.now(),
): NormalizedNightscoutTreatments {
  const basal: BasalDelivery[] = [];
  const boluses: BolusDelivery[] = [];
  const context: HealthContextEvent[] = [];
  const rawRecords: ImportRawRecord[] = [];
  let skipped = 0;
  const sorted = treatments
    .map((treatment, index) => ({
      treatment,
      index,
      timestamp: timestampFor(treatment),
      externalId: externalId(treatment, index),
    }))
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

  sorted.forEach(({ treatment, index, timestamp, externalId: sourceId }) => {
    rawRecords.push({
      id: `nightscout:raw:treatment:${sourceId}`,
      sourceId: 'nightscout',
      recordKind: 'nightscout-treatment',
      timestamp,
      sourceFile: 'treatments.json',
      sourceRow: index + 1,
      payloadJson: JSON.stringify(treatment),
      importedAt,
    });
    if (timestamp === undefined) {
      skipped += 1;
      return;
    }

    const eventType = safeText(treatment.eventType) || 'Nightscout treatment';
    const insulin = numeric(treatment.insulin);
    if (insulin !== undefined) {
      if (insulin > 0 && insulin <= 100) {
        boluses.push({
          id: `nightscout:bolus:${sourceId}`,
          timestamp,
          units: insulin,
          deliveryType: eventType,
          sourceId: 'nightscout',
          importedAt,
          sourceFile: 'treatments.json',
          sourceRow: index + 1,
          sourceDeviceId: safeText(treatment.enteredBy, 120) || undefined,
        });
      } else {
        skipped += 1;
      }
    }

    const carbs = numeric(treatment.carbs);
    if (carbs !== undefined) {
      if (carbs > 0 && carbs <= 1_000) {
        context.push({
          id: `nightscout:meal:${sourceId}`,
          kind: 'meal',
          start: timestamp,
          title: safeText(treatment.notes) || eventType,
          mealType: mealType(timestamp),
          carbsGrams: carbs,
          sourceId: 'nightscout',
          origin: 'imported',
          recordedAt: importedAt,
          sourceFile: 'treatments.json',
          sourceRow: index + 1,
        });
      } else {
        skipped += 1;
      }
    }

    const duration = numeric(treatment.duration);
    const rate = numeric(treatment.absolute ?? treatment.rate);
    if (/temp(?:orary)? basal/i.test(eventType) && duration !== undefined) {
      if (
        rate !== undefined &&
        rate >= 0 &&
        rate <= 50 &&
        duration > 0 &&
        duration <= 1_440
      ) {
        basal.push({
          id: `nightscout:basal:${sourceId}`,
          start: timestamp,
          end: timestamp + duration * 60_000,
          rateUnitsPerHour: rate,
          units: (rate * duration) / 60,
          deliveryType: eventType,
          percentage: numeric(treatment.percent),
          unitsEstimated: true,
          sourceId: 'nightscout',
          importedAt,
          sourceFile: 'treatments.json',
          sourceRow: index + 1,
          sourceDeviceId: safeText(treatment.enteredBy, 120) || undefined,
        });
      } else if (rate !== undefined || numeric(treatment.percent) !== undefined) {
        skipped += 1;
      }
    }

    const descriptor = [
      eventType,
      safeText(treatment.profile),
      safeText(treatment.reason),
      safeText(treatment.notes),
    ].join(' ');
    if (/profile switch|temporary target|override/i.test(eventType)) {
      context.push({
        id: `nightscout:note:${sourceId}`,
        kind: 'note',
        start: timestamp,
        end:
          duration !== undefined && duration > 0
            ? timestamp + duration * 60_000
            : undefined,
        title: eventType,
        category: 'pump',
        detail:
          safeText(treatment.profile) ||
          safeText(treatment.reason) ||
          safeText(treatment.notes) ||
          undefined,
        sourceId: 'nightscout',
        origin: 'imported',
        recordedAt: importedAt,
        sourceFile: 'treatments.json',
        sourceRow: index + 1,
      });
    }
    if (
      duration !== undefined &&
      duration > 0 &&
      duration <= 1_440 &&
      /(exercise|activity)/i.test(descriptor)
    ) {
      rawRecords.push({
        id: `nightscout:pump-state:activity:${sourceId}`,
        sourceId: 'nightscout',
        recordKind: 'pump-state-interval',
        timestamp,
        sourceFile: 'treatments.json',
        sourceRow: index + 1,
        payloadJson: JSON.stringify({
          start: timestamp,
          end: timestamp + duration * 60_000,
          kind: 'activity-mode',
        }),
        importedAt,
      });
    }
  });

  sorted.forEach((item, index) => {
    if (item.timestamp === undefined || !/pump suspend/i.test(safeText(item.treatment.eventType))) {
      return;
    }
    const duration = numeric(item.treatment.duration);
    const resume = sorted.slice(index + 1).find(
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
      id: `nightscout:pump-state:pause:${item.externalId}`,
      sourceId: 'nightscout',
      recordKind: 'pump-state-interval',
      timestamp: item.timestamp,
      sourceFile: 'treatments.json',
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
      id: `nightscout:raw:profile:${id}`,
      sourceId: 'nightscout',
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
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const treatmentQuery = [
        `count=${MAX_TREATMENTS}`,
        `find%5Bcreated_at%5D%5B%24gte%5D=${encodeURIComponent(new Date(start).toISOString())}`,
        `find%5Bcreated_at%5D%5B%24lt%5D=${encodeURIComponent(new Date(end).toISOString())}`,
      ];
      const treatmentResponse = await this.fetchJson(
        endpoint(this.connection, '/api/v1/treatments.json', treatmentQuery),
        controller.signal,
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
      if (!Array.isArray(treatmentResponse)) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned an unexpected treatment response.',
        );
      }
      if (treatmentResponse.length > MAX_TREATMENTS) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned more treatments than T1 Arc can safely process at once.',
        );
      }
      const profiles = Array.isArray(profileResponse)
        ? profileResponse
        : profileResponse && typeof profileResponse === 'object'
          ? [profileResponse]
          : [];
      const importedAt = this.clock();
      const normalized = normalizeNightscoutTreatments(
        treatmentResponse as NightscoutTreatment[],
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
            ...(profileWarning ? [profileWarning] : []),
          ],
        },
        normalized.basal,
        normalized.boluses,
        normalized.context,
        undefined,
        [],
        normalized.rawRecords,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJson(url: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
        `Nightscout treatment data returned HTTP ${response.status}.`,
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
