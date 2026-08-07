import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'daymark-health-v2.db';
const LEGACY_DATABASE_NAME = 'daymark-health.db';
const DATABASE_KEY = 'daymark.database.key.v1';
const LEGACY_MIGRATION_KEY = 'legacy-health-database-v1';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
let transactionQueue: Promise<void> = Promise.resolve();

const DATABASE_BUSY_TIMEOUT_MS = 30_000;
const TRANSACTION_BEGIN_RETRY_DELAYS_MS = [150, 400, 900];

interface LegacyGlucoseRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  received_at_ms: number;
  mmol_l: number;
  trend: string;
  quality: string;
  source_factory_timestamp: string | null;
  source_local_timestamp: string | null;
  timestamp_discrepancy_minutes: number | null;
}

interface LegacySyncRow {
  source_id: string;
  last_attempt_at_ms: number | null;
  last_success_at_ms: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  record_count: number;
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

async function hasTable(database: SQLite.SQLiteDatabase, tableName: string) {
  const row = await database.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = ?`,
    tableName,
  );
  return Boolean(row);
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

async function readLegacyRows(database: SQLite.SQLiteDatabase) {
  if (!(await hasTable(database, 'glucose_readings'))) {
    return {
      glucose: [] as LegacyGlucoseRow[],
      sync: [] as LegacySyncRow[],
    };
  }

  const glucose = await database.getAllAsync<LegacyGlucoseRow>(`
    SELECT id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality,
      source_factory_timestamp, source_local_timestamp,
      timestamp_discrepancy_minutes
    FROM glucose_readings
  `);
  const sync = (await hasTable(database, 'source_sync_state'))
    ? await database.getAllAsync<LegacySyncRow>(`
        SELECT source_id, last_attempt_at_ms, last_success_at_ms,
          last_error_code, last_error_message, record_count
        FROM source_sync_state
      `)
    : [];
  return { glucose, sync };
}

async function openLegacyRows(key: string) {
  let encryptedDatabase: SQLite.SQLiteDatabase | undefined;
  try {
    encryptedDatabase = await SQLite.openDatabaseAsync(
      LEGACY_DATABASE_NAME,
      { useNewConnection: true },
    );
    await encryptedDatabase.execAsync(`PRAGMA key = '${key}';`);
    const rows = await readLegacyRows(encryptedDatabase);
    return { ...rows, format: 'encrypted' as const };
  } catch {
    // A pre-encryption Daymark build may have created a normal SQLite file.
  } finally {
    await encryptedDatabase?.closeAsync().catch(() => undefined);
  }

  let plaintextDatabase: SQLite.SQLiteDatabase | undefined;
  try {
    plaintextDatabase = await SQLite.openDatabaseAsync(
      LEGACY_DATABASE_NAME,
      { useNewConnection: true },
    );
    const rows = await readLegacyRows(plaintextDatabase);
    return { ...rows, format: 'plaintext' as const };
  } finally {
    await plaintextDatabase?.closeAsync().catch(() => undefined);
  }
}

async function migrateLegacyDatabase(
  database: SQLite.SQLiteDatabase,
  key: string,
) {
  const completed = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    LEGACY_MIGRATION_KEY,
  );
  if (completed) return;

  try {
    const legacy = await openLegacyRows(key);
    await database.withTransactionAsync(async () => {
      const transaction = database;
      for (const row of legacy.glucose) {
        await transaction.runAsync(
          `INSERT OR IGNORE INTO glucose_readings (
             id, source_id, timestamp_ms, received_at_ms, mmol_l, trend,
             quality, source_factory_timestamp, source_local_timestamp,
             timestamp_discrepancy_minutes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.source_id,
          row.timestamp_ms,
          row.received_at_ms,
          row.mmol_l,
          row.trend,
          row.quality,
          row.source_factory_timestamp,
          row.source_local_timestamp,
          row.timestamp_discrepancy_minutes,
        );
      }

      for (const row of legacy.sync) {
        await transaction.runAsync(
          `INSERT INTO source_sync_state (
             source_id, last_attempt_at_ms, last_success_at_ms,
             last_error_code, last_error_message, record_count
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             last_attempt_at_ms = COALESCE(
               MAX(source_sync_state.last_attempt_at_ms,
                   excluded.last_attempt_at_ms),
               source_sync_state.last_attempt_at_ms,
               excluded.last_attempt_at_ms
             ),
             last_success_at_ms = COALESCE(
               MAX(source_sync_state.last_success_at_ms,
                   excluded.last_success_at_ms),
               source_sync_state.last_success_at_ms,
               excluded.last_success_at_ms
             ),
             last_error_code = excluded.last_error_code,
             last_error_message = excluded.last_error_message,
             record_count = MAX(
               source_sync_state.record_count, excluded.record_count
             )`,
          row.source_id,
          row.last_attempt_at_ms,
          row.last_success_at_ms,
          row.last_error_code,
          row.last_error_message,
          row.record_count,
        );
      }

      await transaction.runAsync(
        'INSERT INTO app_metadata (key, value) VALUES (?, ?)',
        LEGACY_MIGRATION_KEY,
        `${legacy.format}:${legacy.glucose.length}`,
      );
    });
  } catch {
    // The legacy file can be unreadable if Android retained a database but not
    // its old keystore key. Preserve it untouched and continue with the new
    // encrypted store; LibreLinkUp can refill glucose history.
    await database.runAsync(
      'INSERT INTO app_metadata (key, value) VALUES (?, ?)',
      LEGACY_MIGRATION_KEY,
      'unreadable',
    );
  }
}

async function openAndMigrate() {
  const key = await getOrCreateDatabaseKey();
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  // The key is generated locally as hex and never logged or exported.
  await database.execAsync(`PRAGMA key = '${key}';`);
  const cipher = await database.getFirstAsync<{ cipher_version: string }>(
    'PRAGMA cipher_version',
  );
  if (!cipher?.cipher_version) {
    await database.closeAsync();
    throw new Error('Encrypted health database is unavailable.');
  }

  await database.execAsync(`
    PRAGMA cipher_memory_security = ON;
    PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS glucose_readings (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      received_at_ms INTEGER NOT NULL,
      mmol_l REAL NOT NULL CHECK (mmol_l > 0),
      trend TEXT NOT NULL,
      quality TEXT NOT NULL,
      source_factory_timestamp TEXT,
      source_local_timestamp TEXT,
      timestamp_discrepancy_minutes REAL,
      imported_at_ms INTEGER,
      source_file TEXT,
      source_row INTEGER,
      source_device_id TEXT,
      UNIQUE (source_id, timestamp_ms)
    );

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
        provider IN ('cofid', 'open-food-facts', 'user')
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
        provider IN ('cofid', 'open-food-facts', 'user')
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
        provider IN ('cofid', 'open-food-facts', 'user')
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
      imported_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_source_package_time
      ON notification_source_events(package_name, posted_at_ms);
    CREATE INDEX IF NOT EXISTS idx_notification_source_imported
      ON notification_source_events(imported_at_ms);

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

    PRAGMA user_version = 25;
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
  await ensureColumn(database, 'context_events', 'serving_quantity', 'REAL');
  await ensureColumn(database, 'context_events', 'serving_count', 'REAL');
  await ensureColumn(database, 'context_events', 'calories_burned', 'REAL');
  await ensureColumn(database, 'context_events', 'medication_type', 'TEXT');
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
  await database.execAsync('PRAGMA user_version = 25;');

  await migrateLegacyDatabase(database, key);

  return database;
}

export function openDaymarkDatabase() {
  databasePromise ??= openAndMigrate().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

/**
 * Expo's exclusive transaction helper opens a second SQLite connection.
 * SQLCipher keys are connection-specific, so Daymark must key that connection
 * before beginning the transaction.
 */
async function runDaymarkTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  const key = await getOrCreateDatabaseKey();
  for (
    let attempt = 0;
    attempt <= TRANSACTION_BEGIN_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const transaction = await SQLite.openDatabaseAsync(DATABASE_NAME, {
      useNewConnection: true,
    });
    let began = false;
    try {
      await transaction.execAsync(`
        PRAGMA key = '${key}';
        PRAGMA cipher_memory_security = ON;
        PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS};
        PRAGMA journal_mode = WAL;
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
      const message =
        error instanceof Error ? error.message.toLowerCase() : '';
      const canRetryTransaction =
        (
          message.includes('database is locked') ||
          message.includes('database table is locked') ||
          message.includes('sqlite_busy') ||
          message.includes('sqlite_locked')
        ) &&
        attempt < TRANSACTION_BEGIN_RETRY_DELAYS_MS.length;
      if (!canRetryTransaction) throw error;
      await new Promise((resolve) => {
        setTimeout(
          resolve,
          TRANSACTION_BEGIN_RETRY_DELAYS_MS[attempt],
        );
      });
    } finally {
      await transaction.closeAsync().catch(() => undefined);
    }
  }
  throw new Error('The encrypted health database remained busy.');
}

/**
 * Serialises foreground writes within a JS runtime. Headless Android workers
 * use a separate runtime, so SQLite's 30-second busy timeout and whole-
 * transaction retries provide the second layer of coordination across both
 * runtimes. Every retried transaction is rolled back first.
 */
export function withDaymarkTransaction<T>(
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  const run = transactionQueue.then(
    () => runDaymarkTransaction(task),
    () => runDaymarkTransaction(task),
  );
  transactionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Runs a long read against a consistent WAL snapshot on its own keyed
 * connection. Backup generation uses this so a foreground Libre refresh cannot
 * produce a file whose tables were read at different moments.
 */
export async function withDaymarkReadSnapshot<T>(
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
      PRAGMA cipher_memory_security = ON;
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
