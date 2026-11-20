import { describe, expect, it } from 'vitest';

import { personalGlucoseRange } from '@/domain/glucoseRanges';
import type { BolusDelivery, GlucoseReading } from '@/domain/models';
import {
  buildPeriodNarrative,
  PERIOD_SUMMARY_FOOTER,
  periodNarrativeText,
  periodSummaryRequest,
} from '@/domain/periodSummaryNarrative';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MMOL = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mmolL' } as const;
const MG_DL = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mgDl' } as const;

function series(start: number, end: number, value: (index: number) => number, stepMinutes = 5): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  for (let timestamp = start, index = 0; timestamp < end; timestamp += stepMinutes * MINUTE, index += 1) {
    readings.push({ id: `g-${timestamp}`, timestamp, receivedAt: timestamp, mmolL: value(index), trend: 'flat', quality: 'measured', sourceId: 't1arc-librelinkup' });
  }
  return readings;
}

const empty = { glucose: [], basal: [], boluses: [], dailyInsulinTotals: [], context: [] };
const lines = (narrative: ReturnType<typeof buildPeriodNarrative>) => narrative.sections.flatMap((section) => section.lines);

describe('period summary requests', () => {
  const now = Date.parse('2026-11-17T09:30:00Z');

  it('uses local midnight to now for today and complete days for 7, 14 and 30', () => {
    expect(periodSummaryRequest('today', now, 'Europe/London').range).toEqual({ start: Date.parse('2026-11-17T00:00:00Z'), end: now });
    expect(periodSummaryRequest('7', now, 'Europe/London')).toEqual({
      choice: '7', title: 'Last 7 complete days', range: { start: Date.parse('2026-11-10T00:00:00Z'), end: Date.parse('2026-11-17T00:00:00Z') },
    });
    // 18 Oct is still British Summer Time, so local midnight is 23:00 UTC.
    expect(periodSummaryRequest('30', now, 'Europe/London').range.start).toBe(Date.parse('2026-10-17T23:00:00Z'));
  });

  it('uses the local time zone, not the phone default', () => {
    expect(periodSummaryRequest('today', now, 'America/New_York').range.start).toBe(Date.parse('2026-11-17T05:00:00Z'));
  });

  it('keeps the real length of clock-change nights in Europe/London', () => {
    const autumn = periodSummaryRequest('last-night', Date.parse('2026-10-25T09:00:00Z'), 'Europe/London');
    expect(autumn.range.end - autumn.range.start).toBe(7 * HOUR);
    const spring = periodSummaryRequest('last-night', Date.parse('2026-03-29T09:00:00Z'), 'Europe/London');
    expect(spring.range.end - spring.range.start).toBe(5 * HOUR);
  });

  it('follows a night schedule from alarm settings', () => {
    const request = periodSummaryRequest('last-night', now, 'Europe/London', { startMinutes: 23 * 60, endMinutes: 7 * 60 });
    expect(request.range).toEqual({ start: Date.parse('2026-11-16T23:00:00Z'), end: Date.parse('2026-11-17T07:00:00Z') });
    expect(request.title).toBe('Last night');
  });
});

describe('period summary narrative', () => {
  const now = Date.parse('2026-11-17T09:30:00Z');

  it('describes a well-covered week in mmol/L with every range named and GMI withheld', () => {
    const request = periodSummaryRequest('7', now, 'Europe/London');
    const bolus: BolusDelivery = { id: 'b1', timestamp: request.range.end - 3 * HOUR, units: 4, sourceId: 'glooko-export' };
    const narrative = buildPeriodNarrative(request, {
      ...empty,
      glucose: series(request.range.start, request.range.end, (index) => [5, 6, 7, 8, 11][index % 5]!),
      boluses: [bolus],
    }, personalGlucoseRange({ targetMin: 4, targetMax: 8 }), MMOL, now);
    const text = lines(narrative);
    expect(narrative.period).toBe('10 Nov 2026 – 16 Nov 2026 (7 days)');
    expect(text).toContain('Sensor readings cover 100% of this period (2,016 readings).');
    expect(text).toContain('Standard range 3.9–10.0 mmol/L: 80% of recorded time in range.');
    expect(text).toContain('High (10.1–13.9 mmol/L): 20%');
    expect(text).toContain('Tight range 3.9–7.8 mmol/L: 60% in range.');
    expect(text).toContain('Your range 4.0–8.0 mmol/L (your own setting): 80% in range.');
    expect(text).toContain('Average glucose: 7.4 mmol/L.');
    expect(text.find((line) => line.startsWith('GMI not shown.'))).toContain('at least 14 days');
    expect(text.find((line) => line.startsWith('Variability:'))).toMatch(/standard deviation \d\.\d mmol\/L, coefficient of variation \d+(\.\d)?%/);
    expect(text).toContain('Low episodes (below 3.9 mmol/L for at least 15 minutes): 0.');
    expect(text.some((line) => line.startsWith('Insulin recorded: 4.0 U total'))).toBe(true);
    expect(text.some((line) => line.includes('records through'))).toBe(true);
    expect(narrative.footer).toBe(PERIOD_SUMMARY_FOOTER);
    expect(periodNarrativeText(narrative)).not.toMatch(/\b(good|bad|great|poor|excellent|well done|should|recommend)\b/i);
  });

  it('uses mg/dL thresholds and values when that unit is chosen', () => {
    const request = periodSummaryRequest('14', now, 'Europe/London');
    const narrative = buildPeriodNarrative(request, {
      ...empty, glucose: series(request.range.start, request.range.end, () => 8),
    }, null, MG_DL, now);
    const text = lines(narrative);
    expect(text).toContain('Standard range 70–180 mg/dL: 100% of recorded time in range.');
    expect(text).toContain('Average glucose: 144 mg/dL.');
    expect(text).toContain('Low episodes (below 70 mg/dL for at least 15 minutes): 0.');
    expect(text).toContain('GMI: 6.8% (50 mmol/mol).');
    expect(text.some((line) => line.startsWith('Your range'))).toBe(false);
  });

  it('counts sustained low and high episodes', () => {
    const request = periodSummaryRequest('today', now, 'Europe/London');
    const readings = series(request.range.start, request.range.end, (index) => (index >= 10 && index < 16 ? 3.2 : index >= 40 && index < 50 ? 12 : 6));
    const narrative = buildPeriodNarrative(request, { ...empty, glucose: readings }, null, MMOL, now);
    expect(narrative.lowEpisodes).toBe(1);
    expect(narrative.highEpisodes).toBe(1);
    expect(lines(narrative)).toContain('High episodes (above 10.0 mmol/L for at least 15 minutes): 1.');
  });

  it('states low coverage before the figures', () => {
    const request = periodSummaryRequest('7', now, 'Europe/London');
    const narrative = buildPeriodNarrative(request, {
      ...empty, glucose: series(request.range.start, request.range.start + 2 * DAY, () => 6),
    }, null, MMOL, now);
    const coverage = narrative.sections[0]!;
    expect(coverage.title).toBe('Coverage');
    expect(coverage.lines[0]).toBe('Sensor readings cover 28.6% of this period (576 readings).');
    expect(coverage.lines[1]).toContain('describe the recorded time only');
  });

  it('withholds glucose figures when nothing was recorded', () => {
    const request = periodSummaryRequest('last-night', now, 'Europe/London');
    const narrative = buildPeriodNarrative(request, empty, null, MMOL, now);
    expect(narrative.sections.map((section) => section.title)).toEqual(['Coverage', 'Insulin']);
    expect(lines(narrative)).toContain('No sensor readings were recorded in this period, so glucose figures are not available.');
    expect(lines(narrative)).toContain('No insulin records were found for this period.');
  });

  it('summarises an autumn clock-change night as 7 hours', () => {
    const autumnNow = Date.parse('2026-10-25T09:00:00Z');
    const request = periodSummaryRequest('last-night', autumnNow, 'Europe/London');
    const narrative = buildPeriodNarrative(request, {
      ...empty, glucose: series(request.range.start, request.range.end, () => 6),
    }, null, MMOL, autumnNow);
    expect(narrative.period).toBe('25 Oct 2026 (7 hours)');
    expect(lines(narrative)).toContain('Sensor readings cover 100% of this period (84 readings).');
  });
});
