import T1ArcGlucoseDisplay, {
  type GlucoseDisplayStatus,
} from '../../../modules/t1arc-glucose-display';
import type { SQLiteDatabase } from 'expo-sqlite';

import { GLOOKO_CGM_SOURCE_ID } from '@/data/import/glookoCsv';
import { DEXCOM_SHARE_SOURCE_ID } from '@/data/dexcomShare/types';
import { MEDTRUM_SOURCE_ID } from '@/data/medtrum/types';
import { reconcileGlucoseAlerts } from '@/data/glucoseAlerts/glucoseAlertPreferences';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from '@/data/libreLinkUp/constants';
import {
  DIRECT_LIBRE_VALIDATED_NETWORK_REASON,
  DirectLibreRefreshReason,
} from '@/data/libreLinkUp/refreshPolicy';
import { refreshConfiguredGlucoseSources } from '@/data/live/configuredGlucoseSources';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';
import { NIGHTSCOUT_SOURCE_ID } from '@/data/nightscout/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { XDRIP_SOURCE_ID } from '@/data/xdrip/types';
import { assessGlucoseTrend } from '@/domain/trend';
import type { GlucoseReading } from '@/domain/models';
import {
  GLUCOSE_DISPLAY_HEADLESS_DEADLINE_MS,
  settleHeadlessPromise,
} from './headlessTaskSettlement';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from '@/data/privacy/localDataWriteEpoch';
import {
  assertSourceConnectionWriteLeaseInTransaction,
  type SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';

export {
  GLUCOSE_DISPLAY_HEADLESS_DEADLINE_MS,
  settleHeadlessPromise,
} from './headlessTaskSettlement';

export const GLUCOSE_DISPLAY_HEADLESS_TASK =
  'T1ArcLibreForegroundSync';

const WEAR_HISTORY_WINDOW_MS = 6 * 60 * 60_000;
const MAX_WEAR_HISTORY_POINTS = 144;
const GLUCOSE_TRENDS = [
  'doubleDown',
  'down',
  'slightDown',
  'flat',
  'slightUp',
  'up',
  'doubleUp',
  'unknown',
] as const satisfies readonly GlucoseReading['trend'][];

export interface UpdateGlucoseDisplayOptions {
  allowUnchangedSkip?: boolean;
}

export interface GlucoseDisplayHeadlessTaskData {
  reason?: unknown;
}

interface ForegroundSyncState {
  promise: Promise<void>;
  controller: AbortController;
  draining: boolean;
}

let foregroundSync: ForegroundSyncState | undefined;
let pendingValidatedNetworkRecovery = false;

function validatedNetworkReason(
  taskData?: GlucoseDisplayHeadlessTaskData,
): DirectLibreRefreshReason | undefined {
  return taskData?.reason === DIRECT_LIBRE_VALIDATED_NETWORK_REASON
    ? DIRECT_LIBRE_VALIDATED_NETWORK_REASON
    : undefined;
}

function beginForegroundSync() {
  const refreshReason = pendingValidatedNetworkRecovery
    ? DIRECT_LIBRE_VALIDATED_NETWORK_REASON
    : undefined;
  pendingValidatedNetworkRecovery = false;
  const active: ForegroundSyncState = {
    // Replaced below before the queued work can run.
    promise: Promise.resolve(),
    controller: new AbortController(),
    draining: false,
  };
  foregroundSync = active;
  const work = Promise.resolve().then(async () => {
    const writeLease = await acquireLocalDataWriteLease();
    try {
      await refreshConfiguredGlucoseSources(undefined, {
        reason: refreshReason,
        signal: active.controller.signal,
        writeLease,
      });
    } finally {
      // Cached history is still useful when a configured source is temporarily
      // unavailable; the native display marks it delayed or stale.
      await updateGlucoseDisplayFromHistoryWithLease(writeLease, {
        allowUnchangedSkip: true,
      });
    }
  });
  active.promise = work.finally(() => {
    // A timed-out task remains the owner while its work drains. Only that
    // owner's settlement may release the slot for a later native tick.
    if (foregroundSync === active) foregroundSync = undefined;
  });
  return active;
}

function displaySourceLabel(sourceId: string) {
  if (sourceId === DIRECT_LIBRE_LINKUP_SOURCE_ID) {
    return 'T1 Arc direct LibreLinkUp';
  }
  if (sourceId === NOTIFICATION_SOURCE_ID) {
    return 'Phone notification source';
  }
  if (sourceId === GLOOKO_CGM_SOURCE_ID) {
    return 'Glooko glucose history';
  }
  if (sourceId === NIGHTSCOUT_SOURCE_ID) {
    return 'Nightscout';
  }
  if (sourceId === XDRIP_SOURCE_ID) {
    return 'xDrip-compatible endpoint';
  }
  if (sourceId === DEXCOM_SHARE_SOURCE_ID) {
    return 'Dexcom Share';
  }
  if (sourceId === MEDTRUM_SOURCE_ID) {
    return 'Medtrum EasyFollow';
  }
  return 'Personal glucose source';
}

export function glucoseDisplayAlreadyPublished(
  display: Pick<
    GlucoseDisplayStatus,
    | 'latestTimestamp'
    | 'latestMmolL'
    | 'latestTrend'
    | 'latestTrendOrigin'
    | 'latestSourceLabel'
  >,
  reading: GlucoseReading,
  sourceLabel: string,
) {
  const trendAlreadyPublished =
    reading.trend === 'unknown'
      ? Boolean(display.latestTrend && display.latestTrendOrigin)
      : display.latestTrend === reading.trend &&
        display.latestTrendOrigin === 'source';
  return (
    display.latestTimestamp === reading.timestamp &&
    display.latestMmolL === reading.mmolL &&
    trendAlreadyPublished &&
    display.latestSourceLabel === sourceLabel
  );
}

function displayTrendOrReadingTrend(
  displayTrend: string | undefined,
  readingTrend: GlucoseReading['trend'],
) {
  return GLUCOSE_TRENDS.some((trend) => trend === displayTrend)
    ? (displayTrend as GlucoseReading['trend'])
    : readingTrend;
}

type PreparedGlucoseDisplayPublication =
  | { kind: 'unsupported' }
  | { kind: 'missing' }
  | {
      kind: 'unchanged';
      reading: GlucoseReading;
      trend: GlucoseReading['trend'];
      latestIdentity: string;
    }
  | {
      kind: 'reading';
      reading: GlucoseReading;
      trend: ReturnType<typeof assessGlucoseTrend>;
      sourceLabel: string;
      sourceHasError: boolean;
      history: { mmolL: number; timestampMs: number }[];
      latestIdentity: string;
      historyIdentity: string;
    };

interface PublicationIdentityRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  received_at_ms: number;
  mmol_l: number;
  trend: string;
  source_device_id: string | null;
}

function canonicalPublicationSourceDeviceId(
  sourceDeviceId: string | null | undefined,
) {
  // The SQLite identity schema stores an absent device ID as an empty string,
  // while readingFromRow exposes that same absence as undefined. Compare the
  // canonical persisted representation so the currentness fence does not
  // reject a byte-for-byte unchanged Libre/xDrip row before native publication.
  return sourceDeviceId ?? '';
}

function publicationReadingIdentity(
  reading: Pick<
    GlucoseReading,
    | 'id'
    | 'sourceId'
    | 'timestamp'
    | 'receivedAt'
    | 'mmolL'
    | 'trend'
    | 'sourceDeviceId'
  >,
) {
  return JSON.stringify([
    reading.id,
    reading.sourceId,
    reading.timestamp,
    reading.receivedAt,
    reading.mmolL,
    reading.trend,
    canonicalPublicationSourceDeviceId(reading.sourceDeviceId),
  ]);
}

function rowPublicationIdentity(row: PublicationIdentityRow) {
  return JSON.stringify([
    row.id,
    row.source_id,
    row.timestamp_ms,
    row.received_at_ms,
    row.mmol_l,
    row.trend,
    canonicalPublicationSourceDeviceId(row.source_device_id),
  ]);
}

function publicationHistoryIdentity(readings: readonly GlucoseReading[]) {
  return JSON.stringify(readings.map(publicationReadingIdentity));
}

/** Performs potentially long reads and trend calculation before taking a writer lock. */
async function prepareGlucoseDisplayPublication(
  options: UpdateGlucoseDisplayOptions = {},
): Promise<PreparedGlucoseDisplayPublication> {
  const display = await T1ArcGlucoseDisplay.getStatusAsync();
  // The native snapshot also feeds Wear OS. Watch sync must not depend on
  // whether the phone notification or Pixel always-on overlay is enabled.
  if (!display.supported) return { kind: 'unsupported' };

  const store = new SqliteGlucoseHistoryStore();
  await store.initialize();
  const reading = await store.getLatestReading();
  if (!reading) {
    return { kind: 'missing' };
  }
  const sourceLabel = displaySourceLabel(reading.sourceId);
  if (
    options.allowUnchangedSkip &&
    glucoseDisplayAlreadyPublished(display, reading, sourceLabel)
  ) {
    // The native service re-ages its own notification/widget/AOD snapshot.
    // Re-reading six hours of encrypted history and republishing Wear/Auto on
    // every periodic headless source tick adds no value when the stored
    // reading is byte-for-byte the one already published. Alerts still
    // reconcile so stale and repeat policies continue to advance with wall time.
    return {
      kind: 'unchanged',
      reading,
      trend: displayTrendOrReadingTrend(display.latestTrend, reading.trend),
      latestIdentity: publicationReadingIdentity(reading),
    };
  }
  const syncState = await store.getSyncState(reading.sourceId);
  const historyReadings = await store.getReadings(
    {
      start: reading.timestamp - WEAR_HISTORY_WINDOW_MS,
      end: reading.timestamp + 1,
    },
    reading.sourceId,
  );
  const recentReadings =
    reading.trend === 'unknown'
      ? historyReadings.filter(
          (candidate) =>
            candidate.timestamp >= reading.timestamp - 20 * 60_000,
        )
      : [reading];
  const trend = assessGlucoseTrend(reading, recentReadings);
  return {
    kind: 'reading',
    reading,
    trend,
    sourceLabel,
    sourceHasError: Boolean(syncState?.lastErrorCode),
    history: historyReadings
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-MAX_WEAR_HISTORY_POINTS)
      .map((candidate) => ({
        mmolL: candidate.mmolL,
        timestampMs: candidate.timestamp,
      })),
    latestIdentity: publicationReadingIdentity(reading),
    historyIdentity: publicationHistoryIdentity(historyReadings),
  };
}

async function preparedPublicationStillCurrent(
  transaction: SQLiteDatabase,
  prepared: PreparedGlucoseDisplayPublication,
) {
  if (prepared.kind === 'unsupported') return true;
  const latest = await transaction.getFirstAsync<PublicationIdentityRow>(
    `SELECT id, source_id, timestamp_ms, received_at_ms, mmol_l, trend,
            source_device_id
       FROM glucose_readings
      ORDER BY timestamp_ms DESC, received_at_ms DESC,
               source_device_id ASC, id ASC
      LIMIT 1`,
  );
  if (prepared.kind === 'missing') return !latest;
  if (!latest || rowPublicationIdentity(latest) !== prepared.latestIdentity) {
    return false;
  }
  if (prepared.kind === 'unchanged') return true;

  const syncState = await transaction.getFirstAsync<{
    last_error_code: string | null;
  }>(
    `SELECT last_error_code
       FROM source_sync_state
      WHERE source_id = ?`,
    prepared.reading.sourceId,
  );
  if (Boolean(syncState?.last_error_code) !== prepared.sourceHasError) {
    return false;
  }
  const history = await transaction.getAllAsync<PublicationIdentityRow>(
    `SELECT id, source_id, timestamp_ms, received_at_ms, mmol_l, trend,
            source_device_id
       FROM glucose_readings
      WHERE timestamp_ms >= ? AND timestamp_ms < ? AND source_id = ?
      ORDER BY timestamp_ms ASC, source_device_id ASC, id ASC`,
    prepared.reading.timestamp - WEAR_HISTORY_WINDOW_MS,
    prepared.reading.timestamp + 1,
    prepared.reading.sourceId,
  );
  return (
    JSON.stringify(history.map(rowPublicationIdentity)) ===
    prepared.historyIdentity
  );
}

async function commitPreparedGlucoseDisplayPublication(
  lease: LocalDataWriteLease,
  prepared: PreparedGlucoseDisplayPublication,
) {
  if (prepared.kind === 'unsupported') return true;
  if (prepared.kind === 'missing') {
    await T1ArcGlucoseDisplay.updatePrivateGlucoseForWriteEpochAsync(
      lease.epoch,
      null,
      [],
      'No personal glucose reading',
    );
    await reconcileGlucoseAlerts(undefined).catch(() => undefined);
    return true;
  }
  if (prepared.kind === 'unchanged') {
    await reconcileGlucoseAlerts(prepared.reading, prepared.trend).catch(
      () => undefined,
    );
    return true;
  }

  const historyUpdated =
    await T1ArcGlucoseDisplay.updatePrivateGlucoseForWriteEpochAsync(
      lease.epoch,
      {
        mmolL: prepared.reading.mmolL,
        trend: prepared.trend.direction,
        timestampMs: prepared.reading.timestamp,
        sourceLabel: prepared.sourceLabel,
        sourceHasError: prepared.sourceHasError,
        trendOrigin: prepared.trend.origin,
      },
      prepared.history,
      'No personal glucose reading',
    );
  await reconcileGlucoseAlerts(
    prepared.reading,
    prepared.trend.direction,
  ).catch(() => undefined);
  return historyUpdated;
}

export async function runGlucoseDisplayForegroundSync(
  taskData?: GlucoseDisplayHeadlessTaskData,
) {
  if (validatedNetworkReason(taskData)) {
    // Network callbacks are edge events. Preserve one coalesced recovery edge
    // while an older headless owner drains; its next successor consumes it.
    pendingValidatedNetworkRecovery = true;
  }
  const active = foregroundSync ?? beginForegroundSync();
  // The first Headless JS invocation already bounded and observed this work.
  // Subsequent native ticks should finish immediately while it drains, without
  // either overlapping configured sources or waiting through another deadline.
  if (active.draining) return;
  const completed = await settleHeadlessPromise(
    active.promise,
    GLUCOSE_DISPLAY_HEADLESS_DEADLINE_MS,
    () => active.controller.abort(),
  );
  if (!completed && foregroundSync === active) {
    active.draining = true;
  }
}

/** Prevents stale work from publishing glucose, alerts, Wear or Android Auto. */
export async function updateGlucoseDisplayFromHistoryWithLease(
  lease: LocalDataWriteLease,
  options: UpdateGlucoseDisplayOptions = {},
  beforePublication?: () => void,
  sourceWriteLease?: SourceConnectionWriteLease,
) {
  let prepared = await prepareGlucoseDisplayPublication(options);
  let hookPending = true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await withLocalDataWriteLeaseTransaction(
      lease,
      async (transaction) => {
        if (sourceWriteLease) {
          await assertSourceConnectionWriteLeaseInTransaction(
            transaction,
            sourceWriteLease,
            sourceWriteLease.sourceId,
          );
        }
        if (hookPending) {
          hookPending = false;
          beforePublication?.();
        }
        if (!(await preparedPublicationStillCurrent(transaction, prepared))) {
          return { retry: true as const };
        }
        return {
          retry: false as const,
          value: await commitPreparedGlucoseDisplayPublication(lease, prepared),
        };
      },
    );
    if (!outcome.retry) return outcome.value;
    prepared = await prepareGlucoseDisplayPublication(options);
  }
  // A continuously moving latest row is benign supersession. Do not publish,
  // alert, or surface an error using a snapshot that has already been replaced.
  return false;
}

/** Short foreground callers still receive the same full erase boundary. */
export async function updateGlucoseDisplayFromHistory(
  options: UpdateGlucoseDisplayOptions = {},
) {
  const lease = await acquireLocalDataWriteLease();
  return updateGlucoseDisplayFromHistoryWithLease(lease, options);
}

export async function disableGlucoseDisplay() {
  await T1ArcGlucoseDisplay.disableAsync();
}
