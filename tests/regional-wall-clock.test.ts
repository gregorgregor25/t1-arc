import { describe, expect, it } from 'vitest';

import { formatGlookoPumpScheduleSegment } from '@/data/glooko/glookoReportPresentation';
import {
  formatRegionalWallClock,
  formatRegionalWallClockMinute,
  parseRegionalWallClock,
} from '@/domain/regionalWallClock';

describe('regional wall-clock presentation', () => {
  it.each([
    ['en-US', '12:00 AM', '01:05 PM'],
    ['en-GB', '00:00', '13:05'],
    ['ja-JP', '00:00', '13:05'],
  ])('uses the %s clock without device-zone drift', (locale, midnight, afternoon) => {
    expect(formatRegionalWallClock('00:00', locale)).toBe(midnight);
    expect(formatRegionalWallClock('13:05', locale)).toBe(afternoon);
    expect(formatRegionalWallClockMinute(13 * 60 + 5, locale)).toBe(afternoon);
    expect(parseRegionalWallClock(afternoon, locale)).toBe(13 * 60 + 5);
  });

  it('keeps accepting legacy ASCII 24-hour editor values', () => {
    expect(parseRegionalWallClock('07:30', 'en-US')).toBe(450);
    expect(parseRegionalWallClock('١٣:٠٥', 'ar-EG')).toBe(785);
    expect(formatRegionalWallClock('not-a-time', 'en-GB')).toBe('not-a-time');
  });

  it('converts canonical glucose schedules for US display', () => {
    const segment = {
      startTime: '13:05',
      durationMinutes: 660,
      value: 5.5,
      unit: 'mmol/L' as const,
    };
    expect(
      formatGlookoPumpScheduleSegment(segment, {
        glucoseUnit: 'mmolL',
        locale: 'en-GB',
      }),
    ).toBe('13:05 5.5 mmol/L');
    expect(
      formatGlookoPumpScheduleSegment(segment, {
        glucoseUnit: 'mgDl',
        locale: 'en-US',
      }),
    ).toBe('01:05 PM 99 mg/dL');
  });
});
