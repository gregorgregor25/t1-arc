import { describe, expect, it } from 'vitest';

import { GlucoseReading, TrendDirection } from '@/domain/models';
import { assessGlucoseTrend, presentTrend, trendFromDelta } from '@/domain/trend';

const BASE = Date.UTC(2026, 6, 26, 12);

function reading(
  minutes: number,
  mmolL: number,
  trend: TrendDirection = 'unknown',
  sourceId = 'source-a',
): GlucoseReading {
  return {
    id: `${sourceId}:${minutes}`,
    sourceId,
    timestamp: BASE + minutes * 60_000,
    receivedAt: BASE + minutes * 60_000 + 2_000,
    mmolL,
    trend,
    quality: 'measured',
  };
}

describe('calculated glucose trend', () => {
  it.each<TrendDirection>(['tripleUp', 'tripleDown'])('keeps %s source meaning even when history points elsewhere', (direction) => {
    const current = reading(10, 6, direction, 'aaps-local');
    const assessment = assessGlucoseTrend(current, [
      reading(0, 6, 'unknown', 'aaps-local'),
      reading(5, 6, 'unknown', 'aaps-local'), current,
    ]);
    expect(assessment).toMatchObject({ direction, origin: 'source' });
    expect(assessment.rateMmolLPerFiveMinutes).toBeUndefined();
    expect(assessment.sourceDetail).toContain(direction === 'tripleUp' ? 'TripleUp' : 'TripleDown');
    expect(assessment.compatibilityNote).toContain(direction === 'tripleUp' ? 'double-up' : 'double-down');
    expect(presentTrend(direction)).toEqual(direction === 'tripleUp'
      ? { arrow: '↑↑↑', label: 'rising very quickly' }
      : { arrow: '↓↓↓', label: 'falling very quickly' });
  });

  it('never invents a source triple category from a calculated rate', () => {
    expect(trendFromDelta(4)).toBe('doubleUp');
    expect(trendFromDelta(-4)).toBe('doubleDown');
  });

  it('never replaces a source-provided direction', () => {
    const current = reading(10, 7.2, 'slightUp');
    const result = assessGlucoseTrend(current, [
      reading(0, 6.0),
      reading(5, 6.5),
      current,
    ]);

    expect(result.origin).toBe('source');
    expect(result.direction).toBe('slightUp');
    expect(result.rateMmolLPerFiveMinutes).toBeUndefined();
  });

  it('calculates a rising direction from a coherent recent window', () => {
    const history = [
      reading(0, 6.0),
      reading(5, 6.35),
      reading(10, 6.7),
      reading(15, 7.05),
    ];

    const result = assessGlucoseTrend(history.at(-1), history);

    expect(result.origin).toBe('calculated');
    expect(result.direction).toBe('up');
    expect(result.rateMmolLPerFiveMinutes).toBeCloseTo(0.35, 2);
    expect(result.windowMinutes).toBe(15);
    expect(result.supportingReadings.map((item) => item.id)).toEqual(
      history.map((item) => item.id),
    );
  });

  it('calculates a falling direction using only the current source', () => {
    const current = reading(15, 5.9);
    const result = assessGlucoseTrend(current, [
      reading(0, 7.7),
      reading(5, 7.1),
      reading(10, 6.5),
      reading(10, 18, 'unknown', 'other-source'),
      current,
    ]);

    expect(result.origin).toBe('calculated');
    expect(result.direction).toBe('doubleDown');
    expect(result.supportingReadings).toHaveLength(4);
    expect(
      result.supportingReadings.every(
        (item) => item.sourceId === current.sourceId,
      ),
    ).toBe(true);
  });

  it('withholds a direction when the recent window has a sensor gap', () => {
    const current = reading(20, 7.0);
    const result = assessGlucoseTrend(current, [
      reading(0, 6.0),
      reading(5, 6.2),
      current,
    ]);

    expect(result.origin).toBe('unavailable');
    expect(result.direction).toBe('unknown');
    expect(result.reason).toMatch(/gap/i);
  });

  it('withholds a misleading slope when readings do not share a clear direction', () => {
    const history = [
      reading(0, 6.0),
      reading(5, 7.1),
      reading(10, 5.9),
      reading(15, 7.0),
    ];

    const result = assessGlucoseTrend(history.at(-1), history);

    expect(result.origin).toBe('unavailable');
    expect(result.reason).toMatch(/clear direction/i);
  });

  it('requires at least three readings spanning eight minutes', () => {
    const current = reading(5, 6.3);
    const result = assessGlucoseTrend(current, [
      reading(0, 6.0),
      current,
    ]);

    expect(result.origin).toBe('unavailable');
    expect(result.reason).toMatch(/three recent readings/i);
  });
});
