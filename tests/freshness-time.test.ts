import { describe, expect, it } from 'vitest';

import { glucoseFreshness } from '@/domain/freshness';
import {
  addDays,
  dayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

const MINUTE = 60_000;

describe('glucose freshness', () => {
  const now = 1_000_000_000;

  it('uses explicit current, delayed, stale and missing windows', () => {
    expect(glucoseFreshness(now - 6 * MINUTE, now)).toBe('current');
    expect(glucoseFreshness(now - 7 * MINUTE, now)).toBe('delayed');
    expect(glucoseFreshness(now - 12 * MINUTE, now)).toBe('delayed');
    expect(glucoseFreshness(now - 13 * MINUTE, now)).toBe('stale');
    expect(glucoseFreshness(undefined, now)).toBe('missing');
  });
});

describe('Europe/London date handling', () => {
  it('adds calendar days without drifting across months', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('represents the short and long DST days correctly', () => {
    const spring = dayRange(
      '2026-03-29',
      zonedDateTimeToTimestamp('2026-04-01', 12),
    );
    const autumn = dayRange(
      '2026-10-25',
      zonedDateTimeToTimestamp('2026-11-01', 12),
    );

    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    expect((autumn.end - autumn.start) / 3_600_000).toBe(25);
  });

  it('round-trips a London date key', () => {
    const timestamp = zonedDateTimeToTimestamp('2026-07-25', 12, 30);
    expect(toDateKey(timestamp)).toBe('2026-07-25');
  });
});
