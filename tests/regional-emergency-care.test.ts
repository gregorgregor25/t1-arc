import { afterEach, describe, expect, it } from 'vitest';

import { classifyTarvisSafety } from '@/data/tarvis/safety';
import { emergencyCareTerms } from '@/domain/emergencyCare';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

describe('regional emergency care wording', () => {
  it('uses the configured local emergency terminology', () => {
    expect(emergencyCareTerms('US', 'us').call).toBe('Call 911 now');
    expect(emergencyCareTerms('JP', 'japan').call).toBe('Call 119 now');
    expect(emergencyCareTerms('FR', 'europe').call).toBe('Call 112 now');
    expect(emergencyCareTerms('AU', 'other').call).toContain(
      'local emergency number',
    );
  });

  it('does not reuse the reviewed UK ketone pathway in the US profile', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'us',
      countryCode: 'US',
      languageTag: 'en-US',
      analysisTimeZone: 'America/New_York',
      followDeviceTimeZone: false,
      glucoseUnit: 'mgDl',
      clinicalJurisdiction: 'US',
    });

    const decision = classifyTarvisSafety('Ketones are 1.6, what now?');
    expect(decision.kind).toBe('urgent');
    if (decision.kind !== 'urgent') throw new Error('Expected urgent response');
    expect(decision.answer.answer).toContain('Call 911');
    expect(decision.answer.answer).not.toMatch(/NHS|999|A&E|over 3 mmol\/L/i);
  });
});
