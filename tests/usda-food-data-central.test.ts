import { describe, expect, it, vi } from 'vitest';

import {
  lookupFoodDataCentralBarcode,
  parseFoodDataCentralFood,
  searchFoodDataCentralFoods,
  shouldTryFoodDataCentralBarcodeFallback,
} from '@/data/food/usdaFoodDataCentral';
import { FoodLookupError } from '@/data/food/openFoodFacts';

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
