import { describe, expect, it } from 'vitest';

import {
  dailyRangeSummaries,
  steadiestDay,
  steadiestDayText,
  yesterdayVsTodaySoFar,
} from '@/domain/dailyRangeHighlights';
import type { GlucoseReading } from '@/domain/models';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LONDON = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mmolL' } as const;

function series(start: number, end: number, value: (timestamp: number, index: number) => number): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  for (let timestamp = start, index = 0; timestamp < end; timestamp += 5 * MINUTE, index += 1) {
    readings.push({ id: `g-${timestamp}`, timestamp, receivedAt: timestamp, mmolL: value(timestamp, index), trend: 'flat', quality: 'measured', sourceId: 'test-cgm' });
  }
  return readings;
}

/** In range except for the first `highHours` of each day, which read 12 mmol/L. */
function day(dateIso: string, highHours: number, hours = 24): GlucoseReading[] {
  const start = Date.parse(dateIso);
  return series(start, start + hours * HOUR, (timestamp) => (timestamp - start < highHours * HOUR ? 12 : 6));
}

const WEEK = { start: Date.parse('2026-11-10T00:00:00Z'), end: Date.parse('2026-11-17T00:00:00Z') };

describe('steadiest day', () => {
  it('names the day with the highest standard time in range', () => {
    const readings = [
      ...day('2026-11-10T00:00:00Z', 6),
      ...day('2026-11-11T00:00:00Z', 2),
      ...day('2026-11-12T00:00:00Z', 4),
    ];
    const result = steadiestDay(dailyRangeSummaries(readings, WEEK, 'Europe/London'));
    expect(result).toMatchObject({ status: 'shown', dateKey: '2026-11-11', eligibleDays: 3, totalDays: 7, tiedDateKeys: [] });
    expect(steadiestDayText(result, LONDON).headline).toBe('Highest time in range: Wed 11 Nov, 91.7%');
    expect(steadiestDayText(result, LONDON).detail).toContain('Standard range 3.9–10.0 mmol/L');
  });

  it('skips a day with under 70% coverage even when its readings are all in range', () => {
    const readings = [
      ...day('2026-11-10T00:00:00Z', 4),
      ...day('2026-11-11T00:00:00Z', 0, 16), // 66.7% coverage, all in range
    ];
    const result = steadiestDay(dailyRangeSummaries(readings, WEEK, 'Europe/London'));
    expect(result).toMatchObject({ status: 'shown', dateKey: '2026-11-10', eligibleDays: 1 });
  });

  it('names the most recent day of a tie and lists the others', () => {
    const readings = [
      ...day('2026-11-10T00:00:00Z', 2),
      ...day('2026-11-12T00:00:00Z', 2),
      ...day('2026-11-14T00:00:00Z', 5),
    ];
    const result = steadiestDay(dailyRangeSummaries(readings, WEEK, 'Europe/London'));
    expect(result).toMatchObject({ status: 'shown', dateKey: '2026-11-12', tiedDateKeys: ['2026-11-10'] });
    expect(steadiestDayText(result, LONDON).detail).toContain('The same figure was recorded on Tue 10 Nov.');
  });

  it('withholds the card text when no day is representative', () => {
    const result = steadiestDay(dailyRangeSummaries(day('2026-11-10T00:00:00Z', 0, 6), WEEK, 'Europe/London'));
    expect(result).toEqual({ status: 'withheld', eligibleDays: 0, totalDays: 7 });
    expect(steadiestDayText(result, LONDON).detail).toBe('No day in this period had at least 70% sensor coverage, so no day is named.');
  });

  it('uses mg/dL in the range label when chosen', () => {
    const result = steadiestDay(dailyRangeSummaries(day('2026-11-10T00:00:00Z', 1), WEEK, 'Europe/London'));
    expect(steadiestDayText(result, { ...LONDON, glucoseUnit: 'mgDl' }).detail).toContain('Standard range 70–180 mg/dL');
  });

  it('keeps the real length of clock-change days', () => {
    const range = { start: Date.parse('2026-10-24T23:00:00Z'), end: Date.parse('2026-10-26T00:00:00Z') };
    const days = dailyRangeSummaries([], range, 'Europe/London');
    expect(days.map(({ dateKey }) => dateKey)).toEqual(['2026-10-25']);
    expect(days[0]!.range.end - days[0]!.range.start).toBe(25 * HOUR);
  });
});

describe('yesterday vs today so far', () => {
  it('compares today with the same clock hours yesterday', () => {
    const now = Date.parse('2026-11-17T09:30:00Z');
    const readings = series(Date.parse('2026-11-16T00:00:00Z'), now, (timestamp) => (timestamp < Date.parse('2026-11-16T03:00:00Z') ? 12 : 6));
    const result = yesterdayVsTodaySoFar(readings, now, 'Europe/London')!;
    expect(result.today.range).toEqual({ start: Date.parse('2026-11-17T00:00:00Z'), end: now });
    expect(result.yesterday.range).toEqual({ start: Date.parse('2026-11-16T00:00:00Z'), end: Date.parse('2026-11-16T09:30:00Z') });
    expect(result.comparable).toBe(true);
    expect(result.today.summary.standard.inRange.percent).toBe(100);
    expect(result.yesterday.summary.standard.inRange.percent).toBe(68.4);
  });

  it('is not comparable when either side has under 70% coverage', () => {
    const now = Date.parse('2026-11-17T09:30:00Z');
    const readings = series(Date.parse('2026-11-17T00:00:00Z'), now, () => 6);
    const result = yesterdayVsTodaySoFar(readings, now, 'Europe/London')!;
    expect(result.yesterday.summary.coveragePercent).toBe(0);
    expect(result.comparable).toBe(false);
  });

  it('uses the local time zone for midnight', () => {
    const now = Date.parse('2026-11-17T14:00:00Z');
    const result = yesterdayVsTodaySoFar([], now, 'America/New_York')!;
    expect(result.today.range.start).toBe(Date.parse('2026-11-17T05:00:00Z'));
    expect(result.yesterday.range).toEqual({ start: Date.parse('2026-11-16T05:00:00Z'), end: Date.parse('2026-11-16T14:00:00Z') });
  });

  it('caps yesterday at midnight on the short spring day', () => {
    // 29 Mar 2026 has no 01:00–02:00 in London; at 01:30 on 30 Mar the same
    // clock time yesterday is mapped by the zone rules, never past midnight.
    const now = Date.parse('2026-03-30T00:30:00Z');
    const result = yesterdayVsTodaySoFar([], now, 'Europe/London')!;
    expect(result.yesterday.range.start).toBe(Date.parse('2026-03-29T00:00:00Z'));
    expect(result.yesterday.range.end).toBeLessThanOrEqual(result.today.range.start);
  });
});
