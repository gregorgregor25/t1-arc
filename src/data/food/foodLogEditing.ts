import {
  nutritionForFoodAmount,
  totalNutrition,
} from './nutrition';
import {
  FoodCandidate,
  FoodLog,
  FoodLogDraft,
  FoodLogItemSnapshot,
  FoodNutrition,
} from './types';

function quality(value: number | undefined) {
  return value === undefined
    ? ('missing' as const)
    : value === 0
      ? ('trace' as const)
      : ('reported' as const);
}

export function foodLogTitle(draft: FoodLogDraft) {
  const explicit = draft.title?.trim();
  if (explicit) return explicit;
  if (draft.items.length === 1) return draft.items[0]!.food.name;
  const meal =
    draft.mealType[0]!.toUpperCase() + draft.mealType.slice(1);
  return `${meal} · ${draft.items.length} items`;
}

function candidateFromSnapshot(
  item: FoodLogItemSnapshot,
): FoodCandidate {
  const nutrition: FoodNutrition = { ...item.nutrition };
  return {
    id: item.foodId,
    provider: item.provider,
    externalId: item.externalId,
    name: item.name,
    brand: item.brand,
    barcode: item.barcode,
    basisAmount: item.amount,
    basisUnit: item.unit,
    nutritionPerBasis: nutrition,
    nutritionQuality: {
      carbohydrate: quality(nutrition.carbohydrateGrams),
      energy: quality(nutrition.energyKcal),
      protein: quality(nutrition.proteinGrams),
      fat: quality(nutrition.fatGrams),
      fibre: quality(nutrition.fibreGrams),
      sugars: quality(nutrition.sugarsGrams),
      saturatedFat: quality(nutrition.saturatedFatGrams),
    },
    defaultServingAmount: item.amount,
    defaultServingUnit: item.unit,
    lastPortionAmount: item.amount,
    lastPortionUnit: item.unit,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
  };
}

export function foodLogDraftFromLog(log: FoodLog): FoodLogDraft {
  const items = log.items.map((item) => ({
    food: candidateFromSnapshot(item),
    amount: item.amount,
    unit: item.unit,
  }));
  const draft: FoodLogDraft = {
    timestamp: log.timestamp,
    mealType: log.mealType,
    items,
  };
  return log.title === foodLogTitle(draft)
    ? draft
    : { ...draft, title: log.title };
}

export function revisedFoodLog(
  log: FoodLog,
  draft: FoodLogDraft,
  newItemToken = Date.now().toString(36),
): FoodLog {
  const existingByFood = new Map<string, FoodLogItemSnapshot[]>();
  for (const item of log.items) {
    const matches = existingByFood.get(item.foodId) ?? [];
    matches.push(item);
    existingByFood.set(item.foodId, matches);
  }
  const items = draft.items.map((item, index) => {
    const matches = existingByFood.get(item.food.id);
    const existing = matches?.shift();
    return {
      id: existing?.id ?? `${log.id}:item:${newItemToken}-${index}`,
      foodId: item.food.id,
      provider: item.food.provider,
      externalId: item.food.externalId,
      name: item.food.name,
      brand: item.food.brand,
      barcode: item.food.barcode,
      amount: item.amount,
      unit: item.unit,
      nutrition: nutritionForFoodAmount(item),
      sourceLabel: item.food.sourceLabel,
      sourceUrl: item.food.sourceUrl,
    };
  });
  return {
    ...log,
    timestamp: draft.timestamp,
    mealType: draft.mealType,
    title: foodLogTitle(draft),
    nutrition: totalNutrition(draft.items),
    items,
  };
}
