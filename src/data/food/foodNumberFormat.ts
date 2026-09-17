import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

export function formatFoodNumber(
  value: number,
  maximumFractionDigits = 1,
  locale = getRuntimeRegionalDefaults().locale,
) {
  return value.toLocaleString(locale, {
    maximumFractionDigits,
  });
}

export function formatFoodGrams(value: number | undefined) {
  return value === undefined ? '—' : `${formatFoodNumber(value)} g`;
}
