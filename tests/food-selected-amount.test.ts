import { describe, expect, it } from 'vitest';

import { resolveSelectedFoodCanonicalAmount } from '@/data/food/selectedFoodAmount';

describe('selected food canonical amounts', () => {
  it('keeps an untouched 9 g quick carbohydrate exact behind rounded ounces', () => {
    expect(
      resolveSelectedFoodCanonicalAmount({
        canonicalAmount: 9,
        amountEdited: false,
        displayAmount: 0.32,
        unit: 'oz',
        countryCode: 'US',
      }),
    ).toBe(9);
  });

  it('keeps an untouched 100 g saved item exact behind rounded ounces', () => {
    expect(
      resolveSelectedFoodCanonicalAmount({
        canonicalAmount: 100,
        amountEdited: false,
        displayAmount: 3.53,
        unit: 'oz',
        countryCode: 'US',
      }),
    ).toBe(100);
  });

  it('converts a quantity after the user deliberately edits it', () => {
    expect(
      resolveSelectedFoodCanonicalAmount({
        canonicalAmount: 100,
        amountEdited: true,
        displayAmount: 4,
        unit: 'oz',
        countryCode: 'US',
      }),
    ).toBeCloseTo(113.3980925, 8);
  });
});
