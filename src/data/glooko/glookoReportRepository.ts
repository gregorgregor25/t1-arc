import * as Crypto from 'expo-crypto';

import {
  GlookoReportPreview,
  glookoReportRawRecords,
  parseGlookoReportText,
  PumpTrackIntervalInput,
} from './glookoReport';
import { GLOOKO_SOURCE_ID } from '@/data/import/glookoCsv';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';

export interface StoredGlookoReport {
  id: string;
  fileName: string;
  importedAt: number;
  byteLength: number;
  preview: GlookoReportPreview;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function safeFileName(value: string) {
  return value.split(/[\\/]/).pop()?.trim().slice(0, 160) || 'glooko-report.pdf';
}

export async function saveGlookoReport(
  fileName: string,
  bytes: Uint8Array,
  extractedText: string,
  pumpTrackIntervals: PumpTrackIntervalInput[] = [],
  importedAt = Date.now(),
) {
  if (
    bytes.length < 5 ||
    bytes.length > 25 * 1024 * 1024 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF'
  ) {
    throw new Error('The selected Glooko report is not a supported PDF.');
  }
  const digestInput = bytes.slice();
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput,
  ).finally(() => digestInput.fill(0));
  const fileSha256 = toHex(digest);
  const id = `${GLOOKO_SOURCE_ID}:report:${fileSha256.slice(0, 32)}`;
  const preview = parseGlookoReportText(
    extractedText,
    pumpTrackIntervals,
  );
  if (
    !preview.modeSummary &&
    !preview.dailyModeSummaries.length &&
    !preview.pumpStateIntervals.length &&
    !preview.settings
  ) {
    throw new Error(
      'This PDF did not contain Glooko Omnipod System Details or Device Settings.',
    );
  }
  const rawRecords = glookoReportRawRecords(
    preview,
    safeFileName(fileName),
    importedAt,
  );
  await openDaymarkDatabase();
  let inserted = false;
  await withDaymarkTransaction(async (database) => {
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO glooko_report_payloads (
         id, source_id, file_name, file_sha256, byte_length, payload_bytes,
         extracted_text, preview_json, report_start_ms, report_end_ms,
         imported_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      GLOOKO_SOURCE_ID,
      safeFileName(fileName),
      fileSha256,
      bytes.length,
      bytes,
      extractedText,
      JSON.stringify(preview),
      preview.reportStart ?? null,
      preview.reportEnd ?? null,
      importedAt,
    );
    inserted = result.changes > 0;
    for (const record of rawRecords) {
      await database.runAsync(
        `INSERT INTO import_raw_records (
           id, source_id, record_kind, timestamp_ms, source_file, source_row,
           payload_json, first_import_batch_id, first_seen_at_ms,
           last_import_batch_id, last_seen_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_file = excluded.source_file,
           source_row = excluded.source_row,
           payload_json = excluded.payload_json,
           last_import_batch_id = excluded.last_import_batch_id,
           last_seen_at_ms = MAX(
             import_raw_records.last_seen_at_ms,
             excluded.last_seen_at_ms
           )`,
        record.id,
        record.sourceId,
        record.recordKind,
        record.timestamp ?? null,
        record.sourceFile,
        record.sourceRow,
        record.payloadJson,
        id,
        importedAt,
        id,
        importedAt,
      );
    }
  });
  return {
    inserted,
    report: {
      id,
      fileName: safeFileName(fileName),
      importedAt,
      byteLength: bytes.length,
      preview,
    } satisfies StoredGlookoReport,
  };
}

export async function getLatestGlookoReport(): Promise<
  StoredGlookoReport | undefined
> {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<{
    id: string;
    file_name: string;
    imported_at_ms: number;
    byte_length: number;
    preview_json: string;
  }>(
    `SELECT id, file_name, imported_at_ms, byte_length, preview_json
       FROM glooko_report_payloads
      WHERE source_id = ?
      ORDER BY imported_at_ms DESC
      LIMIT 1`,
    GLOOKO_SOURCE_ID,
  );
  if (!row) return undefined;
  try {
    const preview = JSON.parse(
      row.preview_json,
    ) as Partial<GlookoReportPreview>;
    return {
      id: row.id,
      fileName: row.file_name,
      importedAt: row.imported_at_ms,
      byteLength: row.byte_length,
      preview: {
        ...preview,
        dailyModeSummaries: preview.dailyModeSummaries ?? [],
        pumpStateIntervals: preview.pumpStateIntervals ?? [],
        warnings: preview.warnings ?? [],
      } as GlookoReportPreview,
    };
  } catch {
    return undefined;
  }
}
