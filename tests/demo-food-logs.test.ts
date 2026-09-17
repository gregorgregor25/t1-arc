import { describe, expect, it } from 'vitest';

import { createDemoFoodLogs } from '@/data/synthetic/demoFoodLogs';
import { MealEvent } from '@/domain/models';

describe('synthetic food diary', () => {
  it('creates explicitly synthetic item snapshots that reconcile to meal carbs', () => {
    const meal: MealEvent = {
      id: 'demo-meal',
      kind: 'meal',
      start: Date.parse('2026-07-26T08:18:00+01:00'),
      sourceId: 'demo-context',
      origin: 'synthetic',
      title: 'Breakfast',
      mealType: 'breakfast',
      carbsGrams: 47,
    };

    const [log] = createDemoFoodLogs([meal]);

    expect(log?.contextEventId).toBe(meal.id);
    expect(log?.items.length).toBeGreaterThan(1);
    expect(
      log?.items.every(
        (item) => item.sourceLabel === 'Synthetic demo food',
      ),
    ).toBe(true);
    expect(log?.nutrition.carbohydrateGrams).toBe(meal.carbsGrams);
    expect(
      log?.items.reduce(
        (total, item) =>
          total + (item.nutrition.carbohydrateGrams ?? 0),
        0,
      ),
    ).toBe(meal.carbsGrams);
  });
});
