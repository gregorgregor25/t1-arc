import { describe, expect, it, vi } from 'vitest';

import {
  getCachedDateTimeFormat,
  getCachedNumberFormat,
  INTL_FORMATTER_CACHE_LIMIT,
} from '@/domain/intlFormatterCache';

function currencyCode(index: number) {
  const first = String.fromCharCode(65 + Math.floor(index / 26));
  const second = String.fromCharCode(65 + (index % 26));
  return `Q${first}${second}`;
}

describe('bounded Intl formatter cache', () => {
  it('does not collate option names while retaining locale and changed-option behaviour', () => {
    const collate = vi.spyOn(String.prototype, 'localeCompare');
    try {
      const options: Intl.NumberFormatOptions = { maximumFractionDigits: 2, useGrouping: false };
      const original = getCachedNumberFormat('fr-FR', options);
      for (let index = 0; index < 2_000; index += 1) {
        expect(getCachedNumberFormat('fr-FR', { useGrouping: false, maximumFractionDigits: 2, minimumFractionDigits: undefined })).toBe(original);
      }
      expect(original.format(1.5)).toBe('1,5');
      expect(getCachedNumberFormat('en-US', options).format(1.5)).toBe('1.5');
      options.maximumFractionDigits = 1;
      expect(getCachedNumberFormat('fr-FR', options)).not.toBe(original);
      expect(collate).not.toHaveBeenCalled();
    } finally {
      collate.mockRestore();
    }
  });

  it('reuses equivalent number and date formatter requests', () => {
    expect(
      getCachedNumberFormat('en-US', {
        maximumFractionDigits: 2,
        useGrouping: false,
      }),
    ).toBe(
      getCachedNumberFormat('en-US', {
        useGrouping: false,
        maximumFractionDigits: 2,
      }),
    );
    expect(
      getCachedDateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
      }),
    ).toBe(
      getCachedDateTimeFormat('en-GB', {
        hour: '2-digit',
        timeZone: 'Europe/London',
      }),
    );
  });

  it('evicts old number formatters instead of growing without a bound', () => {
    const original = getCachedNumberFormat('en-US', {
      style: 'currency',
      currency: 'QZZ',
    });
    for (let index = 0; index < INTL_FORMATTER_CACHE_LIMIT; index += 1) {
      getCachedNumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode(index),
      });
    }
    expect(
      getCachedNumberFormat('en-US', {
        style: 'currency',
        currency: 'QZZ',
      }),
    ).not.toBe(original);
  });
});
