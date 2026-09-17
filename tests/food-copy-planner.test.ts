import { describe, expect, it } from 'vitest';

import {
  planFoodLogCopy,
  resolveFoodCopyWallClock,
} from '@/data/food/foodCopyPlanner';
import type { FoodLog, FoodLogItemSnapshot } from '@/data/food/types';
import { toDateKey } from '@/domain/time';

function item(id: string, foodId = id, carbs = 10): FoodLogItemSnapshot {
  return {
    id,
    foodId,
    provider: 'user',
    externalId: foodId,
    name: `Food ${id}`,
    amount: 100,
    unit: 'g',
    nutrition: { carbohydrateGrams: carbs, energyKcal: carbs * 4 },
    sourceLabel: 'My foods',
  };
}

function log(
  id: string,
  timestamp: number,
  mealType: FoodLog['mealType'] = 'breakfast',
  items = [item(`${id}:one`), item(`${id}:two`)],
): FoodLog {
  return {
    id,
    contextEventId: `t1arc-food:meal:${id}`,
    timestamp,
    mealType,
    title: `${mealType} ${id}`,
    nutrition: {
      carbohydrateGrams: items.reduce(
        (sum, entry) => sum + (entry.nutrition.carbohydrateGrams ?? 0),
        0,
      ),
    },
    items,
    createdAt: timestamp + 1,
  };
}

describe('food copy planner', () => {
  it('copies an ordered item subset from immutable snapshots', () => {
    const source = log('source', Date.parse('2026-08-20T07:30:00Z'));
    const plan = planFoodLogCopy({
      sourceLogs: [source],
      selections: [{ logId: source.id, itemIds: [source.items[1]!.id] }],
      sourceTimeZone: 'Europe/London',
      destination: { date: '2026-08-21', timeZone: 'Europe/London' },
      mode: 'append',
    });

    expect(plan.copies[0]).toMatchObject({
      sourceLogId: 'source',
      sourceItemIds: ['source:two'],
      draft: {
        timestamp: Date.parse('2026-08-21T07:30:00Z'),
        mealType: 'breakfast',
        items: [{
          amount: 100,
          food: {
            id: 'source:two',
            nutritionPerBasis: { carbohydrateGrams: 10, energyKcal: 40 },
            sourceLabel: 'My foods',
          },
        }],
      },
    });
    source.items[1]!.nutrition.carbohydrateGrams = 99;
    expect(
      plan.copies[0]!.draft.items[0]!.food.nutritionPerBasis.carbohydrateGrams,
    ).toBe(10);
  });

  it('preserves duplicate food snapshots as distinct rows', () => {
    const source = log('duplicate', Date.parse('2026-08-20T11:00:00Z'), 'lunch', [
      item('first-portion', 'user:oats', 15),
      item('second-portion', 'user:oats', 25),
    ]);
    const plan = planFoodLogCopy({
      sourceLogs: [source],
      selections: [{ logId: source.id }],
      sourceTimeZone: 'UTC',
      destination: { date: '2026-08-21', timeZone: 'UTC' },
      mode: 'append',
    });
    expect(plan.copies[0]!.draft.items).toHaveLength(2);
    expect(plan.copies[0]!.draft.items.map((entry) =>
      entry.food.nutritionPerBasis.carbohydrateGrams)).toEqual([15, 25]);
  });

  it('plans append and meal-scoped replace without touching other dates or meals', () => {
    const source = log('source', Date.parse('2026-08-20T11:00:00Z'), 'lunch');
    const replaced = log('old-lunch', Date.parse('2026-08-21T12:00:00Z'), 'lunch');
    const otherMeal = log('dinner', Date.parse('2026-08-21T18:00:00Z'), 'dinner');
    const otherDate = log('prior', Date.parse('2026-08-20T12:00:00Z'), 'lunch');
    const base = {
      sourceLogs: [source],
      selections: [{ logId: source.id }],
      sourceTimeZone: 'UTC',
      destination: { date: '2026-08-21' as const, timeZone: 'UTC' },
      existingDestinationLogs: [replaced, otherMeal, otherDate],
    };
    expect(planFoodLogCopy({ ...base, mode: 'append' }).replaceLogs).toEqual([]);
    expect(planFoodLogCopy({ ...base, mode: 'replace' }).replaceLogs.map(
      (entry) => entry.id,
    )).toEqual(['old-lunch']);
  });

  it('maps wall time across travel instead of adding 24-hour durations', () => {
    const source = log('travel', Date.parse('2026-07-10T07:15:00Z'));
    const plan = planFoodLogCopy({
      sourceLogs: [source],
      selections: [{ logId: source.id }],
      sourceTimeZone: 'Europe/London',
      destination: { date: '2026-08-01', timeZone: 'Asia/Tokyo' },
      mode: 'append',
    });
    const timestamp = plan.copies[0]!.draft.timestamp;
    expect(timestamp).toBe(Date.parse('2026-07-31T23:15:00Z'));
    expect(toDateKey(timestamp, 'Asia/Tokyo')).toBe('2026-08-01');
  });

  it('rejects skipped DST wall time and requires an explicit fold choice', () => {
    expect(() => resolveFoodCopyWallClock(
      '2026-03-29', 1, 30, 0, 'Europe/London',
    )).toThrow('does not exist');
    expect(() => resolveFoodCopyWallClock(
      '2026-10-25', 1, 30, 0, 'Europe/London',
    )).toThrow('occurs twice');
    const earlier = resolveFoodCopyWallClock(
      '2026-10-25', 1, 30, 0, 'Europe/London', 'earlier',
    );
    const later = resolveFoodCopyWallClock(
      '2026-10-25', 1, 30, 0, 'Europe/London', 'later',
    );
    expect(later - earlier).toBe(3_600_000);
  });

  it('rejects duplicate selections rather than duplicating a meal accidentally', () => {
    const source = log('source', Date.parse('2026-08-20T11:00:00Z'));
    expect(() => planFoodLogCopy({
      sourceLogs: [source],
      selections: [{ logId: source.id }, { logId: source.id }],
      sourceTimeZone: 'UTC',
      destination: { date: '2026-08-21', timeZone: 'UTC' },
      mode: 'append',
    })).toThrow('only be selected once');
  });
});
