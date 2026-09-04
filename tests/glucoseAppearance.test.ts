import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLUCOSE_APPEARANCE,
  glucoseRangeForValue,
  validateGlucoseAppearance,
} from '@/domain/glucoseAppearance';

describe('glucose appearance', () => {
  it('classifies every configured glucose band deterministically', () => {
    expect(glucoseRangeForValue(2.9)).toBe('veryLow');
    expect(glucoseRangeForValue(3)).toBe('veryLow');
    expect(glucoseRangeForValue(3.1)).toBe('low');
    expect(glucoseRangeForValue(3.9)).toBe('target');
    expect(glucoseRangeForValue(10)).toBe('target');
    expect(glucoseRangeForValue(10.1)).toBe('high');
    expect(glucoseRangeForValue(13.9)).toBe('veryHigh');
  });

  it('uses the stale colour independently of the glucose value', () => {
    expect(glucoseRangeForValue(6.2, 'stale')).toBe('stale');
    expect(glucoseRangeForValue(undefined, 'missing')).toBe('stale');
  });

  it('rejects overlapping or reversed boundaries', () => {
    expect(
      validateGlucoseAppearance({
        ...DEFAULT_GLUCOSE_APPEARANCE,
        targetMin: 2.8,
      }),
    ).toContain('increase');
  });

  it('accepts the default mmol/L ranges', () => {
    expect(validateGlucoseAppearance(DEFAULT_GLUCOSE_APPEARANCE)).toBeUndefined();
  });
});
