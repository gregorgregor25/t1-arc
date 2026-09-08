import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import {
  ensureGlucoseReadingDeviceIdentity,
  GLUCOSE_READINGS_CREATE_SQL,
} from './glucoseReadingIdentitySchema';
import {
  CURRENT_T1ARC_SCHEMA_VERSION,
  runVersionedStartupMaintenance,
  STARTUP_MAINTENANCE_METADATA_KEY,
} from './databaseStartupPolicy';
import { createPriorityTransactionScheduler } from './priorityTransactionScheduler';
import { retrySqliteBusy } from './sqliteBusyRetry';
import { pruneRetainedGlookoSources } from '@/data/glooko/glookoSourceRetention';
import { repairHevyWorkoutContextOwnership } from '@/data/hevy/contextOwnership';
import { backfillNativeFoodLogContextNutrition } from '@/data/food/foodLogContextBackfill';
import { ensureNotificationEvidenceProvenance } from './notificationEvidenceProvenanceMigration';
import { legacyContextNoteGlucoseMmolL } from '@/domain/contextNotes';
import {
  completePendingEraseSanitizationWithRetry,
  resumePendingEraseSanitizationAtStartup,
  runSecureEraseTransaction,
} from './eraseSanitization';

const DATABASE_NAME = 't1arc-health-v1.db';
const DATABASE_KEY = 't1arc.database.key.v1';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
const transactionScheduler = createPriorityTransactionScheduler();

const DATABASE_BUSY_TIMEOUT_MS = 30_000;

export async function backfillLegacyGlookoMeterContextNotes(
  database: Pick<SQLite.SQLiteDatabase, 'getAllAsync' | 'runAsync'>,
) {
  const rows = await database.getAllAsync<{ id: string; title: string }>(
    `SELECT id, title
       FROM context_notes
      WHERE source_id = 'glooko-export'
        AND glucose_mmol_l IS NULL
        AND title LIKE 'Blood glucose check · %'`,
  );
  let updated = 0;
  for (const row of rows) {
    const mmolL = legacyContextNoteGlucoseMmolL(row.title);
    if (mmolL === undefined) continue;
    const result = await database.runAsync(
      `UPDATE context_notes
          SET title = 'Blood glucose check', glucose_mmol_l = ?
        WHERE id = ? AND glucose_mmol_l IS NULL`,
      mmolL,
      row.id,
    );
    updated += result.changes;
  }
  return updated;
}

async function openKeyedPrivateConnection(
  key: string,
  remainingBudgetMs: number,
) {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
  });
  try {
    const attemptBusyTimeoutMs = Math.max(
      1,
      Math.min(2_000, Math.floor(remainingBudgetMs)),
    );
    await database.execAsync(`
      PRAGMA key = '${key}';
      PRAGMA busy_timeout = ${attemptBusyTimeoutMs};
      PRAGMA foreign_keys = ON;
    `);
    return database;
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}

function completePendingEraseSanitizationWithKey(key: string) {
  return completePendingEraseSanitizationWithRetry(
    (remainingBudgetMs) =>
      openKeyedPrivateConnection(key, remainingBudgetMs),
    { maxWaitMs: DATABASE_BUSY_TIMEOUT_MS },
  );
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateDatabaseKey() {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY);
  if (existing) {
    if (!/^[0-9a-f]{64}$/i.test(existing)) {
      throw new Error('The encrypted health database key is invalid.');
    }
    return existing;
  }

  const key = toHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(DATABASE_KEY, key);
  return key;
}

async function hasColumn(
  database: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
) {
  const rows = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`,
  );
  return rows.some((row) => row.name === columnName);
}

async function ensureColumn(
  database: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  declaration: string,
) {
  if (await hasColumn(database, tableName, columnName)) return;
  await database.execAsync(
    `ALTER TABLE "${tableName.replace(/"/g, '""')}" ADD COLUMN "${columnName.replace(
      /"/g,
      '""',
    )}" ${declaration}`,
  );
}

async function ensureHealthConnectExtendedKinds(
  database: SQLite.SQLiteDatabase,
) {
  const table = await database.getFirstAsync<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = 'health_connect_records'`,
  );
  if (
    !table?.sql ||
    table.sql.includes("'menstruation_period'")
  ) {
    return;
  }

  await database.execAsync('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await database.execAsync(`
      DROP INDEX IF EXISTS idx_health_connect_kind_time;
      DROP INDEX IF EXISTS idx_health_connect_source_time;

      ALTER TABLE health_connect_records
        RENAME TO health_connect_records_before_extended_kinds;

      CREATE TABLE health_connect_records (
        id TEXT NOT NULL PRIMARY KEY,
        external_id TEXT NOT NULL,
        parent_external_id TEXT,
        kind TEXT NOT NULL CHECK (
          kind IN (
            'steps', 'distance', 'elevation_gained', 'floors_climbed',
            'active_calories', 'total_calories', 'workout',
            'workout_power', 'workout_speed', 'walking_cadence',
            'cycling_cadence',
            'heart_rate', 'resting_heart_rate', 'sleep', 'weight',
            'body_fat', 'lean_body_mass', 'body_water_mass',
            'bone_mass', 'height', 'basal_metabolic_rate',
            'blood_glucose', 'menstruation_period', 'menstruation_flow',
            'ovulation_test', 'basal_body_temperature', 'cervical_mucus',
            'intermenstrual_bleeding', 'blood_pressure_systolic',
            'blood_pressure_diastolic', 'oxygen_saturation',
            'respiratory_rate', 'heart_rate_variability_rmssd',
            'vo2_max', 'body_temperature', 'hydration', 'nutrition'
          )
        ),
        source_package TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        last_modified_ms INTEGER NOT NULL,
        recording_method INTEGER NOT NULL,
        value REAL,
        unit TEXT,
        payload_json TEXT NOT NULL,
        imported_at_ms INTEGER NOT NULL,
        UNIQUE(kind, source_package, external_id)
      );

      INSERT INTO health_connect_records (
        id, external_id, parent_external_id, kind, source_package,
        start_ms, end_ms, last_modified_ms, recording_method,
        value, unit, payload_json, imported_at_ms
      )
      SELECT
        id, external_id, parent_external_id, kind, source_package,
        start_ms, end_ms, last_modified_ms, recording_method,
        value, unit, payload_json, imported_at_ms
      FROM health_connect_records_before_extended_kinds;

      DROP TABLE health_connect_records_before_extended_kinds;

      CREATE INDEX idx_health_connect_kind_time
        ON health_connect_records(kind, start_ms, end_ms);
      CREATE INDEX idx_health_connect_source_time
        ON health_connect_records(source_package, start_ms);
    `);
    await database.execAsync('COMMIT;');
  } catch (error) {
    await database.execAsync('ROLLBACK;').catch(() => undefined);
    throw error;
  }
}

export async function ensureRegionalFoodProviderKinds(
  database: SQLite.SQLiteDatabase,
) {
  const table = await database.getFirstAsync<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = 'food_catalog_cache'`,
  );
  if (!table?.sql || ['mext-jp', 'cnf', 'ciqual', 'bls', 'fineli'].every((provider) => table.sql!.includes(`'${provider}'`))) return;

  // SQLite cannot widen a CHECK constraint in place. Rebuild the three food
  // tables atomically, preserving every existing catalogue, log and recipe row.
  await database.execAsync('PRAGMA foreign_keys = OFF;');
  let transactionOpen = false;
  try {
    await database.execAsync('BEGIN IMMEDIATE TRANSACTION;');
    transactionOpen = true;
    await database.execAsync(`
      DROP TABLE IF EXISTS food_catalog_cache_regional;
      DROP TABLE IF EXISTS food_log_items_regional;
      DROP TABLE IF EXISTS food_recipe_items_regional;

      CREATE TABLE food_catalog_cache_regional (
        id TEXT NOT NULL PRIMARY KEY,
        provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
        ),
        external_id TEXT NOT NULL,
        barcode TEXT,
        name TEXT NOT NULL,
        brand TEXT,
        image_url TEXT,
        basis_amount REAL NOT NULL CHECK (basis_amount > 0),
        basis_unit TEXT NOT NULL CHECK (basis_unit IN ('g', 'ml')),
        default_serving_amount REAL,
        default_serving_unit TEXT,
        last_portion_amount REAL,
        last_portion_unit TEXT,
        carbohydrate_grams REAL,
        energy_kcal REAL,
        protein_grams REAL,
        fat_grams REAL,
        fibre_grams REAL,
        sugars_grams REAL,
        saturated_fat_grams REAL,
        nutrition_quality_json TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_url TEXT,
        raw_payload_json TEXT,
        cached_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER,
        is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
        use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
        last_used_at_ms INTEGER,
        UNIQUE(provider, external_id)
      );

      INSERT INTO food_catalog_cache_regional
      SELECT * FROM food_catalog_cache;

      CREATE TABLE food_log_items_regional (
        id TEXT NOT NULL PRIMARY KEY,
        food_log_id TEXT NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
        provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
        ),
        external_id TEXT NOT NULL,
        name_snapshot TEXT NOT NULL,
        brand_snapshot TEXT,
        barcode_snapshot TEXT,
        amount REAL NOT NULL CHECK (amount > 0),
        unit TEXT NOT NULL CHECK (unit IN ('g', 'ml')),
        carbohydrate_grams REAL,
        energy_kcal REAL,
        protein_grams REAL,
        fat_grams REAL,
        fibre_grams REAL,
        sugars_grams REAL,
        saturated_fat_grams REAL,
        source_label TEXT NOT NULL,
        source_url TEXT,
        UNIQUE(food_log_id, ordinal)
      );

      INSERT INTO food_log_items_regional
      SELECT * FROM food_log_items;

      CREATE TABLE food_recipe_items_regional (
        id TEXT NOT NULL PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
        provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
        ),
        external_id TEXT NOT NULL,
        name_snapshot TEXT NOT NULL,
        brand_snapshot TEXT,
        barcode_snapshot TEXT,
        amount REAL NOT NULL CHECK (amount > 0),
        unit TEXT NOT NULL CHECK (unit IN ('g', 'ml')),
        carbohydrate_grams REAL,
        energy_kcal REAL,
        protein_grams REAL,
        fat_grams REAL,
        fibre_grams REAL,
        sugars_grams REAL,
        saturated_fat_grams REAL,
        source_label TEXT NOT NULL,
        source_url TEXT,
        UNIQUE(recipe_id, ordinal)
      );

      INSERT INTO food_recipe_items_regional
      SELECT * FROM food_recipe_items;

      DROP TABLE food_log_items;
      DROP TABLE food_recipe_items;
      DROP TABLE food_catalog_cache;
      ALTER TABLE food_catalog_cache_regional RENAME TO food_catalog_cache;
      ALTER TABLE food_log_items_regional RENAME TO food_log_items;
      ALTER TABLE food_recipe_items_regional RENAME TO food_recipe_items;

      CREATE INDEX idx_food_catalog_barcode
        ON food_catalog_cache(barcode);
      CREATE INDEX idx_food_catalog_recent
        ON food_catalog_cache(last_used_at_ms DESC);
      CREATE INDEX idx_food_catalog_favorites
        ON food_catalog_cache(is_favorite, name);
      CREATE INDEX idx_food_log_items_log
        ON food_log_items(food_log_id, ordinal);
      CREATE INDEX idx_food_recipe_items_recipe
        ON food_recipe_items(recipe_id, ordinal);
      COMMIT;
    `);
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await database.execAsync('ROLLBACK;').catch(() => undefined);
    }
    throw error;
  } finally {
    await database.execAsync('PRAGMA foreign_keys = ON;');
  }

  const violation = await database.getFirstAsync<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>('PRAGMA foreign_key_check');
  if (violation) {
    throw new Error(
      `Food provider migration found an invalid ${violation.table} relationship.`,
    );
  }
}

async function openAndMigrate() {
  const key = await getOrCreateDatabaseKey();
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  // SQLCipher still locks and sanitises its cryptographic/key allocations with
  // enhanced whole-SQLite memory security disabled. The enhanced mode attempts
  // to mlock every SQLite allocation; Android's small per-process memlock limit
  // rejects those calls and SQLCipher logs each rejection, turning ordinary
  // reads into a CPU/log storm. It is also disabled by default upstream due to
  await database.execAsync(`
    PRAGMA key = '${key}';
  `);
  const cipher = await database.getFirstAsync<{ cipher_version: string }>(
    'PRAGMA cipher_version',
  );
  if (!cipher?.cipher_version) {
    await database.closeAsync();
    throw new Error('Encrypted health database is unavailable.');
  }

  // Capture this before any CREATE/ALTER work. Heavy data repair is versioned
  // separately from routine connection setup so a cold Headless JS runtime
  // can open an already-current database without repeating it.
  const openedVersionRow = await database.getFirstAsync<{
    user_version: number;
  }>('PRAGMA user_version');
  const openedSchemaVersion = openedVersionRow?.user_version ?? 0;

  await database.execAsync(`
    PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA auto_vacuum = INCREMENTAL;

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );

    ${GLUCOSE_READINGS_CREATE_SQL}

    CREATE INDEX IF NOT EXISTS idx_glucose_timestamp
      ON glucose_readings(timestamp_ms);
    CREATE INDEX IF NOT EXISTS idx_glucose_source_timestamp
      ON glucose_readings(source_id, timestamp_ms);

    CREATE TABLE IF NOT EXISTS source_sync_state (
      source_id TEXT NOT NULL PRIMARY KEY,
      last_attempt_at_ms INTEGER,
      last_success_at_ms INTEGER,
      last_error_code TEXT,
      last_error_message TEXT,
      record_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS insulin_basal (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
      rate_units_per_hour REAL NOT NULL CHECK (rate_units_per_hour >= 0),
      units REAL NOT NULL CHECK (units >= 0),
      delivery_type TEXT,
      percentage REAL,
      units_estimated INTEGER NOT NULL DEFAULT 0
        CHECK (units_estimated IN (0, 1)),
      imported_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER,
      source_device_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_insulin_basal_time
      ON insulin_basal(start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS insulin_bolus (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      units REAL NOT NULL CHECK (units >= 0),
      delivery_type TEXT,
      blood_glucose_input_mmol_l REAL,
      carbs_input_grams REAL,
      carb_ratio_grams_per_unit REAL,
      initial_units REAL,
      extended_units REAL,
      imported_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER,
      source_device_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_insulin_bolus_time
      ON insulin_bolus(timestamp_ms);

    CREATE TABLE IF NOT EXISTS insulin_daily_totals (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      date_key TEXT NOT NULL,
      basal_units REAL,
      bolus_units REAL,
      total_units REAL NOT NULL CHECK (total_units >= 0),
      imported_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER,
      source_device_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_insulin_daily_totals_time
      ON insulin_daily_totals(timestamp_ms);

    CREATE TABLE IF NOT EXISTS context_events (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('manual', 'imported', 'synthetic')),
      kind TEXT NOT NULL CHECK (
        kind IN ('meal', 'activity', 'sleep', 'weight', 'medication')
      ),
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      title TEXT NOT NULL,
      meal_type TEXT,
      carbs_grams REAL,
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      serving_quantity REAL,
      serving_count REAL,
      activity_type TEXT,
      duration_minutes REAL,
      intensity TEXT,
      calories_burned REAL,
      quality_percent REAL,
      kilograms REAL,
      amount REAL,
      unit TEXT,
      medication_type TEXT,
      recorded_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_context_events_time
      ON context_events(start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS hevy_workouts (
      id TEXT NOT NULL PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE
        REFERENCES context_events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
      updated_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      imported_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hevy_workouts_time
      ON hevy_workouts(start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS context_notes (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('manual', 'imported', 'synthetic')),
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK (
        category IN (
          'illness', 'stress', 'pump', 'sensor', 'hormones', 'travel', 'other'
        )
      ),
      detail TEXT,
      glucose_mmol_l REAL,
      sensor_started INTEGER CHECK (sensor_started IN (0, 1)),
      sensor_glucose_source_id TEXT,
      recorded_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_context_notes_time
      ON context_notes(start_ms, end_ms);

    CREATE TABLE IF NOT EXISTS health_connect_records (
      id TEXT NOT NULL PRIMARY KEY,
      external_id TEXT NOT NULL,
      parent_external_id TEXT,
      kind TEXT NOT NULL CHECK (
        kind IN (
          'steps', 'distance', 'elevation_gained', 'floors_climbed',
          'active_calories', 'total_calories', 'workout',
          'workout_power', 'workout_speed', 'walking_cadence',
          'cycling_cadence',
          'heart_rate', 'resting_heart_rate', 'sleep', 'weight',
          'body_fat', 'lean_body_mass', 'body_water_mass',
          'bone_mass', 'height', 'basal_metabolic_rate',
          'blood_glucose', 'menstruation_period', 'menstruation_flow',
          'ovulation_test', 'basal_body_temperature', 'cervical_mucus',
          'intermenstrual_bleeding', 'blood_pressure_systolic',
          'blood_pressure_diastolic', 'oxygen_saturation',
          'respiratory_rate', 'heart_rate_variability_rmssd',
          'vo2_max', 'body_temperature', 'hydration', 'nutrition'
        )
      ),
      source_package TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      last_modified_ms INTEGER NOT NULL,
      recording_method INTEGER NOT NULL,
      value REAL,
      unit TEXT,
      payload_json TEXT NOT NULL,
      imported_at_ms INTEGER NOT NULL,
      reconciliation_scope TEXT NOT NULL DEFAULT 'current' CHECK (
        reconciliation_scope IN ('current', 'restored')
      ),
      UNIQUE(kind, source_package, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_health_connect_kind_time
      ON health_connect_records(kind, start_ms, end_ms);
    CREATE INDEX IF NOT EXISTS idx_health_connect_source_time
      ON health_connect_records(source_package, start_ms);

    CREATE TABLE IF NOT EXISTS health_connect_sources (
      package_name TEXT NOT NULL PRIMARY KEY,
      display_name TEXT NOT NULL,
      first_seen_at_ms INTEGER NOT NULL,
      last_seen_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_connect_preferences (
      category TEXT NOT NULL PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      preferred_source_package TEXT,
      preferred_source_mode TEXT CHECK (
        preferred_source_mode IN ('automatic', 'manual')
      ),
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_connect_sync_state (
      category TEXT NOT NULL PRIMARY KEY,
      last_attempt_at_ms INTEGER,
      last_success_at_ms INTEGER,
      data_start_ms INTEGER,
      data_through_ms INTEGER,
      record_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_message TEXT,
      changes_token TEXT,
      changes_token_source_package TEXT
    );

    CREATE TABLE IF NOT EXISTS food_catalog_cache (
      id TEXT NOT NULL PRIMARY KEY,
      provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
      ),
      external_id TEXT NOT NULL,
      barcode TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      image_url TEXT,
      basis_amount REAL NOT NULL CHECK (basis_amount > 0),
      basis_unit TEXT NOT NULL CHECK (basis_unit IN ('g', 'ml')),
      default_serving_amount REAL,
      default_serving_unit TEXT,
      last_portion_amount REAL,
      last_portion_unit TEXT,
      carbohydrate_grams REAL,
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      nutrition_quality_json TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_url TEXT,
      raw_payload_json TEXT,
      cached_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER,
      is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
      use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
      last_used_at_ms INTEGER,
      UNIQUE(provider, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_food_catalog_barcode
      ON food_catalog_cache(barcode);
    CREATE INDEX IF NOT EXISTS idx_food_catalog_recent
      ON food_catalog_cache(last_used_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_food_catalog_favorites
      ON food_catalog_cache(is_favorite, name);

    CREATE TABLE IF NOT EXISTS food_logs (
      id TEXT NOT NULL PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE REFERENCES context_events(id)
        ON DELETE CASCADE,
      timestamp_ms INTEGER NOT NULL,
      meal_type TEXT NOT NULL CHECK (
        meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')
      ),
      title TEXT NOT NULL,
      carbohydrate_grams REAL NOT NULL CHECK (carbohydrate_grams >= 0),
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_food_logs_time
      ON food_logs(timestamp_ms);

    CREATE TABLE IF NOT EXISTS food_log_items (
      id TEXT NOT NULL PRIMARY KEY,
      food_log_id TEXT NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
      ),
      external_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      brand_snapshot TEXT,
      barcode_snapshot TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      unit TEXT NOT NULL CHECK (unit IN ('g', 'ml')),
      carbohydrate_grams REAL,
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      source_label TEXT NOT NULL,
      source_url TEXT,
      UNIQUE(food_log_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_food_log_items_log
      ON food_log_items(food_log_id, ordinal);

    CREATE TABLE IF NOT EXISTS food_recipes (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      meal_type TEXT NOT NULL CHECK (
        meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')
      ),
      servings REAL NOT NULL CHECK (servings > 0 AND servings <= 100),
      carbohydrate_grams REAL NOT NULL CHECK (carbohydrate_grams >= 0),
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_food_recipes_recent
      ON food_recipes(is_favorite DESC, updated_at_ms DESC);

    CREATE TABLE IF NOT EXISTS food_recipe_items (
      id TEXT NOT NULL PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK (
          provider IN ('cofid', 'mext-jp', 'cnf', 'ciqual', 'bls', 'fineli', 'open-food-facts', 'usda-fdc', 'user')
      ),
      external_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      brand_snapshot TEXT,
      barcode_snapshot TEXT,
      amount REAL NOT NULL CHECK (amount > 0),
      unit TEXT NOT NULL CHECK (unit IN ('g', 'ml')),
      carbohydrate_grams REAL,
      energy_kcal REAL,
      protein_grams REAL,
      fat_grams REAL,
      fibre_grams REAL,
      sugars_grams REAL,
      saturated_fat_grams REAL,
      source_label TEXT NOT NULL,
      source_url TEXT,
      UNIQUE(recipe_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_food_recipe_items_recipe
      ON food_recipe_items(recipe_id, ordinal);

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      imported_at_ms INTEGER NOT NULL,
      data_start_ms INTEGER,
      data_through_ms INTEGER,
      basal_count INTEGER NOT NULL,
      bolus_count INTEGER NOT NULL,
      context_count INTEGER NOT NULL,
      daily_total_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      warnings_json TEXT NOT NULL,
      UNIQUE(source_id, file_sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_import_batches_source_time
      ON import_batches(source_id, imported_at_ms);

    CREATE TABLE IF NOT EXISTS import_source_payloads (
      import_batch_id TEXT NOT NULL PRIMARY KEY
        REFERENCES import_batches(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('zip', 'csv')),
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      manifest_json TEXT NOT NULL,
      payload_bytes BLOB NOT NULL,
      stored_at_ms INTEGER NOT NULL,
      UNIQUE(source_id, file_sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_import_source_payloads_source_time
      ON import_source_payloads(source_id, stored_at_ms);

    CREATE TABLE IF NOT EXISTS import_raw_records (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      record_kind TEXT NOT NULL,
      timestamp_ms INTEGER,
      source_file TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      first_import_batch_id TEXT NOT NULL,
      first_seen_at_ms INTEGER NOT NULL,
      last_import_batch_id TEXT NOT NULL,
      last_seen_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_import_raw_records_source_time
      ON import_raw_records(source_id, timestamp_ms);
    CREATE INDEX IF NOT EXISTS idx_import_raw_records_source_kind
      ON import_raw_records(source_id, record_kind, timestamp_ms);

    CREATE TABLE IF NOT EXISTS glooko_report_payloads (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      payload_bytes BLOB NOT NULL,
      extracted_text TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      report_start_ms INTEGER,
      report_end_ms INTEGER,
      imported_at_ms INTEGER NOT NULL,
      UNIQUE(source_id, file_sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_glooko_report_payloads_time
      ON glooko_report_payloads(source_id, imported_at_ms DESC);

    CREATE TABLE IF NOT EXISTS notification_source_events (
      id TEXT NOT NULL PRIMARY KEY,
      package_name TEXT NOT NULL,
      posted_at_ms INTEGER NOT NULL,
      notification_when_ms INTEGER,
      received_at_ms INTEGER NOT NULL,
      is_ongoing INTEGER NOT NULL CHECK (is_ongoing IN (0, 1)),
      payload_json TEXT NOT NULL,
      parser_version INTEGER NOT NULL,
      parsed_glucose_id TEXT,
      parsed_iob_units REAL,
      parsed_pump_mode TEXT,
      reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
        reconciliation_scope IN ('local', 'restored', 'unknown')
      ),
      imported_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_source_package_time
      ON notification_source_events(package_name, posted_at_ms);
    CREATE INDEX IF NOT EXISTS idx_notification_source_imported
      ON notification_source_events(imported_at_ms);
    CREATE INDEX IF NOT EXISTS idx_notification_source_received
      ON notification_source_events(received_at_ms, id);

    CREATE TABLE IF NOT EXISTS insight_reports (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('rolling-week')),
      period_start_ms INTEGER NOT NULL,
      period_end_ms INTEGER NOT NULL,
      comparison_start_ms INTEGER NOT NULL,
      comparison_end_ms INTEGER NOT NULL,
      generated_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      input_fingerprint TEXT NOT NULL,
      ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
      headline TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_record_count INTEGER NOT NULL CHECK (
        evidence_record_count >= 0
      ),
      report_json TEXT NOT NULL,
      viewed_at_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_insight_reports_period
      ON insight_reports(period_end_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_insight_reports_unread
      ON insight_reports(viewed_at_ms, period_end_ms DESC);

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT NOT NULL PRIMARY KEY,
      connector TEXT NOT NULL CHECK (
        connector IN ('glucose', 'glooko', 'health-connect', 'insight-review')
      ),
      trigger TEXT NOT NULL CHECK (trigger IN ('background')),
      started_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER,
      outcome TEXT NOT NULL CHECK (
        outcome IN (
          'running', 'success', 'partial', 'skipped',
          'needs-attention', 'failed'
        )
      ),
      records_processed INTEGER NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
      records_removed INTEGER NOT NULL DEFAULT 0 CHECK (records_removed >= 0),
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_automation_runs_time
      ON automation_runs(started_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_connector_time
      ON automation_runs(connector, started_at_ms DESC);

  `);

  // CREATE TABLE IF NOT EXISTS does not add fields to an installed database.
  // Keep this additive so existing encrypted glucose history remains intact.
  await ensureHealthConnectExtendedKinds(database);
  await ensureColumn(
    database,
    'glucose_readings',
    'imported_at_ms',
    'INTEGER',
  );
  await ensureColumn(database, 'glucose_readings', 'source_file', 'TEXT');
  await ensureColumn(database, 'glucose_readings', 'source_row', 'INTEGER');
  await ensureColumn(database, 'glucose_readings', 'source_device_id', 'TEXT');
  await ensureGlucoseReadingDeviceIdentity(database);
  await ensureColumn(
    database,
    'food_catalog_cache',
    'default_serving_amount',
    'REAL',
  );
  await ensureColumn(
    database,
    'food_catalog_cache',
    'default_serving_unit',
    'TEXT',
  );
  await ensureColumn(
    database,
    'food_catalog_cache',
    'last_portion_amount',
    'REAL',
  );
  await ensureColumn(
    database,
    'food_catalog_cache',
    'last_portion_unit',
    'TEXT',
  );
  await ensureRegionalFoodProviderKinds(database);
  await ensureColumn(
    database,
    'import_batches',
    'daily_total_count',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(database, 'insulin_basal', 'delivery_type', 'TEXT');
  await ensureColumn(database, 'insulin_basal', 'percentage', 'REAL');
  await ensureColumn(
    database,
    'insulin_basal',
    'units_estimated',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(database, 'insulin_basal', 'source_device_id', 'TEXT');
  await ensureColumn(database, 'insulin_bolus', 'delivery_type', 'TEXT');
  await ensureColumn(
    database,
    'insulin_bolus',
    'blood_glucose_input_mmol_l',
    'REAL',
  );
  await ensureColumn(database, 'insulin_bolus', 'carbs_input_grams', 'REAL');
  await ensureColumn(
    database,
    'insulin_bolus',
    'carb_ratio_grams_per_unit',
    'REAL',
  );
  await ensureColumn(database, 'insulin_bolus', 'initial_units', 'REAL');
  await ensureColumn(database, 'insulin_bolus', 'extended_units', 'REAL');
  await ensureColumn(database, 'insulin_bolus', 'source_device_id', 'TEXT');
  await ensureColumn(
    database,
    'insulin_daily_totals',
    'source_device_id',
    'TEXT',
  );
  await ensureColumn(database, 'context_events', 'energy_kcal', 'REAL');
  await ensureColumn(database, 'context_events', 'protein_grams', 'REAL');
  await ensureColumn(database, 'context_events', 'fat_grams', 'REAL');
  await ensureColumn(database, 'context_events', 'fibre_grams', 'REAL');
  await ensureColumn(database, 'context_events', 'sugars_grams', 'REAL');
  const hadHealthConnectReconciliationScope = await hasColumn(
    database,
    'health_connect_records',
    'reconciliation_scope',
  );
  await ensureColumn(
    database,
    'context_events',
    'saturated_fat_grams',
    'REAL',
  );
  await ensureColumn(database, 'context_events', 'serving_quantity', 'REAL');
  await ensureColumn(database, 'context_events', 'serving_count', 'REAL');
  await ensureColumn(database, 'context_events', 'calories_burned', 'REAL');
  await ensureColumn(database, 'context_events', 'medication_type', 'TEXT');
  await ensureColumn(database, 'context_notes', 'glucose_mmol_l', 'REAL');
  await ensureColumn(database, 'context_notes', 'sensor_started', 'INTEGER CHECK (sensor_started IN (0, 1))');
  await ensureColumn(database, 'context_notes', 'sensor_glucose_source_id', 'TEXT');
  await backfillLegacyGlookoMeterContextNotes(database);
  await ensureColumn(
    database,
    'food_logs',
    'is_favorite',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(
    database,
    'health_connect_sync_state',
    'changes_token',
    'TEXT',
  );
  await ensureColumn(
    database,
    'health_connect_records',
    'reconciliation_scope',
    `TEXT NOT NULL DEFAULT 'current' CHECK (
      reconciliation_scope IN ('current', 'restored')
    )`,
  );
  if (!hadHealthConnectReconciliationScope) {
    // Before this provenance field existed we cannot prove whether a row was
    // read from this phone or restored from another one. Preserve it as
    // archival until the current Health Connect store returns a stable match.
    await database.runAsync(
      `UPDATE health_connect_records
          SET reconciliation_scope = 'restored'`,
    );
  }
  await ensureNotificationEvidenceProvenance(database);
  await ensureColumn(
    database,
    'health_connect_sync_state',
    'changes_token_source_package',
    'TEXT',
  );
  await ensureColumn(
    database,
    'health_connect_preferences',
    'preferred_source_mode',
    `TEXT CHECK (preferred_source_mode IN ('automatic', 'manual'))`,
  );
  await database.execAsync(
    `PRAGMA user_version = ${Math.max(
      openedSchemaVersion,
      CURRENT_T1ARC_SCHEMA_VERSION,
    )};`,
  );

  // A process death after the logical erase COMMIT but before its verified WAL
  // truncate leaves this durable marker behind. Check it on the already-keyed
  // startup connection, then resume through a fresh keyed connection without
  // recursively awaiting the database promise that is still being created.
  try {
    await resumePendingEraseSanitizationAtStartup(database, () =>
      completePendingEraseSanitizationWithKey(key),
    );
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }

  return database;
}

export function openT1ArcDatabase() {
  databasePromise ??= openAndMigrate().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

/**
 * Expo's exclusive transaction helper opens a second SQLite connection.
 * SQLCipher keys are connection-specific, so T1 Arc must key that connection
 * before beginning the transaction.
 */
async function runT1ArcTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  const key = await getOrCreateDatabaseKey();
  return retrySqliteBusy(async (remainingBudgetMs) => {
    const transaction = await SQLite.openDatabaseAsync(DATABASE_NAME, {
      useNewConnection: true,
    });
    let began = false;
    try {
      const attemptBusyTimeoutMs = Math.max(
        1,
        Math.min(2_000, Math.floor(remainingBudgetMs)),
      );
      await transaction.execAsync(`
        PRAGMA key = '${key}';
        PRAGMA busy_timeout = ${attemptBusyTimeoutMs};
        PRAGMA foreign_keys = ON;
        BEGIN IMMEDIATE;
      `);
      began = true;
      const result = await task(transaction);
      await transaction.execAsync('COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (began) {
        await transaction.execAsync('ROLLBACK').catch(() => undefined);
        began = false;
      }
      throw error;
    } finally {
      await transaction.closeAsync().catch(() => undefined);
    }
  }, { maxWaitMs: DATABASE_BUSY_TIMEOUT_MS });
}

/**
 * Runs potentially large, idempotent repair work outside the latency-critical
 * database-open path. In particular, the boot glucose service must be able to
 * read the latest row without scanning food, Hevy, or retained Glooko data.
 *
 * This is deliberately not called by the boot/headless glucose pipeline. A
 * foreground maintenance owner can invoke it from an explicit idle workflow.
 */
export async function runT1ArcStartupMaintenance(options?: {
  signal?: AbortSignal;
}) {
  const throwIfAborted = () => {
    if (!options?.signal?.aborted) return;
    const error = new Error('Startup maintenance was deferred.');
    error.name = 'AbortError';
    throw error;
  };

  // Complete the latency-sensitive schema open first. These repairs are
  // deliberately idempotent, so run them as short autocommit statements rather
  // than holding the single writer transaction across every scan and payload
  // cleanup. A verified glucose snapshot must never queue behind minutes of
  // unrelated maintenance; if this job is interrupted, its absent marker makes
  // the next foreground activation safely resume the remaining work.
  const database = await openT1ArcDatabase();
  throwIfAborted();
  const openedVersionRow = await database.getFirstAsync<{
    user_version: number;
  }>('PRAGMA user_version');
  const openedSchemaVersion = openedVersionRow?.user_version ?? 0;
  const startupMaintenanceRow = await database.getFirstAsync<{
    value: string;
  }>(
    `SELECT value
       FROM app_metadata
      WHERE key = ?`,
    STARTUP_MAINTENANCE_METADATA_KEY,
  );
  const completedMaintenanceVersion = startupMaintenanceRow
    ? Number(startupMaintenanceRow.value)
    : undefined;
  const ranStartupMaintenance = await runVersionedStartupMaintenance(
    openedSchemaVersion,
    completedMaintenanceVersion,
    async () => {
      throwIfAborted();
      await backfillNativeFoodLogContextNutrition(database);
      throwIfAborted();
      await repairHevyWorkoutContextOwnership(database);
      throwIfAborted();
      await pruneRetainedGlookoSources(database);
      throwIfAborted();
    },
  );
  throwIfAborted();
  if (ranStartupMaintenance) {
    await database.runAsync(
      `INSERT INTO app_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      STARTUP_MAINTENANCE_METADATA_KEY,
      String(CURRENT_T1ARC_SCHEMA_VERSION),
    );
  }
  return ranStartupMaintenance;
}

/**
 * Serialises foreground writes within a JS runtime. Headless Android workers
 * use a separate runtime, so SQLite's 30-second busy timeout and bounded
 * whole-transaction backoff provide the second layer of coordination across
 * both runtimes. Every retried transaction is rolled back and its keyed
 * connection is closed first.
 */
export function withT1ArcTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  return transactionScheduler.schedule('normal', () =>
    runT1ArcTransaction(task),
  );
}

/**
 * Gives latency-critical glucose commits priority after the currently active
 * transaction. Chunked health imports release the writer between batches, so
 * a pending glucose commit runs before another normal batch. BEGIN IMMEDIATE
 * and the bounded SQLite busy policy preserve cross-runtime write safety.
 */
export function withT1ArcCriticalTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  return transactionScheduler.schedule('critical', () =>
    runT1ArcTransaction(task),
  );
}

/**
 * Keeps logical deletion, WAL truncation, and marker clearing inside one
 * writer-scheduler job in this JS runtime. The verified checkpoint moves the
 * secure-delete page images into the main database and removes all
 * SQLite-visible WAL frames. It does not claim physical-media overwriting;
 * separate source ownership fences remain responsible for stale logical writes
 * from a different runtime.
 */
export async function withT1ArcSanitizedEraseTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  await openT1ArcDatabase();
  const key = await getOrCreateDatabaseKey();
  return transactionScheduler.schedule('normal', async () => {
    const result = await retrySqliteBusy(async (remainingBudgetMs) => {
      const transaction = await openKeyedPrivateConnection(
        key,
        remainingBudgetMs,
      );
      try {
        return await runSecureEraseTransaction(transaction, task);
      } finally {
        await transaction.closeAsync().catch(() => undefined);
      }
    }, { maxWaitMs: DATABASE_BUSY_TIMEOUT_MS });

    // This is deliberately outside the transaction and on a new keyed
    // connection. If it cannot complete, the committed marker remains and the
    // next database startup retries before making the database available.
    await completePendingEraseSanitizationWithKey(key);
    return result;
  });
}

/**
 * Runs a long read against a consistent WAL snapshot on its own keyed
 * connection. Backup generation uses this so a foreground Libre refresh cannot
 * produce a file whose tables were read at different moments.
 */
export async function withT1ArcReadSnapshot<T>(
  task: (snapshot: SQLite.SQLiteDatabase) => Promise<T>,
) {
  const key = await getOrCreateDatabaseKey();
  const snapshot = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
  });
  let began = false;
  try {
    await snapshot.execAsync(`
      PRAGMA key = '${key}';
      PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS};
      PRAGMA foreign_keys = ON;
      BEGIN;
    `);
    began = true;
    const result = await task(snapshot);
    await snapshot.execAsync('COMMIT');
    began = false;
    return result;
  } catch (error) {
    if (began) {
      await snapshot.execAsync('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    await snapshot.closeAsync();
  }
}
