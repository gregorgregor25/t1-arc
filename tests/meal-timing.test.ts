import { describe, expect, it } from 'vitest';

import { suggestedMealType } from '@/domain/mealTiming';

describe('suggested meal type', () => {
  it.each([
    ['2026-07-27T05:30:00Z', 'breakfast'],
    ['2026-07-27T10:30:00Z', 'lunch'],
    ['2026-07-27T15:30:00Z', 'dinner'],
    ['2026-07-27T20:30:00Z', 'snack'],
  ] as const)('uses Europe/London time for %s', (iso, expected) => {
    expect(suggestedMealType(Date.parse(iso))).toBe(expected);
  });
});
