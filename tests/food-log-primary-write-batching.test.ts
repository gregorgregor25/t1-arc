import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FOOD_LOG_SOURCE_ID,
  saveFoodLog,
  saveFoodRecipe,
  updateFoodLog,
  updateFoodLogPortions,
  updateFoodRecipe,
} from '@/data/food/foodLogRepository';
import { INSIGHT_INPUT_GENERATION_KEY } from '@/data/insights/insightReportRepository';
import type { FoodCandidate, FoodLogDraft } from '@/data/food/types';

const harness = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = harness.database as TestDatabase;
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

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })),
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
}));

interface RunCall {
  sql: string;
  parameterCount: number;
}

class TestDatabase {
  readonly runCalls: RunCall[] = [];
  readonly preparedSql: string[] = [];
  preparedExecuteCount = 0;
  finalizedCount = 0;

  constructor(readonly sqlite: DatabaseSync) {}

  resetMeasurements() {
    this.runCalls.length = 0;
    this.preparedSql.length = 0;
    this.preparedExecuteCount = 0;
    this.finalizedCount = 0;
  }

  async runAsync(sql: string, ...parameters: unknown[]) {
    this.runCalls.push({ sql, parameterCount: parameters.length });
    const result = this.sqlite
      .prepare(sql)
      .run(...(parameters as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async prepareAsync(sql: string) {
    this.preparedSql.push(sql);
    const statement = this.sqlite.prepare(sql);
    let finalized = false;
    return {
      executeAsync: async (...parameters: unknown[]) => {
        if (finalized) throw new Error('Prepared statement was finalized.');
        this.preparedExecuteCount += 1;
        const result = statement.run(...(parameters as SQLInputValue[]));
        return {
          changes: Number(result.changes),
          lastInsertRowId: Number(result.lastInsertRowid),
        };
      },
      finalizeAsync: async () => {
        finalized = true;
        this.finalizedCount += 1;
      },
    };
  }

  async getFirstAsync<T>(sql: string, ...parameters: unknown[]) {
    return (
      (this.sqlite
        .prepare(sql)
        .get(...(parameters as SQLInputValue[])) as T | undefined) ?? null
    );
  }
}

function createSchema() {
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
      is_favorite INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0, last_used_at_ms INTEGER,
      UNIQUE(provider, external_id)
    );
    CREATE TABLE food_logs (
      id TEXT PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE
        REFERENCES context_events(id) ON DELETE CASCADE,
      timestamp_ms INTEGER NOT NULL, meal_type TEXT NOT NULL, title TEXT NOT NULL,
      carbohydrate_grams REAL NOT NULL, energy_kcal REAL, protein_grams REAL,
      fat_grams REAL, fibre_grams REAL, sugars_grams REAL,
      saturated_fat_grams REAL, created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE food_log_items (
      id TEXT PRIMARY KEY,
      food_log_id TEXT NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL, external_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL, brand_snapshot TEXT, barcode_snapshot TEXT,
      amount REAL NOT NULL, unit TEXT NOT NULL, carbohydrate_grams REAL,
      energy_kcal REAL, protein_grams REAL, fat_grams REAL, fibre_grams REAL,
      sugars_grams REAL, saturated_fat_grams REAL, source_label TEXT NOT NULL,
      source_url TEXT, UNIQUE(food_log_id, ordinal)
    );
    CREATE TABLE food_recipes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, meal_type TEXT NOT NULL,
      servings REAL NOT NULL, carbohydrate_grams REAL NOT NULL,
      energy_kcal REAL, protein_grams REAL, fat_grams REAL,
      fibre_grams REAL, sugars_grams REAL, saturated_fat_grams REAL,
      created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE food_recipe_items (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL, external_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL, brand_snapshot TEXT, barcode_snapshot TEXT,
      amount REAL NOT NULL, unit TEXT NOT NULL, carbohydrate_grams REAL,
      energy_kcal REAL, protein_grams REAL, fat_grams REAL, fibre_grams REAL,
      sugars_grams REAL, saturated_fat_grams REAL, source_label TEXT NOT NULL,
      source_url TEXT, UNIQUE(recipe_id, ordinal)
    );
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE insight_reports (
      id TEXT PRIMARY KEY
    );
  `);
  return sqlite;
}

function food(id: string, carbohydrateGrams: number): FoodCandidate {
  return {
    id: `user:${id}`,
    provider: 'user',
    externalId: id,
    name: id,
    basisAmount: 100,
    basisUnit: 'g',
    nutritionPerBasis: {
      carbohydrateGrams,
      energyKcal: carbohydrateGrams * 4,
    },
    nutritionQuality: {
      carbohydrate: 'reported',
      energy: 'reported',
      protein: 'missing',
      fat: 'missing',
      fibre: 'missing',
      sugars: 'missing',
      saturatedFat: 'missing',
    },
    sourceLabel: 'My foods',
  };
}

function draft(items: FoodLogDraft['items']): FoodLogDraft {
  return {
    timestamp: Date.parse('2026-08-28T12:00:00Z'),
    mealType: 'lunch',
    items,
  };
}

function countRows(sqlite: DatabaseSync, table: string) {
  return sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
}

let sqlite: DatabaseSync;
let database: TestDatabase;

beforeEach(() => {
  sqlite = createSchema();
  database = new TestDatabase(sqlite);
  harness.database = database;
});

afterEach(() => sqlite.close());

describe('food-log primary-write batching', () => {
  it('preserves duplicate snapshots and ordered catalogue effects', async () => {
    const shared = food('Shared', 10);
    const other = food('Other', 20);
    const result = await saveFoodLog(
      draft([
        { food: shared, amount: 50, unit: 'g' },
        { food: other, amount: 100, unit: 'g' },
        { food: shared, amount: 150, unit: 'g' },
      ]),
      { epoch: 4 },
    );

    expect(
      sqlite
        .prepare(`SELECT ordinal, name_snapshot, amount, carbohydrate_grams
          FROM food_log_items WHERE food_log_id = ? ORDER BY ordinal`)
        .all(result.log.id),
    ).toEqual([
      { ordinal: 0, name_snapshot: 'Shared', amount: 50, carbohydrate_grams: 5 },
      { ordinal: 1, name_snapshot: 'Other', amount: 100, carbohydrate_grams: 20 },
      { ordinal: 2, name_snapshot: 'Shared', amount: 150, carbohydrate_grams: 15 },
    ]);
    expect(
      sqlite
        .prepare(`SELECT name, use_count, last_portion_amount
          FROM food_catalog_cache ORDER BY name`)
        .all(),
    ).toEqual([
      { name: 'Other', use_count: 1, last_portion_amount: 100 },
      { name: 'Shared', use_count: 2, last_portion_amount: 150 },
    ]);
    expect(result.log.items.map((item) => item.amount)).toEqual([50, 100, 150]);

    const catalogueWrites = database.runCalls.filter((call) =>
      call.sql.includes('INSERT INTO food_catalog_cache'),
    );
    const snapshotWrites = database.runCalls.filter((call) =>
      call.sql.includes('INSERT INTO food_log_items'),
    );
    expect(catalogueWrites).toHaveLength(2);
    expect(snapshotWrites).toHaveLength(1);
    expect(database.runCalls).toHaveLength(5);
  });

  it('keeps every large batch below the conservative variable ceiling', async () => {
    const items = Array.from({ length: 70 }, (_, index) => ({
      food: food(`Food ${index}`, index + 1),
      amount: 100,
      unit: 'g' as const,
    }));

    const result = await saveFoodLog(draft(items), { epoch: 4 });

    expect(countRows(sqlite, 'food_log_items')).toEqual({ count: 70 });
    expect(
      sqlite
        .prepare(`SELECT MIN(ordinal) AS first, MAX(ordinal) AS last
          FROM food_log_items WHERE food_log_id = ?`)
        .get(result.log.id),
    ).toEqual({ first: 0, last: 69 });
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_catalog_cache'),
      ),
    ).toHaveLength(3);
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_log_items'),
      ),
    ).toHaveLength(2);
    expect(database.runCalls).toHaveLength(7);
    for (const call of database.runCalls) {
      expect(call.parameterCount).toBeLessThanOrEqual(900);
      expect(call.sql.match(/\?/g)?.length ?? 0).toBe(call.parameterCount);
    }
  });

  it('persists an edited meal exactly with one cache and one snapshot batch', async () => {
    const original = await saveFoodLog(
      draft([
        { food: food('One', 10), amount: 100, unit: 'g' },
        { food: food('Two', 20), amount: 100, unit: 'g' },
        { food: food('Three', 30), amount: 100, unit: 'g' },
      ]),
      { epoch: 4 },
    );
    database.resetMeasurements();

    const adjusted = await updateFoodLog(
      original.log,
      {
        ...draft([
          { food: food('Three', 30), amount: 200, unit: 'g' },
          { food: food('One', 10), amount: 50, unit: 'g' },
          { food: food('Two', 20), amount: 25, unit: 'g' },
        ]),
        title: 'Edited meal',
      },
      { epoch: 4 },
    );

    expect(
      sqlite
        .prepare(`SELECT ordinal, name_snapshot, amount, carbohydrate_grams
          FROM food_log_items WHERE food_log_id = ? ORDER BY ordinal`)
        .all(original.log.id),
    ).toEqual([
      { ordinal: 0, name_snapshot: 'Three', amount: 200, carbohydrate_grams: 60 },
      { ordinal: 1, name_snapshot: 'One', amount: 50, carbohydrate_grams: 5 },
      { ordinal: 2, name_snapshot: 'Two', amount: 25, carbohydrate_grams: 5 },
    ]);
    expect(adjusted.nutrition.carbohydrateGrams).toBe(70);
    expect(database.runCalls).toHaveLength(5);
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_catalog_cache'),
      ),
    ).toHaveLength(1);
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_log_items'),
      ),
    ).toHaveLength(1);
  });

  it('adopts a migrated food timeline source when editing its linked meal', async () => {
    const original = await saveFoodLog(
      draft([{ food: food('Migrated meal', 12), amount: 100, unit: 'g' }]),
      { epoch: 4 },
    );
    sqlite.prepare('UPDATE context_events SET source_id = ? WHERE id = ?').run(
      'recovery-food-source',
      original.log.contextEventId,
    );

    const adjusted = await updateFoodLog(
      original.log,
      {
        ...draft([{ food: food('Migrated meal', 12), amount: 125, unit: 'g' }]),
        title: 'Updated after migration',
      },
      { epoch: 4 },
    );

    expect(adjusted.nutrition.carbohydrateGrams).toBe(15);
    expect(
      sqlite.prepare(`SELECT source_id, title, carbs_grams
        FROM context_events WHERE id = ?`).get(original.log.contextEventId),
    ).toEqual({
      source_id: FOOD_LOG_SOURCE_ID,
      title: 'Updated after migration',
      carbs_grams: 15,
    });
  });

  it('reuses two prepared statements for exact portion updates', async () => {
    const saved = await saveFoodLog(
      draft([
        { food: food('One', 10), amount: 100, unit: 'g' },
        { food: food('Two', 20), amount: 100, unit: 'g' },
        { food: food('Three', 30), amount: 100, unit: 'g' },
      ]),
      { epoch: 4 },
    );
    sqlite.prepare('UPDATE context_events SET source_id = ? WHERE id = ?').run(
      'recovery-food-source',
      saved.log.contextEventId,
    );
    database.resetMeasurements();

    const adjusted = await updateFoodLogPortions(
      saved.log,
      {
        [saved.log.items[0]!.id]: 50,
        [saved.log.items[1]!.id]: 100,
        [saved.log.items[2]!.id]: 200,
      },
      { epoch: 4 },
    );

    expect(adjusted.nutrition.carbohydrateGrams).toBe(85);
    expect(database.preparedSql).toHaveLength(2);
    expect(database.preparedExecuteCount).toBe(6);
    expect(database.finalizedCount).toBe(2);
    expect(database.runCalls).toHaveLength(2);
    expect(
      sqlite
        .prepare(`SELECT ordinal, amount, carbohydrate_grams
          FROM food_log_items WHERE food_log_id = ? ORDER BY ordinal`)
        .all(saved.log.id),
    ).toEqual([
      { ordinal: 0, amount: 50, carbohydrate_grams: 5 },
      { ordinal: 1, amount: 100, carbohydrate_grams: 20 },
      { ordinal: 2, amount: 200, carbohydrate_grams: 60 },
    ]);
    expect(
      sqlite
        .prepare(`SELECT carbohydrate_grams FROM food_logs WHERE id = ?`)
        .get(saved.log.id),
    ).toEqual({ carbohydrate_grams: 85 });
    expect(
      sqlite
        .prepare(`SELECT source_id, carbs_grams FROM context_events WHERE id = ?`)
        .get(saved.log.contextEventId),
    ).toEqual({ source_id: FOOD_LOG_SOURCE_ID, carbs_grams: 85 });
  });

  it('saves a recipe with one catalogue and one ingredient batch', async () => {
    const shared = food('Shared recipe food', 10);
    const recipe = await saveFoodRecipe(
      {
        name: 'Fast recipe',
        mealType: 'lunch',
        servings: 2,
        ingredients: [
          { food: shared, amount: 50, unit: 'g' },
          { food: food('Other recipe food', 20), amount: 100, unit: 'g' },
          { food: shared, amount: 150, unit: 'g' },
        ],
      },
      { epoch: 4 },
    );

    expect(
      sqlite.prepare(`SELECT ordinal, name_snapshot, amount
        FROM food_recipe_items WHERE recipe_id = ? ORDER BY ordinal`)
        .all(recipe.id),
    ).toEqual([
      { ordinal: 0, name_snapshot: 'Shared recipe food', amount: 50 },
      { ordinal: 1, name_snapshot: 'Other recipe food', amount: 100 },
      { ordinal: 2, name_snapshot: 'Shared recipe food', amount: 150 },
    ]);
    expect(
      sqlite.prepare(`SELECT last_portion_amount FROM food_catalog_cache
        WHERE id = ?`).get(shared.id),
    ).toEqual({ last_portion_amount: 150 });
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_catalog_cache'),
      ),
    ).toHaveLength(2);
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_recipe_items'),
      ),
    ).toHaveLength(1);
    expect(database.runCalls).toHaveLength(4);
  });

  it('updates a recipe atomically while preserving identity and favourite state', async () => {
    const original = await saveFoodRecipe(
      {
        name: 'Original recipe',
        mealType: 'breakfast',
        servings: 2,
        ingredients: [
          { food: food('Original ingredient', 10), amount: 100, unit: 'g' },
        ],
      },
      { epoch: 4 },
    );
    sqlite.prepare('UPDATE food_recipes SET is_favorite = 0 WHERE id = ?')
      .run(original.id);
    database.resetMeasurements();

    const updated = await updateFoodRecipe(
      original,
      {
        name: '  Updated   recipe  ',
        mealType: 'lunch',
        servings: 4,
        ingredients: [
          { food: food('First replacement', 20), amount: 50, unit: 'g' },
          { food: food('Second replacement', 30), amount: 200, unit: 'g' },
        ],
      },
      { epoch: 4 },
    );

    expect(updated).toMatchObject({
      id: original.id,
      name: 'Updated recipe',
      mealType: 'lunch',
      servings: 4,
      isFavorite: false,
      createdAt: original.createdAt,
    });
    expect(updated.nutrition.carbohydrateGrams).toBe(70);
    expect(
      sqlite.prepare(`SELECT name, meal_type, servings, carbohydrate_grams,
        created_at_ms, is_favorite FROM food_recipes WHERE id = ?`).get(original.id),
    ).toEqual({
      name: 'Updated recipe',
      meal_type: 'lunch',
      servings: 4,
      carbohydrate_grams: 70,
      created_at_ms: original.createdAt,
      is_favorite: 0,
    });
    expect(
      sqlite.prepare(`SELECT ordinal, name_snapshot, amount
        FROM food_recipe_items WHERE recipe_id = ? ORDER BY ordinal`).all(original.id),
    ).toEqual([
      { ordinal: 0, name_snapshot: 'First replacement', amount: 50 },
      { ordinal: 1, name_snapshot: 'Second replacement', amount: 200 },
    ]);
    expect(database.runCalls).toHaveLength(4);
  });

  it('rolls a failed recipe update back to the complete prior recipe', async () => {
    const original = await saveFoodRecipe(
      {
        name: 'Recipe before failure',
        mealType: 'breakfast',
        servings: 2,
        ingredients: [
          { food: food('Kept ingredient', 10), amount: 100, unit: 'g' },
        ],
      },
      { epoch: 4 },
    );
    sqlite.exec(`CREATE TRIGGER fail_recipe_update_item
      BEFORE INSERT ON food_recipe_items
      WHEN NEW.name_snapshot = 'Fail update item' BEGIN
        SELECT RAISE(ABORT, 'recipe update item failure');
      END;`);

    await expect(
      updateFoodRecipe(
        original,
        {
          name: 'Recipe after failure',
          mealType: 'dinner',
          servings: 8,
          ingredients: [
            { food: food('Fail update item', 25), amount: 200, unit: 'g' },
          ],
        },
        { epoch: 4 },
      ),
    ).rejects.toThrow('recipe update item failure');

    expect(
      sqlite.prepare(`SELECT name, meal_type, servings FROM food_recipes
        WHERE id = ?`).get(original.id),
    ).toEqual({
      name: 'Recipe before failure',
      meal_type: 'breakfast',
      servings: 2,
    });
    expect(
      sqlite.prepare(`SELECT name_snapshot, amount FROM food_recipe_items
        WHERE recipe_id = ?`).all(original.id),
    ).toEqual([{ name_snapshot: 'Kept ingredient', amount: 100 }]);
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS count FROM food_catalog_cache
        WHERE name = 'Fail update item'`).get(),
    ).toEqual({ count: 0 });
  });

  it('keeps every large recipe batch below the SQLite variable ceiling', async () => {
    const ingredients = Array.from({ length: 70 }, (_, index) => ({
      food: food(`Recipe food ${index}`, index + 1),
      amount: 100,
      unit: 'g' as const,
    }));

    const recipe = await saveFoodRecipe(
      {
        name: 'Large recipe',
        mealType: 'dinner',
        servings: 10,
        ingredients,
      },
      { epoch: 4 },
    );

    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM food_recipe_items WHERE recipe_id = ?')
        .get(recipe.id),
    ).toEqual({ count: 70 });
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_catalog_cache'),
      ),
    ).toHaveLength(3);
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO food_recipe_items'),
      ),
    ).toHaveLength(2);
    for (const call of database.runCalls) {
      expect(call.parameterCount).toBeLessThanOrEqual(900);
      expect(call.sql.match(/\?/g)?.length ?? 0).toBe(call.parameterCount);
    }
  });

  it('rolls every recipe row back when a batched ingredient insert fails', async () => {
    sqlite.exec(`CREATE TRIGGER fail_recipe_item
      BEFORE INSERT ON food_recipe_items
      WHEN NEW.name_snapshot = 'Fail recipe item' BEGIN
        SELECT RAISE(ABORT, 'recipe item failure');
      END;`);

    await expect(
      saveFoodRecipe(
        {
          name: 'Rollback recipe',
          mealType: 'dinner',
          servings: 1,
          ingredients: [
            { food: food('Good recipe item', 10), amount: 100, unit: 'g' },
            { food: food('Fail recipe item', 20), amount: 100, unit: 'g' },
          ],
        },
        { epoch: 4 },
      ),
    ).rejects.toThrow('recipe item failure');

    for (const table of [
      'food_catalog_cache',
      'food_recipes',
      'food_recipe_items',
    ]) {
      expect(countRows(sqlite, table)).toEqual({ count: 0 });
    }
  });

  it('marks a created meal dirty inside its primary transaction without deleting the last review', async () => {
    sqlite.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .run(INSIGHT_INPUT_GENERATION_KEY, '7');
    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');

    await saveFoodLog(
      draft([{ food: food('Atomic create', 10), amount: 100, unit: 'g' }]),
      { epoch: 4 },
      { insightInvalidation: 'mark-dirty' },
    );

    expect(
      sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(INSIGHT_INPUT_GENERATION_KEY),
    ).toEqual({ value: '8' });
    expect(countRows(sqlite, 'insight_reports')).toEqual({ count: 1 });
    expect(countRows(sqlite, 'food_logs')).toEqual({ count: 1 });
    expect(
      database.runCalls.filter((call) =>
        call.sql.includes('INSERT INTO app_metadata'),
      ),
    ).toHaveLength(1);
  });

  it('clears saved reviews and advances their generation in the same portion update', async () => {
    const saved = await saveFoodLog(
      draft([{ food: food('Atomic portion', 10), amount: 100, unit: 'g' }]),
      { epoch: 4 },
    );
    sqlite.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .run(INSIGHT_INPUT_GENERATION_KEY, '11');
    sqlite.prepare('INSERT INTO insight_reports (id) VALUES (?)').run('report');

    await updateFoodLogPortions(
      saved.log,
      { [saved.log.items[0]!.id]: 50 },
      { epoch: 4 },
      { insightInvalidation: 'clear-saved-reports' },
    );

    expect(
      sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(INSIGHT_INPUT_GENERATION_KEY),
    ).toEqual({ value: '12' });
    expect(countRows(sqlite, 'insight_reports')).toEqual({ count: 0 });
    expect(
      sqlite.prepare('SELECT amount FROM food_log_items WHERE id = ?')
        .get(saved.log.items[0]!.id),
    ).toEqual({ amount: 50 });
  });

  it('rolls the food rows back if atomic insight invalidation fails', async () => {
    sqlite.exec(`CREATE TRIGGER fail_insight_generation
      BEFORE INSERT ON app_metadata
      WHEN NEW.key = '${INSIGHT_INPUT_GENERATION_KEY}' BEGIN
        SELECT RAISE(ABORT, 'insight invalidation failure');
      END;`);

    await expect(
      saveFoodLog(
        draft([{ food: food('Rollback create', 10), amount: 100, unit: 'g' }]),
        { epoch: 4 },
        { insightInvalidation: 'mark-dirty' },
      ),
    ).rejects.toThrow('insight invalidation failure');

    for (const table of [
      'food_catalog_cache',
      'context_events',
      'food_logs',
      'food_log_items',
      'app_metadata',
    ]) {
      expect(countRows(sqlite, table)).toEqual({ count: 0 });
    }
  });

  it('rolls every batched create row back when a snapshot insert fails', async () => {
    sqlite.exec(`CREATE TRIGGER fail_snapshot BEFORE INSERT ON food_log_items
      WHEN NEW.name_snapshot = 'Fail' BEGIN
        SELECT RAISE(ABORT, 'snapshot failure');
      END;`);

    await expect(
      saveFoodLog(
        draft([
          { food: food('Good', 10), amount: 100, unit: 'g' },
          { food: food('Fail', 20), amount: 100, unit: 'g' },
        ]),
        { epoch: 4 },
      ),
    ).rejects.toThrow('snapshot failure');

    for (const table of [
      'food_catalog_cache',
      'context_events',
      'food_logs',
      'food_log_items',
    ]) {
      expect(countRows(sqlite, table)).toEqual({ count: 0 });
    }
  });

  it('rolls prepared portion changes back when a later item is missing', async () => {
    const saved = await saveFoodLog(
      draft([
        { food: food('One', 10), amount: 100, unit: 'g' },
        { food: food('Two', 20), amount: 100, unit: 'g' },
      ]),
      { epoch: 4 },
    );
    const staleLog = {
      ...saved.log,
      items: saved.log.items.map((item, index) =>
        index === 1 ? { ...item, id: 'missing-item' } : item,
      ),
    };

    await expect(
      updateFoodLogPortions(
        staleLog,
        {
          [staleLog.items[0]!.id]: 50,
          [staleLog.items[1]!.id]: 200,
        },
        { epoch: 4 },
      ),
    ).rejects.toThrow('A saved meal item could not be updated.');

    expect(
      sqlite
        .prepare(`SELECT ordinal, amount FROM food_log_items
          WHERE food_log_id = ? ORDER BY ordinal`)
        .all(saved.log.id),
    ).toEqual([
      { ordinal: 0, amount: 100 },
      { ordinal: 1, amount: 100 },
    ]);
  });
});
