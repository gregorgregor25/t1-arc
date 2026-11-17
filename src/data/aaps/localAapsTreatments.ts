import * as Crypto from 'expo-crypto';

import T1ArcGlucoseDisplay, {
  type AapsLocalTreatment,
} from '../../../modules/t1arc-glucose-display';

import {
  normalizeNightscoutTreatments,
  type NormalizedNightscoutTreatments,
  type TreatmentRecordOrigin,
} from '@/data/nightscout/NightscoutTreatmentImporter';
import type { NightscoutTreatment } from '@/data/nightscout/types';
import type { HealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { acquireLocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import {
  AAPS_LOCAL_UNVERIFIED_SOURCE_FILE,
  AAPS_LOCAL_VERIFIED_SOURCE_FILE,
} from '@/domain/aapsInsulinProvenance';

import { getAapsLocalSourceStatus } from './localAapsSource';
import { AAPS_LOCAL_SOURCE_ID } from './types';

/**
 * AAPS's xDrip+ sync plugin broadcasts boluses, carbs, extended boluses,
 * temporary targets, profile switches and therapy events to apps on this
 * phone. They use the Nightscout treatment shape, so the Nightscout
 * normalizer applies with on-phone provenance.
 *
 * The broadcast needs no permission, and AAPS does not ask Android to share
 * its identity, so Android usually cannot say who sent it. This route is off
 * until the user turns it on, and its records say whether the sender was
 * confirmed. Nightscout copies of the same records take precedence.
 */
export { AAPS_LOCAL_UNVERIFIED_SOURCE_FILE, AAPS_LOCAL_VERIFIED_SOURCE_FILE };

export const AAPS_LOCAL_TREATMENT_ORIGIN: TreatmentRecordOrigin = {
  sourceId: AAPS_LOCAL_SOURCE_ID,
  sourceFile: AAPS_LOCAL_UNVERIFIED_SOURCE_FILE,
  rawRecordKind: 'aaps-local-treatment',
};

const AAPS_LOCAL_VERIFIED_TREATMENT_ORIGIN: TreatmentRecordOrigin = {
  ...AAPS_LOCAL_TREATMENT_ORIGIN,
  sourceFile: AAPS_LOCAL_VERIFIED_SOURCE_FILE,
};

/** Off unless this native build has the switch and the user turned it on. */
export async function loadAapsLocalTreatmentRoute(): Promise<boolean> {
  const status = T1ArcGlucoseDisplay.getAapsTreatmentStatusAsync;
  if (typeof status !== 'function') return false;
  return (await status.call(T1ArcGlucoseDisplay)).localRouteEnabled === true;
}

/**
 * Saves the opt-in natively, where the receiver checks it before accepting
 * anything. Turning it off also clears records still waiting in the queue.
 */
export async function saveAapsLocalTreatmentRoute(enabled: boolean): Promise<boolean> {
  const save = T1ArcGlucoseDisplay.setAapsLocalTreatmentsEnabledAsync;
  if (typeof save !== 'function') {
    throw new Error('This build cannot read AAPS treatment broadcasts on this phone.');
  }
  const lease = await acquireLocalDataWriteLease();
  const status = await save.call(T1ArcGlucoseDisplay, enabled, lease.epoch);
  return status.localRouteEnabled === true;
}

const DRAIN_BATCH_SIZE = 200;
const MAX_DRAIN_PASSES = 10;

const STRING_FIELDS: Record<string, number> = {
  identifier: 80,
  eventType: 40,
  created_at: 40,
  type: 20,
  notes: 240,
  reason: 80,
  profile: 80,
  originalProfileName: 80,
  units: 8,
  enteredBy: 80,
  pumpType: 40,
};

const NUMBER_FIELDS = new Set([
  'date',
  'mills',
  'insulin',
  'carbs',
  'duration',
  'durationInMilliseconds',
  'enteredinsulin',
  'splitNow',
  'splitExt',
  'relative',
  'targetTop',
  'targetBottom',
  'percentage',
  'timeshift',
  'pumpId',
]);

const BOOLEAN_FIELDS = new Set(['isValid', 'isSMB', 'isEmulatingTempBasal']);

/**
 * Copies only the listed fields with the expected types. Native intake has
 * already range-checked them; this keeps the JS boundary explicit as well.
 */
export function aapsLocalTreatmentToNightscout(
  pending: AapsLocalTreatment,
): NightscoutTreatment | undefined {
  const source = pending.treatment;
  if (!source || typeof source !== 'object') return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(source)) {
    const maxLength = STRING_FIELDS[key];
    if (maxLength !== undefined) {
      if (typeof value === 'string' && value.length > 0 && value.length <= maxLength) {
        result[key] = value;
      }
    } else if (NUMBER_FIELDS.has(key)) {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value === 'boolean') result[key] = value;
    }
  }
  if (typeof result.identifier !== 'string' || typeof result.eventType !== 'string') {
    return undefined;
  }
  return result as NightscoutTreatment;
}

/**
 * AAPS re-sends a treatment when it changes and marks a deleted one
 * `isValid: false`. Within one batch the latest copy of each record wins.
 */
export function normalizeAapsLocalTreatments(
  pending: readonly AapsLocalTreatment[],
  importedAt: number,
): NormalizedNightscoutTreatments & { rejected: number } {
  const latest = new Map<
    string,
    { receivedAt: number; senderVerified: boolean; treatment: NightscoutTreatment }
  >();
  let rejected = 0;
  for (const item of pending) {
    const treatment = aapsLocalTreatmentToNightscout(item);
    if (!treatment) {
      rejected += 1;
      continue;
    }
    const key = treatment.identifier as string;
    const previous = latest.get(key);
    if (!previous || item.receivedAt >= previous.receivedAt) {
      latest.set(key, {
        receivedAt: item.receivedAt,
        senderVerified: item.senderVerified === true,
        treatment,
      });
    }
  }
  const ordered = [...latest.values()].sort(
    (left, right) =>
      left.receivedAt - right.receivedAt ||
      String(left.treatment.identifier).localeCompare(String(right.treatment.identifier)),
  );
  const part = (verified: boolean) =>
    normalizeNightscoutTreatments(
      ordered.filter((item) => item.senderVerified === verified).map((item) => item.treatment),
      [],
      importedAt,
      verified ? AAPS_LOCAL_VERIFIED_TREATMENT_ORIGIN : AAPS_LOCAL_TREATMENT_ORIGIN,
    );
  const unverified = part(false);
  const verified = part(true);
  const bounds = (pick: (value: NormalizedNightscoutTreatments) => number | undefined) =>
    [pick(unverified), pick(verified)].filter((value): value is number => value !== undefined);
  const starts = bounds((value) => value.dataStart);
  const ends = bounds((value) => value.dataThrough);
  return {
    basal: [...unverified.basal, ...verified.basal],
    boluses: [...unverified.boluses, ...verified.boluses].sort(
      (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    ),
    context: [...unverified.context, ...verified.context].sort(
      (left, right) => left.start - right.start || left.id.localeCompare(right.id),
    ),
    rawRecords: [...unverified.rawRecords, ...verified.rawRecords],
    skipped: unverified.skipped + verified.skipped,
    withdrawn: unverified.withdrawn + verified.withdrawn,
    revisedRecordIds: [...unverified.revisedRecordIds, ...verified.revisedRecordIds],
    dataStart: starts.length ? Math.min(...starts) : undefined,
    dataThrough: ends.length ? Math.max(...ends) : undefined,
    rejected,
  };
}

async function drainOnce(store: HealthRecordStore, clock: () => number) {
  const peek = T1ArcGlucoseDisplay.peekAapsTreatmentsAsync;
  const acknowledge = T1ArcGlucoseDisplay.acknowledgeAapsTreatmentsAsync;
  if (typeof peek !== 'function' || typeof acknowledge !== 'function') return 0;
  const status = await getAapsLocalSourceStatus();
  if (!status.supported || status.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) return 0;
  // Native code already refuses broadcasts and empties the queue while the
  // switch is off; this keeps the JS side from importing anything either.
  if (!(await loadAapsLocalTreatmentRoute())) return 0;
  const lease = await acquireLocalDataWriteLease();
  if (status.writeEpoch !== lease.epoch) return 0;
  const pending = (await peek.call(T1ArcGlucoseDisplay, DRAIN_BATCH_SIZE)).filter(
    (item) =>
      item.writeEpoch === lease.epoch &&
      item.selectionGeneration === status.selectionGeneration,
  );
  if (pending.length === 0) return 0;
  const importedAt = clock();
  const normalized = normalizeAapsLocalTreatments(pending, importedAt);
  const payload = JSON.stringify(
    [...pending].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const fileSha256 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
  );
  await store.writeImport(
    {
      id: `${AAPS_LOCAL_SOURCE_ID}:${fileSha256.slice(0, 32)}`,
      sourceId: AAPS_LOCAL_SOURCE_ID,
      fileName: 'AAPS treatments received on this phone',
      fileSha256,
      importedAt,
      dataStart: normalized.dataStart,
      dataThrough: normalized.dataThrough,
      skippedCount: normalized.skipped + normalized.rejected,
      warnings: normalized.withdrawn > 0
        ? [
            `${normalized.withdrawn} AAPS treatment${normalized.withdrawn === 1 ? ' was' : 's were'} marked withdrawn and ${normalized.withdrawn === 1 ? 'is' : 'are'} not counted.`,
          ]
        : [],
    },
    normalized.basal,
    normalized.boluses,
    normalized.context,
    undefined,
    [],
    normalized.rawRecords,
    { revisedRecordIds: normalized.revisedRecordIds },
  );
  // A crash between commit and acknowledgement replays an idempotent batch.
  await acknowledge.call(
    T1ArcGlucoseDisplay,
    pending.map((item) => item.id),
    status.selectionGeneration,
    lease.epoch,
  );
  return pending.length;
}

let drainInFlight: Promise<number> | undefined;

/** Moves AAPS treatments from the encrypted native queue into local history. */
export function drainAapsLocalTreatments(
  store: HealthRecordStore,
  clock: () => number = Date.now,
): Promise<number> {
  if (drainInFlight) return drainInFlight;
  drainInFlight = (async () => {
    let processed = 0;
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const count = await drainOnce(store, clock);
      processed += count;
      if (count < DRAIN_BATCH_SIZE) break;
    }
    return processed;
  })().finally(() => {
    drainInFlight = undefined;
  });
  return drainInFlight;
}
