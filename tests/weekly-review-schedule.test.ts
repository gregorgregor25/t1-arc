import { describe, expect, it } from 'vitest';

import { weeklyReviewSchedule } from '@/domain/weeklyReviewSchedule';
import { zonedDateTimeToTimestamp } from '@/domain/time';

describe('weekly review schedule', () => {
  it('waits until Monday morning in Europe/London', () => {
    const before = zonedDateTimeToTimestamp('2026-07-27', 6, 59);
    const after = zonedDateTimeToTimestamp('2026-07-27', 7, 1);

    expect(weeklyReviewSchedule(before)).toMatchObject({
      weekKey: '2026-07-27',
      due: false,
    });
    expect(weeklyReviewSchedule(after)).toMatchObject({
      weekKey: '2026-07-27',
      due: true,
    });
  });

  it('remains due later in the week if Android did not run on Monday', () => {
    const thursday = zonedDateTimeToTimestamp('2026-07-30', 14);
    expect(weeklyReviewSchedule(thursday).due).toBe(true);
  });

  it('notifies at most once per London week', () => {
    const sunday = zonedDateTimeToTimestamp('2026-08-02', 20);
    expect(
      weeklyReviewSchedule(sunday, '2026-07-27'),
    ).toMatchObject({
      weekKey: '2026-07-27',
      due: false,
    });
  });

  it('uses the correct Monday across the autumn clock change', () => {
    const afterClockChange = zonedDateTimeToTimestamp('2026-10-26', 7, 1);
    const schedule = weeklyReviewSchedule(afterClockChange);
    expect(schedule.weekKey).toBe('2026-10-26');
    expect(schedule.eligibleAt).toBe(
      zonedDateTimeToTimestamp('2026-10-26', 7),
    );
    expect(schedule.due).toBe(true);
  });

  it('supports a Sunday schedule in New York independently of the device zone', () => {
    const before = zonedDateTimeToTimestamp(
      '2026-11-01',
      8,
      29,
      0,
      'America/New_York',
    );
    const after = zonedDateTimeToTimestamp(
      '2026-11-01',
      8,
      31,
      0,
      'America/New_York',
    );
    const options = {
      weekday: 0,
      hour: 8,
      minute: 30,
      timeZone: 'America/New_York',
    };
    expect(weeklyReviewSchedule(before, undefined, options).due).toBe(false);
    expect(weeklyReviewSchedule(after, undefined, options)).toMatchObject({
      weekKey: '2026-11-01',
      due: true,
    });
  });

  it('preserves half-hour-zone schedule instants', () => {
    const expected = zonedDateTimeToTimestamp(
      '2026-08-24',
      7,
      15,
      0,
      'Asia/Kolkata',
    );
    expect(
      weeklyReviewSchedule(expected, undefined, {
        weekday: 1,
        hour: 7,
        minute: 15,
        timeZone: 'Asia/Kolkata',
      }).eligibleAt,
    ).toBe(expected);
  });
});
