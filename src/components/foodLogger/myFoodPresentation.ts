import {
  canonicalFoodBasisUnit,
  defaultFoodInputUnit,
  foodAmountFromCanonical,
  foodAmountToCanonical,
  foodInputUnits,
  type FoodInputUnit,
} from '@/data/food/foodMeasurement';
import type {
  FoodBasisUnit,
  FoodCandidate,
  FoodNutrition,
  UserFoodDraft,
} from '@/data/food/types';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from '@/domain/regionalNumberInput';

interface CustomFoodEditableValues {
  name: string;
  brand: string;
  serving: string;
  unit: FoodInputUnit;
  carbs: string;
  energy: string;
  protein: string;
  fat: string;
  fibre: string;
}

interface CustomFoodCanonicalBaseline {
  displayed: CustomFoodEditableValues;
  servingAmount: number;
  servingUnit: FoodCandidate['basisUnit'];
  nutritionPerServing: FoodNutrition;
}

export interface CustomFoodForm extends CustomFoodEditableValues {
  /**
   * Hidden edit baseline. If a displayed, rounded field is not changed, saving
   * reuses its exact canonical value instead of round-tripping through UI text.
   */
  canonicalBaseline?: CustomFoodCanonicalBaseline;
}

export const EMPTY_CUSTOM_FOOD: CustomFoodForm = {
  name: '',
  brand: '',
  serving: '100',
  unit: 'g',
  carbs: '',
  energy: '',
  protein: '',
  fat: '',
  fibre: '',
};

/** Mass and volume cannot be converted without a food-specific density. */
export function myFoodSelectionUnitIsCompatible(
  currentUnit: FoodInputUnit,
  nextBasisUnit: FoodBasisUnit,
) {
  return foodInputUnits(nextBasisUnit).includes(currentUnit);
}

function inputNumber(value: number, locale: string) {
  return formatRegionalNumberInput(value, locale, 2);
}

function formNumber(value: string, locale: string) {
  return normalizeRegionalNumberInput(value, locale)?.value ?? Number.NaN;
}

function optionalFormNumber(value: string, locale: string) {
  return value.trim() ? formNumber(value, locale) : undefined;
}

function exactOrParsedNutrition(
  form: CustomFoodForm,
  key: 'carbs' | 'energy' | 'protein' | 'fat' | 'fibre',
  canonicalKey: keyof Pick<
    FoodNutrition,
    'carbohydrateGrams' | 'energyKcal' | 'proteinGrams' | 'fatGrams' | 'fibreGrams'
  >,
  parsed: number | undefined,
) {
  const baseline = form.canonicalBaseline;
  return baseline && form[key] === baseline.displayed[key]
    ? baseline.nutritionPerServing[canonicalKey]
    : parsed;
}

/** Converts canonical stored values only for display in the regional edit form. */
export function customFoodFormFromCandidate(
  food: FoodCandidate,
  regional: Pick<
    T1ArcRegionalDefaults,
    'countryCode' | 'measurementSystem' | 'energyUnit' | 'locale'
  >,
): CustomFoodForm {
  const unit = defaultFoodInputUnit(food.basisUnit, regional);
  const inputOptional = (value: number | undefined) =>
    value === undefined ? '' : inputNumber(value, regional.locale);
  const displayed: CustomFoodEditableValues = {
    name: food.name,
    brand: food.brand ?? '',
    serving: inputNumber(
      foodAmountFromCanonical(food.basisAmount, unit, regional.countryCode),
      regional.locale,
    ),
    unit,
    carbs: inputOptional(food.nutritionPerBasis.carbohydrateGrams),
    energy: inputOptional(
      food.nutritionPerBasis.energyKcal === undefined
        ? undefined
        : regional.energyUnit === 'kJ'
          ? food.nutritionPerBasis.energyKcal * 4.184
          : food.nutritionPerBasis.energyKcal,
    ),
    protein: inputOptional(food.nutritionPerBasis.proteinGrams),
    fat: inputOptional(food.nutritionPerBasis.fatGrams),
    fibre: inputOptional(food.nutritionPerBasis.fibreGrams),
  };
  return {
    ...displayed,
    canonicalBaseline: {
      displayed,
      servingAmount: food.basisAmount,
      servingUnit: food.basisUnit,
      nutritionPerServing: { ...food.nutritionPerBasis },
    },
  };
}

/** Builds a canonical repository draft while preserving unchanged edit values exactly. */
export function customFoodDraftFromForm(
  form: CustomFoodForm,
  barcode: string,
  regional: Pick<T1ArcRegionalDefaults, 'countryCode' | 'energyUnit' | 'locale'>,
): UserFoodDraft {
  const baseline = form.canonicalBaseline;
  const servingUnchanged = Boolean(
    baseline &&
      form.serving === baseline.displayed.serving &&
      form.unit === baseline.displayed.unit,
  );
  const displayedEnergy = optionalFormNumber(form.energy, regional.locale);
  const parsedEnergyKcal = displayedEnergy === undefined
    ? undefined
    : regional.energyUnit === 'kJ'
      ? displayedEnergy / 4.184
      : displayedEnergy;

  return {
    name: form.name,
    brand: form.brand || undefined,
    barcode: barcode || undefined,
    servingAmount: servingUnchanged
      ? baseline!.servingAmount
      : foodAmountToCanonical(
          formNumber(form.serving, regional.locale),
          form.unit,
          regional.countryCode,
        ),
    servingUnit: servingUnchanged
      ? baseline!.servingUnit
      : canonicalFoodBasisUnit(form.unit),
    nutritionPerServing: {
      ...baseline?.nutritionPerServing,
      carbohydrateGrams: exactOrParsedNutrition(
        form,
        'carbs',
        'carbohydrateGrams',
        optionalFormNumber(form.carbs, regional.locale),
      ),
      energyKcal: exactOrParsedNutrition(
        form,
        'energy',
        'energyKcal',
        parsedEnergyKcal,
      ),
      proteinGrams: exactOrParsedNutrition(
        form,
        'protein',
        'proteinGrams',
        optionalFormNumber(form.protein, regional.locale),
      ),
      fatGrams: exactOrParsedNutrition(
        form,
        'fat',
        'fatGrams',
        optionalFormNumber(form.fat, regional.locale),
      ),
      fibreGrams: exactOrParsedNutrition(
        form,
        'fibre',
        'fibreGrams',
        optionalFormNumber(form.fibre, regional.locale),
      ),
    },
  };
}
