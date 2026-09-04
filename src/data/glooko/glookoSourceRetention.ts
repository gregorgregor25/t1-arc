const GLOOKO_SOURCE_ID = 'glooko-export';
export const GLOOKO_REPORT_SUBJECT_METADATA_KEY =
  'glooko-report-subject-fingerprint-v1';

/**
 * Raw Glooko downloads are recovery material, not the health record itself.
 * Parsed/deduplicated records live in the normal health tables and are not
 * affected by this policy.
 *
 * The budget is large enough for the largest accepted CSV/ZIP (50 MiB) and
 * PDF (25 MiB) to coexist, with a modest recovery margin. Count limits stop
 * tiny rolling downloads from accumulating forever.
 */
export const GLOOKO_RETAINED_SOURCE_MAX_BYTES = 96 * 1024 * 1024;
export const GLOOKO_RETAINED_ARCHIVE_MAX_COUNT = 3;
export const GLOOKO_RETAINED_REPORT_MAX_COUNT = 2;

export interface RetainedGlookoSourceCandidate {
  id: string;
  kind: 'archive' | 'report';
  byteLength: number;
  storedAt: number;
  dataStart?: number;
  dataThrough?: number;
}

export interface GlookoSourceRetentionLimits {
  maxBytes: number;
  maxArchives: number;
  maxReports: number;
}

export interface GlookoSourceRetentionSelection {
  retainedIds: Set<string>;
  totalBytes: number;
}

const DEFAULT_LIMITS: GlookoSourceRetentionLimits = {
  maxBytes: GLOOKO_RETAINED_SOURCE_MAX_BYTES,
  maxArchives: GLOOKO_RETAINED_ARCHIVE_MAX_COUNT,
  maxReports: GLOOKO_RETAINED_REPORT_MAX_COUNT,
};

function finiteTime(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function newestFirst(
  left: RetainedGlookoSourceCandidate,
  right: RetainedGlookoSourceCandidate,
) {
  const throughDifference =
    finiteTime(right.dataThrough, right.storedAt) -
    finiteTime(left.dataThrough, left.storedAt);
  if (throughDifference !== 0) return throughDifference;
  const storedDifference = right.storedAt - left.storedAt;
  return storedDifference !== 0
    ? storedDifference
    : left.id.localeCompare(right.id);
}

/**
 * Selects a small recovery set deterministically. The newest PDF and archive
 * are tried first. For archives, the oldest distinct coverage boundary is
 * preferred next so a backfilled period is not displaced by overlapping
 * rolling exports; remaining slots favour recent recovery copies.
 */
export function selectRetainedGlookoSources(
  candidates: readonly RetainedGlookoSourceCandidate[],
  limits: GlookoSourceRetentionLimits = DEFAULT_LIMITS,
): GlookoSourceRetentionSelection {
  const valid = candidates.filter(
    (candidate) =>
      Number.isSafeInteger(candidate.byteLength) &&
      candidate.byteLength > 0 &&
      candidate.byteLength <= limits.maxBytes &&
      Number.isFinite(candidate.storedAt),
  );
  const reports = valid
    .filter((candidate) => candidate.kind === 'report')
    .sort(newestFirst);
  const archives = valid
    .filter((candidate) => candidate.kind === 'archive')
    .sort(newestFirst);

  const priority: RetainedGlookoSourceCandidate[] = [];
  if (reports[0]) priority.push(reports[0]);
  if (archives[0]) priority.push(archives[0]);

  if (archives.length > 1) {
    const earliestCoverage = [...archives]
      .sort((left, right) => {
        const startDifference =
          finiteTime(left.dataStart, left.storedAt) -
          finiteTime(right.dataStart, right.storedAt);
        return startDifference !== 0 ? startDifference : newestFirst(left, right);
      })[0];
    if (earliestCoverage) priority.push(earliestCoverage);
  }
  if (reports[1]) priority.push(reports[1]);
  priority.push(...archives.slice(1));

  const retainedIds = new Set<string>();
  let totalBytes = 0;
  let retainedArchives = 0;
  let retainedReports = 0;
  for (const candidate of priority) {
    if (retainedIds.has(candidate.id)) continue;
    if (
      candidate.kind === 'archive' &&
      retainedArchives >= limits.maxArchives
    ) {
      continue;
    }
    if (
      candidate.kind === 'report' &&
      retainedReports >= limits.maxReports
    ) {
      continue;
    }
    if (totalBytes + candidate.byteLength > limits.maxBytes) continue;
    retainedIds.add(candidate.id);
    totalBytes += candidate.byteLength;
    if (candidate.kind === 'archive') retainedArchives += 1;
    else retainedReports += 1;
  }
  return { retainedIds, totalBytes };
}

interface RetentionDatabase {
  getAllAsync<T>(query: string, ...params: unknown[]): Promise<T[]>;
  runAsync(query: string, ...params: unknown[]): Promise<unknown>;
}

export interface GlookoSourcePruneResult {
  removedArchives: number;
  removedReports: number;
  retainedBytes: number;
}

/**
 * Idempotent maintenance for the encrypted database. It removes only bounded
 * recovery containers; import batches, normalised health rows and exact
 * indexed source records (including pump settings) remain intact. The newest
 * compact report previews remain with their recovery PDFs.
 */
export async function pruneRetainedGlookoSources(
  database: RetentionDatabase,
): Promise<GlookoSourcePruneResult> {
  const archiveRows = await database.getAllAsync<{
    id: string;
    byte_length: number;
    stored_at_ms: number;
    data_start_ms: number | null;
    data_through_ms: number | null;
  }>(
    `SELECT p.import_batch_id AS id, p.byte_length, p.stored_at_ms,
            b.data_start_ms, b.data_through_ms
       FROM import_source_payloads p
       INNER JOIN import_batches b ON b.id = p.import_batch_id
      WHERE p.source_id = ?`,
    GLOOKO_SOURCE_ID,
  );
  const reportRows = await database.getAllAsync<{
    id: string;
    byte_length: number;
    imported_at_ms: number;
    report_start_ms: number | null;
    report_end_ms: number | null;
    preview_json: string;
  }>(
    `SELECT id, byte_length, imported_at_ms, report_start_ms, report_end_ms,
            preview_json
       FROM glooko_report_payloads
      WHERE source_id = ?`,
    GLOOKO_SOURCE_ID,
  );
  const candidates: RetainedGlookoSourceCandidate[] = [
    ...archiveRows.map((row) => ({
      id: `archive:${row.id}`,
      kind: 'archive' as const,
      byteLength: row.byte_length,
      storedAt: row.stored_at_ms,
      dataStart: row.data_start_ms ?? undefined,
      dataThrough: row.data_through_ms ?? undefined,
    })),
    ...reportRows.map((row) => ({
      id: `report:${row.id}`,
      kind: 'report' as const,
      byteLength: row.byte_length,
      storedAt: row.imported_at_ms,
      dataStart: row.report_start_ms ?? undefined,
      dataThrough: row.report_end_ms ?? undefined,
    })),
  ];
  const selection = selectRetainedGlookoSources(candidates);

  const newestFingerprint = [...reportRows]
    .sort(
      (left, right) =>
        (right.report_end_ms ?? right.imported_at_ms) -
          (left.report_end_ms ?? left.imported_at_ms) ||
        right.imported_at_ms - left.imported_at_ms,
    )
    .flatMap((row) => {
      try {
        const value = JSON.parse(row.preview_json) as {
          subjectFingerprint?: unknown;
        };
        return typeof value.subjectFingerprint === 'string' &&
          /^rs1_[0-9a-f]{64}$/.test(value.subjectFingerprint)
          ? [value.subjectFingerprint]
          : [];
      } catch {
        return [];
      }
    })[0];
  if (newestFingerprint) {
    // This installation-keyed binding intentionally remains in app_metadata,
    // which portable backups exclude. A restored phone can establish its own
    // keyed binding without falsely rejecting the same person's report.
    await database.runAsync(
      `INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)`,
      GLOOKO_REPORT_SUBJECT_METADATA_KEY,
      newestFingerprint,
    );
  }

  // Full extracted PDF text duplicates the compact preview and exact indexed
  // evidence. Clearing it also cleans legacy rows that survive the new policy.
  await database.runAsync(
    `UPDATE glooko_report_payloads
        SET extracted_text = ''
      WHERE source_id = ?
        AND extracted_text <> ''`,
    GLOOKO_SOURCE_ID,
  );

  let removedArchives = 0;
  for (const row of archiveRows) {
    if (selection.retainedIds.has(`archive:${row.id}`)) continue;
    await database.runAsync(
      'DELETE FROM import_source_payloads WHERE import_batch_id = ?',
      row.id,
    );
    removedArchives += 1;
  }
  let removedReports = 0;
  for (const row of reportRows) {
    if (selection.retainedIds.has(`report:${row.id}`)) continue;
    await database.runAsync(
      'DELETE FROM glooko_report_payloads WHERE id = ?',
      row.id,
    );
    removedReports += 1;
  }
  return {
    removedArchives,
    removedReports,
    retainedBytes: selection.totalBytes,
  };
}
