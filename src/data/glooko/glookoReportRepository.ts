import * as Crypto from "expo-crypto";

import {
  DailyPumpModeSummary,
  GlookoPumpSettingsSnapshot,
  GlookoReportPreview,
  glookoReportRawRecords,
  hasGlookoPumpSettingsValues,
  parseGlookoReportText,
  PumpModePercentSummary,
  PumpTrackIntervalInput,
} from "./glookoReport";
import { GLOOKO_SOURCE_ID } from "@/data/import/glookoCsv";
import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from "@/data/persistence/t1arcDatabase";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import { addDays, dayRange, isDateKey, toDateKey } from "@/domain/time";
import { PumpStateInterval } from "@/domain/models";
import {
  GLOOKO_REPORT_SUBJECT_METADATA_KEY,
  pruneRetainedGlookoSources,
} from "./glookoSourceRetention";

export interface StoredGlookoReport {
  id: string;
  fileName: string;
  importedAt: number;
  byteLength: number;
  preview: GlookoReportPreview;
  retainedSettings?: {
    settings: GlookoPumpSettingsSnapshot;
    reportStart?: number;
    reportEnd?: number;
    importedAt: number;
  };
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function safeFileName(value: string) {
  return (
    value.split(/[\\/]/).pop()?.trim().slice(0, 160) || "glooko-report.pdf"
  );
}

function normaliseStoredSettings(
  value: Partial<GlookoPumpSettingsSnapshot> | undefined,
) {
  if (!value) return undefined;
  const settings = {
    ...value,
    basalSchedule: value.basalSchedule ?? [],
    carbRatioSchedule: value.carbRatioSchedule ?? [],
    sensitivitySchedule: value.sensitivitySchedule ?? [],
    targetSchedule: value.targetSchedule ?? [],
    correctionThresholdSchedule: value.correctionThresholdSchedule ?? [],
  } as GlookoPumpSettingsSnapshot;
  return hasGlookoPumpSettingsValues(settings) ? settings : undefined;
}

function parseStoredPreview(value: string): GlookoReportPreview | undefined {
  try {
    const preview = JSON.parse(value) as Partial<GlookoReportPreview>;
    return {
      ...preview,
      settings: normaliseStoredSettings(preview.settings),
      dailyModeSummaries: preview.dailyModeSummaries ?? [],
      pumpStateIntervals: preview.pumpStateIntervals ?? [],
      warnings: preview.warnings ?? [],
    } as GlookoReportPreview;
  } catch {
    return undefined;
  }
}

interface IndexedReportRow {
  id: string;
  record_kind: string;
  timestamp_ms: number | null;
  source_file: string;
  source_row: number;
  payload_json: string;
  last_seen_at_ms: number;
}

function indexedPayload(row: IndexedReportRow) {
  try {
    const value = JSON.parse(row.payload_json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function finitePayloadNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

async function getLatestIndexedGlookoReport(database: {
  getFirstAsync<T>(query: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(query: string, ...params: unknown[]): Promise<T[]>;
}): Promise<StoredGlookoReport | undefined> {
  const latestTimeline = await database.getFirstAsync<{
    latest_timestamp: number | null;
  }>(
    `SELECT MAX(timestamp_ms) AS latest_timestamp
       FROM import_raw_records
      WHERE source_id = ?
        AND record_kind IN ('pump-mode-daily', 'pump-state-interval')`,
    GLOOKO_SOURCE_ID,
  );
  const summaryRows = await database.getAllAsync<IndexedReportRow>(
    `SELECT id, record_kind, timestamp_ms, source_file, source_row,
            payload_json, last_seen_at_ms
       FROM import_raw_records
      WHERE source_id = ?
        AND record_kind = 'pump-mode-summary'
      ORDER BY COALESCE(timestamp_ms, last_seen_at_ms) DESC
      LIMIT 16`,
    GLOOKO_SOURCE_ID,
  );
  const latestSettings = await database.getFirstAsync<IndexedReportRow>(
    `SELECT id, record_kind, timestamp_ms, source_file, source_row,
            payload_json, last_seen_at_ms
       FROM import_raw_records
      WHERE source_id = ?
        AND record_kind = 'pump-settings'
      ORDER BY COALESCE(timestamp_ms, last_seen_at_ms) DESC
      LIMIT 1`,
    GLOOKO_SOURCE_ID,
  );
  const boundaryRows = [
    ...summaryRows,
    ...(latestSettings ? [latestSettings] : []),
  ];
  const boundaryParsed = boundaryRows.flatMap((row) => {
    const payload = indexedPayload(row);
    return payload ? [{ row, payload }] : [];
  });

  const statedRanges = boundaryParsed.flatMap(({ payload }) => {
    const start = finitePayloadNumber(payload.reportStart);
    const end = finitePayloadNumber(payload.reportEnd);
    return start !== undefined && end !== undefined && end > start
      ? [{ start, end }]
      : [];
  });
  statedRanges.sort(
    (left, right) => right.end - left.end || left.start - right.start,
  );
  let reportEnd = statedRanges[0]?.end;
  let reportStart = statedRanges[0]?.start;
  const latestTimelineTimestamp = latestTimeline?.latest_timestamp ?? 0;
  const timelineEnd =
    latestTimelineTimestamp > 0
      ? dayRange(toDateKey(latestTimelineTimestamp)).end
      : undefined;
  if (
    timelineEnd !== undefined &&
    (reportEnd === undefined || timelineEnd > reportEnd)
  ) {
    reportEnd = timelineEnd;
    reportStart = dayRange(addDays(toDateKey(reportEnd - 1), -6)).start;
  }
  if (reportEnd === undefined) {
    const latestTimestamp = boundaryParsed.reduce(
      (latest, { row }) => Math.max(latest, row.timestamp_ms ?? 0),
      0,
    );
    if (latestTimestamp <= 0) return undefined;
    reportEnd = dayRange(toDateKey(latestTimestamp)).end;
    reportStart = dayRange(addDays(toDateKey(reportEnd - 1), -6)).start;
  } else if (
    reportStart === undefined ||
    reportEnd - reportStart <= 24 * 60 * 60 * 1_000
  ) {
    reportStart = dayRange(addDays(toDateKey(reportEnd - 1), -6)).start;
  }

  const timelineRows = await database.getAllAsync<IndexedReportRow>(
    `SELECT id, record_kind, timestamp_ms, source_file, source_row,
            payload_json, last_seen_at_ms
       FROM import_raw_records
      WHERE source_id = ?
        AND record_kind IN ('pump-mode-daily', 'pump-state-interval')
        AND timestamp_ms >= ?
        AND timestamp_ms < ?
      ORDER BY timestamp_ms DESC
      LIMIT 5000`,
    GLOOKO_SOURCE_ID,
    reportStart,
    reportEnd,
  );
  const parsed = [...boundaryRows, ...timelineRows].flatMap((row) => {
    const payload = indexedPayload(row);
    return payload ? [{ row, payload }] : [];
  });
  if (!parsed.length) return undefined;

  const inReportRange = ({ row, payload }: (typeof parsed)[number]) => {
    if (
      row.record_kind === "pump-mode-summary" ||
      row.record_kind === "pump-settings"
    ) {
      const statedStart = finitePayloadNumber(payload.reportStart);
      const statedEnd = finitePayloadNumber(payload.reportEnd);
      return statedStart === reportStart && statedEnd === reportEnd;
    }
    const timestamp = row.timestamp_ms ?? 0;
    return timestamp >= reportStart! && timestamp < reportEnd!;
  };
  const current = parsed.filter(inReportRange);
  const summaryItem = current.find(
    ({ row }) => row.record_kind === "pump-mode-summary",
  );
  const modeSummary = summaryItem
    ? normalisedModeSummary(summaryItem.payload)
    : undefined;
  const dailyModeSummaries = current
    .flatMap(({ row, payload }) => {
      if (
        row.record_kind !== "pump-mode-daily" ||
        !isDateKey(payload.dateKey)
      ) {
        return [];
      }
      const summary = normalisedModeSummary(payload);
      return summary
        ? [
            {
              dateKey: payload.dateKey,
              timestamp: row.timestamp_ms ?? dayRange(payload.dateKey).end - 1,
              summary,
            } satisfies DailyPumpModeSummary,
          ]
        : [];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
  const pumpStateIntervals = current
    .flatMap(({ row, payload }) => {
      if (row.record_kind !== "pump-state-interval") return [];
      const start = finitePayloadNumber(payload.start);
      const end = finitePayloadNumber(payload.end);
      const kind = payload.kind;
      if (
        start === undefined ||
        end === undefined ||
        end <= start ||
        (kind !== "activity-mode" && kind !== "automated-pause")
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          start,
          end,
          kind,
          sourceId: GLOOKO_SOURCE_ID,
          importedAt: row.last_seen_at_ms,
          sourceFile: row.source_file,
          sourcePage: finitePayloadNumber(payload.sourcePage),
        } satisfies PumpStateInterval,
      ];
    })
    .sort((left, right) => left.start - right.start);
  const currentSettingsItem = current.find(
    ({ row, payload }) =>
      row.record_kind === "pump-settings" &&
      finitePayloadNumber(payload.reportEnd) === reportEnd,
  );
  const settings = currentSettingsItem
    ? normaliseStoredSettings(
        currentSettingsItem.payload as Partial<GlookoPumpSettingsSnapshot>,
      )
    : undefined;
  const latestItem = current[0] ?? parsed[0];
  if (!latestItem) return undefined;
  const importedAt = current.reduce(
    (latest, { row }) => Math.max(latest, row.last_seen_at_ms),
    latestItem.row.last_seen_at_ms,
  );
  const report: StoredGlookoReport = {
    id: `${GLOOKO_SOURCE_ID}:indexed-report:${reportEnd}`,
    fileName: latestItem.row.source_file,
    importedAt,
    byteLength: 0,
    preview: {
      reportStart,
      reportEnd,
      modeSummary,
      dailyModeSummaries,
      pumpStateIntervals,
      settings,
      warnings: [],
    },
  };
  if (!settings) {
    const previousSettingsItem = parsed.find(
      ({ row, payload }) =>
        row.record_kind === "pump-settings" &&
        finitePayloadNumber(payload.reportEnd) !== undefined &&
        finitePayloadNumber(payload.reportEnd)! <= reportEnd!,
    );
    const previousSettings = previousSettingsItem
      ? normaliseStoredSettings(
          previousSettingsItem.payload as Partial<GlookoPumpSettingsSnapshot>,
        )
      : undefined;
    if (previousSettings && previousSettingsItem) {
      report.retainedSettings = {
        settings: previousSettings,
        reportStart: finitePayloadNumber(
          previousSettingsItem.payload.reportStart,
        ),
        reportEnd: finitePayloadNumber(previousSettingsItem.payload.reportEnd),
        importedAt: previousSettingsItem.row.last_seen_at_ms,
      };
    }
  }
  return report;
}

function normalisedModeSummary(
  value: Record<string, unknown>,
): PumpModePercentSummary | undefined {
  const summary: PumpModePercentSummary = {
    automatedPercent: finitePayloadNumber(value.automatedPercent),
    activityPercent: finitePayloadNumber(value.activityPercent),
    limitedPercent: finitePayloadNumber(value.limitedPercent),
    manualPercent: finitePayloadNumber(value.manualPercent),
  };
  return Object.values(summary).some((item) => item !== undefined)
    ? summary
    : undefined;
}

export async function saveGlookoReport(
  fileName: string,
  bytes: Uint8Array,
  extractedText: string,
  pumpTrackIntervals: PumpTrackIntervalInput[] = [],
  importedAt = Date.now(),
  subjectFingerprint?: string,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  if (
    bytes.length < 5 ||
    bytes.length > 25 * 1024 * 1024 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF"
  ) {
    throw new Error("The selected Glooko report is not a supported PDF.");
  }
  const digestInput = bytes.slice();
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput,
  ).finally(() => digestInput.fill(0));
  const fileSha256 = toHex(digest);
  const id = `${GLOOKO_SOURCE_ID}:report:${fileSha256.slice(0, 32)}`;
  if (
    subjectFingerprint !== undefined &&
    !/^rs1_[0-9a-f]{64}$/.test(subjectFingerprint)
  ) {
    throw new Error("The Glooko report identity could not be verified safely.");
  }
  const preview: GlookoReportPreview = {
    ...parseGlookoReportText(extractedText, pumpTrackIntervals),
    subjectFingerprint,
  };
  if (
    !preview.modeSummary &&
    !preview.dailyModeSummaries.length &&
    !preview.pumpStateIntervals.length &&
    !preview.settings
  ) {
    throw new Error(
      "This PDF did not contain Glooko Omnipod System Details or Device Settings.",
    );
  }
  const rawRecords = glookoReportRawRecords(
    preview,
    safeFileName(fileName),
    importedAt,
  );
  await openT1ArcDatabase();
  let inserted = false;
  let effectiveImportedAt = importedAt;
  await withT1ArcTransaction(async (database) => {
    // The erase epoch must be the first operation after acquiring SQLite's
    // writer lock; no stale PDF payload or derived index may follow erase.
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    if (subjectFingerprint) {
      const binding = await database.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = ?",
        GLOOKO_REPORT_SUBJECT_METADATA_KEY,
      );
      let previousFingerprint =
        binding && /^rs1_[0-9a-f]{64}$/.test(binding.value)
          ? binding.value
          : undefined;
      if (!previousFingerprint) {
        const latest = await database.getFirstAsync<{ preview_json: string }>(
          `SELECT preview_json
             FROM glooko_report_payloads
            WHERE source_id = ?
            ORDER BY COALESCE(report_end_ms, imported_at_ms) DESC,
                     imported_at_ms DESC
            LIMIT 1`,
          GLOOKO_SOURCE_ID,
        );
        if (latest) {
          previousFingerprint = (() => {
            try {
              const parsed = JSON.parse(latest.preview_json) as {
                subjectFingerprint?: unknown;
              };
              return typeof parsed.subjectFingerprint === "string"
                ? parsed.subjectFingerprint
                : undefined;
            } catch {
              return undefined;
            }
          })();
        }
      }
      if (previousFingerprint && previousFingerprint !== subjectFingerprint) {
        throw new Error(
          "This Daily Overview belongs to a different person than the retained Glooko reports. Nothing was imported.",
        );
      }
    }
    const existing = await database.getFirstAsync<{
      id: string;
      imported_at_ms: number;
    }>(
      `SELECT id, imported_at_ms
         FROM glooko_report_payloads
        WHERE id = ?
        LIMIT 1`,
      id,
    );
    inserted = existing === null || existing === undefined;
    if (
      existing &&
      Number.isFinite(existing.imported_at_ms) &&
      existing.imported_at_ms > 0
    ) {
      effectiveImportedAt = existing.imported_at_ms;
    }
    if (preview.reportStart !== undefined && preview.reportEnd !== undefined) {
      const superseded = await database.getAllAsync<{ id: string }>(
        `SELECT id
           FROM glooko_report_payloads
          WHERE source_id = ?
            AND report_start_ms = ?
            AND report_end_ms = ?
            AND id <> ?`,
        GLOOKO_SOURCE_ID,
        preview.reportStart,
        preview.reportEnd,
        id,
      );
      for (const payload of superseded) {
        await database.runAsync(
          `DELETE FROM import_raw_records
            WHERE source_id = ?
              AND first_import_batch_id = ?
              AND last_import_batch_id = ?
              AND (? = 1 OR record_kind <> 'pump-settings')`,
          GLOOKO_SOURCE_ID,
          payload.id,
          payload.id,
          preview.settings ? 1 : 0,
        );
      }
      await database.runAsync(
        `DELETE FROM glooko_report_payloads
          WHERE source_id = ?
            AND report_start_ms = ?
            AND report_end_ms = ?
            AND id <> ?`,
        GLOOKO_SOURCE_ID,
        preview.reportStart,
        preview.reportEnd,
        id,
      );
    }
    await database.runAsync(
      `INSERT INTO glooko_report_payloads (
         id, source_id, file_name, file_sha256, byte_length, payload_bytes,
         extracted_text, preview_json, report_start_ms, report_end_ms,
         imported_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_name = excluded.file_name,
         byte_length = excluded.byte_length,
         payload_bytes = excluded.payload_bytes,
         extracted_text = excluded.extracted_text,
         preview_json = excluded.preview_json,
         report_start_ms = excluded.report_start_ms,
         report_end_ms = excluded.report_end_ms`,
      id,
      GLOOKO_SOURCE_ID,
      safeFileName(fileName),
      fileSha256,
      bytes.length,
      bytes,
      "",
      JSON.stringify(preview),
      preview.reportStart ?? null,
      preview.reportEnd ?? null,
      importedAt,
    );
    if (subjectFingerprint) {
      await database.runAsync(
        "INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)",
        GLOOKO_REPORT_SUBJECT_METADATA_KEY,
        subjectFingerprint,
      );
    }
    await database.runAsync(
      `DELETE FROM import_raw_records
        WHERE source_id = ?
          AND first_import_batch_id = ?
          AND last_import_batch_id = ?
          AND (? = 1 OR record_kind <> 'pump-settings')`,
      GLOOKO_SOURCE_ID,
      id,
      id,
      preview.settings ? 1 : 0,
    );
    const coveredDates = new Set([
      ...preview.dailyModeSummaries.map((daily) => daily.dateKey),
      ...preview.pumpStateIntervals.map((interval) =>
        toDateKey(interval.start),
      ),
    ]);
    for (const dateKey of coveredDates) {
      const range = dayRange(dateKey);
      await database.runAsync(
        `DELETE FROM import_raw_records
          WHERE source_id = ?
            AND record_kind IN ('pump-state-interval', 'pump-mode-daily')
            AND timestamp_ms >= ?
            AND timestamp_ms < ?`,
        GLOOKO_SOURCE_ID,
        range.start,
        range.end,
      );
    }
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
    await pruneRetainedGlookoSources(database);
  });
  return {
    inserted,
    report: {
      id,
      fileName: safeFileName(fileName),
      importedAt: effectiveImportedAt,
      byteLength: bytes.length,
      preview,
    } satisfies StoredGlookoReport,
  };
}

export async function getLatestGlookoReport(): Promise<
  StoredGlookoReport | undefined
> {
  const database = await openT1ArcDatabase();
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
      ORDER BY COALESCE(report_end_ms, imported_at_ms) DESC,
               imported_at_ms DESC
      LIMIT 1`,
    GLOOKO_SOURCE_ID,
  );
  if (!row) return getLatestIndexedGlookoReport(database);
  const preview = parseStoredPreview(row.preview_json);
  if (!preview) return undefined;

  let retainedSettings: StoredGlookoReport["retainedSettings"];
  if (!preview.settings) {
    const earlierReports = await database.getAllAsync<{
      preview_json: string;
      imported_at_ms: number;
    }>(
      `SELECT preview_json, imported_at_ms
         FROM glooko_report_payloads
        WHERE source_id = ?
          AND id <> ?
        ORDER BY COALESCE(report_end_ms, imported_at_ms) DESC,
                 imported_at_ms DESC
        LIMIT 31`,
      GLOOKO_SOURCE_ID,
      row.id,
    );
    for (const earlier of earlierReports) {
      const earlierPreview = parseStoredPreview(earlier.preview_json);
      if (!earlierPreview?.settings) continue;
      retainedSettings = {
        settings: earlierPreview.settings,
        reportStart: earlierPreview.reportStart,
        reportEnd: earlierPreview.reportEnd,
        importedAt: earlier.imported_at_ms,
      };
      break;
    }
    if (!retainedSettings) {
      const indexedSettings = await database.getFirstAsync<{
        payload_json: string;
        last_seen_at_ms: number;
      }>(
        `SELECT payload_json, last_seen_at_ms
           FROM import_raw_records
          WHERE source_id = ?
            AND record_kind = 'pump-settings'
          ORDER BY COALESCE(timestamp_ms, last_seen_at_ms) DESC,
                   last_seen_at_ms DESC
          LIMIT 1`,
        GLOOKO_SOURCE_ID,
      );
      if (indexedSettings) {
        try {
          const payload = JSON.parse(indexedSettings.payload_json) as Partial<
            GlookoPumpSettingsSnapshot & {
              reportStart: number;
              reportEnd: number;
            }
          >;
          const { reportStart, reportEnd, ...settingsPayload } = payload;
          const settings = normaliseStoredSettings(settingsPayload);
          if (settings) {
            retainedSettings = {
              settings,
              reportStart:
                typeof reportStart === "number" ? reportStart : undefined,
              reportEnd: typeof reportEnd === "number" ? reportEnd : undefined,
              importedAt: indexedSettings.last_seen_at_ms,
            };
          }
        } catch {
          // A malformed old index row must not hide the otherwise valid report.
        }
      }
    }
  }

  return {
    id: row.id,
    fileName: row.file_name,
    importedAt: row.imported_at_ms,
    byteLength: row.byte_length,
    preview,
    retainedSettings,
  };
}
