import {
  fingerprintInsightReport,
  hasInsightReviewEvidence,
  insightEvidenceRecordCount,
  insightReportId,
  INSIGHT_REPORT_SCHEMA_VERSION,
} from '@/domain/insightPersistence';
import { InsightReport } from '@/domain/insights';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';

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
      typeof report.currentRange?.end !== 'number'
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
  const database = await openDaymarkDatabase();
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
  const database = await openDaymarkDatabase();
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
): Promise<{ saved: SavedInsightReport; changed: boolean }> {
  const id = insightReportId(report);
  const inputFingerprint = fingerprintInsightReport(report);
  const existing = await getSavedInsightReport(id);
  if (existing?.inputFingerprint === inputFingerprint) {
    return { saved: existing, changed: false };
  }

  const database = await openDaymarkDatabase();
  const updatedAt = Date.now();
  const evidenceRecordCount = insightEvidenceRecordCount(report);
  await database.runAsync(
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
  const saved = await getSavedInsightReport(id);
  if (!saved) {
    throw new Error('The on-device review could not be saved.');
  }
  return { saved, changed: true };
}

export async function markInsightReportViewed(
  id: string,
  viewedAt = Date.now(),
) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
    `UPDATE insight_reports
     SET viewed_at_ms = COALESCE(viewed_at_ms, ?)
     WHERE id = ?`,
    viewedAt,
    id,
  );
}

export async function removeSavedInsightReport(id: string) {
  const database = await openDaymarkDatabase();
  const result = await database.runAsync(
    'DELETE FROM insight_reports WHERE id = ?',
    id,
  );
  return result.changes;
}

export async function pruneInsightReports(
  beforeTimestamp: number,
) {
  const database = await openDaymarkDatabase();
  const result = await database.runAsync(
    'DELETE FROM insight_reports WHERE period_end_ms < ?',
    beforeTimestamp,
  );
  return result.changes;
}

/**
 * Reviews are derived caches containing human-readable copies of evidence.
 * Any explicit source-record deletion invalidates them so removed health data
 * cannot survive inside an old summary.
 */
export async function clearSavedInsightReports() {
  const database = await openDaymarkDatabase();
  const result = await database.runAsync('DELETE FROM insight_reports');
  return result.changes;
}
