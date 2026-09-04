import { afterEach, describe, expect, it } from 'vitest';

import { foodLogTitle } from '@/data/food/foodLogEditing';
import { parseDexcomClarityCsv } from '@/data/import/dexcomClarityCsv';
import {
  describeTarvisIntent,
  isReadyTarvisIntent,
  resolveTarvisIntent,
} from '@/data/tarvis/intent';
import {
  formatClockTime,
  formatClockTimeForDisplay,
  resolveMostRecentCompletedRecurringWindows,
} from '@/data/tarvis/query';
import {
  buildEvidenceClockWindowAccessibilitySummary,
  formatEvidenceClockMinute,
  formatEvidenceClockWindow,
  resolveEvidenceClockWindowDomain,
} from '@/domain/evidenceClockWindowChart';
import { buildEvidenceQueryAccessibilitySummary } from '@/domain/evidenceQueryChart';
import { mealItemNames } from '@/domain/mealNutrition';
import {
  DEFAULT_REGIONAL_PROFILE,
  type T1ArcRegionalProfile,
} from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

const US_PROFILE: T1ArcRegionalProfile = {
  ...DEFAULT_REGIONAL_PROFILE,
  region: 'us',
  countryCode: 'US',
  languageTag: 'en-US',
  analysisTimeZone: 'America/New_York',
  followDeviceTimeZone: false,
};

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe('locale-aware visible periods and counts', () => {
  it('presents US chart and recurring-window clocks without changing stable IDs', () => {
    setRuntimeRegionalProfile(US_PROFILE);
    const domain = resolveEvidenceClockWindowDomain({
      startMinute: 22 * 60,
      endMinuteUnwrapped: 3 * 60,
    });

    expect(formatEvidenceClockMinute(13 * 60)).toBe('01:00 PM');
    expect(formatEvidenceClockWindow(domain)).toBe(
      '10:00 PM to 03:00 AM',
    );
    expect(
      formatClockTimeForDisplay({ hour: 13, minute: 5 }),
    ).toBe('01:05 PM');
    expect(formatClockTime({ hour: 13, minute: 5 })).toBe('13:05');

    const [window] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'America/New_York',
      asOf: Date.parse('2026-08-08T12:00:00-04:00'),
      count: 1,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });
    expect(window!.label).toContain('12:00 AM–07:00 AM');
    expect(window!.id).toMatch(/:0000:0700$/);
  });

  it('describes Tarv1s periods with localized dates, counts, and clock bounds', () => {
    setRuntimeRegionalProfile(US_PROFILE);
    const resolved = resolveTarvisIntent(
      'What were my average readings over the last two nights between midnight and 7 a.m.?',
      {
        now: Date.parse('2026-08-08T12:00:00-04:00'),
        timezone: 'America/New_York',
      },
    );
    expect(isReadyTarvisIntent(resolved)).toBe(true);
    if (!isReadyTarvisIntent(resolved)) return;

    expect(
      describeTarvisIntent(resolved.intent, {
        timezone: 'America/New_York',
      }),
    ).toContain('2 completed overnight windows · 12:00 AM–07:00 AM');

    const dated = resolveTarvisIntent(
      'What was my average glucose on 6 August 2026?',
      {
        now: Date.parse('2026-08-08T12:00:00-04:00'),
        timezone: 'America/New_York',
      },
    );
    expect(isReadyTarvisIntent(dated)).toBe(true);
    if (isReadyTarvisIntent(dated)) {
      expect(describeTarvisIntent(dated.intent)).toContain('Thu, Aug 6');
      expect(describeTarvisIntent(dated.intent)).not.toContain('2026-08-06');
    }
  });

  it('uses Arabic digits for import warnings, food titles, and overflow counts', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'ar-EG',
    });

    const preview = parseDexcomClarityCsv(
      [
        'Timestamp,Event Type,Glucose Value (mg/dL)',
        '2026-07-27T09:00:00,EGV,100',
        '2026-07-27T09:05:00,EGV,not available',
        '2026-07-27T09:10:00,EGV,not available',
      ].join('\n'),
    );
    expect(preview.warnings.join(' ')).toContain('٢ glucose rows');

    expect(
      foodLogTitle({
        mealType: 'lunch',
        items: [{}, {}],
      } as never),
    ).toBe('Lunch · ٢ items');
    expect(
      mealItemNames({
        nutritionDetail: 'itemized',
        items: ['One', 'Two', 'Three', 'Four', 'Five'].map((name) => ({
          name,
        })),
      } as never),
    ).toEqual(['One', 'Two', 'Three', 'and ٢ more']);
  });

  it('localizes accessibility counts in both evidence chart grammars', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'ar-EG',
    });

    const clockSummary = buildEvidenceClockWindowAccessibilitySummary({
      aggregatePoints: [],
      coverageSummary: 'Saved coverage',
      domain: { startMinute: 0, endMinuteUnwrapped: 60 },
      minimumAggregateContributors: 2,
      title: 'Clock evidence',
      units: 'mmol/L',
      windows: ['One', 'Two', 'Three', 'Four', 'Five'].map((label, index) => ({
        id: label,
        label,
        points: [{ minute: index, mmolL: 6 }],
        status: 'complete' as const,
      })),
    });
    expect(clockSummary).toContain('٥ of ٥ requested occurrences');
    expect(clockSummary).toContain('and ٢ more');

    const querySummary = buildEvidenceQueryAccessibilitySummary({
      kind: 'period-comparison-v1',
      metric: 'glucose.mean',
      schemaVersion: 1,
      subtitle: 'Comparison',
      targetRange: { minimum: 3.9, maximum: 10 },
      timezone: 'Europe/London',
      title: 'Evidence comparison',
      units: 'mmol/L',
      valueDomain: { minimum: 0, maximum: 20 },
      gapThresholdMilliseconds: 20 * 60_000,
      windows: [0, 1].map((index) => ({
        id: `window-${index}`,
        label: `Window ${index}`,
        range: {
          start: Date.parse('2026-08-01T00:00:00Z') + index * 86_400_000,
          end: Date.parse('2026-08-02T00:00:00Z') + index * 86_400_000,
        },
        recordCount: 0,
        coveragePercent: 0,
        coverageStatus: 'unavailable' as const,
        distribution: null,
        events: [],
        meanMmolL: null,
        points: [],
      })),
    });
    expect(querySummary).toContain('compares ٢ exact periods');
  });
});
