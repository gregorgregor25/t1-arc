import type { MealEvent } from './models';
import { formatEnergy, formatRegionalNumber } from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

export type MealNutrientField =
  | 'carbsGrams'
  | 'energyKcal'
  | 'proteinGrams'
  | 'fatGrams'
  | 'fibreGrams'
  | 'sugarsGrams'
  | 'saturatedFatGrams';

const ITEM_NUTRIENT_FIELDS: Record<
  MealNutrientField,
  | 'carbohydrateGrams'
  | 'energyKcal'
  | 'proteinGrams'
  | 'fatGrams'
  | 'fibreGrams'
  | 'sugarsGrams'
  | 'saturatedFatGrams'
> = {
  carbsGrams: 'carbohydrateGrams',
  energyKcal: 'energyKcal',
  proteinGrams: 'proteinGrams',
  fatGrams: 'fatGrams',
  fibreGrams: 'fibreGrams',
  sugarsGrams: 'sugarsGrams',
  saturatedFatGrams: 'saturatedFatGrams',
};

export function mealNutrientItemCoverage(
  meal: MealEvent,
  nutrient: MealNutrientField,
) {
  if (meal.nutritionDetail !== 'itemized' || !meal.items?.length) {
    return undefined;
  }
  const itemField = ITEM_NUTRIENT_FIELDS[nutrient];
  return {
    knownCount: meal.items.filter((item) => {
      const value = item[itemField];
      return typeof value === 'number' && Number.isFinite(value);
    }).length,
    recordCount: meal.items.length,
  };
}

export function mealNutrientIsPartial(
  meal: MealEvent,
  nutrient: MealNutrientField,
) {
  const coverage = mealNutrientItemCoverage(meal, nutrient);
  return Boolean(
    coverage && coverage.knownCount < coverage.recordCount,
  );
}

function amount(value: number, maximumFractionDigits = 1) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits,
  });
}

export function mealNutritionParts(meal: MealEvent) {
  const part = (
    nutrient: MealNutrientField,
    value: number | undefined,
    label: string,
    digits = 1,
  ) =>
    value === undefined
      ? undefined
      : `${amount(value, digits)} ${label}${
          mealNutrientIsPartial(meal, nutrient) ? ' (partial)' : ''
        }`;
  return [
    part('carbsGrams', meal.carbsGrams, 'g carbohydrate'),
    meal.energyKcal === undefined
      ? undefined
      : `${formatEnergy(meal.energyKcal, getRuntimeRegionalDefaults())}${
          mealNutrientIsPartial(meal, 'energyKcal') ? ' (partial)' : ''
        }`,
    part('proteinGrams', meal.proteinGrams, 'g protein'),
    part('fatGrams', meal.fatGrams, 'g fat'),
    part('fibreGrams', meal.fibreGrams, 'g fibre'),
    part('sugarsGrams', meal.sugarsGrams, 'g sugars'),
    part(
      'saturatedFatGrams',
      meal.saturatedFatGrams,
      'g saturated fat',
    ),
  ].filter((part): part is string => Boolean(part));
}

export function mealItemNames(meal: MealEvent, limit = 3) {
  if (meal.nutritionDetail !== 'itemized' || !meal.items?.length) return [];
  const names = meal.items
    .map((item) => item.name.trim())
    .filter(Boolean);
  const visible = names.slice(0, Math.max(0, limit));
  return names.length > visible.length
    ? [
        ...visible,
        `and ${amount(names.length - visible.length, 0)} more`,
      ]
    : visible;
}

export function mealNutritionSummary(
  meal: MealEvent,
  options: { includeItems?: boolean; maxItems?: number } = {},
) {
  const nutrition = mealNutritionParts(meal);
  const items = options.includeItems
    ? mealItemNames(meal, options.maxItems)
    : [];
  return [
    ...(nutrition.length ? nutrition : ['Nutrition record']),
    ...(items.length ? [`items: ${items.join(', ')}`] : []),
  ].join(' · ');
}
