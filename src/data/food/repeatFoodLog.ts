import {
  FoodCandidate,
  FoodLog,
  FoodLogDraft,
  FoodNutrition,
  FoodNutritionQuality,
  NutrientQuality,
} from './types';

function quality(value: number | undefined): NutrientQuality {
  return value === undefined ? 'missing' : 'reported';
}

function nutritionQuality(
  nutrition: FoodNutrition,
): FoodNutritionQuality {
  return {
    carbohydrate: quality(nutrition.carbohydrateGrams),
    energy: quality(nutrition.energyKcal),
    protein: quality(nutrition.proteinGrams),
    fat: quality(nutrition.fatGrams),
    fibre: quality(nutrition.fibreGrams),
    sugars: quality(nutrition.sugarsGrams),
    saturatedFat: quality(nutrition.saturatedFatGrams),
  };
}

/**
 * Reconstructs a provider-neutral candidate from the immutable snapshot saved
 * with a meal. The original amount becomes the candidate basis, so repeating
 * it preserves the exact saved nutrition even if the external catalogue has
 * changed since the first log.
 */
export function repeatFoodLogDraft(
  log: FoodLog,
  timestamp: number,
): FoodLogDraft {
  return {
    timestamp,
    mealType: log.mealType,
    title: log.title,
    items: log.items.map((item) => {
      const food: FoodCandidate = {
        id: item.foodId,
        provider: item.provider,
        externalId: item.externalId,
        name: item.name,
        brand: item.brand,
        barcode: item.barcode,
        basisAmount: item.amount,
        basisUnit: item.unit,
        nutritionPerBasis: { ...item.nutrition },
        nutritionQuality: nutritionQuality(item.nutrition),
        defaultServingAmount: item.amount,
        defaultServingUnit: item.unit,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
      };
      return {
        food,
        amount: item.amount,
        unit: item.unit,
      };
    }),
  };
}
