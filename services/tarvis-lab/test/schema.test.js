import assert from "node:assert/strict";
import test from "node:test";
import { createDataset } from "../src/schema.js";
import { executeReadonlyQuery, validateReadonlySql } from "../src/sql.js";
import { emptySnapshot, glucoseRow } from "./fixtures.js";

test("loads the exact normalized schema into an in-memory read-only database", () => {
  const snapshot = emptySnapshot();
  snapshot.tables.glucose_readings.push(glucoseRow());
  const dataset = createDataset(snapshot);
  try {
    assert.equal(dataset.description.totalRows, 1);
    assert.equal(dataset.description.tables.glucose_readings.rowCount, 1);
    const result = executeReadonlyQuery(
      dataset.database,
      "SELECT local_date, ROUND(AVG(mmol_l), 1) AS average_mmol_l FROM glucose_readings GROUP BY local_date",
    );
    assert.deepEqual(result.rows, [
      { local_date: "2026-08-26", average_mmol_l: 5.9 },
    ]);
    assert.equal(result.truncated, false);
    assert.throws(
      () => dataset.database.prepare("DELETE FROM glucose_readings").run(),
      /read.?only/u,
    );
  } finally {
    dataset.database.close();
  }
});

test("rejects missing, unknown and nested snapshot fields", () => {
  const missingTable = emptySnapshot();
  delete missingTable.tables.meal_items;
  assert.throws(() => createDataset(missingTable), /does not match schema version 1/u);

  const unknownColumn = emptySnapshot();
  unknownColumn.tables.glucose_readings.push({ ...glucoseRow(), surprise: "no" });
  assert.throws(() => createDataset(unknownColumn), /does not match schema version 1/u);

  const nestedValue = emptySnapshot();
  nestedValue.tables.glucose_readings.push(glucoseRow({ quality: { nested: true } }));
  assert.throws(() => createDataset(nestedValue), /must be bounded text or null/u);
});

test("allows SELECT and blocks mutations, multiple statements and dangerous functions", () => {
  assert.equal(validateReadonlySql("SELECT 1;"), "SELECT 1");
  assert.equal(
    validateReadonlySql("WITH values_cte AS (SELECT 2 AS n) SELECT n FROM values_cte"),
    "WITH values_cte AS (SELECT 2 AS n) SELECT n FROM values_cte",
  );
  assert.throws(() => validateReadonlySql("UPDATE glucose_readings SET mmol_l=1"), /Only SELECT/u);
  assert.throws(() => validateReadonlySql("SELECT 1; SELECT 2"), /Only one/u);
  assert.throws(() => validateReadonlySql("SELECT randomblob(10)"), /disabled function/u);
  assert.throws(() => validateReadonlySql("SELECT * FROM sqlite_master"), /internal tables/u);
  assert.throws(
    () => validateReadonlySql("SELECT * FROM glucose_readings CROSS JOIN health_metrics"),
    /not read-only/u,
  );
});

test("caps the rows returned to a model tool call", () => {
  const snapshot = emptySnapshot();
  snapshot.tables.glucose_readings.push(
    glucoseRow({ id: "g1" }),
    glucoseRow({ id: "g2", timestamp_ms: 1_787_678_400_000 }),
  );
  const dataset = createDataset(snapshot);
  try {
    const result = executeReadonlyQuery(dataset.database, "SELECT id FROM glucose_readings ORDER BY id", {
      maxRows: 1,
    });
    assert.deepEqual(result.rows, [{ id: "g1" }]);
    assert.equal(result.truncated, true);
  } finally {
    dataset.database.close();
  }
});
