import { describe, expect, it, vi } from 'vitest';

import {
  lookupFoodDataCentralBarcode,
  parseFoodDataCentralFood,
  searchFoodDataCentralFoods,
  shouldTryFoodDataCentralBarcodeFallback,
} from '@/data/food/usdaFoodDataCentral';
import { FoodLookupError } from '@/data/food/openFoodFacts';
import rawBrandedFixture from './fixtures/usda-branded-cheerios-2026-04.json';

const fixture = {
  fdcId: 123456,
  description: 'PEANUT BUTTER, CREAMY',
  dataType: 'Branded',
  brandOwner: 'Example Foods',
  gtinUpc: '00012345678905',
  servingSize: 32,
  servingSizeUnit: 'g',
  householdServingFullText: '2 tbsp (32 g)',
  foodNutrients: [
    { nutrientId: 1005, value: 20 },
    { nutrientId: 1008, value: 600 },
    { nutrientId: 1003, value: 25 },
    { nutrientId: 1004, value: 50 },
    { nutrientId: 1079, value: 6 },
    { nutrientId: 2000, value: 9 },
    { nutrientId: 1258, value: 10 },
  ],
};

describe('USDA FoodData Central adapter', () => {
  it('preserves equivalent zero-padded GTIN identities', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ foods: [{ ...fixture, gtinUpc: '0012345678905' }] }), { status: 200 }));
    await expect(lookupFoodDataCentralBarcode('012345678905', fetchImpl)).resolves.toMatchObject({ barcode: '012345678905' });
    await expect(lookupFoodDataCentralBarcode('012345678906', fetchImpl)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('retains USDA reported energy and falls back to specific then general Atwater values', () => {
    const nutrients = [{ nutrientId: 1005, value: 10 }, { nutrientId: 2047, value: 70 }, { nutrientId: 2048, value: 65 }];
    const parsed = parseFoodDataCentralFood({ ...fixture, foodNutrients: nutrients });
    expect(parsed.nutritionPerBasis.energyKcal).toBe(65);
    expect(parsed.nutrientDefinitions).toMatchObject({ carbohydrate: 'total', energy: 'atwater-specific' });
    expect(parseFoodDataCentralFood({ ...fixture, foodNutrients: [...nutrients, { nutrientId: 1008, value: 0 }] }).nutritionPerBasis.energyKcal).toBe(0);
    expect(parseFoodDataCentralFood({ ...fixture, foodNutrients: nutrients.slice(0, 2) }).nutritionPerBasis.energyKcal).toBe(70);
  });

  it('keeps reference-food nutrition per 100 g rather than relabelling it as a volume', () => {
    const parsed = parseFoodDataCentralFood({ ...fixture, dataType: 'Foundation', servingSize: 240, servingSizeUnit: 'ml', householdServingFullText: '1 cup' });
    expect(parsed.basisUnit).toBe('g');
    expect(parsed.servingLabel).toBeUndefined();
    expect(parsed.nutrientDefinitions?.note).toContain('240 ml');
  });

  it('uses labelled per-serving nutrients for a known volume without mixing 100g values', () => {
    const parsed = parseFoodDataCentralFood({ ...fixture, servingSize: 240, servingSizeUnit: 'ml', householdServingFullText: '1 cup', labelNutrients: { carbohydrates: { value: 12 }, calories: { value: 80 } } });
    expect(parsed).toMatchObject({ basisAmount: 240, basisUnit: 'ml', defaultServingAmount: 240, defaultServingUnit: 'ml', servingLabel: '1 cup', nutritionPerBasis: { carbohydrateGrams: 12, energyKcal: 80 } });
    expect(parsed.nutritionPerBasis.proteinGrams).toBeUndefined();
  });

  it.each(['ml', 'MLT'])('preserves branded standardized nutrition per 100 ml for source unit %s', (unit) => {
    const parsed = parseFoodDataCentralFood({ ...fixture, description: 'Example drink', servingSize: 240,
      servingSizeUnit: unit, householdServingFullText: '1 cup', foodNutrients: [
        { nutrientId: 1005, value: 5 }, { nutrientId: 1008, value: 35 },
      ] });
    expect(parsed).toMatchObject({ basisAmount: 100, basisUnit: 'ml', defaultServingAmount: 240,
      defaultServingUnit: 'ml', servingLabel: '1 cup', nutritionPerBasis: { carbohydrateGrams: 5, energyKcal: 35 } });
    expect(parsed.nutrientDefinitions?.note ?? '').not.toContain('per 100 g');
  });

  it.each(['g', 'GRM'])('normalizes branded gram unit %s without changing per-100 values', (unit) => {
    expect(parseFoodDataCentralFood({ ...fixture, servingSizeUnit: unit })).toMatchObject({
      basisAmount: 100, basisUnit: 'g', defaultServingAmount: 32, defaultServingUnit: 'g',
      nutritionPerBasis: { carbohydrateGrams: 20, energyKcal: 600 },
    });
  });

  it('does not guess the standardized branded basis from an unsupported serving unit', () => {
    expect(() => parseFoodDataCentralFood({ ...fixture, servingSizeUnit: 'FL OZ' })).toThrow(/gram or millilitre basis/);
  });

  it('rejects actual FDC2517161 conflicting carbohydrate values in bulk and live-search shapes', async () => {
    const conflicting = rawBrandedFixture.foods.find((food) => food.fdcId === 2517161)!;
    expect(conflicting.foodNutrients.filter((entry) => entry.nutrient.id === 1005).map((entry) => entry.amount))
      .toEqual([74.4, 74.4, 21.6]);
    expect(() => parseFoodDataCentralFood(conflicting)).toThrow(/conflicting carbohydrate/);
    const searchFood = { ...conflicting, foodNutrients: conflicting.foodNutrients.map((entry) => ({
      nutrientId: entry.nutrient.id, value: entry.amount,
    })) };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ foods: [searchFood] }), { status: 200 }));
    await expect(lookupFoodDataCentralBarcode(conflicting.gtinUpc, fetchImpl)).rejects.toMatchObject({ code: 'incomplete' });
    expect(() => parseFoodDataCentralFood(searchFood)).toThrow(/conflicting carbohydrate/);
  });

  it('retains actual FDC2738631 per-100 nutrition, and identical repeated rows do not create conflicts', () => {
    const consistent = rawBrandedFixture.foods.find((food) => food.fdcId === 2738631)!;
    const parsed = parseFoodDataCentralFood({ ...consistent,
      foodNutrients: [...consistent.foodNutrients, ...consistent.foodNutrients] });
    expect(parsed).toMatchObject({ basisAmount: 100, basisUnit: 'g', defaultServingAmount: 28,
      nutritionPerBasis: { carbohydrateGrams: 75, energyKcal: 357, proteinGrams: 14.3 },
      nutritionQuality: { carbohydrate: 'reported', energy: 'reported' } });
    expect(parsed.nutrientDefinitions?.note).toBeUndefined();
  });

  it.each([1008, 2048, 2047])('does not fall through a conflicting preferred energy ID %s', (preferredId) => {
    const lowerPriority = [1008, 2048, 2047].slice([1008, 2048, 2047].indexOf(preferredId) + 1)
      .map((nutrientId) => ({ nutrientId, value: 80 }));
    const parsed = parseFoodDataCentralFood({ ...fixture, foodNutrients: [
      { nutrientId: 1005, value: 20 }, { nutrientId: preferredId, value: 100 },
      { nutrientId: preferredId, value: 200 }, ...lowerPriority, { nutrientId: 1062, value: 418.4 },
    ] });
    expect(parsed.nutritionPerBasis.energyKcal).toBeUndefined();
    expect(parsed.nutritionQuality?.energy).toBe('missing');
    expect(parsed.nutrientDefinitions?.energy).toBeUndefined();
    expect(parsed.nutrientDefinitions?.note).toContain('Conflicting source values for energy');
  });

  it('keeps optional nutrient conflicts unknown, including legacy-number duplicates and kJ-only energy', () => {
    const parsed = parseFoodDataCentralFood({ ...fixture, foodNutrients: [
      { nutrientId: 1005, value: 20 },
      { nutrientId: 1003, value: 0 }, { nutrientNumber: '203', value: 5 },
      { nutrientId: 1004, value: 0 }, { nutrientId: 1004, value: 0 },
      { nutrientId: 1062, value: 100 }, { nutrientNumber: '268', value: 200 },
    ] });
    expect(parsed.nutritionPerBasis).toMatchObject({ carbohydrateGrams: 20, proteinGrams: undefined,
      fatGrams: 0, energyKcal: undefined });
    expect(parsed.nutritionQuality).toMatchObject({ protein: 'missing', fat: 'reported', energy: 'missing' });
  });

  it.each([1008, 1062])('does not conceal conflicting standard energy ID %s behind a volume label calorie field', (energyId) => {
    const parsed = parseFoodDataCentralFood({ ...fixture, servingSizeUnit: 'MLT', servingSize: 240,
      labelNutrients: { carbohydrates: { value: 12 }, calories: { value: 80 } }, foodNutrients: [
        { nutrientId: 1005, value: 5 }, { nutrientId: energyId, value: 30 }, { nutrientId: energyId, value: 60 },
      ] });
    expect(parsed).toMatchObject({ basisAmount: 240, basisUnit: 'ml', nutritionPerBasis: { carbohydrateGrams: 12, energyKcal: undefined } });
  });
  it('uses the shared demo-key fallback only for a genuine US barcode miss', () => {
    expect(
      shouldTryFoodDataCentralBarcodeFallback(
        'US',
        new FoodLookupError('not_found', 'missing'),
      ),
    ).toBe(true);
    expect(
      shouldTryFoodDataCentralBarcodeFallback(
        'GB',
        new FoodLookupError('not_found', 'missing'),
      ),
    ).toBe(false);

    for (const code of ['network', 'rate_limited', 'service', 'incomplete'] as const) {
      expect(
        shouldTryFoodDataCentralBarcodeFallback(
          'US',
          new FoodLookupError(code, code),
        ),
      ).toBe(false);
    }
  });

  it('maps public catalogue values into the canonical per-100g contract', () => {
    expect(parseFoodDataCentralFood(fixture)).toMatchObject({
      id: 'usda-fdc:123456',
      provider: 'usda-fdc',
      externalId: '123456',
      name: 'PEANUT BUTTER, CREAMY',
      brand: 'Example Foods',
      barcode: '00012345678905',
      basisAmount: 100,
      basisUnit: 'g',
      defaultServingAmount: 32,
      nutritionPerBasis: {
        carbohydrateGrams: 20,
        energyKcal: 600,
      },
      sourceLabel: 'USDA FoodData Central',
    });
  });

  it('searches only on deliberate calls and excludes incomplete nutrient rows', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          foods: [fixture, { fdcId: 7, description: 'NO CARB DATA' }],
        }),
        { status: 200 },
      ),
    );

    const result = await searchFoodDataCentralFoods('peanut butter', fetchImpl, {
      apiKey: 'test-key',
    });

    expect(result).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=test-key',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires an exact GTIN match for barcode fallback', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ foods: [fixture] }), { status: 200 }),
    );

    await expect(
      lookupFoodDataCentralBarcode('00012345678905', fetchImpl, {
        apiKey: 'test-key',
      }),
    ).resolves.toMatchObject({
      provider: 'usda-fdc',
      barcode: '00012345678905',
    });
  });
});
