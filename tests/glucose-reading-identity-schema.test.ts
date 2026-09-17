import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import {
  ensureGlucoseReadingDeviceIdentity,
  hasDeviceAwareGlucoseIdentity,
  type GlucoseIdentityMigrationDatabase,
} from '@/data/persistence/glucoseReadingIdentitySchema';

function adapter(database: DatabaseSync): GlucoseIdentityMigrationDatabase {
  return {
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return (
        database.prepare(sql).get(...(params as SQLInputValue[])) as
          | T
          | undefined
      ) ?? null;
    },
    async execAsync(sql: string) {
      database.exec(sql);
    },
  };
}

function createLegacyTable(database: DatabaseSync, unique = true) {
  database.exec(`
    CREATE TABLE glucose_readings (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      received_at_ms INTEGER NOT NULL,
      mmol_l REAL NOT NULL,
      trend TEXT NOT NULL,
      quality TEXT NOT NULL,
      source_factory_timestamp TEXT,
      source_local_timestamp TEXT,
      timestamp_discrepancy_minutes REAL,
      imported_at_ms INTEGER,
      source_file TEXT,
      source_row INTEGER,
      source_device_id TEXT
      ${unique ? ', UNIQUE (source_id, timestamp_ms)' : ''}
    );
    CREATE INDEX idx_glucose_timestamp ON glucose_readings(timestamp_ms);
    CREATE INDEX idx_glucose_source_timestamp
      ON glucose_readings(source_id, timestamp_ms);
  `);
}

function insertReading(
  database: DatabaseSync,
  id: string,
  device: string | null,
  mmolL = 6.2,
) {
  database
    .prepare(
      `INSERT INTO glucose_readings (
         id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality,
         source_device_id
       ) VALUES (?, 'glooko-cgm', 1000, 1100, ?, 'flat', 'measured', ?)`,
    )
    .run(id, mmolL, device);
}

describe('glucose source-device identity schema', () => {
  it('preserves legacy rows and permits same-time readings per device', async () => {
    const database = new DatabaseSync(':memory:');
    createLegacyTable(database);
    insertReading(database, 'legacy-reading', null);

    await ensureGlucoseReadingDeviceIdentity(adapter(database));

    const table = database
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'glucose_readings'`,
      )
      .get() as { sql: string };
    expect(hasDeviceAwareGlucoseIdentity(table.sql)).toBe(true);
    expect(
      database
        .prepare('SELECT source_device_id FROM glucose_readings')
        .get(),
    ).toEqual({ source_device_id: '' });

    insertReading(database, 'sensor-a', 'SENSOR-A');
    insertReading(database, 'sensor-b', 'SENSOR-B', 6.4);
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM glucose_readings')
        .get(),
    ).toEqual({ count: 3 });

    // The schema detector makes subsequent opens a no-op.
    await ensureGlucoseReadingDeviceIdentity(adapter(database));
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM glucose_readings')
        .get(),
    ).toEqual({ count: 3 });
    database.close();
  });

  it('rolls back instead of dropping unexpected duplicate identities', async () => {
    const database = new DatabaseSync(':memory:');
    createLegacyTable(database, false);
    insertReading(database, 'first', null);
    insertReading(database, 'second', null, 6.3);

    await expect(
      ensureGlucoseReadingDeviceIdentity(adapter(database)),
    ).rejects.toThrow();

    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM glucose_readings')
        .get(),
    ).toEqual({ count: 2 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name = 'glucose_readings_before_device_identity'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });
});
