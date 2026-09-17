import type { MealEvent } from '@/domain/models';

export type FoodDiaryMealFilter = 'all' | 'hypo-treatment' | MealEvent['mealType'];

export interface FoodDiaryMealSlotSummary {
  count: number;
  carbohydrateGrams?: number;
  hasUnknownCarbohydrate: boolean;
}

export type FoodDiaryMealSummary = Record<
  MealEvent['mealType'],
  FoodDiaryMealSlotSummary
> & { 'hypo-treatment'?: FoodDiaryMealSlotSummary };

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
    const key = meal.purpose === 'hypo-treatment' ? 'hypo-treatment' : meal.mealType;
    const slot = summary[key] ??= { count: 0, carbohydrateGrams: undefined, hasUnknownCarbohydrate: false };
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
    : meals.filter((meal) => filter === 'hypo-treatment' ? meal.purpose === 'hypo-treatment' : meal.purpose !== 'hypo-treatment' && meal.mealType === filter);
}
