import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RAW_BACKUP_TABLE_COLUMNS as BACKUP_TABLE_COLUMNS,
  RAW_EXCLUDED_TABLES,
} from "../src/rawSchema.js";

const TABLE_NAMES = Object.keys(BACKUP_TABLE_COLUMNS);
const EXCLUDED_TABLES = new Set(RAW_EXCLUDED_TABLES);
const RAW_BACKUP_STREAM_MAGIC = "T1ARCCN1";
const RAW_BACKUP_VERSION = 16;

const INDEXES = [
  ["glucose_readings", "timestamp_ms"], ["glucose_readings", "source_id"],
  ["insulin_basal", "start_ms"], ["insulin_bolus", "timestamp_ms"],
  ["context_events", "start_ms"], ["context_events", "kind"],
  ["context_notes", "start_ms"], ["hevy_workouts", "start_ms"],
  ["health_connect_records", "start_ms"], ["health_connect_records", "kind"],
  ["health_connect_records", "source_package"], ["food_logs", "timestamp_ms"],
  ["food_log_items", "food_log_id"], ["insulin_daily_totals", "date_key"],
  ["import_raw_records", "timestamp_ms"], ["import_raw_records", "record_kind"],
];

function quoted(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function usage() {
  process.stderr.write("Usage: node scripts/restore-raw-sqlite.js INPUT.container OUTPUT.sqlite\n");
  process.exit(2);
}

function readExact(fd, length, position) {
  const buffer = Buffer.alloc(length);
  if (fs.readSync(fd, buffer, 0, length, position) !== length) {
    throw new Error("The health backup ended unexpectedly.");
  }
  return buffer;
}

function exactRow(row, columns, tableName, rowNumber) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${tableName} row ${rowNumber} is invalid.`);
  }
  const actual = Object.keys(row).sort();
  const expected = [...columns].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${tableName} row ${rowNumber} does not match the portable database schema.`);
  }
  for (const value of Object.values(row)) {
    if (value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`${tableName} row ${rowNumber} contains a non-scalar value.`);
    }
  }
  return row;
}

function createTables(database) {
  for (const [name, columns] of Object.entries(BACKUP_TABLE_COLUMNS)) {
    if (EXCLUDED_TABLES.has(name)) continue;
    database.exec(`CREATE TABLE ${quoted(name)} (${columns.map((column) => `${quoted(column)} ANY`).join(", ")}) STRICT`);
  }
  database.exec(`CREATE TABLE t1arc_snapshot_manifest (
    source_format TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    excluded_tables_json TEXT NOT NULL
  ) STRICT`);
}

function createStatements(database) {
  return Object.fromEntries(
    Object.entries(BACKUP_TABLE_COLUMNS)
      .filter(([name]) => !EXCLUDED_TABLES.has(name))
      .map(([name, columns]) => [
        name,
        database.prepare(
          `INSERT INTO ${quoted(name)} (${columns.map(quoted).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ),
      ]),
  );
}

function restore(inputPath, outputPath) {
  if (fs.existsSync(outputPath)) throw new Error("Refusing to overwrite an existing output database.");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const input = fs.openSync(inputPath, "r");
  const inputSize = fs.fstatSync(input).size;
  const database = new DatabaseSync(outputPath, { allowExtension: false });
  let position = 0;
  let manifest;
  let sawEndFrame = false;
  const counts = Object.fromEntries(TABLE_NAMES.map((name) => [name, 0]));
  try {
    database.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE");
    createTables(database);
    const statements = createStatements(database);
    const magic = readExact(input, 8, position);
    position += 8;
    if (magic.toString("ascii") !== RAW_BACKUP_STREAM_MAGIC) throw new Error("The input is not an unlocked T1 Arc streamed backup.");

    while (position < inputSize) {
      const header = readExact(input, 6, position);
      position += 6;
      const type = header[0];
      const tableIndex = header[1];
      const length = header.readUInt32BE(2);
      if (position + length > inputSize) throw new Error("The health backup ended unexpectedly.");
      if (type === 0) {
        if (tableIndex !== 255 || length !== 0 || position !== inputSize) throw new Error("The health backup has invalid trailing data.");
        sawEndFrame = true;
        break;
      }
      if (type === 1) {
        if (manifest || tableIndex !== 255) throw new Error("The health backup manifest is invalid.");
        manifest = JSON.parse(readExact(input, length, position).toString("utf8"));
      } else if (type === 2) {
        const tableName = TABLE_NAMES[tableIndex];
        if (!tableName) throw new Error("The health backup references an unknown table.");
        counts[tableName] += 1;
        if (!EXCLUDED_TABLES.has(tableName)) {
          const columns = BACKUP_TABLE_COLUMNS[tableName];
          const row = exactRow(
            JSON.parse(readExact(input, length, position).toString("utf8")),
            columns,
            tableName,
            counts[tableName],
          );
          statements[tableName].run(...columns.map((column) => row[column]));
        }
      } else if (type !== 3) {
        throw new Error("The health backup contains an unknown frame type.");
      }
      position += length;
    }

    if (!sawEndFrame) {
      throw new Error("The health backup is missing its end frame.");
    }
    if (
      !manifest || manifest.format !== "t1arc-health-backup" ||
      manifest.version !== RAW_BACKUP_VERSION || manifest.timeZone !== "Europe/London"
    ) {
      throw new Error("The health backup manifest is not supported.");
    }
    for (const tableName of TABLE_NAMES) {
      if ((manifest.counts?.[tableName] ?? 0) !== counts[tableName]) {
        throw new Error(`${tableName} row count does not match the manifest.`);
      }
    }

    database.prepare(
      "INSERT INTO t1arc_snapshot_manifest VALUES (?, ?, ?, ?, ?)",
    ).run(
      manifest.format,
      manifest.version,
      manifest.createdAt,
      manifest.timeZone,
      JSON.stringify([...EXCLUDED_TABLES].sort()),
    );
    for (const [tableName, columnName] of INDEXES) {
      database.exec(`CREATE INDEX ${quoted(`tarvis_raw_${tableName}_${columnName}`)} ON ${quoted(tableName)} (${quoted(columnName)})`);
    }
    database.exec("COMMIT; PRAGMA optimize");
    database.enableLoadExtension(false);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    database.close();
    fs.closeSync(input);
    try { fs.rmSync(outputPath, { force: true }); } catch {}
    throw error;
  }
  database.close();
  fs.closeSync(input);
  fs.chmodSync(outputPath, 0o600);
  return { manifest, counts, bytes: fs.statSync(outputPath).size };
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) usage();
const result = restore(inputPath, outputPath);
process.stdout.write(`${JSON.stringify({
  outputPath,
  bytes: result.bytes,
  createdAtMs: result.manifest.createdAt,
  includedRows: Object.entries(result.counts)
    .filter(([name]) => !EXCLUDED_TABLES.has(name))
    .reduce((total, [, count]) => total + count, 0),
  excludedTables: [...EXCLUDED_TABLES].sort(),
}, null, 2)}\n`);
