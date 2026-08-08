import { describe, expect, it } from 'vitest';

import {
  calculateGlucoseStatistics,
  DEFAULT_OBSERVATION_GAP_MS,
  GMI_FORMULA_VERSION,
  GLUCOSE_STATISTICS_VERSION,
} from '@/data/tarvis/query/glucoseStatistics';
import type { GlucoseReading } from '@/domain/models';

const MINUTE = 60_000;

function reading(
  id: string,
  timestamp: number,
  mmolL: number,
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: id.split(':')[0] ?? 'test',
  };
}

describe('deterministic glucose statistics', () => {
  it('calculates standard descriptive statistics with versioned definitions', () => {
    const result = calculateGlucoseStatistics({
      range: { start: 0, end: 60 * MINUTE },
      readings: [
        reading('a:1', 0, 4),
        reading('a:2', 5 * MINUTE, 6),
        reading('a:3', 10 * MINUTE, 8),
        reading('a:4', 15 * MINUTE, 10),
      ],
    });

    expect(result).toMatchObject({
      algorithmVersion: GLUCOSE_STATISTICS_VERSION,
      gmiFormulaVersion: GMI_FORMULA_VERSION,
      sampleCount: 4,
      arithmeticMeanMmolL: 7,
      medianMmolL: 7,
      minimumMmolL: 4,
      maximumMmolL: 10,
      populationStandardDeviationMmolL: 2.2361,
      coefficientOfVariationPercent: 31.94,
      observedMilliseconds: 27 * MINUTE,
      coveragePercent: 45,
    });
    expect(result.glucoseManagementIndicatorPercent).toBeCloseTo(6.33, 2);
  });

  it('uses observed duration for TBR, TIR, and TAR and includes boundaries', () => {
    const result = calculateGlucoseStatistics({
      range: { start: 0, end: 30 * MINUTE },
      readings: [
        reading('a:1', 0, 3.8),
        reading('a:2', 5 * MINUTE, 3.9),
        reading('a:3', 10 * MINUTE, 10),
        reading('a:4', 15 * MINUTE, 10.1),
      ],
      thresholds: { lowerMmolL: 3.9, upperMmolL: 10 },
    });

    expect(result.distribution).toMatchObject({
      belowMilliseconds: 5 * MINUTE,
      inRangeMilliseconds: 10 * MINUTE,
      aboveMilliseconds: 12 * MINUTE,
      belowPercent: 18.5,
      inRangePercent: 37,
      abovePercent: 44.4,
    });
  });

  it('does not let exact-timestamp source duplicates skew the statistics', () => {
    const result = calculateGlucoseStatistics({
      range: { start: 0, end: 20 * MINUTE },
      readings: [
        reading('live:1', 0, 6),
        reading('import:1', 0, 8),
        reading('live:2', 5 * MINUTE, 10),
      ],
    });

    expect(result.sampleCount).toBe(2);
    expect(result.arithmeticMeanMmolL).toBe(8.5);
    expect(result.recordIds).toEqual(['import:1', 'live:1', 'live:2']);
  });

  it('reports leading, internal, and trailing missing time exactly', () => {
    const result = calculateGlucoseStatistics({
      range: { start: 0, end: 60 * MINUTE },
      observationGapCapMilliseconds: 5 * MINUTE,
      readings: [
        reading('a:1', 10 * MINUTE, 6),
        reading('a:2', 30 * MINUTE, 7),
      ],
    });

    expect(result.gaps).toEqual([
      { start: 0, end: 10 * MINUTE, durationMilliseconds: 10 * MINUTE },
      {
        start: 15 * MINUTE,
        end: 30 * MINUTE,
        durationMilliseconds: 15 * MINUTE,
      },
      {
        start: 35 * MINUTE,
        end: 60 * MINUTE,
        durationMilliseconds: 25 * MINUTE,
      },
    ]);
  });

  it('distinguishes unavailable data from observed zero-duration categories', () => {
    const unavailable = calculateGlucoseStatistics({
      range: { start: 0, end: 60 * MINUTE },
      readings: [],
      thresholds: { lowerMmolL: 3.9, upperMmolL: 10 },
    });

    expect(unavailable).toMatchObject({
      sampleCount: 0,
      arithmeticMeanMmolL: null,
      medianMmolL: null,
      minimumMmolL: null,
      maximumMmolL: null,
      populationStandardDeviationMmolL: null,
      coefficientOfVariationPercent: null,
      glucoseManagementIndicatorPercent: null,
      coveragePercent: 0,
    });
    expect(unavailable.distribution).toMatchObject({
      belowPercent: null,
      inRangePercent: null,
      abovePercent: null,
    });
    expect(unavailable.gaps).toEqual([
      { start: 0, end: 60 * MINUTE, durationMilliseconds: 60 * MINUTE },
    ]);
  });

  it('rejects duplicate IDs, invalid ranges, and inverted thresholds', () => {
    expect(() =>
      calculateGlucoseStatistics({
        range: { start: 0, end: 10 * MINUTE },
        readings: [reading('same', 0, 6), reading('same', 5 * MINUTE, 7)],
      }),
    ).toThrow('Duplicate glucose record ID');
    expect(() =>
      calculateGlucoseStatistics({
        range: { start: 10, end: 10 },
        readings: [],
      }),
    ).toThrow('range must be valid');
    expect(() =>
      calculateGlucoseStatistics({
        range: { start: 0, end: 10 * MINUTE },
        readings: [],
        thresholds: { lowerMmolL: 10, upperMmolL: 3.9 },
      }),
    ).toThrow('thresholds must be ordered');
    expect(DEFAULT_OBSERVATION_GAP_MS).toBe(12 * MINUTE);
  });
});
