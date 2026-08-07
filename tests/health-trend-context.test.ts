import { describe, expect, it } from 'vitest';

import { summarizeHealthTrendContext } from '@/domain/healthTrendContext';
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
      mealCarbsGrams: 0,
      medicationCount: 0,
      hormoneRecordCount: 0,
    });
  });
});
