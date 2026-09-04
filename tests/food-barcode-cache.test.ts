import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCachedFoodByBarcode,
  getFoodBarcodeCacheEntry,
} from '@/data/food/foodLogRepository';
import { OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS } from '@/data/food/providerRetention';

const database = vi.hoisted(() => ({
  getFirstAsync: vi.fn(),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => database),
  withT1ArcTransaction: vi.fn(),
}));

describe('local food barcode cache', () => {
  beforeEach(() => {
    database.getFirstAsync.mockReset();
  });

  it('returns a saved food without requiring a network provider', async () => {
    database.getFirstAsync.mockResolvedValue({
      id: 'user:barcode:5000157071644',
      provider: 'user',
      external_id: 'barcode:5000157071644',
      barcode: '5000157071644',
      name: 'My cereal',
      brand: 'Kitchen',
      image_url: null,
      basis_amount: 30,
      basis_unit: 'g',
      default_serving_amount: 30,
      default_serving_unit: 'g',
      last_portion_amount: 45,
      last_portion_unit: 'g',
      carbohydrate_grams: 21,
      energy_kcal: 150,
      protein_grams: 4,
      fat_grams: 2,
      fibre_grams: 3,
      sugars_grams: 5,
      saturated_fat_grams: 0.4,
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
      expires_at_ms: null,
    });

    await expect(
      getCachedFoodByBarcode('5000157071644'),
    ).resolves.toMatchObject({
      id: 'user:barcode:5000157071644',
      barcode: '5000157071644',
      name: 'My cereal',
      lastPortionAmount: 45,
      nutritionPerBasis: { carbohydrateGrams: 21 },
    });

    const [query, barcode] = database.getFirstAsync.mock.calls[0]!;
    expect(query).toContain("CASE provider WHEN 'user' THEN 0 ELSE 1 END");
    expect(barcode).toBe('5000157071644');
  });

  it('returns undefined when the barcode has never been saved', async () => {
    database.getFirstAsync.mockResolvedValue(null);
    await expect(
      getCachedFoodByBarcode('12345678'),
    ).resolves.toBeUndefined();
  });

  it('marks an old Open Food Facts row stale but preserves it as an offline fallback', async () => {
    database.getFirstAsync.mockResolvedValue({
      id: 'open-food-facts:5000157071644',
      provider: 'open-food-facts',
      external_id: '5000157071644',
      barcode: '5000157071644',
      name: 'Baked beans',
      brand: 'Example',
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      default_serving_amount: 200,
      default_serving_unit: 'g',
      last_portion_amount: null,
      last_portion_unit: null,
      carbohydrate_grams: 12,
      energy_kcal: 80,
      protein_grams: 5,
      fat_grams: 1,
      fibre_grams: 4,
      sugars_grams: 5,
      saturated_fat_grams: 0.2,
      nutrition_quality_json: JSON.stringify({
        carbohydrate: 'reported',
        energy: 'reported',
        protein: 'reported',
        fat: 'reported',
        fibre: 'reported',
        sugars: 'reported',
        saturatedFat: 'reported',
      }),
      source_label: 'Open Food Facts',
      source_url: null,
      raw_payload_json: null,
      cached_at_ms: 1_000,
      // Simulates a row saved by an older build before TTLs were populated.
      expires_at_ms: null,
    });
    const now = 1_000 + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS;

    await expect(
      getFoodBarcodeCacheEntry('5000157071644', now),
    ).resolves.toMatchObject({
      status: 'stale',
      cachedAt: 1_000,
      expiresAt: now,
      food: { name: 'Baked beans' },
    });
    await expect(
      getCachedFoodByBarcode('5000157071644', now),
    ).resolves.toBeUndefined();
  });

  it('keeps an unexpired provider row fresh', async () => {
    const cachedAt = 10_000;
    database.getFirstAsync.mockResolvedValue({
      id: 'open-food-facts:5000157071644',
      provider: 'open-food-facts',
      external_id: '5000157071644',
      barcode: '5000157071644',
      name: 'Baked beans',
      brand: null,
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      default_serving_amount: 100,
      default_serving_unit: 'g',
      last_portion_amount: null,
      last_portion_unit: null,
      carbohydrate_grams: 12,
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
      cached_at_ms: cachedAt,
      expires_at_ms: cachedAt + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    });

    await expect(
      getFoodBarcodeCacheEntry('5000157071644', cachedAt + 1),
    ).resolves.toMatchObject({ status: 'fresh' });
  });

  it('treats a future-dated provider cache row as stale after clock rollback', async () => {
    const cachedAt = 20_000;
    database.getFirstAsync.mockResolvedValue({
      id: 'open-food-facts:5000157071644',
      provider: 'open-food-facts',
      external_id: '5000157071644',
      barcode: '5000157071644',
      name: 'Baked beans',
      brand: null,
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      default_serving_amount: 100,
      default_serving_unit: 'g',
      last_portion_amount: null,
      last_portion_unit: null,
      carbohydrate_grams: 12,
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
      cached_at_ms: cachedAt,
      expires_at_ms: cachedAt + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    });

    await expect(
      getFoodBarcodeCacheEntry('5000157071644', cachedAt - 1),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('revalidates an Open Food Facts barcode after country or language changes', async () => {
    const cachedAt = 10_000;
    database.getFirstAsync.mockResolvedValue({
      id: 'open-food-facts:5000157071644',
      provider: 'open-food-facts',
      external_id: '5000157071644',
      barcode: '5000157071644',
      name: 'Baked beans',
      brand: null,
      image_url: null,
      basis_amount: 100,
      basis_unit: 'g',
      default_serving_amount: 100,
      default_serving_unit: 'g',
      last_portion_amount: null,
      last_portion_unit: null,
      carbohydrate_grams: 12,
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
      raw_payload_json: JSON.stringify({
        _t1arcRegionalContext: { countryCode: 'GB', languageTag: 'en' },
      }),
      cached_at_ms: cachedAt,
      expires_at_ms: cachedAt + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    });

    await expect(
      getFoodBarcodeCacheEntry('5000157071644', cachedAt + 1, {
        countryCode: 'GB',
        languageTag: 'en-GB',
      }),
    ).resolves.toMatchObject({ status: 'fresh', regionalMatch: true });
    await expect(
      getFoodBarcodeCacheEntry('5000157071644', cachedAt + 1, {
        countryCode: 'US',
        languageTag: 'en-US',
      }),
    ).resolves.toMatchObject({ status: 'stale', regionalMatch: false });
  });
});
