import { describe, expect, it } from 'vitest';
import { presentGlanceGlucose } from '@/domain/glanceGlucosePresentation';
import { calculateGlucoseStats } from '@/domain/stats';
import type { GlucoseReading } from '@/domain/models';

const end = Date.parse('2026-09-08T12:00:00Z');
const range = { start: end - 6 * 3_600_000, end };
const reading = (timestamp: number): GlucoseReading => ({ id: `g:${timestamp}`, sourceId: 'xdrip',
  mmolL: 6, timestamp, receivedAt: timestamp, quality: 'measured', trend: 'flat' });

describe('Today glance observed glucose coverage', () => {
  it('does not present one old in-range reading as a complete six-hour success', () => {
    const stats = calculateGlucoseStats([reading(end - 90 * 60_000)], range);
    const original = { ...stats };
    expect(stats.timeInRangePercent).toBe(100);
    expect(stats.coveragePercent).toBeLessThan(5);
    const presentation = presentGlanceGlucose(stats, 'Last 6 hours', 'en-GB');
    expect(presentation).toEqual({ limited: true, value: 'Limited data',
      detail: 'Last 6 hours · 3.3% observed coverage' });
    expect(stats).toEqual(original);
  });

  it('retains the existing concise result for a well-covered window', () => {
    const readings = Array.from({ length: 72 }, (_, index) => reading(range.start + index * 300_000));
    const stats = calculateGlucoseStats(readings, range);
    expect(presentGlanceGlucose(stats, 'Last 6 hours', 'en-GB'))
      .toEqual({ limited: false, value: '100%', detail: 'Last 6 hours' });
  });

  it('uses the existing 70% coverage boundary and regional decimal formatting', () => {
    expect(presentGlanceGlucose({ timeInRangePercent: 85, coveragePercent: 69.9 }, 'Last 6 hours', 'de-DE'))
      .toMatchObject({ limited: true, detail: 'Last 6 hours · 69,9% observed coverage' });
    expect(presentGlanceGlucose({ timeInRangePercent: 85, coveragePercent: 70 }, 'Last 6 hours', 'en-GB'))
      .toMatchObject({ limited: false, value: '85%' });
  });

  it.each([NaN, Infinity, -1, 101])('does not turn unknown or invalid coverage %s into reassurance', coveragePercent => {
    expect(presentGlanceGlucose({ timeInRangePercent: 100, coveragePercent }, 'Last 6 hours', 'en-GB'))
      .toEqual({ limited: true, value: 'Limited data', detail: 'Last 6 hours · Coverage unavailable' });
  });
});
