import { describe, expect, it } from 'vitest';

import {
  BEDSIDE_NO_RECENT_AFTER_MS,
  bedsideGlucosePresentation,
} from '@/components/bedsideGlucosePresentation';

const NOW = Date.UTC(2026, 10, 2, 3);
const UK = { locale: 'en-GB', glucoseUnit: 'mmolL' as const };

describe('bedside glucose view', () => {
  it('shows a current value with its arrow and age', () => {
    const shown = bedsideGlucosePresentation({ mmolL: 6.4, timestamp: NOW - 2 * 60_000 }, 'flat', NOW, UK);
    expect(shown).toMatchObject({
      kind: 'reading', value: '6.4', unit: 'mmol/L', arrow: '→', status: '2 min ago', stale: false,
    });
  });

  it('labels a delayed value without striking it through', () => {
    const shown = bedsideGlucosePresentation({ mmolL: 6.4, timestamp: NOW - 9 * 60_000 }, 'flat', NOW, UK);
    expect(shown).toMatchObject({ kind: 'reading', status: 'Delayed · 9 min ago', stale: false });
  });

  it('strikes through a stale value and says it is the last known', () => {
    const shown = bedsideGlucosePresentation({ mmolL: 3.9, timestamp: NOW - 25 * 60_000 }, 'down', NOW, UK);
    expect(shown).toMatchObject({ kind: 'reading', status: 'Last known · 25 min ago', stale: true });
    expect(shown.accessibilityLabel).toContain('struck through');
  });

  it('uses the selected glucose unit', () => {
    const shown = bedsideGlucosePresentation(
      { mmolL: 6.4, timestamp: NOW }, 'flat', NOW, { locale: 'en-US', glucoseUnit: 'mgDl' },
    );
    expect(shown).toMatchObject({ kind: 'reading', value: '115', unit: 'mg/dL' });
  });

  it('says there is no recent reading instead of an old or missing number', () => {
    expect(bedsideGlucosePresentation(undefined, 'unknown', NOW, UK)).toMatchObject({
      kind: 'none', message: 'No recent reading', detail: 'Waiting for a glucose reading',
    });
    const old = bedsideGlucosePresentation(
      { mmolL: 6.4, timestamp: NOW - BEDSIDE_NO_RECENT_AFTER_MS - 60_000 }, 'flat', NOW, UK,
    );
    expect(old).toMatchObject({ kind: 'none', message: 'No recent reading', detail: 'Last reading 1 hr ago' });
    expect(old).not.toHaveProperty('value');
  });
});
