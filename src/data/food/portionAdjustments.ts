import { FoodLog } from './types';
import { scaleNutrition, sumNutrition } from './nutrition';

export function adjustedFoodLogPortions(
  log: FoodLog,
  amounts: Record<string, number>,
): FoodLog {
  const items = log.items.map((item) => {
    const amount = amounts[item.id];
    if (
      amount === undefined ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 10_000
    ) {
      throw new Error('Each food amount must be between 0 and 10,000.');
    }
    return {
      ...item,
      amount,
      nutrition: scaleNutrition(item.nutrition, amount / item.amount),
    };
  });
  return {
    ...log,
    items,
    nutrition: sumNutrition(items.map((item) => item.nutrition)),
  };
}
