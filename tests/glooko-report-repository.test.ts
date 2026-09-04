import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLatestGlookoReport,
  saveGlookoReport,
} from "@/data/glooko/glookoReportRepository";
import { GLOOKO_SOURCE_ID } from "@/data/import/glookoCsv";
import { dayRange } from "@/domain/time";

const {
  database,
  digest,
  openT1ArcDatabase,
  withT1ArcTransaction,
  assertWriteLease,
  acquireWriteLease,
} = vi.hoisted(() => {
  const database = {
    getFirstAsync: vi.fn(),
    getAllAsync: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
    runAsync: vi.fn(async (..._args: unknown[]) => ({ changes: 1 })),
  };
  return {
    database,
    digest: vi.fn(async () => new Uint8Array(32).fill(7).buffer),
    openT1ArcDatabase: vi.fn(async () => database),
    withT1ArcTransaction: vi.fn(
      async (callback: (value: typeof database) => Promise<void>) =>
        callback(database),
    ),
    assertWriteLease: vi.fn(async () => undefined),
    acquireWriteLease: vi.fn(async () => ({ epoch: 19 })),
  };
});

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest,
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase,
  withT1ArcTransaction,
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: acquireWriteLease,
  assertLocalDataWriteLeaseInTransaction: assertWriteLease,
}));

const REPORT_TEXT =
  "Daily Overview Wed, 22 Jul 2026 - Tue, 28 Jul 2026 (7 days)";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 test");

describe("Glooko report persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getFirstAsync.mockResolvedValue({ id: "already-imported" });
    database.getAllAsync.mockResolvedValue([]);
  });

  it("asserts the privacy lease before the first report write-transaction read", async () => {
    const writeLease = { epoch: 23 };

    await saveGlookoReport(
      "leased.pdf",
      PDF_BYTES,
      REPORT_TEXT,
      [
        {
          dateLabel: "22/JUL",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 11,
        },
      ],
      1_722_000_000_000,
      undefined,
      writeLease,
    );

    expect(assertWriteLease).toHaveBeenCalledWith(database, writeLease);
    expect(assertWriteLease.mock.invocationCallOrder[0]).toBeLessThan(
      database.getFirstAsync.mock.invocationCallOrder[0]!,
    );
    expect(assertWriteLease.mock.invocationCallOrder[0]).toBeLessThan(
      database.runAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("reprocesses an existing PDF and replaces records unique to its old parse", async () => {
    const result = await saveGlookoReport(
      "download.pdf",
      PDF_BYTES,
      REPORT_TEXT,
      [
        {
          dateLabel: "22/JUL",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 11,
        },
      ],
      1_722_000_000_000,
    );

    expect(result.inserted).toBe(false);
    expect(result.report.preview.pumpStateIntervals).toHaveLength(1);

    const calls = database.runAsync.mock.calls;
    const upsertIndex = calls.findIndex(([sql]) =>
      String(sql).includes("INSERT INTO glooko_report_payloads"),
    );
    const deleteIndex = calls.findIndex(([sql]) =>
      String(sql).includes("first_import_batch_id = ?"),
    );
    const coverageDeleteIndex = calls.findIndex(([sql]) =>
      String(sql).includes("record_kind IN ('pump-state-interval'"),
    );
    const rawInsertIndex = calls.findIndex(([sql]) =>
      String(sql).includes("INSERT INTO import_raw_records"),
    );

    expect(upsertIndex).toBeGreaterThanOrEqual(0);
    expect(String(calls[upsertIndex]?.[0])).toContain(
      "ON CONFLICT(id) DO UPDATE SET",
    );
    expect(calls[upsertIndex]?.[7]).toBe("");
    expect(deleteIndex).toBeGreaterThan(upsertIndex);
    expect(coverageDeleteIndex).toBeGreaterThan(deleteIndex);
    expect(rawInsertIndex).toBeGreaterThan(coverageDeleteIndex);
    expect(calls[deleteIndex]?.slice(1)).toEqual([
      GLOOKO_SOURCE_ID,
      result.report.id,
      result.report.id,
      0,
    ]);
    expect(String(calls[deleteIndex]?.[0])).toContain(
      "record_kind <> 'pump-settings'",
    );
    expect(calls[coverageDeleteIndex]?.slice(1)).toEqual([
      GLOOKO_SOURCE_ID,
      dayRange("2026-07-22").start,
      dayRange("2026-07-22").end,
    ]);
  });

  it("replaces pump-mode evidence only for Daily Overview days actually parsed", async () => {
    await saveGlookoReport("rolling-week.pdf", PDF_BYTES, REPORT_TEXT, [
      {
        dateLabel: "23/JUL",
        startMinute: 60,
        endMinute: 90,
        kind: "activity-mode",
        pageNumber: 11,
      },
    ]);

    const coverageDelete = database.runAsync.mock.calls.find(([sql]) =>
      String(sql).includes("record_kind IN ('pump-state-interval'"),
    );
    expect(String(coverageDelete?.[0])).toContain("timestamp_ms >= ?");
    expect(String(coverageDelete?.[0])).toContain("timestamp_ms < ?");
    expect(coverageDelete?.slice(1)).toEqual([
      GLOOKO_SOURCE_ID,
      dayRange("2026-07-23").start,
      dayRange("2026-07-23").end,
    ]);
  });

  it("still reports a first-time PDF as newly inserted", async () => {
    database.getFirstAsync.mockResolvedValue(undefined);

    const result = await saveGlookoReport("first.pdf", PDF_BYTES, REPORT_TEXT, [
      {
        dateLabel: "22/JUL",
        startMinute: 120,
        endMinute: 150,
        kind: "automated-pause",
        pageNumber: 11,
      },
    ]);

    expect(result.inserted).toBe(true);
  });

  it("rejects a report subject that differs from retained report history", async () => {
    database.getFirstAsync.mockResolvedValueOnce({
      value: `rs1_${"a".repeat(64)}`,
    });

    await expect(
      saveGlookoReport(
        "different-person.pdf",
        PDF_BYTES,
        REPORT_TEXT,
        [
          {
            dateLabel: "22/JUL",
            startMinute: 120,
            endMinute: 150,
            kind: "activity-mode",
            pageNumber: 11,
          },
        ],
        Date.now(),
        `rs1_${"b".repeat(64)}`,
      ),
    ).rejects.toThrow("different person");
    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it("selects the report with the newest covered date before the most recently imported file", async () => {
    database.getFirstAsync.mockResolvedValue({
      id: "newest-covered-report",
      file_name: "newest-week.pdf",
      imported_at_ms: 1_722_000_000_000,
      byte_length: PDF_BYTES.length,
      preview_json: JSON.stringify({
        dailyModeSummaries: [],
        pumpStateIntervals: [],
        warnings: [],
      }),
    });

    await getLatestGlookoReport();

    const [sql] =
      database.getFirstAsync.mock.calls.find(([query]) =>
        String(query).includes("FROM glooko_report_payloads"),
      ) ?? [];
    expect(String(sql)).toContain(
      "ORDER BY COALESCE(report_end_ms, imported_at_ms) DESC",
    );
    expect(String(sql)).toContain("imported_at_ms DESC");
  });

  it("retains the last known pump settings when a newer report omits its settings page", async () => {
    database.getFirstAsync.mockResolvedValue({
      id: "newer-report-without-settings",
      file_name: "11-to-17-august.pdf",
      imported_at_ms: 1_755_500_000_000,
      byte_length: PDF_BYTES.length,
      preview_json: JSON.stringify({
        reportStart: dayRange("2026-08-11").start,
        reportEnd: dayRange("2026-08-17").end,
        dailyModeSummaries: [],
        pumpStateIntervals: [],
        warnings: ["No Omnipod device-settings page was found in this report."],
      }),
    });
    database.getAllAsync.mockResolvedValue([
      {
        imported_at_ms: 1_754_900_000_000,
        preview_json: JSON.stringify({
          reportStart: dayRange("2026-07-28").start,
          reportEnd: dayRange("2026-08-10").end,
          dailyModeSummaries: [],
          pumpStateIntervals: [],
          warnings: [],
          settings: {
            activeCgm: "Dexcom G6",
            basalSchedule: [],
            carbRatioSchedule: [],
            sensitivitySchedule: [],
            targetSchedule: [],
            correctionThresholdSchedule: [],
          },
        }),
      },
    ]);

    const report = await getLatestGlookoReport();

    expect(report?.preview.settings).toBeUndefined();
    expect(report?.retainedSettings).toMatchObject({
      settings: { activeCgm: "Dexcom G6" },
      reportStart: dayRange("2026-07-28").start,
      reportEnd: dayRange("2026-08-10").end,
      importedAt: 1_754_900_000_000,
    });
    const [sql, sourceId, excludedId] =
      database.getAllAsync.mock.calls.at(-1) ?? [];
    expect(String(sql)).toContain("AND id <> ?");
    expect(String(sql)).toContain(
      "ORDER BY COALESCE(report_end_ms, imported_at_ms) DESC",
    );
    expect(sourceId).toBe(GLOOKO_SOURCE_ID);
    expect(excludedId).toBe("newer-report-without-settings");
  });

  it("recovers compact settings from indexed evidence after old PDF payloads are pruned", async () => {
    database.getFirstAsync
      .mockResolvedValueOnce({
        id: "newer-report-without-settings",
        file_name: "11-to-17-august.pdf",
        imported_at_ms: 1_755_500_000_000,
        byte_length: PDF_BYTES.length,
        preview_json: JSON.stringify({
          reportStart: dayRange("2026-08-11").start,
          reportEnd: dayRange("2026-08-17").end,
          dailyModeSummaries: [],
          pumpStateIntervals: [],
          warnings: [],
        }),
      })
      .mockResolvedValueOnce({
        last_seen_at_ms: 1_754_900_000_000,
        payload_json: JSON.stringify({
          reportStart: dayRange("2026-07-28").start,
          reportEnd: dayRange("2026-08-10").end,
          activeCgm: "Dexcom G6",
          basalSchedule: [],
          carbRatioSchedule: [],
          sensitivitySchedule: [],
          targetSchedule: [],
          correctionThresholdSchedule: [],
        }),
      });
    database.getAllAsync.mockResolvedValue([]);

    const report = await getLatestGlookoReport();

    expect(report?.retainedSettings).toMatchObject({
      settings: { activeCgm: "Dexcom G6" },
      reportStart: dayRange("2026-07-28").start,
      reportEnd: dayRange("2026-08-10").end,
      importedAt: 1_754_900_000_000,
    });
    const [query] = database.getFirstAsync.mock.calls.at(-1) ?? [];
    expect(String(query)).toContain("record_kind = 'pump-settings'");
  });

  it("reconstructs the latest compact report view from backed-up indexed evidence", async () => {
    const firstDay = dayRange("2026-08-16");
    const secondDay = dayRange("2026-08-17");
    const indexedRows = [
      {
        id: "daily-17",
        record_kind: "pump-mode-daily",
        timestamp_ms: secondDay.end - 1,
        source_file: "11-to-17-august.pdf",
        source_row: 2,
        payload_json: JSON.stringify({
          reportStart: secondDay.start,
          reportEnd: secondDay.end,
          dateKey: "2026-08-17",
          automatedPercent: 90,
          activityPercent: 2,
        }),
        last_seen_at_ms: 1_755_500_000_000,
      },
      {
        id: "pause-17",
        record_kind: "pump-state-interval",
        timestamp_ms: secondDay.start + 60_000,
        source_file: "11-to-17-august.pdf",
        source_row: 3,
        payload_json: JSON.stringify({
          start: secondDay.start + 60_000,
          end: secondDay.start + 120_000,
          kind: "automated-pause",
          sourcePage: 7,
        }),
        last_seen_at_ms: 1_755_500_000_000,
      },
      {
        id: "daily-16",
        record_kind: "pump-mode-daily",
        timestamp_ms: firstDay.end - 1,
        source_file: "11-to-17-august.pdf",
        source_row: 1,
        payload_json: JSON.stringify({
          reportStart: firstDay.start,
          reportEnd: firstDay.end,
          dateKey: "2026-08-16",
          automatedPercent: 88,
        }),
        last_seen_at_ms: 1_755_500_000_000,
      },
      {
        id: "settings-older",
        record_kind: "pump-settings",
        timestamp_ms: firstDay.start - 1,
        source_file: "4-to-10-august.pdf",
        source_row: 4,
        payload_json: JSON.stringify({
          reportStart: dayRange("2026-08-04").start,
          reportEnd: dayRange("2026-08-10").end,
          activeCgm: "Dexcom G6",
          basalSchedule: [],
          carbRatioSchedule: [],
          sensitivitySchedule: [],
          targetSchedule: [],
          correctionThresholdSchedule: [],
        }),
        last_seen_at_ms: 1_754_900_000_000,
      },
    ];
    database.getFirstAsync.mockImplementation(async (query: string) => {
      if (query.includes("MAX(timestamp_ms)")) {
        return { latest_timestamp: secondDay.end - 1 };
      }
      if (query.includes("record_kind = 'pump-settings'")) {
        return indexedRows.find((row) => row.record_kind === "pump-settings");
      }
      return undefined;
    });
    database.getAllAsync.mockImplementation(async (...args: unknown[]) =>
      String(args[0]).includes("record_kind = 'pump-mode-summary'")
        ? []
        : indexedRows.filter(
            (row) =>
              row.record_kind === "pump-mode-daily" ||
              row.record_kind === "pump-state-interval",
          ),
    );

    const report = await getLatestGlookoReport();

    expect(report).toMatchObject({
      fileName: "11-to-17-august.pdf",
      byteLength: 0,
      preview: {
        reportEnd: secondDay.end,
        dailyModeSummaries: [
          { dateKey: "2026-08-16" },
          { dateKey: "2026-08-17" },
        ],
        pumpStateIntervals: [{ kind: "automated-pause" }],
      },
      retainedSettings: { settings: { activeCgm: "Dexcom G6" } },
    });
  });

  it("includes current summary and settings indexed at the exclusive report end", async () => {
    const reportStart = dayRange("2026-08-11").start;
    const reportEnd = dayRange("2026-08-17").end;
    const common = {
      timestamp_ms: reportEnd,
      source_file: "11-to-17-august.pdf",
      last_seen_at_ms: 1_755_500_000_000,
    };
    const indexedRows = [
      {
        ...common,
        id: "mode-summary",
        record_kind: "pump-mode-summary",
        source_row: 1,
        payload_json: JSON.stringify({
          reportStart,
          reportEnd,
          automatedPercent: 90,
          activityPercent: 2,
        }),
      },
      {
        ...common,
        id: "settings-current",
        record_kind: "pump-settings",
        source_row: 2,
        payload_json: JSON.stringify({
          reportStart,
          reportEnd,
          activeCgm: "Dexcom G6",
          basalSchedule: [],
          carbRatioSchedule: [],
          sensitivitySchedule: [],
          targetSchedule: [],
          correctionThresholdSchedule: [],
        }),
      },
    ];
    database.getFirstAsync.mockImplementation(async (query: string) => {
      if (query.includes("MAX(timestamp_ms)")) {
        return { latest_timestamp: null };
      }
      if (query.includes("record_kind = 'pump-settings'")) {
        return indexedRows.find((row) => row.record_kind === "pump-settings");
      }
      return undefined;
    });
    database.getAllAsync.mockImplementation(async (...args: unknown[]) =>
      String(args[0]).includes("record_kind = 'pump-mode-summary'")
        ? indexedRows.filter((row) => row.record_kind === "pump-mode-summary")
        : [],
    );

    const report = await getLatestGlookoReport();

    expect(report?.preview.modeSummary).toMatchObject({
      automatedPercent: 90,
      activityPercent: 2,
    });
    expect(report?.preview.settings).toMatchObject({ activeCgm: "Dexcom G6" });
    expect(report?.retainedSettings).toBeUndefined();
  });
});
