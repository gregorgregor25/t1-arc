import {
  formatFoodGrams,
  formatFoodNumber,
} from '@/data/food/foodNumberFormat';
import { describe, expect, it } from 'vitest';

describe('food number formatting', () => {
  it('preserves useful carbohydrate precision without trailing zeroes', () => {
    expect(formatFoodGrams(12.5)).toBe('12.5 g');
    expect(formatFoodGrams(12)).toBe('12 g');
    expect(formatFoodNumber(1234.56)).toBe('1,234.6');
  });

  it('shows an explicit unknown state', () => {
    expect(formatFoodGrams(undefined)).toBe('—');
  });
});
