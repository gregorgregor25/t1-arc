import type { MealEvent } from '@/domain/models';

export type FoodDiaryMealFilter = 'all' | MealEvent['mealType'];

export interface FoodDiaryMealSlotSummary {
  count: number;
  carbohydrateGrams?: number;
  hasUnknownCarbohydrate: boolean;
}

export type FoodDiaryMealSummary = Record<
  Exclude<FoodDiaryMealFilter, 'all'>,
  FoodDiaryMealSlotSummary
>;

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export function summarizeFoodDiaryMeals(
  meals: readonly MealEvent[],
): FoodDiaryMealSummary {
  const summary = Object.fromEntries(
    mealTypes.map((mealType) => [
      mealType,
      { count: 0, carbohydrateGrams: undefined, hasUnknownCarbohydrate: false },
    ]),
  ) as FoodDiaryMealSummary;

  for (const meal of meals) {
    const slot = summary[meal.mealType];
    slot.count += 1;
    if (meal.carbsGrams === undefined) {
      slot.hasUnknownCarbohydrate = true;
    } else {
      slot.carbohydrateGrams = (slot.carbohydrateGrams ?? 0) + meal.carbsGrams;
    }
  }
  return summary;
}

export function filterFoodDiaryMeals(
  meals: readonly MealEvent[],
  filter: FoodDiaryMealFilter,
) {
  return filter === 'all'
    ? [...meals]
    : meals.filter((meal) => meal.mealType === filter);
}
