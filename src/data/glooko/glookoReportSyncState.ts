import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GlookoReportSyncState,
} from "./glookoReportSyncPolicy";
import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from "@/data/persistence/t1arcDatabase";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";

const METADATA_KEY = "glooko-report-sync-state-v1";

function timestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : undefined;
}

function parse(value: string): GlookoReportSyncState | undefined {
  try {
    const stored = JSON.parse(value) as Partial<GlookoReportSyncState>;
    return {
      lastAttemptAt: timestamp(stored.lastAttemptAt),
      lastCheckedAt: timestamp(stored.lastCheckedAt),
      lastSuccessAt: timestamp(stored.lastSuccessAt),
      nextEligibleAt: timestamp(stored.nextEligibleAt),
      consecutiveFailures: count(stored.consecutiveFailures) ?? 0,
      lastErrorCode: text(stored.lastErrorCode, 80),
      lastErrorMessage: text(stored.lastErrorMessage, 240),
      lastReportStart: timestamp(stored.lastReportStart),
      lastReportEnd: timestamp(stored.lastReportEnd),
      lastDailyModeCount: count(stored.lastDailyModeCount),
      lastActivityCount: count(stored.lastActivityCount),
      lastPauseCount: count(stored.lastPauseCount),
      lastSourceDataThrough: timestamp(stored.lastSourceDataThrough),
      lastInserted:
        typeof stored.lastInserted === "boolean"
          ? stored.lastInserted
          : undefined,
      lastDiagnostic: text(stored.lastDiagnostic, 2_000),
      inboxConfigured:
        typeof stored.inboxConfigured === "boolean"
          ? stored.inboxConfigured
          : undefined,
      lastInboxSnapshot:
        typeof stored.lastInboxSnapshot === "string" &&
        /^[0-9a-f]{64}$/.test(stored.lastInboxSnapshot)
          ? stored.lastInboxSnapshot
          : undefined,
      lastReportSource:
        stored.lastReportSource === "direct" ||
        stored.lastReportSource === "folder" ||
        stored.lastReportSource === "shared" ||
        stored.lastReportSource === "manual"
          ? stored.lastReportSource
          : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function loadGlookoReportSyncState() {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    METADATA_KEY,
  );
  return row
    ? (parse(row.value) ?? { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE })
    : { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE };
}

export async function saveGlookoReportSyncState(
  state: GlookoReportSyncState,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  await withT1ArcTransaction(async (transaction) => {
    // Keep the global privacy epoch check first after the writer lock.
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    await transaction.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      METADATA_KEY,
      JSON.stringify(state),
    );
  });
}

export async function updateGlookoReportSyncState(
  update:
    | Partial<GlookoReportSyncState>
    | ((current: GlookoReportSyncState) => GlookoReportSyncState),
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  return withT1ArcTransaction(async (transaction) => {
    // Keep the global privacy epoch check first after the writer lock.
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    const row = await transaction.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      METADATA_KEY,
    );
    const current = row
      ? (parse(row.value) ?? { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE })
      : { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE };
    const next =
      typeof update === "function"
        ? update(current)
        : { ...current, ...update };
    await transaction.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      METADATA_KEY,
      JSON.stringify(next),
    );
    return next;
  });
}
