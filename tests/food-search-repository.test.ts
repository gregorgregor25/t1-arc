import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getStoredFoodSearchEntries,
  setFoodFavorite,
  setStoredFoodFavoritesByIdentity,
} from '@/data/food/foodLogRepository';
import { OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS } from '@/data/food/providerRetention';

const database = vi.hoisted(() => ({
  getAllAsync: vi.fn(),
  getFirstAsync: vi.fn(async () => null),
  runAsync: vi.fn(),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => database),
  withT1ArcTransaction: vi.fn(
    async (operation: (value: typeof database) => Promise<unknown>) =>
      operation(database),
  ),
}));

describe('stored food search entries', () => {
  beforeEach(() => {
    database.getAllAsync.mockReset();
    database.runAsync.mockReset().mockResolvedValue({ changes: 1 });
  });

  it('returns candidates together with favourite and usage metadata', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'user:oats',
        provider: 'user',
        external_id: 'oats',
        barcode: null,
        name: 'Breakfast oats',
        brand: null,
        image_url: null,
        basis_amount: 50,
        basis_unit: 'g',
        default_serving_amount: 50,
        default_serving_unit: 'g',
        last_portion_amount: 65,
        last_portion_unit: 'g',
        carbohydrate_grams: 30,
        energy_kcal: 190,
        protein_grams: 6,
        fat_grams: 3,
        fibre_grams: 5,
        sugars_grams: 1,
        saturated_fat_grams: 0.5,
        nutrition_quality_json: JSON.stringify({
          carbohydrate: 'reported',
          energy: 'reported',
          protein: 'reported',
          fat: 'reported',
          fibre: 'reported',
          sugars: 'reported',
          saturatedFat: 'reported',
        }),
        source_label: 'My foods',
        source_url: null,
        raw_payload_json: null,
        cached_at_ms: 1_000,
        is_favorite: 1,
        use_count: 7,
        last_used_at_ms: 2_000,
      },
    ]);

    await expect(getStoredFoodSearchEntries(25)).resolves.toMatchObject([
      {
        food: {
          id: 'user:oats',
          name: 'Breakfast oats',
          provider: 'user',
          lastPortionAmount: 65,
        },
        cachedAt: 1_000,
        isFavourite: true,
        useCount: 7,
        lastUsedAt: 2_000,
      },
    ]);
    const [query, limit] = database.getAllAsync.mock.calls[0]!;
    expect(query).toContain('FROM food_catalog_cache');
    expect(query).toContain('is_favorite DESC');
    expect(query).toContain("CASE provider WHEN 'user' THEN 0 ELSE 1 END");
    expect(limit).toBe(25);
  });

  it('carries a remote catalogue fetch time independently from personal use', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'open-food-facts:12345678',
        provider: 'open-food-facts',
        external_id: '12345678',
        barcode: '12345678',
        name: 'Cereal bar',
        brand: 'Example',
        image_url: null,
        basis_amount: 100,
        basis_unit: 'g',
        default_serving_amount: 30,
        default_serving_unit: 'g',
        last_portion_amount: 45,
        last_portion_unit: 'g',
        carbohydrate_grams: 60,
        energy_kcal: null,
        protein_grams: null,
        fat_grams: null,
        fibre_grams: null,
        sugars_grams: null,
        saturated_fat_grams: null,
        nutrition_quality_json: JSON.stringify({
          carbohydrate: 'reported',
          energy: 'missing',
          protein: 'missing',
          fat: 'missing',
          fibre: 'missing',
          sugars: 'missing',
          saturatedFat: 'missing',
        }),
        source_label: 'Open Food Facts',
        source_url: null,
        raw_payload_json: null,
        cached_at_ms: 1_000,
        is_favorite: 1,
        use_count: 50,
        last_used_at_ms: 99_000,
      },
    ]);

    await expect(getStoredFoodSearchEntries()).resolves.toMatchObject([
      {
        food: { catalogueObservedAt: 1_000 },
        cachedAt: 1_000,
        lastUsedAt: 99_000,
      },
    ]);
  });

  it('bounds the amount loaded for typo-tolerant in-memory ranking', async () => {
    database.getAllAsync.mockResolvedValue([]);
    await getStoredFoodSearchEntries(99_999);
    expect(database.getAllAsync.mock.calls[0]?.[1]).toBe(2_000);
  });

  it('skips a malformed cache row instead of losing all search history', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'broken',
        provider: 'user',
        external_id: 'broken',
        barcode: null,
        name: 'Broken row',
        brand: null,
        image_url: null,
        basis_amount: 100,
        basis_unit: 'g',
        default_serving_amount: null,
        default_serving_unit: null,
        last_portion_amount: null,
        last_portion_unit: null,
        carbohydrate_grams: 10,
        energy_kcal: null,
        protein_grams: null,
        fat_grams: null,
        fibre_grams: null,
        sugars_grams: null,
        saturated_fat_grams: null,
        nutrition_quality_json: '{not-json',
        source_label: 'My foods',
        source_url: null,
        raw_payload_json: null,
        cached_at_ms: 1_000,
        is_favorite: 0,
        use_count: 1,
        last_used_at_ms: 1_000,
      },
    ]);
    await expect(getStoredFoodSearchEntries()).resolves.toEqual([]);
  });

  it('updates cached nutrition but retains only policy-approved provider payload', async () => {
    await setFoodFavorite(
      {
        id: 'open-food-facts:5000157071644',
        provider: 'open-food-facts',
        externalId: '5000157071644',
        name: 'Baked beans',
        barcode: '5000157071644',
        basisAmount: 100,
        basisUnit: 'g',
        defaultServingAmount: 200,
        defaultServingUnit: 'g',
        servingLabel: 'Half can (200 g)',
        nutritionPerBasis: { carbohydrateGrams: 12.5 },
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
        catalogueObservedAt: 1_234,
        rawPayload: {
          serving_size: 'Half can (200 g)',
          ingredients_text: 'not retained',
        },
      },
      true,
    );

    const [sql, ...parameters] = database.runAsync.mock.calls[0]!;
    expect(String(sql).match(/\?/g)?.length).toBe(parameters.length);
    expect(sql).toContain('carbohydrate_grams = CASE');
    expect(sql).toContain('THEN excluded.carbohydrate_grams');
    expect(sql).toContain('expires_at_ms = CASE');
    expect(sql).toContain('THEN excluded.expires_at_ms');
    expect(sql).toContain('ELSE food_catalog_cache.expires_at_ms');
    expect(sql).toContain(
      "excluded.provider NOT IN ('open-food-facts', 'usda-fdc')",
    );
    expect(parameters).toContain(
      JSON.stringify({ serving_size: 'Half can (200 g)' }),
    );
    expect(parameters).toContain(1_234);
    expect(parameters).toContain(
      1_234 + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    );
    expect(parameters).not.toEqual(
      expect.arrayContaining([expect.stringContaining('ingredients_text')]),
    );
  });

  it('does not turn an unknown or stale provider snapshot fresh when favourited', async () => {
    await setFoodFavorite(
      {
        id: 'open-food-facts:5000157071644',
        provider: 'open-food-facts',
        externalId: '5000157071644',
        name: 'Saved beans',
        barcode: '5000157071644',
        basisAmount: 100,
        basisUnit: 'g',
        nutritionPerBasis: { carbohydrateGrams: 10 },
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
      },
      true,
    );

    const [sql, ...parameters] = database.runAsync.mock.calls[0]!;
    expect(sql).toContain('ELSE food_catalog_cache.cached_at_ms');
    expect(sql).toContain('ELSE food_catalog_cache.expires_at_ms');
    expect(parameters).toContain(0);
  });

  it('updates every stored favourite identity without copying representative content', async () => {
    database.runAsync
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    await expect(
      setStoredFoodFavoritesByIdentity(
        [
          { id: 'user:bar', provider: 'user', externalId: 'bar' },
          {
            id: 'open-food-facts:5000000000001',
            provider: 'open-food-facts',
            externalId: '5000000000001',
          },
        ],
        false,
      ),
    ).resolves.toBe(2);

    expect(database.runAsync).toHaveBeenCalledTimes(2);
    for (const [sql] of database.runAsync.mock.calls) {
      expect(sql).toContain('SET is_favorite = ?');
      expect(sql).not.toContain('nutrition');
      expect(sql).not.toContain('raw_payload');
    }
    expect(database.runAsync.mock.calls[0]?.slice(1)).toEqual([
      0,
      'user:bar',
      'user',
      'bar',
    ]);
  });
});
