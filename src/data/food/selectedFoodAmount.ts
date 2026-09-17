import {
  foodAmountToCanonical,
  type FoodInputUnit,
} from './foodMeasurement';

export interface SelectedFoodAmountState {
  canonicalAmount: number;
  amountEdited: boolean;
  displayAmount?: number;
  unit: FoodInputUnit;
  countryCode: string;
}

/**
 * Keeps an untouched saved quantity exact even when its regional editor text
 * is rounded for display. Only a real user edit is converted back to the
 * canonical food unit.
 */
export function resolveSelectedFoodCanonicalAmount({
  canonicalAmount,
  amountEdited,
  displayAmount,
  unit,
  countryCode,
}: SelectedFoodAmountState) {
  if (!amountEdited) {
    return Number.isFinite(canonicalAmount) && canonicalAmount > 0
      ? canonicalAmount
      : undefined;
  }
  if (
    displayAmount === undefined ||
    !Number.isFinite(displayAmount) ||
    displayAmount <= 0
  ) {
    return undefined;
  }
  return foodAmountToCanonical(displayAmount, unit, countryCode);
}
