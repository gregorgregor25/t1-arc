import { readFileSync } from 'node:fs';
import { FOOD_PHOTO } from './fixtures/food-photo';
import { readFoodPhoto, cacheProductPhoto } from '@/data/food/foodPhotoRepository';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheFoodBarcodeLookup, getFoodBarcodeCacheEntry, getFoodLibraryPage,
  getFoodRecipePage, getMealPresetPage, saveFoodLog, saveFoodPersonalServing, saveFoodRecipe,
  getFoodLogByIdInTransaction, deleteFoodLogInTransaction, restoreFoodLogInTransaction,
} from '@/data/food/foodLogRepository';
import { parseFoodDataCentralFood } from '@/data/food/usdaFoodDataCentral';
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
    CREATE TABLE food_recipes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, meal_type TEXT NOT NULL, servings REAL NOT NULL,
      carbohydrate_grams REAL NOT NULL, energy_kcal REAL, protein_grams REAL, fat_grams REAL,
      fibre_grams REAL, sugars_grams REAL, saturated_fat_grams REAL,
      is_favorite INTEGER NOT NULL DEFAULT 0, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE food_recipe_items (
      id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES food_recipes(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, catalog_id TEXT REFERENCES food_catalog_cache(id) ON DELETE SET NULL,
      provider TEXT NOT NULL, external_id TEXT NOT NULL, name_snapshot TEXT NOT NULL,
      brand_snapshot TEXT, barcode_snapshot TEXT, amount REAL NOT NULL, unit TEXT NOT NULL,
      carbohydrate_grams REAL, energy_kcal REAL, protein_grams REAL, fat_grams REAL, fibre_grams REAL,
      sugars_grams REAL, saturated_fat_grams REAL, source_label TEXT NOT NULL, source_url TEXT,
      UNIQUE(recipe_id, ordinal)
    );
  `);
  const productionSchema = readFileSync('src/data/persistence/t1arcDatabase.ts', 'utf8');
  sqlite.exec(productionSchema.match(/CREATE TABLE IF NOT EXISTS food_photos\s*\([\s\S]*?\);/)![0]);
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

  function remoteFood() {
    return { ...parseFoodDataCentralFood({ fdcId: 20, description: 'Cereal', gtinUpc: '00012345678905',
      servingSize: 30, servingSizeUnit: 'g', foodNutrients: [{ nutrientId: 1005, value: 50 }] }), catalogueObservedAt: Date.now() };
  }

  it('caches a lookup without logging it, then remembers equivalent barcode and personal serving', async () => {
    const food = remoteFood();
    await cacheFoodBarcodeLookup(food, { epoch: 4 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM food_logs').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT use_count, is_favorite, last_used_at_ms FROM food_catalog_cache').get())
      .toEqual({ use_count: 0, is_favorite: 0, last_used_at_ms: null });
    expect((await getFoodBarcodeCacheEntry('012345678905'))?.food.id).toBe(food.id);
    await saveFoodPersonalServing(food, { amount: 45, unit: 'g', label: 'My bowl' }, { epoch: 4 });
    await cacheFoodBarcodeLookup({ ...food, name: 'New cereal label', catalogueObservedAt: food.catalogueObservedAt + 1 }, { epoch: 4 });
    expect((await getFoodBarcodeCacheEntry('012345678905'))?.food).toMatchObject({
      name: 'New cereal label', personalServingAmount: 45, personalServingLabel: 'My bowl',
      nutrientDefinitions: { carbohydrate: 'by-difference' },
    });
  });

  it('rejects lookup and personal portion writes after a privacy erase', async () => {
    harness.epoch = 5;
    await expect(cacheFoodBarcodeLookup(remoteFood(), { epoch: 4 })).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    await expect(saveFoodPersonalServing(remoteFood(), { amount: 40, unit: 'g' }, { epoch: 4 })).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM food_catalog_cache').get()).toEqual({ count: 0 });
  });

  it('keeps personal barcode corrections ahead of equivalent provider entries', async () => {
    const personal = await createMyFood({ ...myFoodDraft, barcode: '012345678905' }, { lease: { epoch: 4 } });
    await cacheFoodBarcodeLookup(remoteFood(), { epoch: 4 });
    expect((await getFoodBarcodeCacheEntry('0012345678905'))?.food.id).toBe(personal.id);
    await expect(createMyFood({ ...myFoodDraft, barcode: '0012345678905' }, { lease: { epoch: 4 } })).rejects.toThrow('already used');
    await cacheFoodBarcodeLookup({ ...remoteFood(), id: personal.id }, { epoch: 4 });
    expect((await getFoodBarcodeCacheEntry('0012345678905'))?.food.name).toBe('Granola');
  });

  it('pages saved foods independently and searches beyond the initial suggestions', async () => {
    for (let index = 0; index < 35; index++) {
      await createMyFood({ ...myFoodDraft, name: `Food ${String(index).padStart(2, '0')}` }, { lease: { epoch: 4 }, now: 1, entropy: String(index) });
    }
    const first = await getFoodLibraryPage({ kind: 'my-foods', limit: 20 });
    const second = await getFoodLibraryPage({ kind: 'my-foods', offset: 20, limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(15);
    expect(second.hasMore).toBe(false);
    expect((await getFoodLibraryPage({ kind: 'my-foods', query: 'Food 34' })).items[0]?.food.name).toBe('Food 34');
    expect((await getFoodLibraryPage({ kind: 'recent' })).items).toHaveLength(0);
    expect((await getFoodLibraryPage({ kind: 'my-foods', query: '%' })).items).toHaveLength(0);
  });

  it('finds older recipes and meals through independent searchable pages', async () => {
    const food = await createMyFood(myFoodDraft, { lease: { epoch: 4 } });
    for (let index = 0; index < 25; index++) {
      const name = `Meal ${String(index).padStart(2, '0')}`;
      await saveFoodRecipe({ name, mealType: 'breakfast', servings: 2, ingredients: [{ food, amount: 90, unit: 'g' }] }, { epoch: 4 });
      await saveFoodLog({ timestamp: 1_000 + index, title: name, mealType: 'breakfast', items: [{ food, amount: 45, unit: 'g' }] }, { epoch: 4 });
    }
    expect((await getFoodRecipePage({ limit: 20 })).hasMore).toBe(true);
    expect((await getFoodRecipePage({ offset: 20 })).items).toHaveLength(5);
    expect((await getFoodRecipePage({ query: 'Meal 00' })).items[0]?.name).toBe('Meal 00');
    expect((await getMealPresetPage({ limit: 20 })).hasMore).toBe(true);
    expect((await getMealPresetPage({ offset: 20 })).items).toHaveLength(5);
    expect((await getMealPresetPage({ query: 'Meal 00' })).items[0]?.title).toBe('Meal 00');
  });

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


describe('private food photo transactions', () => {
  it('caches retained product images without overwriting a personal photo', async () => {
    const draft = { name: 'Cached food', servingAmount: 100, servingUnit: 'g' as const, nutritionPerServing: { carbohydrateGrams: 20 } };
    const food = await createMyFood(draft);
    const owner = { kind: 'food' as const, id: food.id };
    const url = 'https://images.openfoodfacts.org/images/example.jpg';
    await cacheProductPhoto(owner, async () => FOOD_PHOTO, url);
    expect(await readFoodPhoto(owner)).toEqual({ uri: FOOD_PHOTO, sourceUrl: url });
    await updateMyFood(food.id, { ...draft, photoData: FOOD_PHOTO });
    await cacheProductPhoto(owner, async () => FOOD_PHOTO, url);
    expect(await readFoodPhoto(owner)).toEqual({ uri: FOOD_PHOTO, sourceUrl: undefined });
    await cacheProductPhoto({ kind: 'food', id: 'not-retained' }, async () => FOOD_PHOTO, url);
    expect(await readFoodPhoto({ kind: 'food', id: 'not-retained' })).toBeUndefined();
  });
  it('restores the original meal photo when a replacement is undone', async () => {
    const food = await createMyFood({ name: 'Undo food', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 20 } });
    const { log } = await saveFoodLog({ timestamp: 12345, mealType: 'lunch', items: [{ food, amount: 100, unit: 'g' }], photoData: FOOD_PHOTO }, { epoch: 4 });
    const db = harness.database as import('expo-sqlite').SQLiteDatabase;
    const snapshot = await getFoodLogByIdInTransaction(db, log.id);
    expect(snapshot?.photoData).toBe(FOOD_PHOTO);
    await deleteFoodLogInTransaction(db, snapshot!);
    expect(await readFoodPhoto({ kind: 'meal', id: log.id })).toBeUndefined();
    await restoreFoodLogInTransaction(db, snapshot!);
    expect((await readFoodPhoto({ kind: 'meal', id: log.id }))?.uri).toBe(FOOD_PHOTO);
  });
  it('stores pixels atomically, preserves on metadata edits, removes explicitly and cascades on deletion', async () => {
    const draft = { name: 'Photo food', servingAmount: 100, servingUnit: 'g' as const, nutritionPerServing: { carbohydrateGrams: 20 }, photoData: FOOD_PHOTO, labelConvention: 'us' as const };
    const food = await createMyFood(draft);
    expect((await readFoodPhoto({ kind: 'food', id: food.id }))?.uri).toBe(FOOD_PHOTO);
    expect((await listMyFoods())[0]?.nutrientDefinitions?.carbohydrate).toBe('total');
    await updateMyFood(food.id, { ...draft, photoData: undefined, name: 'Renamed' });
    expect((await readFoodPhoto({ kind: 'food', id: food.id }))?.uri).toBe(FOOD_PHOTO);
    await updateMyFood(food.id, { ...draft, photoData: null });
    expect(await readFoodPhoto({ kind: 'food', id: food.id })).toBeUndefined();
    await updateMyFood(food.id, draft);
    await deleteMyFood(food.id);
    expect(await readFoodPhoto({ kind: 'food', id: food.id })).toBeUndefined();
  });
  it('rolls back a new food when its photo is invalid and cannot reintroduce photos after erase', async () => {
    await expect(createMyFood({ name: 'Invalid photo', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 20 }, photoData: 'file:///private/image.jpg' })).rejects.toThrow();
    expect(await listMyFoods()).toEqual([]);
    const food = await createMyFood({ name: 'Before erase', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 20 } });
    await expect(cacheProductPhoto({ kind: 'food', id: food.id }, async () => { harness.epoch += 1; return FOOD_PHOTO; }, 'https://images.openfoodfacts.org/images/example.jpg')).rejects.toThrow(/superseded/);
    expect(await readFoodPhoto({ kind: 'food', id: food.id })).toBeUndefined();
  });
});
