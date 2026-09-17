import { describe, expect, it } from 'vitest';

import { createQuickCarbCandidate } from '@/data/food/quickCarb';

describe('quick carbohydrate entry', () => {
  it('creates an explicitly carb-only local food with a matching portion', () => {
    const food = createQuickCarbCandidate(
      17.5,
      '  Hypo treatment  ',
      1_720_000_000_000,
      'fixture',
    );

    expect(food).toMatchObject({
      name: 'Hypo treatment',
      basisAmount: 17.5,
      basisUnit: 'g',
      defaultServingAmount: 17.5,
      nutritionPerBasis: { carbohydrateGrams: 17.5 },
      sourceLabel: 'Quick carb entry',
      rawPayload: {
        enteredOnDevice: true,
        quickCarbEntry: true,
      },
    });
  });

  it('uses a neutral label and rejects implausible values', () => {
    expect(
      createQuickCarbCandidate(12, undefined, 1_720_000_000_000, 'fixture')
        .name,
    ).toBe('Quick carbohydrate');
    expect(() => createQuickCarbCandidate(0)).toThrow(/between/i);
    expect(() => createQuickCarbCandidate(1_001)).toThrow(/between/i);
  });
});
