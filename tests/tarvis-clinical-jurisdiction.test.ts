import { afterEach, describe, expect, it } from 'vitest';

import { selectTarvisReviewedKnowledge } from '@/data/tarvis/reviewedKnowledge';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe('Tarv1s reviewed clinical jurisdiction', () => {
  it('does not automatically apply NICE guidance to a non-GB profile', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'us',
      countryCode: 'US',
      languageTag: 'en-US',
      analysisTimeZone: 'America/New_York',
      followDeviceTimeZone: false,
      clinicalJurisdiction: 'US',
    });

    expect(selectTarvisReviewedKnowledge('What are the sick-day rules?')).toEqual(
      [],
    );
  });

  it('keeps an explicit non-GB NICE question labelled and scoped as UK guidance', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'japan',
      countryCode: 'JP',
      languageTag: 'ja-JP',
      analysisTimeZone: 'Asia/Tokyo',
      followDeviceTimeZone: false,
      clinicalJurisdiction: 'JP',
    });

    const selected = selectTarvisReviewedKnowledge(
      'What are the NICE sick-day rules?',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.jurisdiction).toBe('UK');
    expect(selected[0]?.summary).toContain('England and Wales');
  });
});
