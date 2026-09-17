import { describe, expect, it } from 'vitest';

import { GlucoseReading } from '@/domain/models';
import {
  MAX_TIMELINE_GLUCOSE_MARKERS,
  sampleGlucoseForChart,
  sampleGlucoseMarkersForChart,
} from '@/domain/timelineSampling';

const MINUTE = 60_000;

function reading(index: number, mmolL = 6): GlucoseReading {
  return {
    id: `reading-${index}`,
    timestamp: index * 5 * MINUTE,
    receivedAt: index * 5 * MINUTE,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test',
  };
}

describe('timeline chart sampling', () => {
  it('retains the first, last, highest, and lowest readings', () => {
    const readings = Array.from({ length: 1_000 }, (_, index) =>
      reading(index, 6 + Math.sin(index / 20)),
    );
    readings[187] = reading(187, 2.8);
    readings[812] = reading(812, 15.2);

    const sampled = sampleGlucoseForChart(readings, 100);
    const ids = new Set(sampled.map((item) => item.id));

    expect(sampled.length).toBeLessThanOrEqual(100);
    expect(ids.has('reading-0')).toBe(true);
    expect(ids.has('reading-999')).toBe(true);
    expect(ids.has('reading-187')).toBe(true);
    expect(ids.has('reading-812')).toBe(true);
  });

  it('retains both readings surrounding a missing-data gap', () => {
    const readings = Array.from({ length: 120 }, (_, index) => reading(index));
    readings[61] = {
      ...readings[61]!,
      timestamp: readings[60]!.timestamp + 45 * MINUTE,
    };
    for (let index = 62; index < readings.length; index += 1) {
      readings[index] = {
        ...readings[index]!,
        timestamp: readings[index - 1]!.timestamp + 5 * MINUTE,
      };
    }

    const sampled = sampleGlucoseForChart(readings, 20);
    const ids = new Set(sampled.map((item) => item.id));

    expect(ids.has('reading-60')).toBe(true);
    expect(ids.has('reading-61')).toBe(true);
  });

  it('does not alter a series already small enough to draw', () => {
    const readings = [reading(0), reading(1), reading(2)];
    expect(sampleGlucoseForChart(readings, 10)).toBe(readings);
  });

  it('bounds decorative marker views without changing the complete chart path', () => {
    const readings = Array.from({ length: 2_664 }, (_, index) =>
      reading(index, 6 + Math.sin(index / 20)),
    );
    readings[187] = reading(187, 2.8);
    readings[2_412] = reading(2_412, 15.2);

    const path = sampleGlucoseForChart(readings);
    const markers = sampleGlucoseMarkersForChart(readings);
    const markerIds = new Set(markers.map((item) => item.id));

    expect(path.length).toBeGreaterThan(MAX_TIMELINE_GLUCOSE_MARKERS);
    expect(markers.length).toBeLessThanOrEqual(MAX_TIMELINE_GLUCOSE_MARKERS);
    expect(markerIds.has('reading-0')).toBe(true);
    expect(markerIds.has('reading-2663')).toBe(true);
    expect(markerIds.has('reading-187')).toBe(true);
    expect(markerIds.has('reading-2412')).toBe(true);
  });
});
