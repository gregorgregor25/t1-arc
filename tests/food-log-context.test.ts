import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { saveFoodLog } from '@/data/food/foodLogRepository';
import { OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS } from '@/data/food/providerRetention';

const database = vi.hoisted(() => ({
  getFirstAsync: vi.fn(async () => null),
  runAsync: vi.fn(async () => ({ changes: 1 })),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => database),
  withT1ArcTransaction: vi.fn(
    async (operation: (value: typeof database) => Promise<unknown>) =>
      operation(database),
  ),
}));

describe('native food-log timeline context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes complete meal nutrition and returns exact itemized context', async () => {
    const result = await saveFoodLog({
      timestamp: Date.parse('2026-08-18T12:30:00+01:00'),
      mealType: 'lunch',
      items: [
        {
          amount: 250,
          unit: 'g',
          food: {
            id: 'user:wrap',
            provider: 'user',
            externalId: 'wrap',
            name: 'Chicken wrap',
            basisAmount: 250,
            basisUnit: 'g',
            nutritionPerBasis: {
              carbohydrateGrams: 42,
              energyKcal: 510,
              proteinGrams: 28,
              fatGrams: 16,
              fibreGrams: 7,
              sugarsGrams: 5,
              saturatedFatGrams: 3,
            },
            nutritionQuality: {
              carbohydrate: 'reported',
              energy: 'reported',
              protein: 'reported',
              fat: 'reported',
              fibre: 'reported',
              sugars: 'reported',
              saturatedFat: 'reported',
            },
            sourceLabel: 'My foods',
          },
        },
      ],
    });

    const contextWrite = (
      database.runAsync.mock.calls as unknown as unknown[][]
    ).find(([sql]) => String(sql).includes('INSERT INTO context_events'));
    const catalogWrite = (
      database.runAsync.mock.calls as unknown as unknown[][]
    ).find(([sql]) => String(sql).includes('INSERT INTO food_catalog_cache'));
    expect(String(catalogWrite?.[0]).match(/\?/g)?.length).toBe(
      (catalogWrite?.length ?? 1) - 1,
    );
    expect(String(contextWrite?.[0]).match(/\?/g)?.length).toBe(
      (contextWrite?.length ?? 1) - 1,
    );
    expect(contextWrite?.[0]).toContain('fibre_grams');
    expect(contextWrite?.[0]).toContain('sugars_grams');
    expect(contextWrite?.[0]).toContain('saturated_fat_grams');
    expect(contextWrite?.slice(1)).toEqual(
      expect.arrayContaining([42, 510, 28, 16, 7, 5, 3]),
    );
    expect(result.event).toMatchObject({
      sourceLabel: 'T1 Arc food log',
      carbsGrams: 42,
      energyKcal: 510,
      proteinGrams: 28,
      fatGrams: 16,
      fibreGrams: 7,
      sugarsGrams: 5,
      saturatedFatGrams: 3,
      nutritionDetail: 'itemized',
      items: [
        expect.objectContaining({
          name: 'Chicken wrap',
          carbohydrateGrams: 42,
          sourceLabel: 'My foods',
        }),
      ],
    });
  });

  it('does not refresh provider catalogue age when logging a stale offline fallback', async () => {
    const catalogueObservedAt = 1_000;
    await saveFoodLog({
      timestamp: Date.parse('2026-08-18T12:30:00+01:00'),
      mealType: 'lunch',
      items: [
        {
          amount: 200,
          unit: 'g',
          food: {
            id: 'open-food-facts:5000157071644',
            provider: 'open-food-facts',
            externalId: '5000157071644',
            barcode: '5000157071644',
            name: 'Saved beans',
            basisAmount: 100,
            basisUnit: 'g',
            nutritionPerBasis: { carbohydrateGrams: 12 },
            nutritionQuality: {
              carbohydrate: 'reported',
              energy: 'missing',
              protein: 'missing',
              fat: 'missing',
              fibre: 'missing',
              sugars: 'missing',
              saturatedFat: 'missing',
            },
            sourceLabel: 'Open Food Facts',
            catalogueObservedAt,
          },
        },
      ],
    });

    const catalogWrite = (
      database.runAsync.mock.calls as unknown as unknown[][]
    ).find(([sql]) => String(sql).includes('INSERT INTO food_catalog_cache'))!;
    const sql = String(catalogWrite[0]);
    expect(sql).toContain(
      'excluded.cached_at_ms >= food_catalog_cache.cached_at_ms',
    );
    for (const column of [
      'name',
      'carbohydrate_grams',
      'nutrition_quality_json',
      'raw_payload_json',
      'cached_at_ms',
      'expires_at_ms',
    ]) {
      expect(sql).toContain(`${column} = CASE`);
      expect(sql).toContain(`ELSE food_catalog_cache.${column}`);
    }
    expect(sql).toContain('last_portion_amount = excluded.last_portion_amount');
    expect(catalogWrite[25]).toBe(catalogueObservedAt);
    expect(catalogWrite[26]).toBe(
      catalogueObservedAt + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    );

    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`CREATE TABLE food_catalog_cache (
        id TEXT PRIMARY KEY, provider TEXT, external_id TEXT, barcode TEXT,
        name TEXT, brand TEXT, image_url TEXT, basis_amount REAL,
        basis_unit TEXT, default_serving_amount REAL,
        default_serving_unit TEXT, last_portion_amount REAL,
        last_portion_unit TEXT, carbohydrate_grams REAL, energy_kcal REAL,
        protein_grams REAL, fat_grams REAL, fibre_grams REAL,
        sugars_grams REAL, saturated_fat_grams REAL,
        nutrition_quality_json TEXT, source_label TEXT, source_url TEXT,
        raw_payload_json TEXT, cached_at_ms INTEGER, expires_at_ms INTEGER,
        is_favorite INTEGER, use_count INTEGER, last_used_at_ms INTEGER
      )`);
      sqlite.prepare(`INSERT INTO food_catalog_cache (
        id, provider, external_id, barcode, name, basis_amount, basis_unit,
        default_serving_amount, default_serving_unit, carbohydrate_grams,
        nutrition_quality_json, source_label, raw_payload_json, cached_at_ms,
        expires_at_ms, is_favorite, use_count, last_used_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'open-food-facts:5000157071644',
        'open-food-facts',
        '5000157071644',
        '5000157071644',
        'Fresh corrected beans',
        100,
        'g',
        100,
        'g',
        13,
        '{"carbohydrate":"reported"}',
        'Open Food Facts',
        '{"serving_size":"100 g"}',
        2_000,
        2_000 + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
        0,
        3,
        2_500,
      );
      sqlite
        .prepare(sql)
        .run(...(catalogWrite.slice(1) as SQLInputValue[]));
      expect(
        sqlite.prepare(`SELECT name, carbohydrate_grams, raw_payload_json,
          cached_at_ms, last_portion_amount, use_count, last_used_at_ms
          FROM food_catalog_cache WHERE id = ?`).get(
          'open-food-facts:5000157071644',
        ),
      ).toMatchObject({
        name: 'Fresh corrected beans',
        carbohydrate_grams: 13,
        raw_payload_json: '{"serving_size":"100 g"}',
        cached_at_ms: 2_000,
        last_portion_amount: 200,
        use_count: 4,
        last_used_at_ms: expect.any(Number),
      });
    } finally {
      sqlite.close();
    }
  });
});
