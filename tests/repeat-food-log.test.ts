import { describe, expect, it } from 'vitest';

import { repeatFoodLogDraft } from '@/data/food/repeatFoodLog';
import { totalNutrition } from '@/data/food/nutrition';
import { FoodLog } from '@/data/food/types';

describe('repeat food log', () => {
  it('preserves saved portions, nutrients, source, and meal identity', () => {
    const original: FoodLog = {
      id: 'meal-1',
      contextEventId: 'context-1',
      timestamp: 1_000,
      mealType: 'breakfast',
      title: 'Usual breakfast',
      nutrition: {
        carbohydrateGrams: 41,
        energyKcal: 355,
      },
      items: [
        {
          id: 'item-1',
          foodId: 'open-food-facts:123',
          provider: 'open-food-facts',
          externalId: '123',
          name: 'Cereal',
          brand: 'Example',
          barcode: '123',
          amount: 45,
          unit: 'g',
          nutrition: {
            carbohydrateGrams: 31,
            energyKcal: 170,
          },
          sourceLabel: 'Open Food Facts',
          sourceUrl: 'https://example.test/123',
        },
        {
          id: 'item-2',
          foodId: 'cofid:milk',
          provider: 'cofid',
          externalId: 'milk',
          name: 'Milk',
          amount: 200,
          unit: 'ml',
          nutrition: {
            carbohydrateGrams: 10,
            energyKcal: 185,
          },
          sourceLabel: 'CoFID 2021',
        },
      ],
      createdAt: 2_000,
    };

    const draft = repeatFoodLogDraft(original, 9_999);

    expect(draft).toMatchObject({
      timestamp: 9_999,
      mealType: 'breakfast',
      title: 'Usual breakfast',
      items: [
        {
          amount: 45,
          unit: 'g',
          food: {
            id: 'open-food-facts:123',
            brand: 'Example',
            basisAmount: 45,
            nutritionPerBasis: { carbohydrateGrams: 31 },
            sourceLabel: 'Open Food Facts',
          },
        },
        {
          amount: 200,
          unit: 'ml',
          food: {
            id: 'cofid:milk',
            basisAmount: 200,
            nutritionPerBasis: { carbohydrateGrams: 10 },
          },
        },
      ],
    });
    expect(totalNutrition(draft.items)).toMatchObject({
      carbohydrateGrams: 41,
      energyKcal: 355,
    });
  });
});
