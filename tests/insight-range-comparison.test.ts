import { afterEach, describe, expect, it } from 'vitest';

import {
  buildInsightComparisonRanges,
  insightComparisonForHistoryView,
  isInsightComparisonRequest,
} from '@/domain/insightRanges';
import { buildInsightReport } from '@/domain/insights';
import type { GlucoseReading, TimelineData } from '@/domain/models';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import { addDays, dayRange, toDateKey } from '@/domain/time';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

const MINUTE = 60_000;

function timeline(range: { start: number; end: number }, mmolL: (index: number) => number, stepMinutes = 5): TimelineData {
  const glucose: GlucoseReading[] = [];
  for (let timestamp = range.start, index = 0; timestamp < range.end; timestamp += stepMinutes * MINUTE, index += 1) {
    glucose.push({
      id: `g-${timestamp}`,
      timestamp,
      receivedAt: timestamp,
      mmolL: mmolL(index),
      trend: 'flat',
      quality: 'measured',
      sourceId: 'test-cgm',
    });
  }
  return { range, glucose, basal: [], boluses: [], context: [], sources: [] };
}

describe('comparison navigation from History', () => {
  it('keeps multi-day views and opens seven days for a single day', () => {
    expect(insightComparisonForHistoryView(3, '2026-07-20', '2026-07-25')).toEqual({ periodDays: 3, endDate: '2026-07-20' });
    expect(insightComparisonForHistoryView(7, '2026-07-20', '2026-07-25')).toEqual({ periodDays: 7, endDate: '2026-07-20' });
    expect(insightComparisonForHistoryView(30, '2026-07-20', '2026-07-25')).toEqual({ periodDays: 30, endDate: '2026-07-20' });
    expect(insightComparisonForHistoryView(1, '2026-07-20', '2026-07-25')).toEqual({ periodDays: 7, endDate: '2026-07-20' });
  });

  it('never ends a comparison on an incomplete day', () => {
    expect(insightComparisonForHistoryView(7, '2026-07-26', '2026-07-25').endDate).toBe('2026-07-25');
  });

  it('validates the one-shot navigation request', () => {
    expect(isInsightComparisonRequest({ periodDays: 90, endDate: '2026-07-25', request: 'r1' })).toBe(true);
    expect(isInsightComparisonRequest({ periodDays: 1, endDate: '2026-07-25', request: 'r1' })).toBe(false);
    expect(isInsightComparisonRequest({ periodDays: 7, endDate: '25/07/2026', request: 'r1' })).toBe(false);
    expect(isInsightComparisonRequest({ periodDays: 7, endDate: '2026-07-25', request: '' })).toBe(false);
    expect(isInsightComparisonRequest(undefined)).toBe(false);
  });
});

describe('90-day comparison periods', () => {
  it('builds two adjacent 90-day calendar periods across both London clock changes', () => {
    const ranges = buildInsightComparisonRanges('2026-11-15', 90, Date.parse('2026-11-16T12:00:00Z'));
    expect(toDateKey(ranges.current.start)).toBe(addDays('2026-11-15', -89));
    expect(ranges.previous.end).toBe(ranges.current.start);
    expect(toDateKey(ranges.previous.start)).toBe(addDays('2026-11-15', -179));
    // The recent period contains the autumn change (one extra hour).
    expect(ranges.current.end - ranges.current.start).toBe((90 * 24 + 1) * 60 * MINUTE);
  });
});

describe('comparison findings name their range definitions', () => {
  const now = Date.parse('2026-07-26T10:00:00+01:00');
  const currentRange = { start: dayRange('2026-07-19', now).start, end: dayRange('2026-07-25', now).end };
  const previousRange = { start: dayRange('2026-07-12', now).start, end: currentRange.start };

  it('reports standard, tight and consensus band figures from the same readings', () => {
    // Recent: alternate 6 and 12 mmol/L. Previous: steady 6 mmol/L.
    const current = timeline(currentRange, (index) => (index % 2 ? 12 : 6));
    const previous = timeline(previousRange, () => 6);
    const report = buildInsightReport(current, previous, now);
    expect(report.ready).toBe(true);
    expect(report.current).toMatchObject({
      timeInRangePercent: 50,
      timeInTightRangePercent: 50,
      timeHighPercent: 50,
      timeVeryHighPercent: 0,
      timeVeryLowPercent: 0,
      timeLowPercent: 0,
    });
    const overview = report.findings.find(({ id }) => id === 'glucose-overview')!;
    expect(overview.title).toBe('Time in the standard range fell by 50 percentage points');
    expect(overview.summary).toContain('Recent time in the standard range 3.9–10.0 mmol/L was 50% versus 100%.');
    expect(overview.summary).toContain('time in the tight range 3.9–7.8 mmol/L 50% versus 100%');
    expect(overview.summary).toContain('very low (below 3.0 mmol/L) 0% versus 0%');
    expect(overview.summary).toContain('high (10.1–13.9 mmol/L) 50% versus 0%');
    expect(report.headline).toBe('Time in the standard range was lower in the recent 7 days');
    expect(`${report.headline} ${report.summary} ${overview.title} ${overview.summary}`).not.toMatch(/\b(?:good|bad|better|worse)\b/i);
  });

  it('uses published mg/dL limits for mg/dL users', () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, glucoseUnit: 'mgDl' });
    {
      const report = buildInsightReport(
        timeline(currentRange, () => 6),
        timeline(previousRange, () => 6),
        now,
      );
      const overview = report.findings.find(({ id }) => id === 'glucose-overview')!;
      expect(overview.summary).toContain('the standard range 70–180 mg/dL');
      expect(overview.summary).toContain('the tight range 70–140 mg/dL');
      expect(overview.summary).toContain('very low (below 54 mg/dL)');
      expect(overview.summary).toContain('very high (above 250 mg/dL)');
    }
  });

  it('still withholds the comparison when either period has under 70% coverage', () => {
    // Readings every 20 minutes cover 12 of every 20 minutes (60%).
    const report = buildInsightReport(
      timeline(currentRange, () => 6, 20),
      timeline(previousRange, () => 6),
      now,
    );
    expect(report.ready).toBe(false);
    expect(report.current.coveragePercent).toBe(60);
    expect(report.findings.some(({ id }) => id === 'glucose-overview')).toBe(false);
  });
});
