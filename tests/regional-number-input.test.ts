import { describe, expect, it } from 'vitest';

import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from '@/domain/regionalNumberInput';

describe('regional numeric input normalization', () => {
  it.each([
    ['en-GB', '1,234.5', '1234.5', 1234.5],
    ['en-US', '1,234.5', '1234.5', 1234.5],
    ['ar-EG', '١٬٢٣٤٫٥', '1234.5', 1234.5],
    ['fa-IR', '۱٬۲۳۴٫۵', '1234.5', 1234.5],
  ])(
    'normalizes %s digits and separators',
    (locale, input, normalized, value) => {
      expect(normalizeRegionalNumberInput(input, locale)).toEqual({
        normalized,
        value,
      });
    },
  );

  it('accepts a decimal comma paste without misreading valid grouping', () => {
    expect(normalizeRegionalNumberInput('1,5', 'en-GB')?.value).toBe(1.5);
    expect(normalizeRegionalNumberInput('1,000', 'en-US')?.value).toBe(1000);
  });

  it('supports signs, ungrouped regional digits and mixed Western paste input', () => {
    expect(normalizeRegionalNumberInput('−١٢٫٥', 'ar-EG')).toEqual({
      normalized: '-12.5',
      value: -12.5,
    });
    expect(normalizeRegionalNumberInput('۱۲.۵', 'fa-IR')?.value).toBe(12.5);
    expect(normalizeRegionalNumberInput('1,234٫5', 'ar-EG')?.value).toBe(1234.5);
    expect(normalizeRegionalNumberInput('٫٥', 'ar-EG')).toEqual({
      normalized: '0.5',
      value: 0.5,
    });
  });

  it.each(['', '١٢ mg', '1,2,3', '1e3', '--12', '٫'])(
    'rejects the complete invalid token %j',
    (input) => {
      expect(normalizeRegionalNumberInput(input, 'ar-EG')).toBeUndefined();
    },
  );

  it('supports Indian grouping without changing the canonical value', () => {
    expect(normalizeRegionalNumberInput('12,34,567.8', 'hi-IN')).toEqual({
      normalized: '1234567.8',
      value: 1234567.8,
    });
  });

  it.each([
    ['en-GB', '12.5'],
    ['en-US', '12.5'],
    ['ar-EG', '١٢٫٥'],
    ['fa-IR', '۱۲٫۵'],
  ])('formats an editable %s value without grouping and round-trips it', (locale, expected) => {
    const displayed = formatRegionalNumberInput(12.5, locale);
    expect(displayed).toBe(expected);
    expect(normalizeRegionalNumberInput(displayed, locale)?.value).toBe(12.5);
  });
});
