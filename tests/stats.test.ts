import { describe, expect, it } from 'vitest';

import {
  BasalDelivery,
  BolusDelivery,
  GlucoseReading,
} from '@/domain/models';
import { calculateGlucoseStats, calculateInsulinStats } from '@/domain/stats';
import { calculateGlucoseStatistics } from '@/data/tarvis/query/glucoseStatistics';

const MINUTE = 60_000;

function reading(minute: number, mmolL: number): GlucoseReading {
  return {
    id: `g-${minute}`,
    timestamp: minute * MINUTE,
    receivedAt: minute * MINUTE,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test',
  };
}

describe('glucose statistics', () => {
  it('uses the same reading average as Tarv1s even when sampling intervals vary', () => {
    const readings = [reading(0, 4), reading(1, 10), reading(11, 6)];
    const range = { start: 0, end: 12 * MINUTE };
    const history = calculateGlucoseStats(readings, range);
    const tarvis = calculateGlucoseStatistics({ readings, range });
    expect(history.averageMmolL).toBe(tarvis.arithmeticMeanMmolL);
    expect(tarvis.arithmeticMeanMmolL).toBeCloseTo(20 / 3, 3);
    expect(history.standardDeviationMmolL).toBe(2.5);
    expect(history.coefficientOfVariationPercent).toBe(37.4);
    expect(history.coveragePercent).toBe(100);
    expect(readings.map(({ mmolL }) => mmolL)).toEqual([4, 10, 6]);
  });

  it('normalises same-timestamp sources once and excludes the next day', () => {
    const readings = [reading(0, 4), { ...reading(0, 8), id: 'second-source' }, reading(5, 10), reading(10, 25)];
    const range = { start: 0, end: 10 * MINUTE };
    expect(calculateGlucoseStats(readings, range).averageMmolL).toBe(8);
    expect(calculateGlucoseStatistics({ readings, range }).arithmeticMeanMmolL).toBe(8);
  });

  it('never substitutes zero for an empty observed mean', () => {
    const range = { start: 0, end: 10 * MINUTE };
    expect(calculateGlucoseStats([], range)).toMatchObject({ averageMmolL: null, coveragePercent: 0, observedMinutes: 0 });
  });

  it('calculates deterministic time-weighted range percentages', () => {
    const stats = calculateGlucoseStats(
      [reading(0, 3), reading(5, 6), reading(10, 11), reading(15, 7)],
      { start: 0, end: 20 * MINUTE },
    );

    expect(stats.timeBelowPercent).toBe(25);
    expect(stats.timeInRangePercent).toBe(50);
    expect(stats.timeAbovePercent).toBe(25);
    expect(stats.averageMmolL).toBe(6.75);
    expect(stats.standardDeviationMmolL).toBe(2.9);
    expect(stats.coefficientOfVariationPercent).toBe(42.4);
    expect(stats.coveragePercent).toBe(100);
  });

  it('does not count a long missing-data gap as observed time', () => {
    const stats = calculateGlucoseStats(
      [reading(0, 6), reading(5, 7)],
      { start: 0, end: 30 * MINUTE },
    );

    expect(stats.observedMinutes).toBe(17);
    expect(stats.coveragePercent).toBe(56.7);
  });
});

describe('insulin statistics', () => {
  it('prorates basal overlap and includes boluses inside the range', () => {
    const basal: BasalDelivery[] = [
      {
        id: 'basal',
        start: 0,
        end: 60 * MINUTE,
        units: 1,
        rateUnitsPerHour: 1,
        sourceId: 'test',
      },
    ];
    const boluses: BolusDelivery[] = [
      { id: 'in', timestamp: 30 * MINUTE, units: 2, sourceId: 'test' },
      { id: 'out', timestamp: 50 * MINUTE, units: 5, sourceId: 'test' },
    ];

    const stats = calculateInsulinStats(basal, boluses, {
      start: 15 * MINUTE,
      end: 45 * MINUTE,
    });

    expect(stats.basalUnits).toBe(0.5);
    expect(stats.bolusUnits).toBe(2);
    expect(stats.totalUnits).toBe(2.5);
  });
});
