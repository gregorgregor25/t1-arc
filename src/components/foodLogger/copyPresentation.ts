import type { FoodCopySelection } from '@/data/food/foodCopyPlanner';
import type { FoodLog } from '@/data/food/types';

const mealOrder: FoodLog['mealType'][] = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
];

export interface FoodCopyMealGroup {
  mealType: FoodLog['mealType'];
  title: string;
  logs: FoodLog[];
}

export interface FoodCopySelectionSummary {
  itemCount: number;
  mealCount: number;
  carbohydrateGrams?: number;
  carbohydrateMissingCount: number;
}

export type FoodCopyMealSelectionState = false | true | 'mixed';

export function foodCopyMealTypeLabel(mealType: FoodLog['mealType']) {
  return mealType[0]!.toUpperCase() + mealType.slice(1);
}

/** Composite identity remains collision-safe even when source IDs contain separators. */
export function foodCopyItemIdentity(logId: string, itemId: string) {
  return JSON.stringify([logId, itemId]);
}

export function foodCopyMealGroups(
  sourceLogs: readonly FoodLog[],
): FoodCopyMealGroup[] {
  return mealOrder.flatMap((mealType): FoodCopyMealGroup[] => {
    const logs = sourceLogs
      .filter((log) => log.mealType === mealType)
      .sort((left, right) => left.timestamp - right.timestamp);
    return logs.length
      ? [{ mealType, title: foodCopyMealTypeLabel(mealType), logs }]
      : [];
  });
}

export function allFoodCopyItemIdentities(sourceLogs: readonly FoodLog[]) {
  return sourceLogs.flatMap((log) =>
    log.items.map((item) => foodCopyItemIdentity(log.id, item.id)),
  );
}

/** Starts with only the draft's matching meal selected. */
export function defaultFoodCopyItemIdentities(
  sourceLogs: readonly FoodLog[],
  mealType: FoodLog['mealType'],
) {
  return allFoodCopyItemIdentities(
    sourceLogs.filter((log) => log.mealType === mealType),
  );
}

function selectedIdentitySet(selectedItemIdentities: readonly string[]) {
  return new Set(selectedItemIdentities);
}

export function foodCopyMealSelectionState(
  log: FoodLog,
  selectedItemIdentities: readonly string[],
): FoodCopyMealSelectionState {
  if (!log.items.length) return false;
  const selected = selectedIdentitySet(selectedItemIdentities);
  const count = log.items.filter((item) =>
    selected.has(foodCopyItemIdentity(log.id, item.id)),
  ).length;
  return count === 0 ? false : count === log.items.length ? true : 'mixed';
}

export function toggleFoodCopyItem(
  selectedItemIdentities: readonly string[],
  identity: string,
) {
  const selected = selectedIdentitySet(selectedItemIdentities);
  if (selected.has(identity)) selected.delete(identity);
  else selected.add(identity);
  return [...selected];
}

export function toggleFoodCopyMeal(
  selectedItemIdentities: readonly string[],
  log: FoodLog,
) {
  const selected = selectedIdentitySet(selectedItemIdentities);
  const identities = log.items.map((item) =>
    foodCopyItemIdentity(log.id, item.id),
  );
  const allSelected = identities.length > 0 &&
    identities.every((identity) => selected.has(identity));
  for (const identity of identities) {
    if (allSelected) selected.delete(identity);
    else selected.add(identity);
  }
  return [...selected];
}

export function toggleAllFoodCopyItems(
  selectedItemIdentities: readonly string[],
  sourceLogs: readonly FoodLog[],
) {
  const visible = allFoodCopyItemIdentities(sourceLogs);
  const selected = selectedIdentitySet(selectedItemIdentities);
  const allSelected = visible.length > 0 &&
    visible.every((identity) => selected.has(identity));
  for (const identity of visible) {
    if (allSelected) selected.delete(identity);
    else selected.add(identity);
  }
  return [...selected];
}

export function foodCopyPlannerSelections(
  sourceLogs: readonly FoodLog[],
  selectedItemIdentities: readonly string[],
): FoodCopySelection[] {
  const selected = selectedIdentitySet(selectedItemIdentities);
  return sourceLogs.flatMap((log): FoodCopySelection[] => {
    const itemIds = log.items
      .filter((item) => selected.has(foodCopyItemIdentity(log.id, item.id)))
      .map((item) => item.id);
    if (!itemIds.length) return [];
    return [itemIds.length === log.items.length
      ? { logId: log.id }
      : { logId: log.id, itemIds }];
  });
}

export function foodCopySelectionSummary(
  sourceLogs: readonly FoodLog[],
  selectedItemIdentities: readonly string[],
): FoodCopySelectionSummary {
  const selected = selectedIdentitySet(selectedItemIdentities);
  let itemCount = 0;
  let mealCount = 0;
  let carbohydrateGrams = 0;
  let carbohydrateMissingCount = 0;
  for (const log of sourceLogs) {
    let selectedFromMeal = 0;
    for (const item of log.items) {
      if (!selected.has(foodCopyItemIdentity(log.id, item.id))) continue;
      itemCount += 1;
      selectedFromMeal += 1;
      if (item.nutrition.carbohydrateGrams === undefined) {
        carbohydrateMissingCount += 1;
      } else {
        carbohydrateGrams += item.nutrition.carbohydrateGrams;
      }
    }
    if (selectedFromMeal) mealCount += 1;
  }
  return {
    itemCount,
    mealCount,
    carbohydrateGrams:
      carbohydrateMissingCount === 0 ? carbohydrateGrams : undefined,
    carbohydrateMissingCount,
  };
}
