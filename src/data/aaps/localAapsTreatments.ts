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

import { getAapsLocalSourceStatus } from './localAapsSource';
import { AAPS_LOCAL_SOURCE_ID } from './types';

/**
 * AAPS's xDrip+ sync plugin broadcasts boluses, carbs, extended boluses,
 * temporary targets, profile switches and therapy events to apps on this
 * phone. They use the Nightscout treatment shape, so the Nightscout
 * normalizer applies with on-phone provenance.
 */
export const AAPS_LOCAL_TREATMENT_ORIGIN: TreatmentRecordOrigin = {
  sourceId: AAPS_LOCAL_SOURCE_ID,
  sourceFile: 'AAPS xDrip+ broadcast',
  rawRecordKind: 'aaps-local-treatment',
};

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
  const latest = new Map<string, { receivedAt: number; treatment: NightscoutTreatment }>();
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
      latest.set(key, { receivedAt: item.receivedAt, treatment });
    }
  }
  const treatments = [...latest.values()]
    .sort(
      (left, right) =>
        left.receivedAt - right.receivedAt ||
        String(left.treatment.identifier).localeCompare(String(right.treatment.identifier)),
    )
    .map((item) => item.treatment);
  return {
    ...normalizeNightscoutTreatments(treatments, [], importedAt, AAPS_LOCAL_TREATMENT_ORIGIN),
    rejected,
  };
}

async function drainOnce(store: HealthRecordStore, clock: () => number) {
  const peek = T1ArcGlucoseDisplay.peekAapsTreatmentsAsync;
  const acknowledge = T1ArcGlucoseDisplay.acknowledgeAapsTreatmentsAsync;
  if (typeof peek !== 'function' || typeof acknowledge !== 'function') return 0;
  const status = await getAapsLocalSourceStatus();
  if (!status.supported || status.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) return 0;
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
