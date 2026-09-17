import * as Crypto from 'expo-crypto';

import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from '@/data/persistence/t1arcDatabase';
import {
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

export type AutomationRunConnector =
  'glucose' | 'glooko' | 'health-connect' | 'insight-review';

/**
 * Connectors shown in the user-facing automation status. Hevy intentionally
 * has no persisted AutomationRun yet: the installed database constrains the
 * historical connector values, so its status is derived from its durable
 * source-sync state instead of risking a destructive table migration.
 */
export type AutomationConnector = AutomationRunConnector | 'hevy';

export type AutomationOutcome =
  'running' | 'success' | 'partial' | 'skipped' | 'needs-attention' | 'failed';

export interface AutomationRun {
  id: string;
  connector: AutomationRunConnector;
  trigger: 'background';
  startedAt: number;
  completedAt?: number;
  outcome: AutomationOutcome;
  recordsProcessed: number;
  recordsRemoved: number;
  detail?: string;
}

interface AutomationRunRow {
  id: string;
  connector: AutomationRunConnector;
  trigger: 'background';
  started_at_ms: number;
  completed_at_ms: number | null;
  outcome: AutomationOutcome;
  records_processed: number;
  records_removed: number;
  detail: string | null;
}

const RUNS_RETAINED_PER_CONNECTOR = 30;
export const AUTOMATION_RUN_STALE_AFTER_MS = 15 * 60 * 1000;
const INTERRUPTED_DETAIL =
  'Android stopped this update before it reported completion. T1 Arc will try again automatically.';

function safeCount(value?: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function safeDetail(value?: string) {
  const detail = value?.replace(/\s+/g, ' ').trim().slice(0, 240);
  return detail || undefined;
}

function fromRow(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    connector: row.connector,
    trigger: row.trigger,
    startedAt: row.started_at_ms,
    completedAt: row.completed_at_ms ?? undefined,
    outcome: row.outcome,
    recordsProcessed: row.records_processed,
    recordsRemoved: row.records_removed,
    detail: row.detail ?? undefined,
  };
}

async function reconcileInterruptedRunsInDatabase(
  database: Awaited<ReturnType<typeof openT1ArcDatabase>>,
  now: number,
) {
  const result = await database.runAsync(
    `UPDATE automation_runs
     SET completed_at_ms = started_at_ms + ?,
         outcome = 'failed',
         detail = ?
     WHERE outcome = 'running'
       AND started_at_ms <= ?`,
    AUTOMATION_RUN_STALE_AFTER_MS,
    INTERRUPTED_DETAIL,
    now - AUTOMATION_RUN_STALE_AFTER_MS,
  );
  return result.changes;
}

export function isInterruptedAutomationRun(run: AutomationRun) {
  return run.outcome === 'failed' && run.detail === INTERRUPTED_DETAIL;
}

export async function reconcileInterruptedAutomationRuns(now = Date.now()) {
  const database = await openT1ArcDatabase();
  return reconcileInterruptedRunsInDatabase(database, now);
}

export async function beginAutomationRun(
  connector: AutomationRunConnector,
  startedAt = Date.now(),
  writeLease?: LocalDataWriteLease,
) {
  const id = Crypto.randomUUID();
  await withT1ArcTransaction(async (database) => {
    if (writeLease) {
      // Keep the epoch comparison as the first operation in this transaction.
      await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    }
    await reconcileInterruptedRunsInDatabase(database, startedAt);
    await database.runAsync(
      `INSERT INTO automation_runs (
         id, connector, trigger, started_at_ms, outcome
       ) VALUES (?, ?, 'background', ?, 'running')`,
      id,
      connector,
      startedAt,
    );
  });
  return id;
}

export async function finishAutomationRun(
  id: string,
  result: {
    outcome: Exclude<AutomationOutcome, 'running'>;
    completedAt?: number;
    recordsProcessed?: number;
    recordsRemoved?: number;
    detail?: string;
  },
  writeLease?: LocalDataWriteLease,
) {
  const completedAt = result.completedAt ?? Date.now();
  await withT1ArcTransaction(async (database) => {
    if (writeLease) {
      // Keep the epoch comparison as the first operation in this transaction.
      await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    }
    await database.runAsync(
      `UPDATE automation_runs
       SET completed_at_ms = ?,
           outcome = ?,
           records_processed = ?,
           records_removed = ?,
           detail = ?
       WHERE id = ?`,
      completedAt,
      result.outcome,
      safeCount(result.recordsProcessed),
      safeCount(result.recordsRemoved),
      safeDetail(result.detail) ?? null,
      id,
    );
    const stored = await database.getFirstAsync<{
      connector: AutomationRunConnector;
    }>('SELECT connector FROM automation_runs WHERE id = ?', id);
    if (!stored) return;
    await database.runAsync(
      `DELETE FROM automation_runs
       WHERE connector = ?
         AND id NOT IN (
           SELECT id FROM automation_runs
           WHERE connector = ?
           ORDER BY started_at_ms DESC
           LIMIT ?
         )`,
      stored.connector,
      stored.connector,
      RUNS_RETAINED_PER_CONNECTOR,
    );
  });
}

export async function listAutomationRuns(limit = 20) {
  const database = await openT1ArcDatabase();
  await reconcileInterruptedRunsInDatabase(database, Date.now());
  const rows = await database.getAllAsync<AutomationRunRow>(
    `SELECT id, connector, trigger, started_at_ms, completed_at_ms,
       outcome, records_processed, records_removed, detail
     FROM automation_runs
     ORDER BY started_at_ms DESC
     LIMIT ?`,
    Math.max(1, Math.min(100, Math.floor(limit))),
  );
  return rows.map(fromRow);
}
