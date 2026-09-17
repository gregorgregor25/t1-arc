import {
  fingerprintInsightReport,
  hasInsightReviewEvidence,
  insightEvidenceRecordCount,
  insightReportId,
  INSIGHT_REPORT_SCHEMA_VERSION,
} from '@/domain/insightPersistence';
import { InsightReport } from '@/domain/insights';
import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from '@/data/persistence/t1arcDatabase';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import type { SQLiteDatabase } from 'expo-sqlite';

export const INSIGHT_INPUT_GENERATION_KEY =
  'insight-input-generation-v1';

interface InsightInputGenerationRow {
  value: string;
}

type InsightInputGenerationDatabase = Pick<
  SQLiteDatabase,
  'getFirstAsync' | 'runAsync'
>;

export class InsightInputSupersededError extends Error {
  constructor() {
    super('This insight review was superseded by newer local evidence.');
    this.name = 'InsightInputSupersededError';
  }
}

function parseInsightInputGeneration(
  row: InsightInputGenerationRow | null,
) {
  if (!row) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(row.value)) {
    throw new Error('The durable insight-input generation is invalid.');
  }
  const generation = Number(row.value);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('The durable insight-input generation is invalid.');
  }
  return generation;
}

export async function readInsightInputGenerationFromDatabase(
  database: Pick<SQLiteDatabase, 'getFirstAsync'>,
) {
  return parseInsightInputGeneration(
    await database.getFirstAsync<InsightInputGenerationRow>(
      'SELECT value FROM app_metadata WHERE key = ?',
      INSIGHT_INPUT_GENERATION_KEY,
    ),
  );
}

/** Capture before loading any evidence used to build an insight report. */
export async function acquireInsightInputGeneration() {
  return readInsightInputGenerationFromDatabase(await openT1ArcDatabase());
}

export async function assertInsightInputGenerationInTransaction(
  database: Pick<SQLiteDatabase, 'getFirstAsync'>,
  generation: number,
) {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    (await readInsightInputGenerationFromDatabase(database)) !== generation
  ) {
    throw new InsightInputSupersededError();
  }
}

export async function assertInsightInputGenerationCurrent(
  generation: number,
) {
  await assertInsightInputGenerationInTransaction(
    await openT1ArcDatabase(),
    generation,
  );
}

/** Advances monotonically in the same transaction that mutates evidence. */
export async function advanceInsightInputGenerationInTransaction(
  database: InsightInputGenerationDatabase,
) {
  const current = await readInsightInputGenerationFromDatabase(database);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      'The durable insight-input generation cannot be advanced safely.',
    );
  }
  const next = current + 1;
  await database.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    INSIGHT_INPUT_GENERATION_KEY,
    String(next),
  );
  return next;
}

/**
 * Durably records that source evidence changed without discarding the last
 * readable review. The next scheduled generation observes the new generation
 * and cannot treat an older report as fresh.
 */
export async function markInsightReviewDirty(lease?: LocalDataWriteLease) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  const generation = await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    return advanceInsightInputGenerationInTransaction(transaction);
  });
  await assertLocalDataWriteLeaseCurrent(writeLease);
  return generation;
}

interface InsightReportRow {
  id: string;
  generated_at_ms: number;
  updated_at_ms: number;
  input_fingerprint: string;
  report_json: string;
  viewed_at_ms: number | null;
}

export interface SavedInsightReport {
  id: string;
  report: InsightReport;
  generatedAt: number;
  updatedAt: number;
  inputFingerprint: string;
  viewedAt?: number;
}

function parseReport(row: InsightReportRow): SavedInsightReport | undefined {
  try {
    const report = JSON.parse(row.report_json) as InsightReport;
    if (
      !report ||
      typeof report.headline !== 'string' ||
      !Array.isArray(report.findings) ||
      typeof report.currentRange?.start !== 'number' ||
      typeof report.currentRange?.end !== 'number' ||
      (report.inputGeneration !== undefined &&
        (!Number.isSafeInteger(report.inputGeneration) ||
          report.inputGeneration < 0))
    ) {
      return undefined;
    }
    return {
      id: row.id,
      report,
      generatedAt: row.generated_at_ms,
      updatedAt: row.updated_at_ms,
      inputFingerprint: row.input_fingerprint,
      viewedAt: row.viewed_at_ms ?? undefined,
    };
  } catch {
    return undefined;
  }
}

export async function getSavedInsightReport(id: string) {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<InsightReportRow>(
    `SELECT id, generated_at_ms, updated_at_ms, input_fingerprint,
       report_json, viewed_at_ms
     FROM insight_reports
     WHERE id = ?`,
    id,
  );
  return row ? parseReport(row) : undefined;
}

export async function listSavedInsightReports(limit = 12) {
  const database = await openT1ArcDatabase();
  const rows = await database.getAllAsync<InsightReportRow>(
    `SELECT id, generated_at_ms, updated_at_ms, input_fingerprint,
       report_json, viewed_at_ms
     FROM insight_reports
     ORDER BY period_end_ms DESC
     LIMIT ?`,
    Math.max(1, Math.min(90, Math.floor(limit))),
  );
  return rows
    .map(parseReport)
    .filter((report): report is SavedInsightReport => report !== undefined)
    .filter((report) => hasInsightReviewEvidence(report.report));
}

export async function saveInsightReport(
  report: InsightReport,
  lease?: LocalDataWriteLease,
): Promise<{ saved: SavedInsightReport; changed: boolean }> {
  if (
    !Number.isSafeInteger(report.inputGeneration) ||
    (report.inputGeneration ?? -1) < 0
  ) {
    throw new Error(
      'The insight review is missing its durable input generation.',
    );
  }
  const inputGeneration = report.inputGeneration as number;
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const id = insightReportId(report);
  const inputFingerprint = fingerprintInsightReport(report);
  const existing = await getSavedInsightReport(id);
  if (existing?.inputFingerprint === inputFingerprint) {
    await withT1ArcTransaction(async (transaction) => {
      await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      await assertInsightInputGenerationInTransaction(
        transaction,
        inputGeneration,
      );
    });
    await assertLocalDataWriteLeaseCurrent(writeLease);
    await assertInsightInputGenerationCurrent(inputGeneration);
    return { saved: existing, changed: false };
  }

  const updatedAt = Date.now();
  const evidenceRecordCount = insightEvidenceRecordCount(report);
  await openT1ArcDatabase();
  await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    await assertInsightInputGenerationInTransaction(
      transaction,
      inputGeneration,
    );
    await transaction.runAsync(
    `INSERT INTO insight_reports (
       id, kind, period_start_ms, period_end_ms,
       comparison_start_ms, comparison_end_ms,
       generated_at_ms, updated_at_ms, schema_version,
       input_fingerprint, ready, headline, summary,
       evidence_record_count, report_json, viewed_at_ms
     ) VALUES (?, 'rolling-week', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       period_start_ms = excluded.period_start_ms,
       period_end_ms = excluded.period_end_ms,
       comparison_start_ms = excluded.comparison_start_ms,
       comparison_end_ms = excluded.comparison_end_ms,
       generated_at_ms = excluded.generated_at_ms,
       updated_at_ms = excluded.updated_at_ms,
       schema_version = excluded.schema_version,
       input_fingerprint = excluded.input_fingerprint,
       ready = excluded.ready,
       headline = excluded.headline,
       summary = excluded.summary,
       evidence_record_count = excluded.evidence_record_count,
       report_json = excluded.report_json,
       viewed_at_ms = NULL`,
    id,
    report.currentRange.start,
    report.currentRange.end,
    report.previousRange.start,
    report.previousRange.end,
    report.generatedAt,
    updatedAt,
    INSIGHT_REPORT_SCHEMA_VERSION,
    inputFingerprint,
    report.ready ? 1 : 0,
    report.headline,
    report.summary,
    evidenceRecordCount,
      JSON.stringify(report),
    );
  });
  const saved = await getSavedInsightReport(id);
  if (!saved) {
    throw new Error('The on-device review could not be saved.');
  }
  await assertLocalDataWriteLeaseCurrent(writeLease);
  await assertInsightInputGenerationCurrent(inputGeneration);
  return { saved, changed: true };
}

export async function markInsightReportViewed(
  id: string,
  viewedAt = Date.now(),
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    await transaction.runAsync(
      `UPDATE insight_reports
       SET viewed_at_ms = COALESCE(viewed_at_ms, ?)
       WHERE id = ?`,
      viewedAt,
      id,
    );
  });
}

export async function removeSavedInsightReport(
  id: string,
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  const result = await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    return transaction.runAsync('DELETE FROM insight_reports WHERE id = ?', id);
  });
  return result.changes;
}

export async function pruneInsightReports(
  beforeTimestamp: number,
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  const result = await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    return transaction.runAsync(
      'DELETE FROM insight_reports WHERE period_end_ms < ?',
      beforeTimestamp,
    );
  });
  return result.changes;
}

/**
 * Reviews are derived caches containing human-readable copies of evidence.
 * Any explicit source-record deletion invalidates them so removed health data
 * cannot survive inside an old summary.
 */
export async function clearSavedInsightReports(
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  await openT1ArcDatabase();
  const result = await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
    return clearSavedInsightReportsInTransaction(transaction);
  });
  return result.changes;
}

/** Caller already owns the local-data writer transaction. */
export async function clearSavedInsightReportsInTransaction(
  transaction: InsightInputGenerationDatabase,
) {
  await advanceInsightInputGenerationInTransaction(transaction);
  return transaction.runAsync('DELETE FROM insight_reports');
}
