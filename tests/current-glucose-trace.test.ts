import { describe, expect, it } from 'vitest';

import { glucoseTraceGeometry } from '@/components/currentGlucoseTrace';
import { DEFAULT_OBSERVATION_GAP_MS } from '@/domain/glucoseStatistics';
import type { GlucoseReading } from '@/domain/models';

const END = Date.UTC(2026, 8, 8, 12);
const MINUTE = 60_000;

function reading(timestamp: number, mmolL = 7): GlucoseReading {
  return {
    id: `${timestamp}:${mmolL}`,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'xdrip-synthetic-test',
  };
}

describe('compact current glucose trace', () => {
  it('keeps the old and fresh fixture readings visible without filling their 90-minute gap', () => {
    const trace = glucoseTraceGeometry([reading(END - 90 * MINUTE), reading(END)], END)!;
    expect(trace.duration).toBe(90 * MINUTE);
    expect(trace.areas).toEqual([]);
    expect(trace.segments).toEqual([]);
    expect(trace.isolatedPoints).toEqual([
      expect.objectContaining({ timestamp: END - 90 * MINUTE, value: 7, x: 1 }),
      expect.objectContaining({ timestamp: END, value: 7, x: 99 }),
    ]);
  });

  it('closes each observed run into its own filled area', () => {
    const trace = glucoseTraceGeometry([
      reading(END - 95 * MINUTE), reading(END - 90 * MINUTE),
      reading(END - 5 * MINUTE), reading(END),
    ], END)!;
    expect(trace.areas).toHaveLength(2);
    expect(trace.segments).toHaveLength(2);
    expect(trace.isolatedPoints).toEqual([]);
    expect(trace.areas[0]).toBe('M 1.00 28.50 C 3.58 28.50, 3.58 28.50, 6.16 28.50 L 6.16 60 L 1.00 60 Z');
    expect(trace.areas[1]).toBe('M 93.84 28.50 C 96.42 28.50, 96.42 28.50, 99.00 28.50 L 99.00 60 L 93.84 60 Z');
  });

  it.each([
    [DEFAULT_OBSERVATION_GAP_MS, 1, 0],
    [DEFAULT_OBSERVATION_GAP_MS + 1, 0, 2],
  ])('uses the established 12-minute boundary for a %s ms gap', (gap, connected, isolated) => {
    const trace = glucoseTraceGeometry([reading(END - gap), reading(END)], END)!;
    expect(trace.segments).toHaveLength(connected);
    expect(trace.areas).toHaveLength(connected);
    expect(trace.isolatedPoints).toHaveLength(isolated);
  });

  it('preserves a lone reading without inventing an interval or a filled area', () => {
    const trace = glucoseTraceGeometry([reading(END, 6.7)], END)!;
    expect(trace.duration).toBe(0);
    expect(trace.readingCount).toBe(1);
    expect(trace.isolatedPoints).toEqual([expect.objectContaining({ value: 6.7, timestamp: END })]);
    expect(trace.areas).toEqual([]);
    expect(trace.segments).toEqual([]);
  });

  it('retains an isolated old reading alongside the genuinely connected fresh run', () => {
    const trace = glucoseTraceGeometry([
      reading(END - 90 * MINUTE, 6.1), reading(END - 5 * MINUTE, 6.9), reading(END, 7.1),
    ], END)!;
    expect(trace.isolatedPoints).toEqual([expect.objectContaining({ value: 6.1 })]);
    expect(trace.areas).toHaveLength(1);
    expect(trace.segments).toHaveLength(1);
    expect(trace.areas[0]).toMatch(/^M 93\.56 /);
    expect(trace.segments[0]!.value).toBe(7.1);
  });

  it('does not average or draw a vertical interval for conflicting simultaneous readings', () => {
    const trace = glucoseTraceGeometry([reading(END, 6), reading(END, 8)], END)!;
    expect(trace.duration).toBe(0);
    expect(trace.isolatedPoints.map((point) => point.value)).toEqual([6, 8]);
    expect(trace.segments).toEqual([]);
    expect(trace.areas).toEqual([]);
  });

  it('sorts a copy, limits the four-hour window, and excludes invalid observations', () => {
    const readings = [
      reading(END), reading(END - 5 * MINUTE), reading(END - 4 * 60 * MINUTE),
      reading(END - 4 * 60 * MINUTE - 1), reading(END + 1),
      reading(END, Number.NaN), reading(Number.NaN), reading(END, 0),
    ];
    const original = structuredClone(readings);
    const trace = glucoseTraceGeometry(readings, END)!;
    expect(trace.readingCount).toBe(3);
    expect(trace.duration).toBe(4 * 60 * MINUTE);
    expect(trace.isolatedPoints[0]!.timestamp).toBe(END - 4 * 60 * MINUTE);
    expect(trace.segments).toHaveLength(1);
    expect(readings).toEqual(original);
  });

  it('returns no chart for an invalid end time or no valid readings', () => {
    expect(glucoseTraceGeometry([], END)).toBeUndefined();
    expect(glucoseTraceGeometry([reading(END)], Number.NaN)).toBeUndefined();
    expect(glucoseTraceGeometry([reading(END, -1)], END)).toBeUndefined();
  });
});
