import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFoodLog } from '@/data/food/foodLogRepository';
import {
  createMyFood,
  deleteMyFood,
  listMyFoods,
  updateMyFood,
} from '@/data/food/myFoodsRepository';

const harness = vi.hoisted(() => ({
  database: undefined as unknown,
  epoch: 4,
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => harness.database),
  withT1ArcTransaction: vi.fn(async (task: (database: unknown) => Promise<unknown>) => {
    const database = harness.database as TestDatabase;
    database.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await task(database);
      database.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      database.sqlite.exec('ROLLBACK');
      throw error;
    }
  }),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: harness.epoch })),
  assertLocalDataWriteLeaseInTransaction: vi.fn(
    async (_database: unknown, lease: { epoch: number }) => {
      if (lease.epoch !== harness.epoch) {
        const error = new Error('This local-data operation was superseded by a privacy erase.');
        error.name = 'LocalDataWriteSupersededError';
        throw error;
      }
    },
  ),
}));

class TestDatabase {
  constructor(readonly sqlite: DatabaseSync) {}

  async runAsync(sql: string, ...params: unknown[]) {
    const result = this.sqlite.prepare(sql).run(...params as SQLInputValue[]);
    return { changes: Number(result.changes), lastInsertRowId: result.lastInsertRowid };
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]) {
    return (this.sqlite.prepare(sql).get(...params as SQLInputValue[]) ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]) {
    return this.sqlite.prepare(sql).all(...params as SQLInputValue[]) as T[];
  }
}

function schema() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE context_events (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, origin TEXT NOT NULL,
      kind TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER,
      title TEXT NOT NULL, meal_type TEXT, carbs_grams REAL, energy_kcal REAL,
      protein_grams REAL, fat_grams REAL, fibre_grams REAL, sugars_grams REAL,
      saturated_fat_grams REAL, activity_type TEXT, duration_minutes REAL,
      intensity TEXT, quality_percent REAL, kilograms REAL, amount REAL,
      unit TEXT, recorded_at_ms INTEGER, source_file TEXT, source_row INTEGER
    );
    CREATE TABLE food_catalog_cache (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL,
      barcode TEXT, name TEXT NOT NULL, brand TEXT, image_url TEXT,
      basis_amount REAL NOT NULL, basis_unit TEXT NOT NULL,
      default_serving_amount REAL, default_serving_unit TEXT,
      last_portion_amount REAL, last_portion_unit TEXT,
      carbohydrate_grams REAL, energy_kcal REAL, protein_grams REAL,
      fat_grams REAL, fibre_grams REAL, sugars_grams REAL,
      saturated_fat_grams REAL, nutrition_quality_json TEXT NOT NULL,
      source_label TEXT NOT NULL, source_url TEXT, raw_payload_json TEXT,
      cached_at_ms INTEGER NOT NULL, expires_at_ms INTEGER,
      is_favorite INTEGER NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at_ms INTEGER, UNIQUE(provider, external_id)
    );
    CREATE TABLE food_logs (
      id TEXT PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE REFERENCES context_events(id) ON DELETE CASCADE,
      timestamp_ms INTEGER NOT NULL, meal_type TEXT NOT NULL, title TEXT NOT NULL,
      carbohydrate_grams REAL NOT NULL, energy_kcal REAL, protein_grams REAL,
      fat_grams REAL, fibre_grams REAL, sugars_grams REAL,
      saturated_fat_grams REAL, created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE food_log_items (
      id TEXT PRIMARY KEY,
      food_log_id TEXT NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL, external_id TEXT NOT NULL, name_snapshot TEXT NOT NULL,
      brand_snapshot TEXT, barcode_snapshot TEXT, amount REAL NOT NULL,
      unit TEXT NOT NULL, carbohydrate_grams REAL, energy_kcal REAL,
      protein_grams REAL, fat_grams REAL, fibre_grams REAL, sugars_grams REAL,
      saturated_fat_grams REAL, source_label TEXT NOT NULL, source_url TEXT,
      UNIQUE(food_log_id, ordinal)
    );
  `);
  return sqlite;
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = schema();
  harness.database = new TestDatabase(sqlite);
  harness.epoch = 4;
});

afterEach(() => sqlite.close());

describe('durable My Foods operations', () => {
  const myFoodDraft = {
    name: 'Granola', brand: 'Kitchen', servingAmount: 45, servingUnit: 'g' as const,
    nutritionPerServing: { carbohydrateGrams: 28, energyKcal: 210 },
  };

  it('creates and lists a standalone food without marking it recently logged', async () => {
    const created = await createMyFood(myFoodDraft, {
      lease: { epoch: 4 }, now: 1_700_000_000_000, entropy: 'fixture',
    });
    expect(created.id).toBe('user:1700000000000-fixture');
    expect(await listMyFoods()).toMatchObject([{ id: created.id, name: 'Granola' }]);
    expect(sqlite.prepare(`SELECT use_count, last_used_at_ms FROM food_catalog_cache
      WHERE id = ?`).get(created.id)).toEqual({ use_count: 0, last_used_at_ms: null });
  });

  it('updates stable catalogue identity while preserving saved snapshots on delete', async () => {
    const created = await createMyFood(myFoodDraft, {
      lease: { epoch: 4 }, now: 1_700_000_000_000, entropy: 'fixture',
    });
    const logged = await saveFoodLog({
      timestamp: Date.parse('2026-08-20T08:00:00Z'), mealType: 'breakfast',
      items: [{ food: created, amount: 45, unit: 'g' }],
    }, { epoch: 4 });
    const updated = await updateMyFood(created.id, {
      ...myFoodDraft, name: 'Updated granola', nutritionPerServing: { carbohydrateGrams: 31 },
    }, { lease: { epoch: 4 }, now: 1_700_000_001_000 });
    expect(updated.id).toBe(created.id);
    await deleteMyFood(created.id, { epoch: 4 });
    expect(sqlite.prepare(`SELECT catalog_id, name_snapshot, carbohydrate_grams
      FROM food_log_items WHERE food_log_id = ?`).get(logged.log.id)).toEqual({
      catalog_id: null, name_snapshot: 'Granola', carbohydrate_grams: 28,
    });
  });

  it('rejects a superseded standalone write', async () => {
    harness.epoch = 5;
    await expect(createMyFood(myFoodDraft, {
      lease: { epoch: 4 }, now: 1_700_000_000_000, entropy: 'fixture',
    })).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM food_catalog_cache').get())
      .toEqual({ count: 0 });
  });
});
