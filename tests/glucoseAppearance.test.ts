import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLUCOSE_APPEARANCE,
  glucoseAppearancePreview,
  glucoseRangeForValue,
  validateGlucoseAppearance,
} from '@/domain/glucoseAppearance';
import { formatGlucose } from '@/domain/regionalFormat';

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

  it.each([
    DEFAULT_GLUCOSE_APPEARANCE,
    { ...DEFAULT_GLUCOSE_APPEARANCE, veryLowMax: 2, targetMin: 3, targetMax: 8, veryHighMin: 12 },
    { ...DEFAULT_GLUCOSE_APPEARANCE, veryLowMax: 1, targetMin: 1.1, targetMax: 29.9, veryHighMin: 30 },
  ])('keeps preview examples within their configured bands', (settings) => {
    const before = structuredClone(settings);
    const preview = glucoseAppearancePreview(settings);
    expect(preview.map(({ range }) => range)).toEqual(['veryLow', 'low', 'target', 'high', 'veryHigh']);
    for (const { mmolL, range } of preview) {
      expect(glucoseRangeForValue(mmolL, 'current', settings)).toBe(range);
      expect(mmolL).toBeGreaterThan(0);
    }
    expect(settings).toEqual(before);
  });

  it('formats canonical preview values using the selected unit and locale', () => {
    const low = glucoseAppearancePreview(DEFAULT_GLUCOSE_APPEARANCE)[0]!.mmolL;
    expect(formatGlucose(low, { locale: 'en-GB', glucoseUnit: 'mmolL' })).toBe('2.9 mmol/L');
    expect(formatGlucose(low, { locale: 'en-US', glucoseUnit: 'mgDl' })).toBe('52 mg/dL');
    expect(formatGlucose(low, { locale: 'ja-JP', glucoseUnit: 'mgDl' })).toBe('52 mg/dL');
    expect(formatGlucose(low, { locale: 'fr-FR', glucoseUnit: 'mmolL' })).toBe('2,9 mmol/L');
  });
});
