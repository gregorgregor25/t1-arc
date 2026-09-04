import { afterEach, describe, expect, it } from 'vitest';

import {
  formatTarvisFixedNumber,
  formatTarvisNumber,
} from '@/data/tarvis/regionalNumberPresentation';
import {
  DEFAULT_REGIONAL_PROFILE,
  type T1ArcRegionalProfile,
} from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

function profile(locale: string): T1ArcRegionalProfile {
  return {
    ...DEFAULT_REGIONAL_PROFILE,
    languageTag: locale,
  };
}

afterEach(() => {
  setRuntimeRegionalProfile(DEFAULT_REGIONAL_PROFILE);
});

describe('Tarv1s regional number presentation', () => {
  it('uses comma decimals for French evidence and answers', () => {
    setRuntimeRegionalProfile(profile('fr-FR'));
    expect(formatTarvisFixedNumber(1234.5, 2)).toBe('1\u202f234,50');
    expect(formatTarvisNumber(12_345, { maximumFractionDigits: 0 })).toBe(
      '12\u202f345',
    );
  });

  it('uses German grouping and decimal separators', () => {
    setRuntimeRegionalProfile(profile('de-DE'));
    expect(formatTarvisFixedNumber(1234.5, 1)).toBe('1.234,5');
  });
});
