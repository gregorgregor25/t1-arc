import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireInsightInputGeneration,
  clearSavedInsightReports,
  INSIGHT_INPUT_GENERATION_KEY,
  InsightInputSupersededError,
  markInsightReviewDirty,
  saveInsightReport,
} from "@/data/insights/insightReportRepository";
import type { InsightReport } from "@/domain/insights";

const persistence = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = persistence.database as AsyncDatabaseAdapter;
      database.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(database);
        database.database.exec("COMMIT");
        return result;
      } catch (error) {
        database.database.exec("ROLLBACK");
        throw error;
      }
    },
  ),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 0 })),
  assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
}));

type BindValue = string | number | bigint | Uint8Array | null;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class AsyncDatabaseAdapter {
  readonly executedSql: string[] = [];
  private pausedReportRead:
    | {
        entered: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;

  constructor(readonly database: DatabaseSync) {}

  pauseNextReportRead() {
    const gate = { entered: deferred(), release: deferred() };
    this.pausedReportRead = gate;
    return gate;
  }

  async runAsync(sql: string, ...parameters: BindValue[]) {
    this.executedSql.push(sql);
    const result = this.database.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, ...parameters: BindValue[]) {
    if (this.pausedReportRead && sql.includes("FROM insight_reports")) {
      const gate = this.pausedReportRead;
      this.pausedReportRead = undefined;
      gate.entered.resolve();
      await gate.release.promise;
    }
    return (
      (this.database.prepare(sql).get(...parameters) as T | undefined) ?? null
    );
  }

  async getAllAsync<T>(sql: string, ...parameters: BindValue[]) {
    return this.database.prepare(sql).all(...parameters) as T[];
  }
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE insight_reports (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT,
      period_start_ms INTEGER,
      period_end_ms INTEGER,
      comparison_start_ms INTEGER,
      comparison_end_ms INTEGER,
      generated_at_ms INTEGER,
      updated_at_ms INTEGER,
      schema_version INTEGER,
      input_fingerprint TEXT,
      ready INTEGER,
      headline TEXT,
      summary TEXT,
      evidence_record_count INTEGER,
      report_json TEXT,
      viewed_at_ms INTEGER
    );
  `);
}

function insightReport(inputGeneration: number): InsightReport {
  return {
    inputGeneration,
    generatedAt: 100,
    currentRange: { start: 20, end: 30 },
    previousRange: { start: 10, end: 20 },
    ready: true,
    headline: "A review",
    summary: "A summary",
    current: {
      glucoseAverage: 7,
      glucoseStandardDeviation: 1,
      glucoseCvPercent: 14,
      timeInRangePercent: 80,
      timeAbovePercent: 15,
      timeBelowPercent: 5,
      coveragePercent: 95,
      glucoseReadings: 100,
      highGlucoseRuns: 2,
      lowGlucoseRuns: 1,
      insulinUnits: 200,
      mealCarbsPerDay: 150,
      lateMeals: 2,
      sleepMinutesPerNight: 450,
      activityMinutes: 120,
    },
    previous: {
      glucoseAverage: 7.2,
      glucoseStandardDeviation: 1.1,
      glucoseCvPercent: 15,
      timeInRangePercent: 78,
      timeAbovePercent: 17,
      timeBelowPercent: 5,
      coveragePercent: 94,
      glucoseReadings: 100,
      highGlucoseRuns: 3,
      lowGlucoseRuns: 1,
      insulinUnits: 205,
      mealCarbsPerDay: 160,
      lateMeals: 3,
      sleepMinutesPerNight: 430,
      activityMinutes: 90,
    },
    findings: [],
  };
}

function insertStoredReport(database: DatabaseSync) {
  database
    .prepare(
      `INSERT INTO insight_reports (
         id, period_end_ms, generated_at_ms, updated_at_ms,
         input_fingerprint, report_json, viewed_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      "rolling-week:30",
      30,
      100,
      100,
      "old-fingerprint",
      JSON.stringify(insightReport(0)),
    );
}

function insertedInsightReport(database: AsyncDatabaseAdapter) {
  return database.executedSql.some((sql) =>
    /^\s*INSERT INTO insight_reports\b/i.test(sql),
  );
}

describe("durable insight-input generation", () => {
  let sqlite: DatabaseSync;
  let database: AsyncDatabaseAdapter;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    database = new AsyncDatabaseAdapter(sqlite);
    persistence.database = database;
  });

  afterEach(() => {
    sqlite.close();
  });

  it("advances the generation in the same clear that deletes saved reports", async () => {
    insertStoredReport(sqlite);
    await expect(acquireInsightInputGeneration()).resolves.toBe(0);

    await expect(clearSavedInsightReports({ epoch: 0 })).resolves.toBe(1);

    await expect(acquireInsightInputGeneration()).resolves.toBe(1);
    expect(
      sqlite
        .prepare("SELECT value FROM app_metadata WHERE key = ?")
        .get(INSIGHT_INPUT_GENERATION_KEY),
    ).toEqual({ value: "1" });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM insight_reports").get(),
    ).toEqual({ count: 0 });
  });

  it("marks derived reviews dirty without discarding the last readable report", async () => {
    insertStoredReport(sqlite);

    await expect(markInsightReviewDirty({ epoch: 0 })).resolves.toBe(1);

    await expect(acquireInsightInputGeneration()).resolves.toBe(1);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM insight_reports").get(),
    ).toEqual({ count: 1 });
  });

  it("rejects a stale report before issuing any report INSERT", async () => {
    await clearSavedInsightReports({ epoch: 0 });
    database.executedSql.length = 0;

    await expect(
      saveInsightReport(insightReport(0), { epoch: 0 }),
    ).rejects.toBeInstanceOf(InsightInputSupersededError);

    expect(insertedInsightReport(database)).toBe(false);
    await expect(acquireInsightInputGeneration()).resolves.toBe(1);
  });

  it("rejects a deferred stale save after a concurrent clear", async () => {
    insertStoredReport(sqlite);
    const gate = database.pauseNextReportRead();
    const staleSave = saveInsightReport(insightReport(0), { epoch: 0 });
    await gate.entered.promise;

    await expect(clearSavedInsightReports({ epoch: 0 })).resolves.toBe(1);
    gate.release.resolve();

    await expect(staleSave).rejects.toBeInstanceOf(InsightInputSupersededError);
    expect(insertedInsightReport(database)).toBe(false);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM insight_reports").get(),
    ).toEqual({ count: 0 });
    await expect(acquireInsightInputGeneration()).resolves.toBe(1);
  });
});
