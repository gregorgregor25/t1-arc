import { afterEach, describe, expect, it } from 'vitest';

import { buildGlucoseProfile } from '@/domain/glucoseProfile';
import { GlucoseReading } from '@/domain/models';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import {
  addDays,
  dayRange,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

function reading(
  id: string,
  timestamp: number,
  mmolL: number,
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test',
  };
}

describe('aggregate glucose profile', () => {
  it('calculates local-clock percentiles only when enough separate days contribute', () => {
    const startDate = '2026-07-20' as const;
    const range = {
      start: dayRange(startDate).start,
      end: dayRange(addDays(startDate, 5)).start,
    };
    const readings: GlucoseReading[] = [];
    [5, 6, 7, 8, 9].forEach((value, index) => {
      const date = addDays(startDate, index);
      readings.push(
        reading(
          `morning-${index}`,
          zonedDateTimeToTimestamp(date, 8, 10),
          value,
        ),
      );
    });
    readings.push(
      reading(
        'lonely-evening',
        zonedDateTimeToTimestamp(startDate, 20, 10),
        12,
      ),
    );

    const profile = buildGlucoseProfile(readings, range);
    const morning = profile.bins[16];
    const evening = profile.bins[40];

    expect(profile.expectedDays).toBe(5);
    expect(profile.minimumDaysPerBin).toBe(2);
    expect(morning?.representedDays).toBe(5);
    expect(morning?.median).toBe(7);
    expect(morning?.p25).toBe(6);
    expect(morning?.p75).toBe(8);
    expect(morning?.recordIds).toHaveLength(5);
    expect(evening?.representedDays).toBe(1);
    expect(evening?.median).toBeUndefined();
  });

  it('falls back to half-hour bins for an invalid bin size', () => {
    const range = {
      start: zonedDateTimeToTimestamp('2026-07-20'),
      end: zonedDateTimeToTimestamp('2026-07-23'),
    };

    const profile = buildGlucoseProfile([], range, 17);

    expect(profile.binMinutes).toBe(30);
    expect(profile.bins).toHaveLength(48);
  });

  it('uses numeric wall-clock parts when the locale renders Arabic digits', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'other',
      countryCode: 'EG',
      languageTag: 'ar-EG',
      analysisTimeZone: 'Africa/Cairo',
      followDeviceTimeZone: false,
    });
    const timestamp = Date.parse('2026-08-01T09:15:00+03:00');
    const profile = buildGlucoseProfile(
      [reading('arabic-clock', timestamp, 6)],
      {
        start: Date.parse('2026-08-01T00:00:00+03:00'),
        end: Date.parse('2026-08-02T00:00:00+03:00'),
      },
    );

    expect(profile.bins[18]?.readingCount).toBe(1);
  });
});
