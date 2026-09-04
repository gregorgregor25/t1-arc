import {
  FoodLogItemDraft,
  FoodNutrition,
} from './types';

const NUTRIENT_KEYS: (keyof FoodNutrition)[] = [
  'carbohydrateGrams',
  'energyKcal',
  'proteinGrams',
  'fatGrams',
  'fibreGrams',
  'sugarsGrams',
  'saturatedFatGrams',
];

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

export function nutritionForFoodAmount(item: FoodLogItemDraft): FoodNutrition {
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    throw new Error('Food amount must be greater than zero.');
  }
  if (item.unit !== item.food.basisUnit) {
    throw new Error(
      `This food is measured in ${item.food.basisUnit}, not ${item.unit}.`,
    );
  }

  const multiplier = item.amount / item.food.basisAmount;
  const nutrition: FoodNutrition = {};
  for (const key of NUTRIENT_KEYS) {
    const value = item.food.nutritionPerBasis[key];
    if (value !== undefined) {
      nutrition[key] = rounded(value * multiplier);
    }
  }
  return nutrition;
}

export function totalNutrition(
  items: FoodLogItemDraft[],
): FoodNutrition {
  const total: FoodNutrition = {};
  for (const item of items) {
    const nutrition = nutritionForFoodAmount(item);
    for (const key of NUTRIENT_KEYS) {
      const value = nutrition[key];
      if (value !== undefined) {
        total[key] = rounded((total[key] ?? 0) + value);
      }
    }
  }
  return total;
}

export function scaleNutrition(
  nutrition: FoodNutrition,
  multiplier: number,
): FoodNutrition {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('Food amount must be greater than zero.');
  }
  const scaled: FoodNutrition = {};
  for (const key of NUTRIENT_KEYS) {
    const value = nutrition[key];
    if (value !== undefined) scaled[key] = rounded(value * multiplier);
  }
  return scaled;
}

export function sumNutrition(
  nutrition: FoodNutrition[],
): FoodNutrition {
  const total: FoodNutrition = {};
  for (const item of nutrition) {
    for (const key of NUTRIENT_KEYS) {
      const value = item[key];
      if (value !== undefined) {
        total[key] = rounded((total[key] ?? 0) + value);
      }
    }
  }
  return total;
}
