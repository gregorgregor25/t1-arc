import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GlookoReportSyncState,
} from './glookoReportSyncPolicy';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';

const METADATA_KEY = 'glooko-report-sync-state-v1';

function timestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
function count(value: unknown) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.floor(value)
    : undefined;
}

function text(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

function parse(value: string): GlookoReportSyncState | undefined {
  try {
    const stored = JSON.parse(value) as Partial<GlookoReportSyncState>;
    return {
      lastAttemptAt: timestamp(stored.lastAttemptAt),
      lastSuccessAt: timestamp(stored.lastSuccessAt),
      nextEligibleAt: timestamp(stored.nextEligibleAt),
      consecutiveFailures: count(stored.consecutiveFailures) ?? 0,
      lastErrorCode: text(stored.lastErrorCode, 80),
      lastErrorMessage: text(stored.lastErrorMessage, 240),
      lastReportStart: timestamp(stored.lastReportStart),
      lastReportEnd: timestamp(stored.lastReportEnd),
      lastDailyModeCount: count(stored.lastDailyModeCount),
      lastInserted:
        typeof stored.lastInserted === 'boolean'
          ? stored.lastInserted
          : undefined,
      lastDiagnostic: text(stored.lastDiagnostic, 2_000),
    };
  } catch {
    return undefined;
  }
}

export async function loadGlookoReportSyncState() {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    METADATA_KEY,
  );
  return row
    ? parse(row.value) ?? { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE }
    : { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE };
}

export async function saveGlookoReportSyncState(
  state: GlookoReportSyncState,
) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    METADATA_KEY,
    JSON.stringify(state),
  );
}

export async function updateGlookoReportSyncState(
  update:
    | Partial<GlookoReportSyncState>
    | ((
        current: GlookoReportSyncState,
      ) => GlookoReportSyncState),
) {
  const current = await loadGlookoReportSyncState();
  const next =
    typeof update === 'function'
      ? update(current)
      : { ...current, ...update };
  await saveGlookoReportSyncState(next);
  return next;
}
