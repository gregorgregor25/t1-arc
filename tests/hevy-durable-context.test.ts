import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { repairHevyWorkoutContextOwnership } from '@/data/hevy/contextOwnership';
import { HevyWorkoutRepository } from '@/data/hevy/repository';
import type { HevyWorkout } from '@/data/hevy/types';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

const persistence = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) =>
      work(persistence.database),
  ),
}));

type BindValue = string | number | bigint | Uint8Array | null;

class AsyncDatabaseAdapter {
  constructor(readonly database: DatabaseSync) {}

  async execAsync(sql: string) {
    this.database.exec(sql);
  }

  async runAsync(sql: string, ...parameters: BindValue[]) {
    const result = this.database.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, ...parameters: BindValue[]) {
    return (
      (this.database.prepare(sql).get(...parameters) as T | undefined) ?? null
    );
  }

  async getAllAsync<T>(sql: string, ...parameters: BindValue[]) {
    return this.database.prepare(sql).all(...parameters) as T[];
  }
}

const START = Date.parse('2026-08-14T17:00:00.000Z');
const END = Date.parse('2026-08-14T18:00:00.000Z');

function workout(): HevyWorkout {
  return {
    id: 'workout-one',
    title: 'Upper body',
    routine_id: 'routine-one',
    description: 'Controlled session',
    start_time: '2026-08-14T17:00:00.000Z',
    end_time: '2026-08-14T18:00:00.000Z',
    updated_at: '2026-08-14T18:05:00.000Z',
    created_at: '2026-08-14T18:05:00.000Z',
    exercises: [
      {
        index: 0,
        title: 'Bench Press (Barbell)',
        notes: 'Controlled reps',
        exercise_template_id: 'bench',
        supersets_id: null,
        sets: [
          {
            index: 0,
            type: 'normal',
            weight_kg: 80,
            reps: 8,
            distance_meters: null,
            duration_seconds: null,
            rpe: 8.5,
            custom_metric: null,
          },
        ],
      },
    ],
  };
}

function createSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE hevy_workouts (
      id TEXT NOT NULL PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE
        REFERENCES context_events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      imported_at_ms INTEGER NOT NULL
    );
    CREATE TABLE app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE source_sync_state (
      source_id TEXT NOT NULL PRIMARY KEY,
      last_attempt_at_ms INTEGER,
      last_success_at_ms INTEGER,
      last_error_code TEXT,
      last_error_message TEXT,
      record_count INTEGER NOT NULL DEFAULT 0
    );
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
      recorded_at_ms INTEGER NOT NULL,
      source_file TEXT,
      source_row INTEGER
    );
    CREATE TABLE health_connect_preferences (
      category TEXT NOT NULL PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      preferred_source_package TEXT,
      preferred_source_mode TEXT,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

async function insertHealthConnectWorkout(
  database: AsyncDatabaseAdapter,
  id = 'health-connect:workout:watch:one',
) {
  await database.runAsync(
    `INSERT INTO context_events (
       id, source_id, origin, kind, start_ms, end_ms, title,
       activity_type, duration_minutes, intensity, calories_burned,
       recorded_at_ms, source_file
     ) VALUES (?, 'health-connect:watch.app', 'imported', 'activity', ?, ?,
       'Weightlifting', 'strength', 60, 'moderate', 420, ?,
       'Health Connect')`,
    id,
    START + 30_000,
    END - 30_000,
    END,
  );
}

describe('durable Hevy context ownership', () => {
  let sqlite: DatabaseSync;
  let database: AsyncDatabaseAdapter;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    createSchema(sqlite);
    database = new AsyncDatabaseAdapter(sqlite);
    persistence.database = database;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('survives an HC delete/reinsert and exposes one source-merged workout', async () => {
    await insertHealthConnectWorkout(database);
    const repository = new HevyWorkoutRepository();
    await repository.activateConnection({
      connectionGeneration: 1,
      userId: 'hevy-user',
    });
    await repository.reconcileFullSnapshot([workout()], {
      connectionGeneration: 1,
      cursorAt: END,
      fingerprint: 'snapshot-one',
      sourceWorkoutCount: 1,
      syncedAt: END,
      userId: 'hevy-user',
    });

    expect(
      await database.getFirstAsync<{
        context_event_id: string;
        source_id: string;
      }>(
        `SELECT h.context_event_id, c.source_id
           FROM hevy_workouts h
           JOIN context_events c ON c.id = h.context_event_id`,
      ),
    ).toEqual({
      context_event_id: 'hevy:workout-one',
      source_id: 'hevy',
    });

    await database.runAsync(
      `DELETE FROM context_events
        WHERE id = 'health-connect:workout:watch:one'`,
    );
    expect(
      await database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM hevy_workouts',
      ),
    ).toEqual({ count: 1 });

    await insertHealthConnectWorkout(
      database,
      'health-connect:workout:watch:replacement',
    );
    const visible = await new SqliteHealthRecordStore().getContextEvents({
      start: START - 1,
      end: END + 1,
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: 'hevy:workout-one',
      sourceId: 'hevy',
      title: 'Upper body',
      start: START,
      end: END,
      caloriesBurned: 420,
      caloriesBurnedSourceId: 'health-connect:watch.app',
      corroboratingSourceIds: ['health-connect:watch.app'],
      strengthWorkout: {
        provider: 'hevy',
        workoutId: 'workout-one',
        exercises: [
          expect.objectContaining({
            title: 'Bench Press (Barbell)',
            sets: [expect.objectContaining({ weightKilograms: 80, reps: 8 })],
          }),
        ],
      },
    });

    await repository.clearImportedWorkouts();
    expect(
      await database.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM context_events
          WHERE source_id LIKE 'health-connect:%'`,
      ),
    ).toEqual({ count: 1 });
    expect(
      await database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM hevy_workouts',
      ),
    ).toEqual({ count: 0 });
  });

  it('migrates an old HC-linked detail row before HC can cascade-delete it', async () => {
    await insertHealthConnectWorkout(database);
    const value = workout();
    await database.runAsync(
      `INSERT INTO hevy_workouts (
         id, context_event_id, title, description, start_ms, end_ms,
         updated_at_ms, created_at_ms, payload_json, imported_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      value.id,
      'health-connect:workout:watch:one',
      value.title,
      value.description,
      START,
      END,
      Date.parse(value.updated_at),
      Date.parse(value.created_at),
      JSON.stringify(value),
      END,
    );

    await expect(
      repairHevyWorkoutContextOwnership(database as never),
    ).resolves.toBe(1);
    await expect(
      repairHevyWorkoutContextOwnership(database as never),
    ).resolves.toBe(0);
    expect(
      await database.getFirstAsync<{
        context_event_id: string;
        source_id: string;
      }>(
        `SELECT h.context_event_id, c.source_id
           FROM hevy_workouts h
           JOIN context_events c ON c.id = h.context_event_id`,
      ),
    ).toEqual({
      context_event_id: 'hevy:workout-one',
      source_id: 'hevy',
    });

    await database.runAsync(
      `DELETE FROM context_events
        WHERE id = 'health-connect:workout:watch:one'`,
    );
    expect(
      await database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM hevy_workouts',
      ),
    ).toEqual({ count: 1 });
  });
});
