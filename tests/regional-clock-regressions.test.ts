import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
  evidenceOverlayClockMinute,
  evidenceOverlayDateKey,
} from '@/components/evidenceGlucoseOverlayClock';
import { selectRetrospectiveActivities } from '@/data/tarvis/retrospectiveEventReview';
import { buildInsightReport } from '@/domain/insights';
import type { ActivityEvent, TimelineData } from '@/domain/models';
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

function timeline(
  start: number,
  end: number,
  context: TimelineData['context'] = [],
): TimelineData {
  return {
    range: { start, end },
    glucose: [],
    basal: [],
    boluses: [],
    context,
    sources: [],
  };
}

describe('regional 12-hour clock regressions', () => {
  it('places an en-US 13:30 reading at 13:30 rather than 01:30', () => {
    const timestamp = Date.parse('2026-08-15T13:30:00-04:00');

    expect(
      evidenceOverlayClockMinute(timestamp, 'en-US', 'America/New_York'),
    ).toBe(13 * 60 + 30);
  });

  it('keeps overlay arithmetic independent of localized numeral glyphs', () => {
    expect(
      evidenceOverlayClockMinute(
        Date.parse('2026-08-15T13:30:00+03:00'),
        'ar-EG',
        'Africa/Cairo',
      ),
    ).toBe(13 * 60 + 30);
  });

  it('recomputes overlay clock and local-day grouping when the profile zone changes', () => {
    const clockTimestamp = Date.parse('2026-08-15T17:30:00Z');
    expect(
      evidenceOverlayClockMinute(
        clockTimestamp,
        'en-US',
        'America/New_York',
      ),
    ).toBe(13 * 60 + 30);
    expect(
      evidenceOverlayClockMinute(clockTimestamp, 'ja-JP', 'Asia/Tokyo'),
    ).toBe(26 * 60 + 30);

    const groupingTimestamp = Date.parse('2026-08-15T10:30:00Z');
    expect(
      evidenceOverlayDateKey(groupingTimestamp, 'America/New_York'),
    ).toBe('2026-08-14');
    expect(evidenceOverlayDateKey(groupingTimestamp, 'Asia/Tokyo')).toBe(
      '2026-08-15',
    );
  });

  it('groups noon-anchored overlays by wall clock across DST boundaries', () => {
    // The spring-forward day is only 23 elapsed hours long. Subtracting twelve
    // hours from 12:30 BST would incorrectly land on the previous date.
    expect(
      evidenceOverlayDateKey(
        Date.parse('2026-03-29T11:30:00Z'),
        'Europe/London',
      ),
    ).toBe('2026-03-29');

    // On the 25-hour fall-back day, 11:30 GMT still belongs to the overlay
    // which began at noon on the previous local calendar day.
    expect(
      evidenceOverlayDateKey(
        Date.parse('2026-10-25T11:30:00Z'),
        'Europe/London',
      ),
    ).toBe('2026-10-24');
  });

  it('keeps overlay grouping and memoization tied to the active locale and zone', () => {
    const source = readFileSync(
      new URL('../src/components/EvidenceGlucoseOverlay.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      'evidenceOverlayDateKey(\n        reading.timestamp,\n        regional.timeZone,',
    );
    expect(source).toContain(
      'regional.locale,\n          regional.timeZone,',
    );
    expect(source).toContain(
      '[readings, regional.locale, regional.timeZone]',
    );
  });

  it('counts a US 20:30 meal as late in insight summaries', () => {
    setRuntimeRegionalProfile(US_PROFILE);
    const end = Date.parse('2026-08-16T00:00:00-04:00');
    const currentStart = end - 7 * 24 * 60 * 60_000;
    const previousStart = currentStart - 7 * 24 * 60 * 60_000;
    const current = timeline(currentStart, end, [
      {
        id: 'late-us-meal',
        kind: 'meal',
        start: Date.parse('2026-08-14T20:30:00-04:00'),
        sourceId: 'manual-food',
        origin: 'manual',
        title: 'Dinner',
        mealType: 'dinner',
        carbsGrams: 45,
      },
    ]);

    const report = buildInsightReport(
      current,
      timeline(previousStart, currentStart),
      end,
    );

    expect(report.current.lateMeals).toBe(1);
  });

  it('selects US afternoon and evening activities using their real local hour', () => {
    setRuntimeRegionalProfile(US_PROFILE);
    const activity = (
      id: string,
      start: string,
      title: string,
    ): ActivityEvent => ({
      id,
      kind: 'activity',
      start: Date.parse(start),
      sourceId: 'health-connect',
      origin: 'imported',
      title,
      activityType: 'walk',
      durationMinutes: 30,
      intensity: 'moderate',
    });
    const afternoon = activity(
      'afternoon-walk',
      '2026-08-14T13:30:00-04:00',
      'Afternoon walk',
    );
    const evening = activity(
      'evening-walk',
      '2026-08-14T19:30:00-04:00',
      'Evening walk',
    );
    const data = timeline(
      Date.parse('2026-08-14T00:00:00-04:00'),
      Date.parse('2026-08-15T00:00:00-04:00'),
      [afternoon, evening],
    );

    expect(
      selectRetrospectiveActivities(
        'Why did I go low during my walk this afternoon?',
        data,
      ).map(({ id }) => id),
    ).toEqual(['afternoon-walk']);
    expect(
      selectRetrospectiveActivities(
        'Why did I go low during my walk this evening?',
        data,
      ).map(({ id }) => id),
    ).toEqual(['evening-walk']);
    expect(
      selectRetrospectiveActivities(
        'Why did I go low during my walk at 19:30?',
        data,
      ).map(({ id }) => id),
    ).toEqual(['evening-walk']);
  });
});
