import type { FoodNutrition } from '@/data/food/types';
import { formatEnergy, formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

function rounded(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 1,
  });
}

export interface FoodNutritionPresentation {
  carbs: string;
  calories?: string;
  protein?: string;
  fat?: string;
  secondary: string;
}

/**
 * Keeps the logger's nutrient hierarchy consistent wherever a food or meal is
 * summarised: carbohydrate first, then quieter supporting macros.
 */
export function presentFoodNutrition(
  nutrition: FoodNutrition,
): FoodNutritionPresentation {
  const calories =
    nutrition.energyKcal === undefined
      ? undefined
      : formatEnergy(nutrition.energyKcal, getRuntimeRegionalDefaults());
  const protein =
    nutrition.proteinGrams === undefined
      ? undefined
      : `${rounded(nutrition.proteinGrams)} g protein`;
  const fat =
    nutrition.fatGrams === undefined
      ? undefined
      : `${rounded(nutrition.fatGrams)} g fat`;

  return {
    carbs:
      nutrition.carbohydrateGrams === undefined
        ? 'Not reported'
        : `${rounded(nutrition.carbohydrateGrams)} g carbs`,
    calories,
    protein,
    fat,
    secondary: [calories, protein, fat].filter(Boolean).join(' · '),
  };
}
