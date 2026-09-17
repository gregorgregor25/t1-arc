import { describe, expect, it } from 'vitest';

import {
  filterFoodDiaryMeals,
  summarizeFoodDiaryMeals,
} from '@/components/foodDiary/presentation';
import type { MealEvent } from '@/domain/models';

const meal = (
  id: string,
  mealType: MealEvent['mealType'],
  carbsGrams?: number,
): MealEvent => ({
  id,
  sourceId: 'test',
  sourceLabel: 'Test',
  origin: 'manual',
  kind: 'meal',
  start: 1,
  title: id,
  mealType,
  carbsGrams,
});

describe('food diary presentation', () => {
  const meals = [
    meal('breakfast', 'breakfast', 20),
    meal('lunch-a', 'lunch', 35),
    meal('lunch-b', 'lunch'),
    meal('snack', 'snack', 8),
  ];

  it('summarizes each meal slot without treating missing carbs as zero', () => {
    const summary = summarizeFoodDiaryMeals(meals);
    expect(summary.breakfast).toMatchObject({ count: 1, carbohydrateGrams: 20 });
    expect(summary.lunch).toEqual({
      count: 2,
      carbohydrateGrams: 35,
      hasUnknownCarbohydrate: true,
    });
    expect(summary.dinner).toEqual({
      count: 0,
      carbohydrateGrams: undefined,
      hasUnknownCarbohydrate: false,
    });
  });

  it('filters by a meal slot while preserving source order', () => {
    expect(filterFoodDiaryMeals(meals, 'lunch').map((entry) => entry.id)).toEqual([
      'lunch-a',
      'lunch-b',
    ]);
    expect(filterFoodDiaryMeals(meals, 'all')).toEqual(meals);
  });
});
