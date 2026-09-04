import { describe, expect, it } from 'vitest';

import { summarizeHealthTrendContext } from '@/domain/healthTrendContext';
import { mealNutritionSummary } from '@/domain/mealNutrition';
import type { HealthContextEvent } from '@/domain/models';

const range = { start: 1_000, end: 101_000 };

function base(
  overrides: Partial<HealthContextEvent>,
): HealthContextEvent {
  return {
    id: 'context',
    kind: 'note',
    title: 'Context',
    category: 'other',
    sourceId: 'manual',
    origin: 'manual',
    start: range.start,
    ...overrides,
  } as HealthContextEvent;
}

describe('health trend context summaries', () => {
  it('summarises logged food, medication and hormone context without inference', () => {
    const events: HealthContextEvent[] = [
      base({
        id: 'meal-1',
        kind: 'meal',
        title: 'Breakfast',
        mealType: 'breakfast',
        carbsGrams: 42,
      }),
      base({
        id: 'meal-2',
        kind: 'meal',
        title: 'Snack',
        mealType: 'snack',
        carbsGrams: 18.5,
        start: 50_000,
      }),
      base({
        id: 'medication',
        kind: 'medication',
        title: 'Medication',
      }),
      base({
        id: 'period',
        kind: 'note',
        title: 'Menstrual period',
        category: 'hormones',
        end: 201_000,
      }),
    ];

    expect(summarizeHealthTrendContext(events, range)).toEqual({
      mealCount: 2,
      mealCarbsGrams: 60.5,
      mealEnergyKcal: undefined,
      mealProteinGrams: undefined,
      mealFatGrams: undefined,
      mealFibreGrams: undefined,
      mealSugarsGrams: undefined,
      mealSaturatedFatGrams: undefined,
      mealNutrientCoverage: {
        carbsGrams: { knownCount: 2, recordCount: 2 },
        energyKcal: { knownCount: 0, recordCount: 2 },
        proteinGrams: { knownCount: 0, recordCount: 2 },
        fatGrams: { knownCount: 0, recordCount: 2 },
        fibreGrams: { knownCount: 0, recordCount: 2 },
        sugarsGrams: { knownCount: 0, recordCount: 2 },
        saturatedFatGrams: { knownCount: 0, recordCount: 2 },
      },
      nutritionSourceLabels: ['manual'],
      nutritionPossibleDuplicatePairs: 0,
      medicationCount: 1,
      hormoneRecordCount: 1,
    });
  });

  it('does not pull point events from an adjacent day into the summary', () => {
    const events: HealthContextEvent[] = [
      base({
        id: 'previous-meal',
        kind: 'meal',
        title: 'Previous meal',
        mealType: 'dinner',
        carbsGrams: 55,
        start: range.start - 1,
      }),
      base({
        id: 'next-medication',
        kind: 'medication',
        title: 'Next medication',
        start: range.end,
      }),
    ];

    expect(summarizeHealthTrendContext(events, range)).toEqual({
      mealCount: 0,
      mealCarbsGrams: undefined,
      mealEnergyKcal: undefined,
      mealProteinGrams: undefined,
      mealFatGrams: undefined,
      mealFibreGrams: undefined,
      mealSugarsGrams: undefined,
      mealSaturatedFatGrams: undefined,
      mealNutrientCoverage: {
        carbsGrams: { knownCount: 0, recordCount: 0 },
        energyKcal: { knownCount: 0, recordCount: 0 },
        proteinGrams: { knownCount: 0, recordCount: 0 },
        fatGrams: { knownCount: 0, recordCount: 0 },
        fibreGrams: { knownCount: 0, recordCount: 0 },
        sugarsGrams: { knownCount: 0, recordCount: 0 },
        saturatedFatGrams: { knownCount: 0, recordCount: 0 },
      },
      nutritionSourceLabels: [],
      nutritionPossibleDuplicatePairs: 0,
      medicationCount: 0,
      hormoneRecordCount: 0,
    });
  });

  it('uses half-open day boundaries for interval and point context', () => {
    const events: HealthContextEvent[] = [
      base({
        id: 'period-ending-at-midnight',
        kind: 'note',
        title: 'Previous period',
        category: 'hormones',
        start: range.start - 50_000,
        end: range.start,
      }),
      base({
        id: 'period-point-at-midnight',
        kind: 'note',
        title: 'New period point',
        category: 'hormones',
        start: range.start,
      }),
      base({
        id: 'point-at-next-midnight',
        kind: 'note',
        title: 'Next day point',
        category: 'hormones',
        start: range.end,
      }),
    ];

    expect(summarizeHealthTrendContext(events, range).hormoneRecordCount).toBe(
      1,
    );
  });

  it('totals every supplied nutrient without turning missing carbohydrate into zero', () => {
    const events: HealthContextEvent[] = [
      base({
        id: 'meal-without-carbs',
        kind: 'meal',
        title: 'Imported meal summary',
        mealType: 'lunch',
        energyKcal: 440,
        proteinGrams: 32,
        fatGrams: 18,
        fibreGrams: 6,
        sugarsGrams: 4,
        saturatedFatGrams: 3,
        sourceId: 'health-connect:mfp',
        sourceLabel: 'MyFitnessPal',
      }),
    ];

    expect(summarizeHealthTrendContext(events, range)).toMatchObject({
      mealCount: 1,
      mealCarbsGrams: undefined,
      mealEnergyKcal: 440,
      mealProteinGrams: 32,
      mealFatGrams: 18,
      mealFibreGrams: 6,
      mealSugarsGrams: 4,
      mealSaturatedFatGrams: 3,
      nutritionSourceLabels: ['MyFitnessPal'],
      mealNutrientCoverage: {
        carbsGrams: { knownCount: 0, recordCount: 1 },
        energyKcal: { knownCount: 1, recordCount: 1 },
        proteinGrams: { knownCount: 1, recordCount: 1 },
        fatGrams: { knownCount: 1, recordCount: 1 },
        fibreGrams: { knownCount: 1, recordCount: 1 },
        sugarsGrams: { knownCount: 1, recordCount: 1 },
        saturatedFatGrams: { knownCount: 1, recordCount: 1 },
      },
      nutritionPossibleDuplicatePairs: 0,
    });
  });

  it('keeps near-identical cross-source meals separate and flags overlap', () => {
    const summary = summarizeHealthTrendContext(
      [
        base({
          id: 'native-meal',
          kind: 'meal',
          title: 'Lunch',
          mealType: 'lunch',
          carbsGrams: 45,
          energyKcal: 520,
          sourceId: 't1arc-food',
          sourceLabel: 'T1 Arc food log',
        }),
        base({
          id: 'health-connect-meal',
          kind: 'meal',
          title: 'Lunch summary',
          mealType: 'lunch',
          carbsGrams: 45,
          start: range.start + 5_000,
          sourceId: 'health-connect:mfp',
          sourceLabel: 'MyFitnessPal',
        }),
      ],
      range,
    );

    expect(summary.mealCount).toBe(2);
    expect(summary.mealCarbsGrams).toBe(90);
    expect(summary.mealNutrientCoverage.carbsGrams).toEqual({
      knownCount: 2,
      recordCount: 2,
    });
    expect(summary.nutritionSourceLabels).toEqual([
      'MyFitnessPal',
      'T1 Arc food log',
    ]);
    expect(summary.nutritionPossibleDuplicatePairs).toBe(1);
  });

  it('marks a native multi-item nutrient subtotal as partial', () => {
    const meal = base({
      id: 'partially-known-meal',
      kind: 'meal',
      title: 'Lunch',
      mealType: 'lunch',
      carbsGrams: 30,
      proteinGrams: 12,
      nutritionDetail: 'itemized',
      items: [
        {
          id: 'known-item',
          name: 'Wrap',
          amount: 120,
          unit: 'g',
          carbohydrateGrams: 30,
          proteinGrams: 12,
        },
        {
          id: 'unknown-item',
          name: 'Sauce',
          amount: 20,
          unit: 'g',
          carbohydrateGrams: 0,
        },
      ],
    }) as Extract<HealthContextEvent, { kind: 'meal' }>;

    const summary = summarizeHealthTrendContext([meal], range);

    expect(summary.mealProteinGrams).toBe(12);
    expect(summary.mealNutrientCoverage.proteinGrams).toEqual({
      knownCount: 1,
      recordCount: 1,
      partialCount: 1,
    });
    expect(summary.mealNutrientCoverage.carbsGrams).toEqual({
      knownCount: 1,
      recordCount: 1,
    });
    expect(mealNutritionSummary(meal, { includeItems: true })).toContain(
      '12 g protein (partial)',
    );
  });
});
