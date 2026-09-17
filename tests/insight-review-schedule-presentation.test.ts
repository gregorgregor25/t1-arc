import { describe, expect, it } from 'vitest';

import {
  reviewTimeLabel,
  reviewWeekdayLabel,
  weeklyReviewScheduleLabel,
} from '@/components/insightReviewSchedulePresentation';
import { regionalClockUses24Hours } from '@/components/zonedDateTimePicker';

describe('weekly review schedule presentation', () => {
  it('keeps weekday fixtures stable in extreme device zones', () => {
    expect(reviewWeekdayLabel('en-US', 0, 'long')).toBe('Sunday');
    expect(reviewWeekdayLabel('en-GB', 1, 'long')).toBe('Monday');
    expect(reviewWeekdayLabel('ja-JP', 6, 'long')).toBe('土曜日');
  });

  it('uses the locale clock convention without changing the stored wall time', () => {
    expect(regionalClockUses24Hours('en-US')).toBe(false);
    expect(regionalClockUses24Hours('en-GB')).toBe(true);
    expect(reviewTimeLabel('en-US', 19, 5)).toMatch(/7:05\s*PM/i);
    expect(reviewTimeLabel('en-GB', 19, 5)).toBe('19:05');
  });

  it('labels a US schedule with its selected analysis zone', () => {
    expect(
      weeklyReviewScheduleLabel({
        hour: 19,
        locale: 'en-US',
        minute: 5,
        timeZone: 'America/New_York',
        weekday: 0,
      }),
    ).toMatch(/^Sun 7:05\s*PM · America\/New_York$/i);
  });
});
