import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  buildHealthConnectExternalIdFilter,
  buildHealthConnectReconciliationFilter,
  healthConnectParentRecordIds,
  HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY,
  reconcileHealthConnectWindowInTransaction,
  resolveAndPromoteHealthConnectRecordId,
} from '@/data/healthConnect/healthConnectReconciliation';

describe('Health Connect reconciliation', () => {
  it('covers every supported category, including nutrition', () => {
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.nutrition).toEqual([
      'nutrition',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.vitals).toContain(
      'blood_pressure_diastolic',
    );
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.blood_glucose).toEqual([
      'blood_glucose',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.distance).toEqual([
      'distance',
      'elevation_gained',
      'floors_climbed',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.workouts).toEqual([
      'workout',
      'workout_power',
      'workout_speed',
      'walking_cadence',
      'cycling_cadence',
    ]);
    expect(
      HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.body_composition,
    ).toContain('basal_metabolic_rate');
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.cycle).toEqual([
      'menstruation_period',
      'menstruation_flow',
      'ovulation_test',
      'basal_body_temperature',
      'cervical_mucus',
      'intermenstrual_bleeding',
    ]);
    expect(Object.keys(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY)).toHaveLength(
      13,
    );
  });

  it('limits deletion reconciliation to the completed time window', () => {
    const filter = buildHealthConnectReconciliationFilter(
      'heart_rate',
      1_000,
      9_000,
      12_000,
    );

    expect(filter.whereSql).toContain('kind IN (?, ?)');
    expect(filter.whereSql).toContain('start_ms < ?');
    expect(filter.whereSql).toContain('end_ms >= ?');
    expect(filter.whereSql).toContain('imported_at_ms <> ?');
    expect(filter.whereSql).toContain("reconciliation_scope = 'current'");
    expect(filter.whereSql).not.toContain('source_package = ?');
    expect(filter.parameters).toEqual([
      'heart_rate',
      'resting_heart_rate',
      9_000,
      1_000,
      12_000,
    ]);
  });

  it('preserves restored phone-swap history during an empty current-device scan', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE health_connect_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_package TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        imported_at_ms INTEGER NOT NULL,
        reconciliation_scope TEXT NOT NULL
      );
      CREATE TABLE context_events (id TEXT PRIMARY KEY);
      CREATE TABLE context_notes (id TEXT PRIMARY KEY);
      INSERT INTO health_connect_records VALUES
        ('restored', 'nutrition', 'old.phone.app', 2000, 3000, 4000, 'restored'),
        ('current', 'nutrition', 'current.phone.app', 2000, 3000, 4000, 'current');
      INSERT INTO context_events VALUES ('restored'), ('current');
    `);
    const adapter = {
      runAsync: async (
        sql: string,
        ...parameters: (string | number | null)[]
      ) => {
        const result = database.prepare(sql).run(...parameters);
        return { changes: Number(result.changes) };
      },
    };

    try {
      const result = await reconcileHealthConnectWindowInTransaction(
        adapter,
        'nutrition',
        1_000,
        5_000,
        9_000,
      );

      expect(result).toEqual({ recordsRemoved: 1, contextRemoved: 1 });
      expect(
        database
          .prepare('SELECT id, reconciliation_scope FROM health_connect_records')
          .all(),
      ).toEqual([{ id: 'restored', reconciliation_scope: 'restored' }]);
      expect(database.prepare('SELECT id FROM context_events').all()).toEqual([
        { id: 'restored' },
      ]);
    } finally {
      database.close();
    }
  });

  it('promotes one restored row when the new phone has a different store id but the same client id', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE health_connect_records (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        parent_external_id TEXT,
        kind TEXT NOT NULL,
        source_package TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        reconciliation_scope TEXT NOT NULL,
        UNIQUE(kind, source_package, external_id)
      );
      CREATE TABLE context_events (id TEXT PRIMARY KEY);
    `);
    database
      .prepare(
        `INSERT INTO health_connect_records VALUES
          (?, ?, NULL, 'nutrition', 'com.example.food', ?, ?, ?, 'restored')`,
      )
      .run(
        'restored-row-id',
        'old-store-id',
        2_000,
        3_000,
        JSON.stringify({ clientRecordId: 'provider-meal-42' }),
      );
    database
      .prepare('INSERT INTO context_events VALUES (?)')
      .run('restored-row-id');
    const adapter = {
      getAllAsync: async <T>(sql: string, ...parameters: any[]) =>
        database.prepare(sql).all(...parameters) as T[],
      runAsync: async (sql: string, ...parameters: any[]) => {
        const result = database.prepare(sql).run(...parameters);
        return { changes: Number(result.changes) };
      },
    };

    try {
      const id = await resolveAndPromoteHealthConnectRecordId(
        adapter,
        {
          externalId: 'new-store-id',
          kind: 'nutrition',
          sourcePackage: 'com.example.food',
          startTimeMs: 2_000,
          endTimeMs: 3_000,
          lastModifiedTimeMs: 4_000,
          recordingMethod: 2,
          clientRecordId: 'provider-meal-42',
          clientRecordVersion: 1,
        },
        'new-generated-id',
      );

      expect(id).toBe('restored-row-id');
      expect(
        database
          .prepare(
            'SELECT id, external_id, reconciliation_scope FROM health_connect_records',
          )
          .all(),
      ).toEqual([
        {
          id: 'restored-row-id',
          external_id: 'new-store-id',
          reconciliation_scope: 'current',
        },
      ]);
      expect(database.prepare('SELECT id FROM context_events').all()).toEqual([
        { id: 'restored-row-id' },
      ]);
    } finally {
      database.close();
    }
  });

  it('fails closed when a provider client id is ambiguous', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE health_connect_records (
        id TEXT PRIMARY KEY, external_id TEXT NOT NULL,
        parent_external_id TEXT, kind TEXT NOT NULL,
        source_package TEXT NOT NULL, start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL, payload_json TEXT NOT NULL,
        reconciliation_scope TEXT NOT NULL
      );
      INSERT INTO health_connect_records VALUES
        ('one', 'old-one', NULL, 'nutrition', 'com.example.food', 1, 2,
         '{"clientRecordId":"reused"}', 'restored'),
        ('two', 'old-two', NULL, 'nutrition', 'com.example.food', 3, 4,
         '{"clientRecordId":"reused"}', 'restored');
    `);
    const adapter = {
      getAllAsync: async <T>(sql: string, ...parameters: any[]) =>
        database.prepare(sql).all(...parameters) as T[],
      runAsync: async (sql: string, ...parameters: any[]) => {
        const result = database.prepare(sql).run(...parameters);
        return { changes: Number(result.changes) };
      },
    };

    try {
      await expect(
        resolveAndPromoteHealthConnectRecordId(
          adapter,
          {
            externalId: 'new-store-id',
            kind: 'nutrition',
            sourcePackage: 'com.example.food',
            startTimeMs: 1,
            endTimeMs: 2,
            lastModifiedTimeMs: 5,
            recordingMethod: 2,
            clientRecordId: 'reused',
            clientRecordVersion: 1,
          },
          'new-id',
        ),
      ).rejects.toThrow(/ambiguous provider record identity/i);
      expect(
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM health_connect_records WHERE reconciliation_scope = ?',
          )
          .get('restored'),
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }
  });

  it('never removes archived records from an unselected source', () => {
    const filter = buildHealthConnectReconciliationFilter(
      'steps',
      1_000,
      9_000,
      12_000,
      'com.sec.android.app.shealth',
    );

    expect(filter.whereSql).toContain('source_package = ?');
    expect(filter.parameters.at(-1)).toBe(
      'com.sec.android.app.shealth',
    );
  });

  it('reconciles sampled and compound changes by their parent record id', () => {
    expect(
      healthConnectParentRecordIds([
        {
          externalId: 'heart-parent:1000',
          parentExternalId: 'heart-parent',
          kind: 'heart_rate',
          sourcePackage: 'com.sec.android.app.shealth',
          startTimeMs: 1_000,
          endTimeMs: 1_000,
          lastModifiedTimeMs: 2_000,
          recordingMethod: 2,
          clientRecordVersion: 1,
          value: 90,
          unit: 'bpm',
        },
        {
          externalId: 'heart-parent:2000',
          parentExternalId: 'heart-parent',
          kind: 'heart_rate',
          sourcePackage: 'com.sec.android.app.shealth',
          startTimeMs: 2_000,
          endTimeMs: 2_000,
          lastModifiedTimeMs: 2_000,
          recordingMethod: 2,
          clientRecordVersion: 1,
          value: 88,
          unit: 'bpm',
        },
      ]),
    ).toEqual(['heart-parent']);
  });

  it('builds a bound deletion filter for both direct and child records', () => {
    const filter = buildHealthConnectExternalIdFilter(['one', 'two', 'one']);
    expect(filter?.whereSql).toContain('external_id IN (?, ?)');
    expect(filter?.whereSql).toContain('parent_external_id IN (?, ?)');
    expect(filter?.parameters).toEqual(['one', 'two', 'one', 'two']);
    expect(buildHealthConnectExternalIdFilter([])).toBeUndefined();
  });
});
