import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSIGHT_INPUT_GENERATION_KEY } from '@/data/insights/insightReportRepository';
import {
  createManualInsulinDelivery,
  reviseManualInsulinDelivery,
} from '@/data/manualInsulin';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import {
  LOCAL_DATA_WRITE_EPOCH_KEY,
  LocalDataWriteSupersededError,
} from '@/data/privacy/localDataWriteEpoch';
import type { ContextNoteEvent, MealEvent } from '@/domain/models';

const persistence = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = persistence.database as AsyncDatabaseAdapter;
      database.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(database);
        database.sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        database.sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  ),
}));

class AsyncDatabaseAdapter {
  failNextInsightDelete = false;

  constructor(readonly sqlite: DatabaseSync) {}

  async runAsync(sql: string, ...parameters: SQLInputValue[]) {
    if (
      this.failNextInsightDelete &&
      /^\s*DELETE FROM insight_reports\b/i.test(sql)
    ) {
      this.failNextInsightDelete = false;
      throw new Error('invalidation failed');
    }
    const result = this.sqlite.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, ...parameters: SQLInputValue[]) {
    return (this.sqlite.prepare(sql).get(...parameters) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...parameters: SQLInputValue[]) {
    return this.sqlite.prepare(sql).all(...parameters) as T[];
  }
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE context_notes (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      detail TEXT,
      glucose_mmol_l REAL,
      sensor_started INTEGER,
      sensor_glucose_source_id TEXT,
      recorded_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER
    );
    CREATE TABLE context_events (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      kind TEXT NOT NULL,
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
    CREATE TABLE app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE insight_reports (
      id TEXT NOT NULL PRIMARY KEY
    );
    CREATE TABLE insulin_bolus (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      units REAL NOT NULL,
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
  `);
}

function note(overrides: Partial<ContextNoteEvent> = {}): ContextNoteEvent {
  return {
    id: 'manual-note',
    sourceId: 'manual-entry',
    origin: 'manual',
    kind: 'note',
    start: 1_000,
    title: 'Original note',
    category: 'other',
    detail: 'Original detail',
    recordedAt: 1_100,
    ...overrides,
  };
}

function insertNote(database: DatabaseSync, event = note()) {
  database
    .prepare(
      `INSERT INTO context_notes (
         id, source_id, origin, start_ms, end_ms, title, category, detail,
         recorded_at_ms, source_file, source_row
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(
      event.id,
      event.sourceId,
      event.origin,
      event.start,
      event.end ?? null,
      event.title,
      event.category,
      event.detail ?? null,
      event.recordedAt ?? 0,
    );
}

function setGeneration(database: DatabaseSync, generation: number) {
  database
    .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
    .run(INSIGHT_INPUT_GENERATION_KEY, String(generation));
}

function generation(database: DatabaseSync) {
  return database
    .prepare('SELECT value FROM app_metadata WHERE key = ?')
    .get(INSIGHT_INPUT_GENERATION_KEY) as { value: string } | undefined;
}

function count(database: DatabaseSync, table: string) {
  return Number(
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }).count,
  );
}

describe('atomic manual context save insight invalidation', () => {
  let sqlite: DatabaseSync;
  let database: AsyncDatabaseAdapter;
  let store: SqliteHealthRecordStore;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    createSchema(sqlite);
    sqlite.exec(`CREATE TABLE glucose_readings (
      id TEXT PRIMARY KEY, source_id TEXT, timestamp_ms INTEGER,
      received_at_ms INTEGER, mmol_l REAL, imported_at_ms INTEGER, source_file TEXT
    );`);
    sqlite
      .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .run(LOCAL_DATA_WRITE_EPOCH_KEY, '7');
    database = new AsyncDatabaseAdapter(sqlite);
    persistence.database = database;
    store = new SqliteHealthRecordStore({ epoch: 7 });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('commits a create and generation advance together without clearing readable reports', async () => {
    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');

    await store.saveManualContext(note(), {
      insightInvalidation: 'mark-dirty',
    });

    expect(count(sqlite, 'context_notes')).toBe(1);
    expect(count(sqlite, 'insight_reports')).toBe(1);
    expect(generation(sqlite)).toEqual({ value: '1' });
  });

  it('persists a sensor change and ends waiting only for source-matched timely observations', async () => {
    const event = note({ sourceId: 't1arc-manual', category: 'sensor', sensorStarted: true,
      sensorGlucoseSourceId: 'live-cgm', start: 1_000 });
    await store.saveManualContext(event, { insightInvalidation: 'mark-dirty' });
    expect(await store.getSensorChangeStatus('live-cgm', 500_000)).toMatchObject({
      waiting: true, event: { id: event.id, sensorStarted: true, sensorGlucoseSourceId: 'live-cgm' },
    });
    expect(await store.getSensorChangeStatus('other-cgm', 500_000)).toBeUndefined();
    sqlite.prepare('INSERT INTO glucose_readings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('backfill', 'live-cgm', 2_000, 450_000, 6.5, null, null);
    sqlite.prepare('INSERT INTO glucose_readings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('other-source', 'other-cgm', 400_000, 400_100, 6.5, null, null);
    expect((await store.getSensorChangeStatus('live-cgm', 500_000))?.waiting).toBe(true);
    sqlite.prepare('INSERT INTO glucose_readings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('live-returned', 'live-cgm', 400_000, 400_100, 6.5, null, null);
    expect((await store.getSensorChangeStatus('live-cgm', 500_000))?.waiting).toBe(false);
    expect((await store.getSensorChangeStatus('live-cgm', 9_000_000))?.waiting).toBe(false);
    await store.saveManualContext({ ...event, start: 450_000 }, { insightInvalidation: 'mark-dirty' });
    expect((await store.getSensorChangeStatus('live-cgm', 500_000))?.waiting).toBe(true);
    await store.deleteManualContext(event.id);
    expect(await store.getSensorChangeStatus('live-cgm', 500_000)).toBeUndefined();
  });

  it('uses the same transaction boundary for structured manual events', async () => {
    const meal: MealEvent = {
      id: 'manual-meal',
      sourceId: 'manual-entry',
      origin: 'manual',
      kind: 'meal',
      start: 2_000,
      title: 'Lunch',
      mealType: 'lunch',
      carbsGrams: 42,
      recordedAt: 2_100,
    };

    await store.saveManualContext(meal, {
      insightInvalidation: 'mark-dirty',
    });

    expect(
      sqlite
        .prepare(
          'SELECT title, carbs_grams AS carbsGrams FROM context_events WHERE id = ?',
        )
        .get(meal.id),
    ).toEqual({ title: 'Lunch', carbsGrams: 42 });
    expect(generation(sqlite)).toEqual({ value: '1' });
  });

  it('atomically creates, corrects and deletes a manual insulin point dose', async () => {
    const delivery = createManualInsulinDelivery(
      {
        timestamp: 2_000,
        units: 4.5,
        insulinType: 'rapid-acting',
      },
      { id: 'manual-dose', recordedAt: 2_100 },
    );

    await store.saveManualInsulin(delivery, {
      insightInvalidation: 'mark-dirty',
    });
    expect(
      sqlite
        .prepare(
          'SELECT units, delivery_type AS deliveryType FROM insulin_bolus WHERE id = ?',
        )
        .get(delivery.id),
    ).toEqual({ units: 4.5, deliveryType: 'Manual rapid-acting dose' });
    expect(generation(sqlite)).toEqual({ value: '1' });

    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');
    await store.saveManualInsulin(
      reviseManualInsulinDelivery(delivery, {
        timestamp: 2_500,
        units: 5,
        insulinType: 'rapid-acting',
      }),
      { insightInvalidation: 'clear-saved-reports' },
    );
    expect(
      sqlite
        .prepare(
          'SELECT timestamp_ms AS timestamp, units FROM insulin_bolus WHERE id = ?',
        )
        .get(delivery.id),
    ).toEqual({ timestamp: 2_500, units: 5 });
    expect(count(sqlite, 'insight_reports')).toBe(0);

    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report-2');
    await expect(store.deleteManualInsulin(delivery.id)).resolves.toBe(true);
    expect(count(sqlite, 'insulin_bolus')).toBe(0);
    expect(count(sqlite, 'insight_reports')).toBe(0);
  });

  it('commits an edit, generation advance and copied-report clear together', async () => {
    insertNote(sqlite);
    setGeneration(sqlite, 4);
    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');

    await store.saveManualContext(
      note({ title: 'Corrected note', recordedAt: 1_200 }),
      { insightInvalidation: 'clear-saved-reports' },
    );

    expect(
      sqlite.prepare('SELECT title FROM context_notes WHERE id = ?').get('manual-note'),
    ).toEqual({ title: 'Corrected note' });
    expect(count(sqlite, 'insight_reports')).toBe(0);
    expect(generation(sqlite)).toEqual({ value: '5' });
  });

  it('rolls back the edit and generation when copied-report clearing fails', async () => {
    insertNote(sqlite);
    setGeneration(sqlite, 4);
    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');
    database.failNextInsightDelete = true;

    await expect(
      store.saveManualContext(note({ title: 'Must roll back' }), {
        insightInvalidation: 'clear-saved-reports',
      }),
    ).rejects.toThrow('invalidation failed');

    expect(
      sqlite.prepare('SELECT title FROM context_notes WHERE id = ?').get('manual-note'),
    ).toEqual({ title: 'Original note' });
    expect(count(sqlite, 'insight_reports')).toBe(1);
    expect(generation(sqlite)).toEqual({ value: '4' });
  });

  it('rolls back a create when its generation cannot advance safely', async () => {
    setGeneration(sqlite, Number.MAX_SAFE_INTEGER);

    await expect(
      store.saveManualContext(note(), { insightInvalidation: 'mark-dirty' }),
    ).rejects.toThrow('cannot be advanced safely');

    expect(count(sqlite, 'context_notes')).toBe(0);
    expect(generation(sqlite)).toEqual({
      value: String(Number.MAX_SAFE_INTEGER),
    });
  });

  it('does not mutate records or insight state when the write lease is stale', async () => {
    const staleStore = new SqliteHealthRecordStore({ epoch: 6 });

    await expect(
      staleStore.saveManualContext(note(), {
        insightInvalidation: 'mark-dirty',
      }),
    ).rejects.toBeInstanceOf(LocalDataWriteSupersededError);

    expect(count(sqlite, 'context_notes')).toBe(0);
    expect(generation(sqlite)).toBeUndefined();
  });
});
