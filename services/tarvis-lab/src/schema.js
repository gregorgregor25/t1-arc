import { DatabaseSync } from "node:sqlite";
import { HttpError } from "./errors.js";

const MAX_TOTAL_ROWS = 1_000_000;
const MAX_STRING_CHARACTERS = 16_000;

const TABLE_COLUMNS = {
  glucose_readings: [
    "id", "timestamp_ms", "received_at_ms", "mmol_l", "trend", "quality",
    "source_id", "imported_at_ms", "local_date", "local_time", "local_weekday",
  ],
  glucose_observation_intervals: [
    "id", "reading_id", "start_ms", "end_ms", "observed_minutes", "mmol_l",
    "range_band", "source_id", "local_date", "local_weekday",
  ],
  basal_deliveries: [
    "id", "start_ms", "end_ms", "rate_units_per_hour", "units", "delivery_type",
    "percentage", "units_estimated", "source_id", "local_start_date",
    "local_start_time", "local_start_weekday", "local_end_date", "local_end_time",
  ],
  basal_daily_segments: [
    "id", "delivery_id", "start_ms", "end_ms", "duration_minutes", "units",
    "rate_units_per_hour", "source_id", "local_date", "local_weekday",
  ],
  bolus_deliveries: [
    "id", "timestamp_ms", "units", "delivery_type", "blood_glucose_input_mmol_l",
    "carbs_input_grams", "carb_ratio_grams_per_unit", "initial_units", "extended_units",
    "source_id", "local_date", "local_time", "local_weekday",
  ],
  insulin_daily_totals: [
    "id", "timestamp_ms", "date_key", "basal_units", "bolus_units", "total_units",
    "source_id", "local_weekday",
  ],
  pump_states: [
    "id", "start_ms", "end_ms", "kind", "source_id", "local_start_date",
    "local_start_time", "local_start_weekday", "local_end_date", "local_end_time",
  ],
  context_events: [
    "id", "kind", "start_ms", "end_ms", "title", "source_id", "source_label",
    "origin", "recorded_at_ms", "local_date", "local_time", "local_weekday",
    "meal_type", "carbs_grams", "energy_kcal", "protein_grams", "fat_grams",
    "fibre_grams", "sugars_grams", "saturated_fat_grams", "serving_quantity",
    "serving_count", "nutrition_detail", "activity_type", "duration_minutes",
    "intensity", "calories_burned", "quality_percent", "weight_kilograms",
    "medication_amount", "medication_unit", "medication_type", "note_category",
    "note_detail", "ketone_type", "ketone_value_numeric", "ketone_value_text",
    "ketone_unit",
  ],
  meal_items: [
    "id", "context_event_id", "name", "brand", "amount", "unit",
    "carbohydrate_grams", "energy_kcal", "protein_grams", "fat_grams", "fibre_grams",
    "sugars_grams", "saturated_fat_grams", "source_label",
  ],
  strength_workouts: [
    "workout_id", "context_event_id", "title", "description", "start_ms", "end_ms",
    "source_id", "source_label", "local_date", "local_time", "local_weekday",
  ],
  strength_exercises: [
    "workout_id", "context_event_id", "exercise_index", "title", "notes",
    "exercise_template_id", "superset_id",
  ],
  strength_sets: [
    "workout_id", "context_event_id", "exercise_index", "set_index", "set_type",
    "weight_kilograms", "reps", "distance_metres", "duration_seconds", "rpe",
    "custom_metric",
  ],
  health_metrics: [
    "id", "measurement_id", "kind", "source_package", "source_label", "start_ms",
    "end_ms", "value", "unit", "meal_type_code", "relation_to_meal_code",
    "specimen_source_code", "local_date", "local_time", "local_weekday",
  ],
  daily_health_metrics: [
    "local_date", "local_weekday", "steps", "distance_kilometres",
    "elevation_gained_metres", "floors_climbed", "active_calories_kcal",
    "total_calories_kcal", "average_workout_power_watts", "maximum_workout_power_watts",
    "average_workout_speed_metres_per_second", "maximum_workout_speed_metres_per_second",
    "average_walking_cadence_per_minute", "average_cycling_cadence_rpm",
    "average_heart_rate_bpm", "resting_heart_rate_bpm", "minimum_heart_rate_bpm",
    "maximum_heart_rate_bpm", "weight_kilograms", "body_fat_percent",
    "lean_body_mass_kilograms", "body_water_mass_kilograms", "blood_pressure_systolic",
    "blood_pressure_diastolic", "oxygen_saturation_percent",
    "respiratory_rate_per_minute", "heart_rate_variability_rmssd_ms",
    "vo2_max_ml_per_kg_min", "body_temperature_celsius", "hydration_litres",
    "sleep_minutes", "workout_minutes", "meal_count", "meal_carbs_grams",
    "record_count", "source_labels_json", "needs_source_json",
  ],
  source_statuses: [
    "id", "label", "freshness", "origin", "last_updated_at_ms", "data_through_ms",
    "record_count", "is_live", "capabilities_json",
  ],
};

const TABLE_DETAILS = {
  glucose_readings: {
    description: "Individual CGM readings. This is sample-based; use observation intervals for duration-weighted glucose metrics.",
    maxRows: 300_000,
    required: ["id", "timestamp_ms", "mmol_l", "source_id", "local_date", "local_time", "local_weekday"],
    time: ["timestamp_ms", "timestamp_ms"],
  },
  glucose_observation_intervals: {
    description: "CGM readings converted into bounded observed-time intervals and split at local midnight. Sum observed_minutes for time-in-range calculations.",
    maxRows: 300_000,
    required: ["id", "reading_id", "start_ms", "end_ms", "observed_minutes", "mmol_l", "range_band", "local_date"],
    time: ["start_ms", "end_ms"],
  },
  basal_deliveries: {
    description: "Imported basal insulin delivery intervals. units may be estimated; uncovered time must not be treated as zero delivery.",
    maxRows: 100_000,
    required: ["id", "start_ms", "end_ms", "rate_units_per_hour", "units", "source_id"],
    time: ["start_ms", "end_ms"],
  },
  basal_daily_segments: {
    description: "Basal deliveries split at local midnight with apportioned units, suitable for local-day totals.",
    maxRows: 150_000,
    required: ["id", "delivery_id", "start_ms", "end_ms", "duration_minutes", "units", "local_date"],
    time: ["start_ms", "end_ms"],
  },
  bolus_deliveries: {
    description: "Bolus insulin deliveries, including optional pump-entered glucose, carb and ratio fields.",
    maxRows: 100_000,
    required: ["id", "timestamp_ms", "units", "source_id", "local_date", "local_time", "local_weekday"],
    time: ["timestamp_ms", "timestamp_ms"],
  },
  insulin_daily_totals: {
    description: "Source-reported insulin daily totals. These may differ from sums of detailed rows and should be identified as a separate source.",
    maxRows: 10_000,
    required: ["id", "timestamp_ms", "date_key", "total_units", "source_id"],
    time: ["timestamp_ms", "timestamp_ms"],
  },
  pump_states: {
    description: "Known pump-state intervals such as automated pauses. Absence of a state is not proof of normal delivery.",
    maxRows: 100_000,
    required: ["id", "start_ms", "end_ms", "kind", "source_id"],
    time: ["start_ms", "end_ms"],
  },
  context_events: {
    description: "Meals, activity, sleep, weight, medication, notes and manually logged ketones in one typed event timeline. Event-specific columns are null for other kinds.",
    maxRows: 150_000,
    required: ["id", "kind", "start_ms", "title", "source_id", "origin", "local_date", "local_time", "local_weekday"],
    time: ["start_ms", "end_ms"],
  },
  meal_items: {
    description: "Food items belonging to meal context events, joined via context_event_id.",
    maxRows: 250_000,
    required: ["id", "context_event_id", "name", "amount", "unit"],
  },
  strength_workouts: {
    description: "Strength-workout sessions, joined to context_events and to exercise/set tables.",
    maxRows: 50_000,
    required: ["workout_id", "context_event_id", "title", "start_ms", "source_id", "local_date", "local_time", "local_weekday"],
    time: ["start_ms", "end_ms"],
  },
  strength_exercises: {
    description: "Ordered exercises within strength workouts, joined by workout_id and exercise_index.",
    maxRows: 150_000,
    required: ["workout_id", "context_event_id", "exercise_index", "title"],
  },
  strength_sets: {
    description: "Ordered sets within strength exercises, joined by workout_id and exercise_index.",
    maxRows: 500_000,
    required: ["workout_id", "context_event_id", "exercise_index", "set_index", "set_type"],
  },
  health_metrics: {
    description: "Individual Health Connect measurements from all supported kinds, with source, time, numeric value and unit.",
    maxRows: 500_000,
    required: ["id", "kind", "source_package", "source_label", "start_ms", "end_ms", "value", "unit", "local_date", "local_time", "local_weekday"],
    time: ["start_ms", "end_ms"],
  },
  daily_health_metrics: {
    description: "Preferred-source canonical local-day health, activity, sleep and meal summary for up to the last 90 days. Use this for highest-step and other daily totals. Null means unavailable; it does not mean zero.",
    maxRows: 10_000,
    required: ["local_date", "local_weekday", "sleep_minutes", "workout_minutes", "meal_count", "record_count"],
    localDate: "local_date",
  },
  source_statuses: {
    description: "Freshness, coverage and capabilities reported for each imported or live source.",
    maxRows: 1_000,
    required: ["id", "label", "freshness", "origin", "is_live", "capabilities_json"],
    time: ["data_through_ms", "data_through_ms"],
  },
};

const TEXT_COLUMNS = new Set([
  "id", "reading_id", "delivery_id", "workout_id", "context_event_id", "measurement_id",
  "source_id", "source_package", "source_label", "date_key", "local_date", "local_time",
  "local_weekday", "local_start_date", "local_start_time", "local_start_weekday",
  "local_end_date", "local_end_time", "trend", "quality", "range_band", "delivery_type",
  "kind", "title", "origin", "meal_type", "nutrition_detail", "activity_type", "intensity",
  "medication_unit", "medication_type", "note_category", "note_detail", "ketone_type",
  "ketone_value_text", "ketone_unit", "name", "brand", "unit", "description", "notes",
  "exercise_template_id", "set_type", "freshness", "capabilities_json", "source_labels_json",
  "needs_source_json",
]);

const INDEXES = [
  ["glucose_readings", "timestamp_ms"],
  ["glucose_readings", "local_date"],
  ["glucose_observation_intervals", "start_ms"],
  ["glucose_observation_intervals", "local_date"],
  ["basal_deliveries", "start_ms"],
  ["basal_daily_segments", "local_date"],
  ["bolus_deliveries", "timestamp_ms"],
  ["bolus_deliveries", "local_date"],
  ["insulin_daily_totals", "date_key"],
  ["pump_states", "start_ms"],
  ["context_events", "start_ms"],
  ["context_events", "local_date"],
  ["context_events", "kind"],
  ["meal_items", "context_event_id"],
  ["strength_workouts", "workout_id"],
  ["strength_exercises", "workout_id"],
  ["strength_sets", "workout_id"],
  ["health_metrics", "start_ms"],
  ["health_metrics", "kind"],
  ["daily_health_metrics", "local_date"],
];

export const TABLE_SCHEMAS = Object.freeze(
  Object.fromEntries(
    Object.entries(TABLE_COLUMNS).map(([name, columns]) => [
      name,
      Object.freeze({
        ...TABLE_DETAILS[name],
        columns: Object.freeze(
          columns.map((column) =>
            Object.freeze({
              name: column,
              type: TEXT_COLUMNS.has(column) ? "TEXT" : "REAL",
              nullable: !TABLE_DETAILS[name].required.includes(column),
            }),
          ),
        ),
      }),
    ]),
  ),
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new HttpError(400, "snapshot_schema_invalid", `${label} does not match schema version 1.`);
  }
}

function validateNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "snapshot_value_invalid", `${label} must be a finite number.`);
  }
}

function validateSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    throw new HttpError(400, "snapshot_invalid", "The request must contain a normalized T1 Arc snapshot.");
  }
  assertExactKeys(snapshot, ["schemaVersion", "timezone", "generatedAtMs", "range", "tables"], "Snapshot");
  if (snapshot.schemaVersion !== 1) {
    throw new HttpError(400, "snapshot_version_unsupported", "Only TARV1S lab snapshot schema version 1 is supported.");
  }
  if (snapshot.timezone !== "Europe/London") {
    throw new HttpError(400, "snapshot_timezone_invalid", "Snapshot timezone must be Europe/London.");
  }
  validateNumber(snapshot.generatedAtMs, "generatedAtMs");
  if (!isPlainObject(snapshot.range)) {
    throw new HttpError(400, "snapshot_range_invalid", "Snapshot range is invalid.");
  }
  assertExactKeys(snapshot.range, ["startMs", "endMs"], "Snapshot range");
  validateNumber(snapshot.range.startMs, "range.startMs");
  validateNumber(snapshot.range.endMs, "range.endMs");
  if (snapshot.range.startMs >= snapshot.range.endMs) {
    throw new HttpError(400, "snapshot_range_invalid", "Snapshot range must have a positive duration.");
  }
  if (!isPlainObject(snapshot.tables)) {
    throw new HttpError(400, "snapshot_tables_invalid", "Snapshot tables are invalid.");
  }
  assertExactKeys(snapshot.tables, Object.keys(TABLE_SCHEMAS), "Snapshot tables");

  let totalRows = 0;
  for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
    const rows = snapshot.tables[tableName];
    if (!Array.isArray(rows) || rows.length > schema.maxRows) {
      throw new HttpError(400, "snapshot_rows_invalid", `${tableName} exceeds its row limit or is not an array.`);
    }
    totalRows += rows.length;
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new HttpError(413, "snapshot_too_many_rows", "The snapshot exceeds the total row limit.");
    }
    const columnNames = schema.columns.map((column) => column.name);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!isPlainObject(row)) {
        throw new HttpError(400, "snapshot_row_invalid", `${tableName}[${rowIndex}] must be an object.`);
      }
      assertExactKeys(row, columnNames, `${tableName}[${rowIndex}]`);
      for (const column of schema.columns) {
        const value = row[column.name];
        const label = `${tableName}[${rowIndex}].${column.name}`;
        if (value === null) {
          if (!column.nullable) {
            throw new HttpError(400, "snapshot_value_invalid", `${label} cannot be null.`);
          }
          continue;
        }
        if (column.type === "TEXT") {
          if (typeof value !== "string" || value.length > MAX_STRING_CHARACTERS) {
            throw new HttpError(400, "snapshot_value_invalid", `${label} must be bounded text or null.`);
          }
        } else {
          validateNumber(value, label);
        }
      }
    }
  }
  return { snapshot, totalRows };
}

function quoted(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createTables(database) {
  for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
    const columns = schema.columns
      .map((column) => `${quoted(column.name)} ${column.type}${column.nullable ? "" : " NOT NULL"}`)
      .join(", ");
    database.exec(`CREATE TABLE ${quoted(tableName)} (${columns}) STRICT`);
  }
}

function insertRows(database, snapshot) {
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
      const columnNames = schema.columns.map((column) => column.name);
      const statement = database.prepare(
        `INSERT INTO ${quoted(tableName)} (${columnNames.map(quoted).join(", ")}) VALUES (${columnNames.map(() => "?").join(", ")})`,
      );
      for (const row of snapshot.tables[tableName]) {
        statement.run(...columnNames.map((column) => row[column]));
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function createIndexes(database) {
  INDEXES.forEach(([tableName, columnName], index) => {
    database.exec(
      `CREATE INDEX ${quoted(`tarvis_idx_${index}`)} ON ${quoted(tableName)} (${quoted(columnName)})`,
    );
  });
}

function timeCoverage(database, tableName, schema) {
  if (schema.time) {
    const [startColumn, endColumn] = schema.time;
    const row = database
      .prepare(
        `SELECT MIN(${quoted(startColumn)}) AS startMs, MAX(${quoted(endColumn)}) AS endMs FROM ${quoted(tableName)}`,
      )
      .get();
    return row?.startMs === null || row?.startMs === undefined
      ? null
      : { startMs: row.startMs, endMs: row.endMs };
  }
  if (schema.localDate) {
    const row = database
      .prepare(
        `SELECT MIN(${quoted(schema.localDate)}) AS startDate, MAX(${quoted(schema.localDate)}) AS endDate FROM ${quoted(tableName)}`,
      )
      .get();
    return row?.startDate === null || row?.startDate === undefined
      ? null
      : { startDate: row.startDate, endDate: row.endDate };
  }
  return null;
}

function describeDatabase(database, snapshot, totalRows) {
  return {
    schemaVersion: 1,
    timezone: snapshot.timezone,
    generatedAtMs: snapshot.generatedAtMs,
    requestedRange: snapshot.range,
    timestampConvention: "All *_ms columns are Unix epoch milliseconds. Local date/time fields already use Europe/London clock boundaries.",
    missingDataConvention: "Null means unavailable, not zero. Empty tables mean no matching records were supplied for this snapshot, not proof that an event never occurred.",
    totalRows,
    relationships: [
      "glucose_observation_intervals.reading_id -> glucose_readings.id",
      "basal_daily_segments.delivery_id -> basal_deliveries.id",
      "meal_items.context_event_id -> context_events.id",
      "strength_workouts.context_event_id -> context_events.id",
      "strength_exercises(workout_id, context_event_id) -> strength_workouts",
      "strength_sets(workout_id, context_event_id, exercise_index) -> strength_exercises",
    ],
    tables: Object.fromEntries(
      Object.entries(TABLE_SCHEMAS).map(([tableName, schema]) => [
        tableName,
        {
          description: schema.description,
          rowCount: snapshot.tables[tableName].length,
          timeCoverage: timeCoverage(database, tableName, schema),
          columns: schema.columns.map(({ name, type, nullable }) => ({ name, type, nullable })),
        },
      ]),
    ),
  };
}

export function createDataset(snapshotInput) {
  const { snapshot, totalRows } = validateSnapshot(snapshotInput);
  const database = new DatabaseSync(":memory:", { allowExtension: false });
  try {
    database.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF");
    createTables(database);
    insertRows(database, snapshot);
    createIndexes(database);
    const description = describeDatabase(database, snapshot, totalRows);
    database.exec("PRAGMA query_only=ON");
    database.enableLoadExtension(false);
    return { database, description };
  } catch (error) {
    database.close();
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "snapshot_load_failed", "The normalized snapshot could not be loaded.", { cause: error });
  }
}
