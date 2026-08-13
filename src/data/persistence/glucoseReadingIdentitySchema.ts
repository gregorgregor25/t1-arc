/** Minimal database surface used by the additive glucose identity migration. */
export interface GlucoseIdentityMigrationDatabase {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
}

export const GLUCOSE_READINGS_CREATE_SQL = `
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
    source_device_id TEXT NOT NULL DEFAULT '',
    UNIQUE (source_id, timestamp_ms, source_device_id)
  );
`;

const GLUCOSE_READINGS_REBUILD_SQL = `
  DROP INDEX IF EXISTS idx_glucose_timestamp;
  DROP INDEX IF EXISTS idx_glucose_source_timestamp;

  ALTER TABLE glucose_readings
    RENAME TO glucose_readings_before_device_identity;

  CREATE TABLE glucose_readings (
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
    source_device_id TEXT NOT NULL DEFAULT '',
    UNIQUE (source_id, timestamp_ms, source_device_id)
  );

  INSERT INTO glucose_readings (
    id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality,
    source_factory_timestamp, source_local_timestamp,
    timestamp_discrepancy_minutes, imported_at_ms, source_file, source_row,
    source_device_id
  )
  SELECT
    id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality,
    source_factory_timestamp, source_local_timestamp,
    timestamp_discrepancy_minutes, imported_at_ms, source_file, source_row,
    COALESCE(source_device_id, '')
  FROM glucose_readings_before_device_identity;
`;

export function hasDeviceAwareGlucoseIdentity(tableSql: string | null) {
  if (!tableSql) return false;
  const normalized = tableSql.toLowerCase().replace(/\s+/g, ' ');
  return (
    /source_device_id text not null default ['"]{2}/.test(normalized) &&
    /unique\s*\(\s*source_id\s*,\s*timestamp_ms\s*,\s*source_device_id\s*\)/.test(
      normalized,
    )
  );
}

/**
 * Rebuilds the one legacy table whose UNIQUE constraint cannot be altered in
 * place. The transaction is only committed after every row is accounted for;
 * an unexpected duplicate identity rolls back to the untouched old table.
 */
export async function ensureGlucoseReadingDeviceIdentity(
  database: GlucoseIdentityMigrationDatabase,
) {
  const table = await database.getFirstAsync<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = 'glucose_readings'`,
  );
  if (hasDeviceAwareGlucoseIdentity(table?.sql ?? null)) return;

  const before = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM glucose_readings',
  );
  await database.execAsync('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await database.execAsync(GLUCOSE_READINGS_REBUILD_SQL);
    const after = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM glucose_readings',
    );
    if ((after?.count ?? -1) !== (before?.count ?? 0)) {
      throw new Error(
        'Glucose device-identity migration did not preserve every reading.',
      );
    }
    await database.execAsync(`
      DROP TABLE glucose_readings_before_device_identity;
      CREATE INDEX idx_glucose_timestamp
        ON glucose_readings(timestamp_ms);
      CREATE INDEX idx_glucose_source_timestamp
        ON glucose_readings(source_id, timestamp_ms);
    `);
    await database.execAsync('COMMIT;');
  } catch (error) {
    await database.execAsync('ROLLBACK;').catch(() => undefined);
    throw error;
  }
}

export function glucoseReadingIdentityKey(
  sourceId: string,
  timestamp: number,
  sourceDeviceId?: string,
) {
  return `${sourceId}\u0000${timestamp}\u0000${sourceDeviceId ?? ''}`;
}
