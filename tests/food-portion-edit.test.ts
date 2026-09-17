import { describe, expect, it } from 'vitest';

import { adjustedFoodLogPortions } from '@/data/food/portionAdjustments';
import { FoodLog } from '@/data/food/types';

const log: FoodLog = {
  id: 'food-log:1',
  contextEventId: 't1arc-food:meal:1',
  timestamp: 1_700_000_000_000,
  mealType: 'lunch',
  title: 'Lunch · 2 items',
  nutrition: {
    carbohydrateGrams: 30,
    energyKcal: 240,
    proteinGrams: 9,
  },
  createdAt: 1_700_000_000_100,
  items: [
    {
      id: 'food-log:1:item:0',
      foodId: 'food:one',
      provider: 'cofid',
      externalId: 'one',
      name: 'First food',
      amount: 100,
      unit: 'g',
      nutrition: {
        carbohydrateGrams: 20,
        energyKcal: 100,
        proteinGrams: 4,
      },
      sourceLabel: 'CoFID',
    },
    {
      id: 'food-log:1:item:1',
      foodId: 'food:two',
      provider: 'user',
      externalId: 'two',
      name: 'Second food',
      amount: 50,
      unit: 'g',
      nutrition: {
        carbohydrateGrams: 10,
        energyKcal: 140,
        proteinGrams: 5,
      },
      sourceLabel: 'Personal food',
    },
  ],
};

describe('food portion edits', () => {
  it('scales each immutable source snapshot and reconciles meal totals', () => {
    const adjusted = adjustedFoodLogPortions(log, {
      'food-log:1:item:0': 150,
      'food-log:1:item:1': 25,
    });

    expect(adjusted.items[0]).toMatchObject({
      amount: 150,
      nutrition: {
        carbohydrateGrams: 30,
        energyKcal: 150,
        proteinGrams: 6,
      },
    });
    expect(adjusted.items[1]).toMatchObject({
      amount: 25,
      nutrition: {
        carbohydrateGrams: 5,
        energyKcal: 70,
        proteinGrams: 2.5,
      },
    });
    expect(adjusted.nutrition).toEqual({
      carbohydrateGrams: 35,
      energyKcal: 220,
      proteinGrams: 8.5,
    });
    expect(log.items[0]?.amount).toBe(100);
  });

  it('rejects missing, zero and implausibly large amounts', () => {
    expect(() =>
      adjustedFoodLogPortions(log, {
        'food-log:1:item:0': 0,
        'food-log:1:item:1': 50,
      }),
    ).toThrow('between 0 and 10,000');
    expect(() =>
      adjustedFoodLogPortions(log, {
        'food-log:1:item:0': 100,
      }),
    ).toThrow('between 0 and 10,000');
  });
});
