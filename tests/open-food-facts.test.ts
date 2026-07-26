import { describe, expect, it, vi } from 'vitest';

import {
  FoodLookupError,
  lookupOpenFoodFactsBarcode,
  normaliseFoodBarcode,
  parseOpenFoodFactsProduct,
} from '@/data/food/openFoodFacts';

const productFixture = {
  status: 'success',
  result: { id: 'product_found' },
  product: {
    code: '3017624010701',
    product_name: 'Nutella',
    brands: 'Ferrero',
    serving_quantity: 15,
    serving_quantity_unit: 'g',
    nutrition_data_per: '100g',
    nutriments: {
      carbohydrates_100g: 57.5,
      'energy-kcal_100g': 539,
      proteins_100g: 6.3,
      fat_100g: 30.9,
      sugars_100g: 56.3,
      'saturated-fat_100g': 10.6,
    },
  },
};

describe('Open Food Facts barcode adapter', () => {
  it('normalises whitespace without losing leading zeroes', () => {
    expect(normaliseFoodBarcode(' 0034-0004-70693 ')).toBe(
      '0034000470693',
    );
    expect(() => normaliseFoodBarcode('not-a-code')).toThrow(
      FoodLookupError,
    );
  });

  it('maps a product into the provider-neutral food contract', () => {
    expect(
      parseOpenFoodFactsProduct('3017624010701', productFixture),
    ).toMatchObject({
      id: 'open-food-facts:3017624010701',
      provider: 'open-food-facts',
      name: 'Nutella',
      brand: 'Ferrero',
      basisAmount: 100,
      basisUnit: 'g',
      defaultServingAmount: 15,
      nutritionPerBasis: {
        carbohydrateGrams: 57.5,
        energyKcal: 539,
      },
      nutritionQuality: {
        carbohydrate: 'reported',
        fibre: 'missing',
      },
    });
  });

  it('distinguishes a missing product from a network failure', async () => {
    const notFoundFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          result: { id: 'product_not_found' },
        }),
        { status: 200 },
      ),
    );
    await expect(
      lookupOpenFoodFactsBarcode('3017624010701', notFoundFetch),
    ).rejects.toMatchObject({ code: 'not_found' });

    const offlineFetch = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      lookupOpenFoodFactsBarcode('3017624010701', offlineFetch),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('requests only the fields needed by the logger', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(productFixture), { status: 200 }),
    );
    await lookupOpenFoodFactsBarcode('3017624010701', fetcher);
    const calls = fetcher.mock.calls as unknown as Array<
      [RequestInfo | URL, RequestInit?]
    >;
    const [url, options] = calls[0]!;
    expect(String(url)).toContain('/api/v3/product/3017624010701');
    expect(String(url)).toContain('fields=');
    expect(options?.headers).toMatchObject({
      Accept: 'application/json',
    });
  });
});
