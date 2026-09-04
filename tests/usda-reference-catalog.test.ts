import { describe, expect, it } from 'vitest';

import {
  getUsdaReferenceFood,
  searchUsdaReferenceFoods,
  USDA_REFERENCE_CATALOG_INFO,
} from '@/data/food/usdaReferenceCatalog';

describe('bundled USDA FoodData Central reference catalogue', () => {
  it('records reproducible official Foundation Foods and FNDDS sources', () => {
    expect(USDA_REFERENCE_CATALOG_INFO).toMatchObject({
      dataset: 'USDA FoodData Central',
      foodCount: 5_742,
      licence: 'CC0 1.0 Universal / US public domain',
      sources: [
        {
          dataType: 'Foundation Foods',
          release: '2026-04-30',
          archiveSha256:
            '186e988ec542e913f51ef62b86a47758e8cdd0d1dc3889e7b055581f3c09c77a',
          jsonSha256:
            '27d1fe3fd89edfbe528ed915da5619320e1d004d4594603a1b19bdb1511590cc',
          sourceRecordCount: 395,
        },
        {
          dataType: 'FNDDS',
          release: '2024-10-31',
          archiveSha256:
            'dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb',
          jsonSha256:
            '2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808',
          sourceRecordCount: 5_432,
        },
      ],
    });
  });

  it('finds common US foods locally with canonical per-100g nutrition', () => {
    const results = searchUsdaReferenceFoods('peanut butter', 20);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      provider: 'usda-fdc',
      basisAmount: 100,
      basisUnit: 'g',
      sourceLabel: 'USDA FoodData Central',
    });
    expect(results.every((food) => food.nutritionPerBasis.carbohydrateGrams !== undefined)).toBe(
      true,
    );
  });

  it('preserves official FDC identity and source links', () => {
    const hummus = searchUsdaReferenceFoods('hummus commercial', 1)[0];
    expect(hummus).toBeDefined();

    expect(getUsdaReferenceFood(hummus!.id)).toEqual(hummus);
    expect(hummus!.sourceUrl).toBe(
      `https://fdc.nal.usda.gov/food-details/${hummus!.externalId}/nutrients`,
    );
  });
});
