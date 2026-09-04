import { describe, expect, it } from 'vitest';

import {
  OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
  retainedFoodCatalogData,
} from '@/data/food/providerRetention';
import { FoodCandidate } from '@/data/food/types';

const baseFood: FoodCandidate = {
  id: 'open-food-facts:12345678',
  provider: 'open-food-facts',
  externalId: '12345678',
  name: 'Cereal bar',
  basisAmount: 100,
  basisUnit: 'g',
  nutritionPerBasis: { carbohydrateGrams: 62 },
  nutritionQuality: {
    carbohydrate: 'reported',
    energy: 'missing',
    protein: 'missing',
    fat: 'missing',
    fibre: 'missing',
    sugars: 'missing',
    saturatedFat: 'missing',
  },
  servingLabel: '1 bar (27.5 g)',
  sourceLabel: 'Open Food Facts',
  rawPayload: {
    serving_size: '1 bar (27.5 g)',
    ingredients_text: 'Provider response not needed after normalization',
    unrelated: { nested: true },
  },
};

describe('food provider retention policy', () => {
  it('retains only normalized serving metadata from a remote catalogue payload', () => {
    expect(retainedFoodCatalogData(baseFood, 1_000)).toEqual({
      rawPayloadJson: JSON.stringify({ serving_size: '1 bar (27.5 g)' }),
      expiresAt: 1_000 + OPEN_FOOD_FACTS_CATALOG_CACHE_TTL_MS,
    });
  });

  it('retains locally authored metadata but no CoFID provider payload', () => {
    const localPayload = { createdAt: 123, enteredOnDevice: true };
    expect(
      JSON.parse(
        retainedFoodCatalogData(
          {
            ...baseFood,
            id: 'user:bar',
            provider: 'user',
            sourceLabel: 'My foods',
            rawPayload: localPayload,
          },
          1_000,
        ).rawPayloadJson!,
      ),
    ).toEqual(localPayload);
    expect(
      retainedFoodCatalogData(
        {
          ...baseFood,
          id: 'cofid:bar',
          provider: 'cofid',
          sourceLabel: 'CoFID',
        },
        1_000,
      ).rawPayloadJson,
    ).toBeNull();
  });

  it('does not retain a remote payload disguised behind a user identity', () => {
    expect(
      retainedFoodCatalogData(
        {
          ...baseFood,
          id: 'user:bar',
          provider: 'user',
          sourceLabel: 'My foods',
          rawPayload: {
            product_name: 'Remote bar',
            nutriments: { carbohydrates_100g: 60 },
          },
        },
        1_000,
      ).rawPayloadJson,
    ).toBeNull();
  });
});
