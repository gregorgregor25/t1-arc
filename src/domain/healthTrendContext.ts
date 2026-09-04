import type { HealthContextEvent, TimeRange } from './models';
import {
  mealNutrientIsPartial,
  type MealNutrientField,
} from './mealNutrition';

export type { MealNutrientField } from './mealNutrition';

export interface NutritionNutrientCoverage {
  knownCount: number;
  recordCount: number;
  /** Meals whose total is a known subtotal because at least one item omitted it. */
  partialCount?: number;
}

export type MealNutrientCoverage = Record<
  MealNutrientField,
  NutritionNutrientCoverage
>;

export function nutritionCoverageNeedsReview(
  coverage: NutritionNutrientCoverage,
) {
  return (
    coverage.knownCount < coverage.recordCount ||
    (coverage.partialCount ?? 0) > 0
  );
}

export interface HealthTrendContextSummary {
  mealCount: number;
  mealCarbsGrams?: number;
  mealEnergyKcal?: number;
  mealProteinGrams?: number;
  mealFatGrams?: number;
  mealFibreGrams?: number;
  mealSugarsGrams?: number;
  mealSaturatedFatGrams?: number;
  mealNutrientCoverage: MealNutrientCoverage;
  nutritionSourceLabels: string[];
  /** Cross-source records close enough in time to warrant duplicate review. */
  nutritionPossibleDuplicatePairs: number;
  medicationCount: number;
  hormoneRecordCount: number;
}

function summarizeNutrient(
  meals: Extract<HealthContextEvent, { kind: 'meal' }>[],
  nutrient: MealNutrientField,
) {
  const values = meals.flatMap((meal) => {
    const value = meal[nutrient];
    return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
  });
  const partialCount = meals.filter((meal) => {
    const value = meal[nutrient];
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      mealNutrientIsPartial(meal, nutrient)
    );
  }).length;
  return {
    total: values.length
      ? values.reduce((total, value) => total + value, 0)
      : undefined,
    coverage: {
      knownCount: values.length,
      recordCount: meals.length,
      ...(partialCount ? { partialCount } : {}),
    },
  };
}

function possibleDuplicateMealPairs(
  meals: Extract<HealthContextEvent, { kind: 'meal' }>[],
) {
  const sorted = [...meals].sort((left, right) => left.start - right.start);
  const nearDuplicateWindowMs = 15 * 60_000;
  let pairs = 0;
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sorted.length;
      rightIndex += 1
    ) {
      const right = sorted[rightIndex]!;
      if (right.start - left.start > nearDuplicateWindowMs) break;
      if (left.sourceId !== right.sourceId) pairs += 1;
    }
  }
  return pairs;
}

export function healthContextEventEnd(event: HealthContextEvent) {
  return (
    event.end ??
    ('durationMinutes' in event
      ? event.start + event.durationMinutes * 60_000
      : event.start)
  );
}

export function healthContextEventOverlapsRange(
  event: HealthContextEvent,
  range: TimeRange,
) {
  const end = healthContextEventEnd(event);
  if (end <= event.start) {
    return event.start >= range.start && event.start < range.end;
  }
  return event.start < range.end && end > range.start;
}

/**
 * Summarises only records that were actually logged. Zero means no matching
 * record was present, not that food, medication or hormone context was absent
 * from the person's day.
 */
export function summarizeHealthTrendContext(
  events: HealthContextEvent[],
  range: TimeRange,
): HealthTrendContextSummary {
  const inRange = events.filter((event) =>
    healthContextEventOverlapsRange(event, range),
  );
  const meals = inRange.filter(
    (event): event is Extract<HealthContextEvent, { kind: 'meal' }> =>
      event.kind === 'meal' &&
      event.start >= range.start &&
      event.start < range.end,
  );
  const carbs = summarizeNutrient(meals, 'carbsGrams');
  const energy = summarizeNutrient(meals, 'energyKcal');
  const protein = summarizeNutrient(meals, 'proteinGrams');
  const fat = summarizeNutrient(meals, 'fatGrams');
  const fibre = summarizeNutrient(meals, 'fibreGrams');
  const sugars = summarizeNutrient(meals, 'sugarsGrams');
  const saturatedFat = summarizeNutrient(meals, 'saturatedFatGrams');
  return {
    mealCount: meals.length,
    mealCarbsGrams: carbs.total,
    mealEnergyKcal: energy.total,
    mealProteinGrams: protein.total,
    mealFatGrams: fat.total,
    mealFibreGrams: fibre.total,
    mealSugarsGrams: sugars.total,
    mealSaturatedFatGrams: saturatedFat.total,
    mealNutrientCoverage: {
      carbsGrams: carbs.coverage,
      energyKcal: energy.coverage,
      proteinGrams: protein.coverage,
      fatGrams: fat.coverage,
      fibreGrams: fibre.coverage,
      sugarsGrams: sugars.coverage,
      saturatedFatGrams: saturatedFat.coverage,
    },
    nutritionSourceLabels: [
      ...new Set(meals.map((meal) => meal.sourceLabel ?? meal.sourceId)),
    ].sort(),
    nutritionPossibleDuplicatePairs: possibleDuplicateMealPairs(meals),
    medicationCount: inRange.filter(
      (event) =>
        event.kind === 'medication' &&
        event.start >= range.start &&
        event.start < range.end,
    ).length,
    hormoneRecordCount: inRange.filter(
      (event) =>
        event.kind === 'note' && event.category === 'hormones',
    ).length,
  };
}
