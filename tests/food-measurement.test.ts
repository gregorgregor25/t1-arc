import { describe, expect, it } from 'vitest';

import {
  canonicalFoodBasisUnit,
  defaultFoodInputUnit,
  foodAmountFromCanonical,
  foodAmountToCanonical,
} from '@/data/food/foodMeasurement';

describe('regional food measurement input', () => {
  it('accepts imperial mass while preserving canonical grams', () => {
    expect(foodAmountToCanonical(1, 'oz', 'US')).toBeCloseTo(28.3495, 4);
    expect(foodAmountToCanonical(1, 'lb', 'US')).toBeCloseTo(453.5924, 4);
    expect(foodAmountFromCanonical(453.59237, 'lb', 'US')).toBeCloseTo(1, 8);
    expect(canonicalFoodBasisUnit('oz')).toBe('g');
  });

  it('uses country-appropriate fluid and household measures', () => {
    expect(foodAmountToCanonical(1, 'fl oz', 'US')).toBeCloseTo(29.5735, 4);
    expect(foodAmountToCanonical(1, 'fl oz', 'GB')).toBeCloseTo(28.4131, 4);
    expect(foodAmountToCanonical(1, 'cup', 'US')).toBeCloseTo(236.5882, 4);
    expect(foodAmountToCanonical(1, 'cup', 'JP')).toBe(200);
    expect(foodAmountToCanonical(1, 'cup', 'AU')).toBe(250);
    expect(foodAmountToCanonical(1, 'tbsp', 'AU')).toBe(20);
    expect(foodAmountFromCanonical(40, 'tbsp', 'AU')).toBe(2);
    expect(foodAmountToCanonical(1, 'tbsp', 'GB')).toBe(15);
    expect(canonicalFoodBasisUnit('tbsp')).toBe('ml');
  });

  it('chooses display input units without changing a food’s stored basis', () => {
    expect(defaultFoodInputUnit('g', { measurementSystem: 'imperial' })).toBe(
      'oz',
    );
    expect(defaultFoodInputUnit('ml', { measurementSystem: 'imperial' })).toBe(
      'fl oz',
    );
    expect(defaultFoodInputUnit('g', { measurementSystem: 'metric' })).toBe('g');
  });
});
