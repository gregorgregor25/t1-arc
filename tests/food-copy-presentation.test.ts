import { describe, expect, it } from 'vitest';

import {
  allFoodCopyItemIdentities,
  defaultFoodCopyItemIdentities,
  foodCopyItemIdentity,
  foodCopyMealGroups,
  foodCopyMealSelectionState,
  foodCopyPlannerSelections,
  foodCopySelectionSummary,
  toggleAllFoodCopyItems,
  toggleFoodCopyItem,
  toggleFoodCopyMeal,
} from '@/components/foodLogger/copyPresentation';
import type { FoodLog, FoodLogItemSnapshot } from '@/data/food/types';

function item(id: string, carbs: number | undefined): FoodLogItemSnapshot {
  return {
    id,
    foodId: `user:${id}`,
    provider: 'user',
    externalId: id,
    name: id,
    amount: 100,
    unit: 'g',
    nutrition: { carbohydrateGrams: carbs },
    sourceLabel: 'My foods',
  };
}

function log(
  id: string,
  mealType: FoodLog['mealType'],
  timestamp: number,
  items: FoodLogItemSnapshot[],
): FoodLog {
  return {
    id,
    contextEventId: `t1arc-food:meal:${id}`,
    timestamp,
    mealType,
    title: id,
    nutrition: { carbohydrateGrams: 0 },
    items,
    createdAt: timestamp,
  };
}

const breakfast = log('breakfast-log', 'breakfast', 200, [
  item('shared-item-id', 10),
  item('toast', 20),
]);
const dinner = log('dinner-log', 'dinner', 100, [
  item('shared-item-id', 15),
]);

describe('food copy presentation', () => {
  it('uses collision-safe identities for item IDs repeated across meals', () => {
    expect(foodCopyItemIdentity(breakfast.id, 'shared-item-id')).not.toBe(
      foodCopyItemIdentity(dinner.id, 'shared-item-id'),
    );
    expect(allFoodCopyItemIdentities([breakfast, dinner])).toHaveLength(3);
  });

  it('defaults only the current draft meal type, preserving duplicate rows', () => {
    expect(defaultFoodCopyItemIdentities([breakfast, dinner], 'breakfast')).toEqual(
      breakfast.items.map((entry) => foodCopyItemIdentity(breakfast.id, entry.id)),
    );
    expect(defaultFoodCopyItemIdentities([breakfast, dinner], 'snack')).toEqual([]);
  });

  it('groups by canonical meal order and sorts meals by time', () => {
    const earlierBreakfast = log('early', 'breakfast', 50, [item('oats', 12)]);
    const groups = foodCopyMealGroups([dinner, breakfast, earlierBreakfast]);
    expect(groups.map((group) => group.title)).toEqual(['Breakfast', 'Dinner']);
    expect(groups[0]!.logs.map((entry) => entry.id)).toEqual(['early', 'breakfast-log']);
  });

  it('toggles individual, whole-meal and select-all state without mutating input', () => {
    const original: string[] = [];
    const one = toggleFoodCopyItem(
      original,
      foodCopyItemIdentity(breakfast.id, breakfast.items[0]!.id),
    );
    expect(original).toEqual([]);
    expect(foodCopyMealSelectionState(breakfast, one)).toBe('mixed');

    const meal = toggleFoodCopyMeal(one, breakfast);
    expect(foodCopyMealSelectionState(breakfast, meal)).toBe(true);
    expect(toggleFoodCopyMeal(meal, breakfast)).toEqual([]);

    const all = toggleAllFoodCopyItems([], [breakfast, dinner]);
    expect(all).toHaveLength(3);
    expect(toggleAllFoodCopyItems(all, [breakfast, dinner])).toEqual([]);
  });

  it('returns planner-compatible full and partial selections in source order', () => {
    const selected = [
      ...breakfast.items.map((entry) => foodCopyItemIdentity(breakfast.id, entry.id)),
      foodCopyItemIdentity(dinner.id, dinner.items[0]!.id),
      foodCopyItemIdentity('stale-log', 'stale-item'),
    ];
    expect(foodCopyPlannerSelections([breakfast, dinner], selected)).toEqual([
      { logId: breakfast.id },
      { logId: dinner.id },
    ]);

    expect(foodCopyPlannerSelections([breakfast], [selected[1]!])).toEqual([
      { logId: breakfast.id, itemIds: ['toast'] },
    ]);
  });

  it('summarises selected food, meal and carbohydrate totals', () => {
    const selected = [
      foodCopyItemIdentity(breakfast.id, breakfast.items[0]!.id),
      foodCopyItemIdentity(dinner.id, dinner.items[0]!.id),
    ];
    expect(foodCopySelectionSummary([breakfast, dinner], selected)).toEqual({
      itemCount: 2,
      mealCount: 2,
      carbohydrateGrams: 25,
      carbohydrateMissingCount: 0,
    });

    const incomplete = log('incomplete', 'snack', 300, [item('unknown', undefined)]);
    expect(foodCopySelectionSummary(
      [incomplete],
      [foodCopyItemIdentity(incomplete.id, incomplete.items[0]!.id)],
    )).toMatchObject({
      itemCount: 1,
      carbohydrateGrams: undefined,
      carbohydrateMissingCount: 1,
    });
  });
});
