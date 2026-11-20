import type { SQLiteDatabase } from 'expo-sqlite';

import T1ArcGlucoseDisplay from '../../../modules/t1arc-glucose-display';
import { invalidateGlucoseAlertsForSourceReplacement } from '@/data/glucoseAlerts/glucoseAlertPreferences';
import { upsertGlucoseReadingsInTransaction } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';
import {
  acquireLocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

import { normalizeAapsReading } from './normalizeAapsReading';
import { archiveAapsGlucoseInTransaction } from './archiveAapsHistory';
import { AAPS_NO_SOURCE_ID, AAPS_LOCAL_SOURCE_ID, type AapsContextObservation, type AapsLocalReading, type AapsLocalStatus } from './types';

const MAX_DRAIN_PASSES = 10;
const DRAIN_BATCH_SIZE = 100;
/** Approx. 90 days of minute observations, with a hard cap for bursty broadcasts. */
const AAPS_CONTEXT_RETENTION_MS = 90 * 24 * 60 * 60_000;
const MAX_RETAINED_OBSERVATIONS = 150_000;

interface ContextRow {
  id: string;
  received_at_ms: number;
  write_epoch: number;
  selection_generation: number;
  glucose_timestamp_ms: number | null;
  glucose_mgdl: number | null;
  trend: string | null;
  raw_trend: string | null;
  delta_mgdl: number | null;
  avg_delta_mgdl: number | null;
  iob_units: number | null;
  bolus_iob_units: number | null;
  basal_iob_units: number | null;
  cob_grams: number | null;
  future_carbs_grams: number | null;
  display_units: string | null;
  reconciliation_scope: 'local' | 'restored';
}

function contextFromRow(row: ContextRow): AapsContextObservation {
  return {
    id: row.id,
    receivedAt: row.received_at_ms,
    writeEpoch: row.write_epoch,
    selectionGeneration: row.selection_generation,
    glucoseTimestamp: row.glucose_timestamp_ms ?? undefined,
    glucoseMgdl: row.glucose_mgdl ?? undefined,
    trend: (row.trend ?? undefined) as AapsContextObservation['trend'],
    rawTrend: row.raw_trend ?? undefined,
    deltaMgdl: row.delta_mgdl ?? undefined,
    avgDeltaMgdl: row.avg_delta_mgdl ?? undefined,
    iobUnits: row.iob_units ?? undefined,
    bolusIobUnits: row.bolus_iob_units ?? undefined,
    basalIobUnits: row.basal_iob_units ?? undefined,
    cobGrams: row.cob_grams ?? undefined,
    futureCarbsGrams: row.future_carbs_grams ?? undefined,
    displayUnits: row.display_units ?? undefined,
    reconciliationScope: row.reconciliation_scope,
  };
}

async function insertObservation(transaction: SQLiteDatabase, observation: AapsContextObservation) {
  await transaction.runAsync(
    `INSERT OR IGNORE INTO aaps_status_observations (
      id, received_at_ms, write_epoch, selection_generation,
      glucose_timestamp_ms, glucose_mgdl, trend, raw_trend, delta_mgdl, avg_delta_mgdl,
      iob_units, bolus_iob_units, basal_iob_units, cob_grams,
      future_carbs_grams, display_units, reconciliation_scope
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')`,
    observation.id,
    observation.receivedAt,
    observation.writeEpoch,
    observation.selectionGeneration,
    observation.glucoseTimestamp ?? null,
    observation.glucoseMgdl ?? null,
    observation.trend ?? null,
    observation.rawTrend ?? null,
    observation.deltaMgdl ?? null,
    observation.avgDeltaMgdl ?? null,
    observation.iobUnits ?? null,
    observation.bolusIobUnits ?? null,
    observation.basalIobUnits ?? null,
    observation.cobGrams ?? null,
    observation.futureCarbsGrams ?? null,
    observation.displayUnits ?? null,
  );
}

export async function getAapsLocalSourceStatus(): Promise<AapsLocalStatus> {
  return T1ArcGlucoseDisplay.getAapsLocalStatusAsync();
}

/** An unreadable selector must never cause a quiet return to cloud glucose. */
export async function getSelectedGlucoseSourceId(): Promise<string | undefined> {
  try {
    const status = await getAapsLocalSourceStatus();
    return status.supported ? status.selectedSourceId : undefined;
  } catch {
    return AAPS_NO_SOURCE_ID;
  }
}

export async function getSelectedGlucoseSourceState() {
  try {
    const status = await getAapsLocalSourceStatus();
    return {
      sourceId: status.supported ? status.selectedSourceId : undefined,
      generation: status.selectionGeneration,
    };
  } catch {
    return { sourceId: AAPS_NO_SOURCE_ID, generation: -1 };
  }
}

let drainInFlight: Promise<number> | undefined;

async function drainOnce(status: AapsLocalStatus): Promise<number> {
  const lease = await acquireLocalDataWriteLease();
  if (status.writeEpoch !== lease.epoch) return 0;
  const pending: AapsLocalReading[] =
    await T1ArcGlucoseDisplay.peekAapsReadingsAsync(DRAIN_BATCH_SIZE);
  if (pending.length === 0) return 0;

  const parsed = pending
    .filter((reading) =>
      reading.writeEpoch === lease.epoch &&
      reading.selectionGeneration === status.selectionGeneration,
    )
    .map((reading) => normalizeAapsReading(reading))
    .filter((reading) => reading !== undefined);
  const current = await withLocalDataWriteLeaseTransaction(lease, async (transaction) => {
    const selected = await getAapsLocalSourceStatus();
    if (
      selected.selectedSourceId !== AAPS_LOCAL_SOURCE_ID ||
      selected.selectionGeneration !== status.selectionGeneration ||
      selected.writeEpoch !== lease.epoch
    ) return false;

    const glucose = parsed
      .flatMap((observation) => observation.glucose ? [observation.glucose] : [])
      .sort((left, right) => left.receivedAt - right.receivedAt);
    await upsertGlucoseReadingsInTransaction(transaction, glucose);
    for (const observation of parsed) {
      await insertObservation(transaction, observation.context);
    }
    await transaction.runAsync(
      'DELETE FROM aaps_status_observations WHERE received_at_ms < ?',
      Date.now() - AAPS_CONTEXT_RETENTION_MS,
    );
    const bounds = await transaction.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM aaps_status_observations',
    );
    if ((bounds?.count ?? 0) > MAX_RETAINED_OBSERVATIONS) {
      await transaction.runAsync(
        `DELETE FROM aaps_status_observations WHERE id NOT IN (
          SELECT id FROM aaps_status_observations
          ORDER BY received_at_ms DESC, id DESC LIMIT ?
        )`,
        MAX_RETAINED_OBSERVATIONS,
      );
    }
    return true;
  });
  if (!current) return 0;
  // A crash between commit and ack replays an idempotent batch.
  await T1ArcGlucoseDisplay.acknowledgeAapsReadingsAsync(
    pending.map((reading) => reading.id),
    status.selectionGeneration,
    lease.epoch,
  );
  return pending.length;
}

export function drainAapsLocalReadings(): Promise<number> {
  if (drainInFlight) return drainInFlight;
  drainInFlight = (async () => {
    let processed = 0;
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const status = await getAapsLocalSourceStatus();
      if (!status.supported || status.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) break;
      const count = await drainOnce(status);
      processed += count;
      if (count < DRAIN_BATCH_SIZE) break;
    }
    return processed;
  })().finally(() => { drainInFlight = undefined; });
  return drainInFlight;
}

export async function getLatestAapsContext(): Promise<AapsContextObservation | undefined> {
  await drainAapsLocalReadings();
  const status = await getAapsLocalSourceStatus();
  if (!status.supported || status.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
    return undefined;
  }
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<ContextRow>(
    `SELECT * FROM aaps_status_observations
     WHERE reconciliation_scope = 'local'
       AND write_epoch = ? AND selection_generation = ?
     ORDER BY received_at_ms DESC, id DESC LIMIT 1`,
    status.writeEpoch, status.selectionGeneration,
  );
  const current = await getAapsLocalSourceStatus();
  if (
    current.selectedSourceId !== AAPS_LOCAL_SOURCE_ID ||
    current.writeEpoch !== status.writeEpoch ||
    current.selectionGeneration !== status.selectionGeneration
  ) return undefined;
  return row ? contextFromRow(row) : undefined;
}

/**
 * Call while holding the local-data write transaction used to persist demo
 * mode. The native selection is cleared before any demo repository is exposed.
 */
export async function stopAapsLocalSourceForDemoInTransaction(
  lease: LocalDataWriteLease,
): Promise<boolean> {
  const current = await getAapsLocalSourceStatus();
  if (!current.supported || current.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
    return false;
  }
  await invalidateGlucoseAlertsForSourceReplacement();
  const stopped = await T1ArcGlucoseDisplay.setLocalGlucoseSourceAsync(
    AAPS_NO_SOURCE_ID, lease.epoch,
  );
  if (stopped.selectedSourceId !== AAPS_NO_SOURCE_ID) {
    throw new Error('AAPS local glucose could not be stopped for demo mode.');
  }
  return true;
}

async function assertAapsCanBeEnabled() {
  const { loadDataMode } = await import('@/data/libreLinkUp/secureStore');
  if (await loadDataMode() === 'demo') {
    throw new Error('Leave demo mode before enabling AAPS local glucose.');
  }
}

async function setSelection(sourceId: string) {
  const lease = await acquireLocalDataWriteLease();
  let observedSelection: AapsLocalStatus | undefined;
  if (sourceId === AAPS_LOCAL_SOURCE_ID) {
    // Commit this archive before native AAPS selection becomes durable. If the
    // process dies after native selection but before a later SQLite COMMIT,
    // no previous AAPS glucose row can revive as this session's latest value.
    await withLocalDataWriteLeaseTransaction(lease, async (transaction) => {
      const before = await getAapsLocalSourceStatus();
      if (!before.supported) throw new Error('AAPS local broadcasts are only available on Android.');
      observedSelection = before;
      await assertAapsCanBeEnabled();
      if (before.selectedSourceId === AAPS_LOCAL_SOURCE_ID) return;
      await archiveAapsGlucoseInTransaction(
        transaction, before.writeEpoch, before.selectionGeneration,
      );
      await transaction.runAsync('DELETE FROM source_sync_state WHERE source_id = ?', AAPS_LOCAL_SOURCE_ID);
    });
  }
  const status = await withLocalDataWriteLeaseTransaction(lease, async () => {
    const before = await getAapsLocalSourceStatus();
    if (!before.supported) throw new Error('AAPS local broadcasts are only available on Android.');
    if (sourceId === AAPS_LOCAL_SOURCE_ID) {
      await assertAapsCanBeEnabled();
    }
    if (before.selectedSourceId === sourceId) return before;
    if (
      observedSelection &&
      (before.selectedSourceId !== observedSelection.selectedSourceId ||
        before.selectionGeneration !== observedSelection.selectionGeneration)
    ) throw new Error('The active glucose source changed during AAPS setup.');
    await invalidateGlucoseAlertsForSourceReplacement();
    const next = await T1ArcGlucoseDisplay.setLocalGlucoseSourceAsync(sourceId, lease.epoch);
    return next;
  });
  const { updateGlucoseDisplayFromHistory } = await import('@/data/glucoseDisplay/glucoseDisplayCoordinator');
  await drainAapsLocalReadings();
  await updateGlucoseDisplayFromHistory();
  return status;
}

export function enableAapsLocalSource(): Promise<AapsLocalStatus> {
  return setSelection(AAPS_LOCAL_SOURCE_ID);
}

export function disableAapsLocalSource(): Promise<AapsLocalStatus> {
  return setSelection(AAPS_NO_SOURCE_ID);
}
