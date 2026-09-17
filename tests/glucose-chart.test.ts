import { describe, expect, it } from 'vitest';

import {
  buildColouredGlucoseSegments,
  buildGlucoseChartScale,
} from '../src/domain/glucoseChart';
import { DEFAULT_GLUCOSE_APPEARANCE } from '../src/domain/glucoseAppearance';

describe('glucose chart geometry', () => {
  it('keeps readings and the configured target range inside a padded scale', () => {
    const scale = buildGlucoseChartScale(
      [
        { timestamp: 1, mmolL: 2.4 },
        { timestamp: 2, mmolL: 17.2 },
      ],
      DEFAULT_GLUCOSE_APPEARANCE,
    );

    expect(scale.minimum).toBeLessThan(2.4);
    expect(scale.maximum).toBeGreaterThan(17.2);
    expect(scale.ticks[0]).toBe(scale.minimum);
    expect(scale.ticks.at(-1)).toBe(scale.maximum);
  });

  it('uses the target range when there are no readings', () => {
    const scale = buildGlucoseChartScale(
      [],
      DEFAULT_GLUCOSE_APPEARANCE,
    );

    expect(scale.minimum).toBeLessThan(
      DEFAULT_GLUCOSE_APPEARANCE.targetMin,
    );
    expect(scale.maximum).toBeGreaterThan(
      DEFAULT_GLUCOSE_APPEARANCE.targetMax,
    );
  });

  it('splits a rising line at every crossed range boundary', () => {
    const segments = buildColouredGlucoseSegments(
      [
        { timestamp: 0, mmolL: 2.5 },
        { timestamp: 5 * 60_000, mmolL: 15 },
      ],
      DEFAULT_GLUCOSE_APPEARANCE,
      12 * 60_000,
    );

    expect(segments.map((segment) => segment.range)).toEqual([
      'veryLow',
      'low',
      'target',
      'high',
      'veryHigh',
    ]);
    expect(segments[0]!.points.at(-1)!.mmolL).toBe(3);
    expect(segments[2]!.points[0]!.mmolL).toBe(3.9);
    expect(segments[2]!.points.at(-1)!.mmolL).toBe(10);
    expect(segments[4]!.points[0]!.mmolL).toBe(13.9);
  });

  it('does not join across a missing-data gap', () => {
    const segments = buildColouredGlucoseSegments(
      [
        { timestamp: 0, mmolL: 6 },
        { timestamp: 5 * 60_000, mmolL: 6.2 },
        { timestamp: 30 * 60_000, mmolL: 6.4 },
      ],
      DEFAULT_GLUCOSE_APPEARANCE,
      12 * 60_000,
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]!.points).toHaveLength(2);
  });
});
