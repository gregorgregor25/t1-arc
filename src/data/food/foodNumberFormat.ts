export function formatFoodNumber(
  value: number,
  maximumFractionDigits = 1,
) {
  return value.toLocaleString('en-GB', {
    maximumFractionDigits,
  });
}

export function formatFoodGrams(value: number | undefined) {
  return value === undefined ? '—' : `${formatFoodNumber(value)} g`;
}
