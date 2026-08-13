import { describe, expect, it, vi } from 'vitest';

import {
  FoodLookupError,
  OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS,
  lookupOpenFoodFactsBarcode,
  normaliseFoodSearchQuery,
  normaliseFoodBarcode,
  parseOpenFoodFactsProduct,
  parseOpenFoodFactsSearchResponse,
  searchOpenFoodFactsProducts,
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

  it('uses a labelled package serving when structured quantity is absent', () => {
    expect(
      parseOpenFoodFactsProduct('12345678', {
        status: 'success',
        product: {
          code: '12345678',
          product_name: 'Cereal bar',
          serving_size: '1 bar (27.5 g)',
          nutrition_data_per: '100g',
          nutriments: { carbohydrates_100g: 62 },
        },
      }),
    ).toMatchObject({
      defaultServingAmount: 27.5,
      defaultServingUnit: 'g',
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
      'User-Agent':
        'T1Arc/1.6.9 (https://github.com/gregorgregor25/daymark)',
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries one transport failure without retrying service responses', async () => {
    const recoveringFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(productFixture), { status: 200 }),
      );
    await expect(
      lookupOpenFoodFactsBarcode('3017624010701', recoveringFetch),
    ).resolves.toMatchObject({ name: 'Nutella' });
    expect(recoveringFetch).toHaveBeenCalledTimes(2);

    const unavailableFetch = vi.fn(async () =>
      new Response('Unavailable', { status: 503 }),
    );
    await expect(
      lookupOpenFoodFactsBarcode('3017624010701', unavailableFetch),
    ).rejects.toMatchObject({ code: 'service' });
    expect(unavailableFetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled request and returns a bounded network error', async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      );
      const lookup = lookupOpenFoodFactsBarcode(
        '3017624010701',
        stalledFetch,
      );
      const rejection = expect(lookup).rejects.toMatchObject({
        code: 'network',
      });

      await vi.advanceTimersByTimeAsync(
        OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS + 250,
      );
      await vi.advanceTimersByTimeAsync(
        OPEN_FOOD_FACTS_REQUEST_TIMEOUT_MS,
      );
      await rejection;
      expect(stalledFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps branded search hits and drops unusable or duplicate products', () => {
    expect(
      parseOpenFoodFactsSearchResponse({
        hits: [
          {
            code: '5000157071644',
            product_name: 'Heinz Baked Beans',
            brands: ['Heinz'],
            nutriments: { carbohydrates_100g: 12.5 },
          },
          {
            code: '5000157071644',
            product_name: 'Duplicate',
            nutriments: { carbohydrates_100g: 12.5 },
          },
          {
            code: 'no-carbs',
            product_name: 'Incomplete food',
            nutriments: {},
          },
          { code: 'no-name', nutriments: { carbohydrates_100g: 1 } },
        ],
      }),
    ).toMatchObject([
      {
        id: 'open-food-facts:5000157071644',
        name: 'Heinz Baked Beans',
        brand: 'Heinz',
        nutritionPerBasis: { carbohydrateGrams: 12.5 },
      },
    ]);
  });

  it('searches only after an explicit complete query and limits fields', async () => {
    expect(normaliseFoodSearchQuery('  baked   beans ')).toBe(
      'baked beans',
    );
    expect(() => normaliseFoodSearchQuery('a')).toThrow(FoodLookupError);

    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hits: [
            {
              code: '5000157071644',
              product_name: 'Heinz Baked Beans',
              brands: ['Heinz'],
              nutriments: { carbohydrates_100g: 12.5 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const results = await searchOpenFoodFactsProducts(
      'baked beans',
      fetcher,
    );
    expect(results).toHaveLength(1);
    const calls = fetcher.mock.calls as unknown as Array<
      [RequestInfo | URL, RequestInit?]
    >;
    const [url, options] = calls[0]!;
    expect(String(url)).toBe('https://search.openfoodfacts.org/search');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'User-Agent':
        'T1Arc/1.6.9 (https://github.com/gregorgregor25/daymark)',
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      q: 'baked beans countries_tags:"en:united-kingdom"',
      page_size: 20,
      boost_phrase: true,
      langs: ['en'],
      sort_by: 'popularity_key',
    });
    expect(JSON.parse(String(options?.body)).fields).toContain(
      'nutriments',
    );
  });
});
