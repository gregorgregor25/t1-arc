import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openRawDataset } from "../src/rawDataset.js";
import {
  RAW_BACKUP_TABLE_COLUMNS,
  RAW_EXCLUDED_TABLES,
  RAW_INCLUDED_TABLES,
} from "../src/rawSchema.js";

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function createFixture({ extraTable = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "tarvis-raw-test-"));
  const databasePath = path.join(directory, "raw.sqlite");
  const database = new DatabaseSync(databasePath, { allowExtension: false });
  for (const tableName of RAW_INCLUDED_TABLES) {
    database.exec(
      `CREATE TABLE ${quoteIdentifier(tableName)} (${RAW_BACKUP_TABLE_COLUMNS[tableName]
        .map((column) => `${quoteIdentifier(column)} ANY`)
        .join(", ")}) STRICT`,
    );
  }
  database.exec(`CREATE TABLE t1arc_snapshot_manifest (
    source_format TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    excluded_tables_json TEXT NOT NULL
  ) STRICT`);
  database.prepare("INSERT INTO t1arc_snapshot_manifest VALUES (?, ?, ?, ?, ?)").run(
    "t1arc-health-backup",
    16,
    1_787_758_220_319,
    "Europe/London",
    JSON.stringify([...RAW_EXCLUDED_TABLES].sort()),
  );
  const glucoseColumns = RAW_BACKUP_TABLE_COLUMNS.glucose_readings;
  database.prepare(
    `INSERT INTO glucose_readings (${glucoseColumns.map(quoteIdentifier).join(", ")}) VALUES (${glucoseColumns.map(() => "?").join(", ")})`,
  ).run(
    "g1",
    "source-a",
    1_787_758_220_319,
    1_787_758_220_319,
    6.2,
    "stable",
    null,
    null,
    null,
    null,
    1_787_758_220_319,
    "source.csv",
    1,
    null,
  );
  if (extraTable) database.exec("CREATE TABLE should_not_be_here (value TEXT)");
  database.close();
  return { directory, databasePath };
}

test("keeps the raw helper aligned with the current streamed backup contract", () => {
  const helper = readFileSync(
    new URL("../scripts/restore-raw-sqlite.js", import.meta.url),
    "utf8",
  );
  assert.match(helper, /RAW_BACKUP_STREAM_MAGIC\s*=\s*"T1ARCCN1"/u);
  assert.match(helper, /RAW_BACKUP_VERSION\s*=\s*16/u);
  assert.ok(RAW_BACKUP_TABLE_COLUMNS.context_notes.includes("glucose_mmol_l"));
});

test("opens the exact raw backup shape read-only with London clock helpers", () => {
  const fixture = createFixture();
  try {
    const dataset = openRawDataset(fixture.databasePath);
    try {
      assert.equal(dataset.description.schemaVersion, "raw-backup-v16");
      assert.equal(dataset.description.totalRows, 1);
      assert.equal(dataset.description.tables.glucose_readings.rowCount, 1);
      assert.deepEqual(
        dataset.query(`SELECT
          t1arc_local_date(timestamp_ms) AS local_date,
          t1arc_local_time(timestamp_ms) AS local_time
        FROM glucose_readings`).rows,
        [{ local_date: "2026-08-26", local_time: "16:30:20" }],
      );
      assert.equal(
        dataset.query(`SELECT
          t1arc_day_end_ms('2026-10-25') - t1arc_day_start_ms('2026-10-25') AS duration_ms`).rows[0].duration_ms,
        25 * 60 * 60 * 1_000,
      );
      assert.throws(
        () => dataset.query("UPDATE glucose_readings SET mmol_l = 9"),
        /read-only|SELECT/u,
      );
    } finally {
      dataset.close();
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("fails closed when a raw snapshot contains an unexpected table", () => {
  const fixture = createFixture({ extraTable: true });
  try {
    assert.throws(
      () => openRawDataset(fixture.databasePath),
      /could not be opened safely/u,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
