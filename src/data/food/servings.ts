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

function canonicalServingAmount(amount: number, unit: string, basisUnit: FoodBasisUnit) {
  const normalizedUnit = unit.trim().toLowerCase();
  if (basisUnit === 'g') {
    if (['g', 'gm', 'grm', 'gram', 'grams'].includes(normalizedUnit)) return amount;
    if (['kg', 'kilogram', 'kilograms'].includes(normalizedUnit)) return amount * 1_000;
    if (['oz', 'ounce', 'ounces'].includes(normalizedUnit)) return amount * 28.349523125;
  }
  if (basisUnit === 'ml') {
    if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(normalizedUnit)) return amount;
    if (['l', 'liter', 'liters', 'litre', 'litres'].includes(normalizedUnit)) return amount * 1_000;
  }
  return undefined;
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
  if (structuredAmount !== undefined) {
    const converted = canonicalServingAmount(structuredAmount, unit, basisUnit);
    if (converted !== undefined) return converted;
  }

  const servingLabel =
    typeof source.serving_size === 'string' ? source.serving_size : '';
  const matches = [
    ...servingLabel.matchAll(/(\d+(?:[.,]\d+)?)\s*(fl\s*oz|fluid\s+ounces?|kg|kilograms?|oz|ounces?|ml|millilit(?:er|re)s?|g|grams?|l|lit(?:er|re)s?)\b/gi),
  ];
  for (const match of matches.reverse()) {
    const amount = positiveNumber(match[1]?.replace(',', '.'));
    if (amount === undefined) continue;
    const converted = canonicalServingAmount(amount, match[2] ?? '', basisUnit);
    if (converted !== undefined) return converted;
  }
  return undefined;
}

export function defaultFoodServingAmount(food: FoodCandidate) {
  if (
    food.personalServingUnit === food.basisUnit &&
    food.personalServingAmount !== undefined &&
    Number.isFinite(food.personalServingAmount) && food.personalServingAmount > 0
  ) return food.personalServingAmount;
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
