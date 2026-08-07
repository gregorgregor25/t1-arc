import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GLOOKO_INCREMENTAL_INTERVAL_MS,
  GlookoBackgroundOutcome,
  GlookoCheckOutcome,
  GlookoSessionStatus,
  GlookoSyncState,
} from './glookoSyncPolicy';
import { isDateKey } from './glookoBackfill';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';

const METADATA_KEY = 'glooko-sync-state-v1';
const GLOOKO_SOURCE_ID = 'glooko-export';

interface LatestImportRow {
  imported_at_ms: number;
  data_through_ms: number | null;
}

function finiteTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function finiteNonNegativeInteger(value: unknown) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.floor(value)
    : undefined;
}

function backgroundOutcome(
  value: unknown,
): GlookoBackgroundOutcome | undefined {
  return value === 'success' ||
    value === 'skipped' ||
    value === 'session-required' ||
    value === 'cancelled' ||
    value === 'failed'
    ? value
    : undefined;
}

function checkOutcome(value: unknown): GlookoCheckOutcome | undefined {
  return value === 'new-data' ||
    value === 'no-new-data' ||
    value === 'empty-range'
    ? value
    : undefined;
}

function parseState(value: string): GlookoSyncState | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<GlookoSyncState>;
    const sessionStatus: GlookoSessionStatus =
      parsed.sessionStatus === 'ready' ||
      parsed.sessionStatus === 'needs-sign-in'
        ? parsed.sessionStatus
        : 'unknown';
    return {
      automaticEnabled: parsed.automaticEnabled === true,
      sessionStatus,
      lastAttemptAt: finiteTimestamp(parsed.lastAttemptAt),
      lastCheckedAt: finiteTimestamp(parsed.lastCheckedAt),
      lastDownloadedAt: finiteTimestamp(parsed.lastDownloadedAt),
      lastDataChangedAt: finiteTimestamp(parsed.lastDataChangedAt),
      lastSuccessAt: finiteTimestamp(parsed.lastSuccessAt),
      lastAutomaticAt: finiteTimestamp(parsed.lastAutomaticAt),
      lastFullSuccessAt: finiteTimestamp(parsed.lastFullSuccessAt),
      lastExtendedSuccessAt: finiteTimestamp(
        parsed.lastExtendedSuccessAt,
      ),
      dataThrough: finiteTimestamp(parsed.dataThrough),
      nextEligibleAt: finiteTimestamp(parsed.nextEligibleAt),
      consecutiveFailures:
        finiteNonNegativeInteger(parsed.consecutiveFailures) ?? 0,
      lastErrorCode:
        typeof parsed.lastErrorCode === 'string'
          ? parsed.lastErrorCode.slice(0, 80)
          : undefined,
      lastErrorMessage:
        typeof parsed.lastErrorMessage === 'string'
          ? parsed.lastErrorMessage.slice(0, 240)
          : undefined,
      lastRangeDays:
        finiteNonNegativeInteger(parsed.lastRangeDays) || undefined,
      lastInsertedRecords:
        finiteNonNegativeInteger(parsed.lastInsertedRecords) ?? undefined,
      lastParsedRecords:
        finiteNonNegativeInteger(parsed.lastParsedRecords) ?? undefined,
      lastCheckOutcome: checkOutcome(parsed.lastCheckOutcome),
      lastRequestedStartDate: isDateKey(parsed.lastRequestedStartDate)
        ? parsed.lastRequestedStartDate
        : undefined,
      lastRequestedEndDate: isDateKey(parsed.lastRequestedEndDate)
        ? parsed.lastRequestedEndDate
        : undefined,
      lastBackgroundRunAt: finiteTimestamp(parsed.lastBackgroundRunAt),
      lastBackgroundOutcome: backgroundOutcome(
        parsed.lastBackgroundOutcome,
      ),
      lastBackgroundDetail:
        typeof parsed.lastBackgroundDetail === 'string'
          ? parsed.lastBackgroundDetail.slice(0, 160)
          : undefined,
      historyBackfillBeforeDate: isDateKey(
        parsed.historyBackfillBeforeDate,
      )
        ? parsed.historyBackfillBeforeDate
        : undefined,
      historyBackfillTargetDate: isDateKey(
        parsed.historyBackfillTargetDate,
      )
        ? parsed.historyBackfillTargetDate
        : undefined,
      lastHistoryBackfillAt: finiteTimestamp(
        parsed.lastHistoryBackfillAt,
      ),
    };
  } catch {
    return undefined;
  }
}

export async function loadGlookoSyncState(): Promise<GlookoSyncState> {
  const database = await openDaymarkDatabase();
  const stored = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    METADATA_KEY,
  );
  if (stored) {
    return parseState(stored.value) ?? { ...DEFAULT_GLOOKO_SYNC_STATE };
  }

  // Existing installations may already have a successful 30-day import from
  // the manual connector. Bootstrap automation without making the user repeat
  // that work; the silent connector will still verify the retained session.
  const latest = await database.getFirstAsync<LatestImportRow>(
    `SELECT imported_at_ms, data_through_ms
     FROM import_batches
     WHERE source_id = ?
     ORDER BY imported_at_ms DESC
     LIMIT 1`,
    GLOOKO_SOURCE_ID,
  );
  if (!latest) return { ...DEFAULT_GLOOKO_SYNC_STATE };

  const bootstrapped: GlookoSyncState = {
    automaticEnabled: true,
    sessionStatus: 'unknown',
    lastAttemptAt: latest.imported_at_ms,
    lastCheckedAt: latest.imported_at_ms,
    lastDownloadedAt: latest.imported_at_ms,
    lastDataChangedAt: latest.data_through_ms
      ? latest.imported_at_ms
      : undefined,
    lastSuccessAt: latest.imported_at_ms,
    lastFullSuccessAt: latest.imported_at_ms,
    dataThrough: latest.data_through_ms ?? undefined,
    nextEligibleAt: latest.imported_at_ms + GLOOKO_INCREMENTAL_INTERVAL_MS,
    consecutiveFailures: 0,
    lastRangeDays: 30,
    lastCheckOutcome:
      latest.data_through_ms === null ? 'empty-range' : 'new-data',
  };
  await saveGlookoSyncState(bootstrapped);
  return bootstrapped;
}

export async function saveGlookoSyncState(state: GlookoSyncState) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    METADATA_KEY,
    JSON.stringify(state),
  );
}

export async function updateGlookoSyncState(
  update:
    | Partial<GlookoSyncState>
    | ((current: GlookoSyncState) => GlookoSyncState),
) {
  const current = await loadGlookoSyncState();
  const next =
    typeof update === 'function'
      ? update(current)
      : {
          ...current,
          ...update,
        };
  await saveGlookoSyncState(next);
  return next;
}
