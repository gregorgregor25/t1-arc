import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';

import type { FoodBasisUnit } from './types';

export type FoodInputUnit =
  | 'g'
  | 'oz'
  | 'lb'
  | 'ml'
  | 'fl oz'
  | 'cup'
  | 'tbsp'
  | 'tsp';

const MASS_UNITS: readonly FoodInputUnit[] = ['g', 'oz', 'lb'];
const VOLUME_UNITS: readonly FoodInputUnit[] = [
  'ml',
  'fl oz',
  'cup',
  'tbsp',
  'tsp',
];

export function foodInputUnits(basisUnit: FoodBasisUnit) {
  return basisUnit === 'g' ? MASS_UNITS : VOLUME_UNITS;
}

export function defaultFoodInputUnit(
  basisUnit: FoodBasisUnit,
  settings: Pick<T1ArcRegionalDefaults, 'measurementSystem'>,
): FoodInputUnit {
  if (settings.measurementSystem !== 'imperial') return basisUnit;
  return basisUnit === 'g' ? 'oz' : 'fl oz';
}

function millilitresPerUnit(unit: FoodInputUnit, countryCode: string) {
  const us = countryCode === 'US';
  switch (unit) {
    case 'fl oz':
      return us ? 29.5735295625 : 28.4130625;
    case 'cup':
      return countryCode === 'JP' ? 200 : us ? 236.5882365 : 250;
    case 'tbsp':
      return us ? 14.78676478125 : 15;
    case 'tsp':
      return us ? 4.92892159375 : 5;
    default:
      return 1;
  }
}

export function foodAmountToCanonical(
  value: number,
  unit: FoodInputUnit,
  countryCode: string,
) {
  if (!Number.isFinite(value)) return value;
  switch (unit) {
    case 'oz':
      return value * 28.349523125;
    case 'lb':
      return value * 453.59237;
    case 'fl oz':
    case 'cup':
    case 'tbsp':
    case 'tsp':
      return value * millilitresPerUnit(unit, countryCode);
    default:
      return value;
  }
}

export function foodAmountFromCanonical(
  value: number,
  unit: FoodInputUnit,
  countryCode: string,
) {
  if (!Number.isFinite(value)) return value;
  switch (unit) {
    case 'oz':
      return value / 28.349523125;
    case 'lb':
      return value / 453.59237;
    case 'fl oz':
    case 'cup':
    case 'tbsp':
    case 'tsp':
      return value / millilitresPerUnit(unit, countryCode);
    default:
      return value;
  }
}

export function canonicalFoodBasisUnit(unit: FoodInputUnit): FoodBasisUnit {
  return MASS_UNITS.includes(unit) ? 'g' : 'ml';
}
