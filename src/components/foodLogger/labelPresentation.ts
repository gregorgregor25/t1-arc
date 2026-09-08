import type { FoodLabelDraft } from '@/data/food/foodLabelCapture';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import { formatRegionalNumberInput } from '@/domain/regionalNumberInput';
import type { CustomFoodForm } from './myFoodPresentation';

/** Applying one reviewed label replaces its nutrients, never merges two different labels. */
export function customFoodFormFromLabelDraft(current: CustomFoodForm, draft: FoodLabelDraft, regional: Pick<T1ArcRegionalDefaults, 'locale' | 'energyUnit'>): CustomFoodForm {
  const input = (value: number | undefined) => value === undefined ? '' : formatRegionalNumberInput(value, regional.locale, 2);
  const fields = draft.fields;
  const displayed = {
    name: current.name,
    brand: current.brand,
    serving: input(fields.serving),
    unit: fields.unit ?? 'g' as const,
    carbs: input(fields.carbs),
    energy: input(fields.energyKcal === undefined ? undefined : fields.energyKcal * (regional.energyUnit === 'kJ' ? 4.184 : 1)),
    protein: input(fields.protein),
    fat: input(fields.fat),
    fibre: input(fields.fibre),
  };
  return {
    ...displayed,
    canonicalBaseline: fields.serving && fields.unit ? {
      displayed,
      servingAmount: fields.serving,
      servingUnit: fields.unit,
      nutritionPerServing: { carbohydrateGrams: fields.carbs, energyKcal: fields.energyKcal, proteinGrams: fields.protein, fatGrams: fields.fat, fibreGrams: fields.fibre },
    } : undefined,
  };
}
