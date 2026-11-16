import { afterEach, describe, expect, it } from 'vitest';

import { buildClinicReport, escapeReportHtml, reportDays } from '@/domain/clinicReport';
import { laggingDataStamps } from '@/domain/dataThrough';
import { personalGlucoseRange } from '@/domain/glucoseRanges';
import type { BasalDelivery, BolusDelivery, GlucoseReading, MealEvent } from '@/domain/models';
import { periodGmi, summarizePeriod, type PeriodSummaryTimeline } from '@/domain/periodSummary';
import { buildPeriodSummaryText } from '@/domain/periodSummaryText';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-16T10:00:00Z');
const MMOL = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mmolL' } as const;
const MG_DL = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mgDl' } as const;

function series(start: number, end: number, value: (index: number) => number, stepMinutes = 5, sourceId = 't1arc-librelinkup'): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  for (let timestamp = start, index = 0; timestamp < end; timestamp += stepMinutes * MINUTE, index += 1) {
    readings.push({ id: `${sourceId}-${index}`, timestamp, receivedAt: timestamp, mmolL: value(index), trend: 'flat', quality: 'measured', sourceId });
  }
  return readings;
}

function timeline(range: { start: number; end: number }, extra: Partial<PeriodSummaryTimeline> = {}): PeriodSummaryTimeline {
  return { range, glucose: [], basal: [], boluses: [], dailyInsulinTotals: [], context: [], ...extra };
}

const wave = (index: number) => [3.5, 5, 6, 7, 8, 9, 11, 12, 15, 6][index % 10]!;

describe('GMI rules', () => {
  it('shows GMI for 14 days with at least 70% coverage', () => {
    const range = { start: NOW - 14 * DAY, end: NOW };
    const gmi = periodGmi({ range, glucose: series(range.start, range.end, () => 8) });
    expect(gmi).toEqual({ status: 'shown', percent: 6.8, mmolMol: 50 });
  });

  it('withholds GMI and says why for a short period', () => {
    const range = { start: NOW - 7 * DAY, end: NOW };
    const gmi = periodGmi({ range, glucose: series(range.start, range.end, () => 8) });
    expect(gmi).toEqual({ status: 'withheld', reason: 'GMI is shown for at least 14 days with at least 70% sensor coverage. This period is 7 days with 100% coverage.' });
  });

  it('withholds GMI for low coverage and for no readings', () => {
    const range = { start: NOW - 14 * DAY, end: NOW };
    const partial = periodGmi({ range, glucose: series(range.start, range.start + 5 * DAY, () => 8) });
    expect(partial.status).toBe('withheld');
    expect(partial.status === 'withheld' && partial.reason).toContain('36% coverage');
    expect(periodGmi({ range, glucose: [] })).toEqual({ status: 'withheld', reason: 'No sensor readings were recorded in this period.' });
  });
});

describe('summary text', () => {
  const range = { start: NOW - 7 * DAY, end: NOW };
  const bolus: BolusDelivery = { id: 'b1', timestamp: NOW - 3 * 60 * MINUTE, units: 4, sourceId: 'glooko-export' };
  const basal: BasalDelivery = { id: 'ba1', start: NOW - DAY, end: NOW - 22 * 60 * MINUTE, rateUnitsPerHour: 1, units: 2, sourceId: 'glooko-export' };
  const meal: MealEvent = { id: 'm1', kind: 'meal', title: 'Lunch', mealType: 'lunch', start: NOW - 4 * 60 * MINUTE, carbsGrams: 45, sourceId: 't1arc-manual', origin: 'manual' };

  it('names every range, lists the five bands and withholds GMI with the reason', () => {
    const summary = summarizePeriod(timeline(range, {
      glucose: series(range.start, range.end, wave), boluses: [bolus], basal: [basal], context: [meal],
    }), personalGlucoseRange({ targetMin: 4, targetMax: 8 }));
    const text = buildPeriodSummaryText(summary, MMOL, NOW);
    expect(text).toContain('Period: 9 Nov 2026 – 16 Nov 2026 (7 days)');
    expect(text).toContain('Times: London (Greenwich Mean Time)');
    expect(text).toContain('Sensor coverage: 100%');
    expect(text).toContain('Time in ranges (Standard range 3.9–10.0 mmol/L):');
    for (const band of ['Very low (below 3.0 mmol/L): 0%', 'Low (3.0–3.8 mmol/L): 10%', 'In range (3.9–10.0 mmol/L): 60.1%', 'High (10.1–13.9 mmol/L): 19.9%', 'Very high (above 13.9 mmol/L): 10%']) {
      expect(text).toContain(`  ${band}`);
    }
    expect(text).toContain('Tight range 3.9–7.8 mmol/L: 40% in range');
    expect(text).toContain('Your range 4.0–8.0 mmol/L (your own setting): 50% in range');
    expect(text).toContain('Average glucose: 8.2 mmol/L');
    expect(text).toContain('GMI: not shown. GMI is shown for at least 14 days');
    expect(text).toMatch(/Standard deviation: \d\.\d mmol\/L · Coefficient of variation: \d+(\.\d)?%/);
    expect(text).toContain('Glucose source: LibreLinkUp');
    expect(text).toContain('Insulin recorded: 6.0 U total · basal 2.0 U · bolus 4.0 U');
    expect(text).toContain('Source: Glooko · records through 07:00');
    expect(text).toContain('Carbohydrate logged: 45 g across 1 entry');
    expect(text).toContain('not treatment advice');
    expect(text).not.toMatch(/undefined|NaN|you should|recommend/i);
  });

  it('uses mg/dL throughout when chosen', () => {
    const summary = summarizePeriod(timeline(range, { glucose: series(range.start, range.end, wave) }), null);
    const text = buildPeriodSummaryText(summary, MG_DL, NOW);
    expect(text).toContain('Time in ranges (Standard range 70–180 mg/dL):');
    expect(text).toContain('Very high (above 250 mg/dL)');
    expect(text).toContain('Tight range 70–140 mg/dL');
    expect(text).toMatch(/Average glucose: \d+ mg\/dL/);
    expect(text).toMatch(/Standard deviation: \d+ mg\/dL/);
    expect(text).not.toContain('mmol/L');
    expect(text).not.toContain('Your range');
    expect(text).not.toContain('Insulin recorded');
  });

  it('states partial coverage and leaves out figures when there are no readings', () => {
    const partial = summarizePeriod(timeline(range, { glucose: series(range.start, range.start + DAY, () => 6) }), null);
    expect(buildPeriodSummaryText(partial, MMOL, NOW)).toContain('so these figures describe the recorded time only');
    const empty = buildPeriodSummaryText(summarizePeriod(timeline(range), null), MMOL, NOW);
    expect(empty).toContain('No sensor readings were recorded in this period');
    expect(empty).not.toContain('Time in ranges');
    expect(empty).not.toContain('GMI');
  });
});

describe('data-through stamps', () => {
  const today = { start: Date.parse('2026-11-16T00:00:00Z'), end: NOW };

  it('shows the newest synced insulin record when it trails by more than an hour', () => {
    const stamps = laggingDataStamps({
      range: today,
      glucose: series(today.start, NOW, () => 6),
      boluses: [{ id: 'b', timestamp: Date.parse('2026-11-16T08:00:00Z'), units: 2, sourceId: 'glooko-export' }],
      basal: [],
    }, NOW, MMOL);
    expect(stamps).toEqual([{ kind: 'insulin', through: Date.parse('2026-11-16T08:00:00Z'), text: 'Insulin records through 08:00' }]);
  });

  it('hides stamps when records are current or only typed into T1 Arc', () => {
    expect(laggingDataStamps({
      range: today,
      glucose: series(today.start, NOW, () => 6),
      boluses: [{ id: 'm', timestamp: Date.parse('2026-11-16T05:00:00Z'), units: 2, sourceId: 't1arc-manual' }],
      basal: [{ id: 'ba', start: today.start, end: NOW + 30 * MINUTE, rateUnitsPerHour: 1, units: 10, sourceId: 'aaps-local' }],
    }, NOW, MMOL)).toEqual([]);
  });

  it('shows lagging glucose with its date for a past period', () => {
    const range = { start: Date.parse('2026-11-14T00:00:00Z'), end: Date.parse('2026-11-15T00:00:00Z') };
    const stamps = laggingDataStamps({
      range, glucose: series(range.start, Date.parse('2026-11-14T13:00:00Z'), () => 6), boluses: [], basal: [],
    }, NOW, MMOL, ['glucose']);
    expect(stamps.map((stamp) => stamp.text)).toEqual(['Glucose records through 14 Nov 2026, 12:55']);
  });
});

describe('clinic report', () => {
  const range = { start: NOW - 14 * DAY, end: NOW };

  it('includes the summary, typical day, daily overview, totals and footer', () => {
    const glucose = series(range.start, range.end, wave);
    const summary = summarizePeriod(timeline(range, {
      glucose,
      boluses: [{ id: 'b1', timestamp: NOW - 3 * 60 * MINUTE, units: 4, sourceId: 'nightscout' }],
    }), null);
    const report = buildClinicReport({ summary, glucose, settings: MMOL, generatedAt: NOW });
    expect(report.sections).toEqual(['glucose', 'typical-day', 'daily', 'insulin-carbs']);
    expect(report.html).toContain('Content-Security-Policy');
    expect(report.html).toContain('@media print');
    expect(report.html).toContain('<h2>Typical day</h2>');
    expect(report.html).not.toMatch(/\bAGP\b|Ambulatory Glucose Profile/i);
    expect(report.html).toContain('GMI');
    expect(report.html).toContain('mmol/mol');
    expect(report.html).toContain('Tight range 3.9–7.8 mmol/L');
    expect(report.html).toContain('Coefficient of variation');
    expect(report.html).toContain('not a medical device');
    expect(report.html).toContain('Data sources: LibreLinkUp, Nightscout.');
    expect(report.html.match(/class="day"/g)).toHaveLength(15);
    expect(report.html).not.toMatch(/undefined|NaN|<script/);
    // The only address is the SVG namespace; nothing is loaded from the network.
    expect(report.html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(report.fileName).toBe('T1-Arc-glucose-report-2026-11-16.html');
  });

  it('hides empty sections and states when nothing is stored', () => {
    const empty = buildClinicReport({ summary: summarizePeriod(timeline(range), null), glucose: [], settings: MMOL, generatedAt: NOW });
    expect(empty.sections).toEqual([]);
    expect(empty.html).toContain('No glucose, insulin or carbohydrate records are stored for this period.');
    expect(empty.html).not.toContain('Typical day');
    expect(empty.html).not.toContain('Insulin and carbohydrate');

    const glucose = series(range.start, range.end, () => 7);
    const glucoseOnly = buildClinicReport({ summary: summarizePeriod(timeline(range, { glucose }), null), glucose, settings: MG_DL, generatedAt: NOW });
    expect(glucoseOnly.sections).toEqual(['glucose', 'typical-day', 'daily']);
    expect(glucoseOnly.html).toContain('70–180 mg/dL');
  });

  it('withholds GMI with its reason and omits the typical day when too few days have readings', () => {
    const glucose = series(range.start, range.start + DAY, () => 7);
    const report = buildClinicReport({ summary: summarizePeriod(timeline(range, { glucose }), null), glucose, settings: MMOL, generatedAt: NOW });
    expect(report.html).toContain('GMI is shown for at least 14 days with at least 70% sensor coverage.');
    expect(report.html).toContain('describe the recorded time only');
    expect(report.sections).not.toContain('typical-day');
    expect(report.html).toContain('No readings');
  });

  it('escapes text placed in the page', () => {
    expect(escapeReportHtml(`<script>"a" & 'b'</script>`)).toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;');
  });

  it('splits days on local midnight, including a 23-hour clock-change day', () => {
    const days = reportDays({ start: Date.parse('2026-03-28T00:00:00Z'), end: Date.parse('2026-03-29T23:00:00Z') }, 'Europe/London');
    expect(days.map((day) => [day.date, (day.dayEnd - day.dayStart) / 3_600_000])).toEqual([
      ['2026-03-28', 24],
      ['2026-03-29', 23],
    ]);
  });
});
