import { FoodBasisUnit, FoodCandidate } from './types';

function positiveNumber(value: unknown) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function servingAmountFromRawPayload(
  payload: unknown,
  basisUnit: FoodBasisUnit,
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const source = payload as Record<string, unknown>;
  const unit = String(source.serving_quantity_unit ?? '')
    .trim()
    .toLocaleLowerCase('en-GB');
  const structuredAmount = positiveNumber(source.serving_quantity);
  if (unit === basisUnit && structuredAmount !== undefined) {
    return structuredAmount;
  }

  const servingLabel =
    typeof source.serving_size === 'string' ? source.serving_size : '';
  const matches = [
    ...servingLabel.matchAll(/(\d+(?:[.,]\d+)?)\s*(ml|g)\b/gi),
  ];
  for (const match of matches.reverse()) {
    if (match[2]?.toLocaleLowerCase('en-GB') !== basisUnit) continue;
    const amount = positiveNumber(match[1]?.replace(',', '.'));
    if (amount !== undefined) return amount;
  }
  return undefined;
}

export function defaultFoodServingAmount(food: FoodCandidate) {
  if (
    food.defaultServingUnit === food.basisUnit &&
    food.defaultServingAmount !== undefined &&
    Number.isFinite(food.defaultServingAmount) &&
    food.defaultServingAmount > 0
  ) {
    return food.defaultServingAmount;
  }
  return food.basisAmount;
}

export function initialFoodPortionAmount(food: FoodCandidate) {
  if (
    food.lastPortionUnit === food.basisUnit &&
    food.lastPortionAmount !== undefined &&
    Number.isFinite(food.lastPortionAmount) &&
    food.lastPortionAmount > 0
  ) {
    return food.lastPortionAmount;
  }
  return defaultFoodServingAmount(food);
}

export function servingMultiplierAmount(
  food: FoodCandidate,
  multiplier: number,
) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('Serving multiplier must be greater than zero.');
  }
  return Math.round(defaultFoodServingAmount(food) * multiplier * 10) / 10;
}
