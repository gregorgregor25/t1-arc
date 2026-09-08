import {
  BasalDelivery,
  BolusDelivery,
  GlucoseReading,
  GlucoseStats,
  InsulinStats,
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  TimeRange,
} from './models';
import { calculateGlucoseStatistics } from './glucoseStatistics';

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateGlucoseStats(
  readings: GlucoseReading[],
  range: TimeRange,
): GlucoseStats {
  const statistics = calculateGlucoseStatistics({
    readings,
    range,
    thresholds: {
      lowerMmolL: TARGET_LOW_MMOL_L,
      upperMmolL: TARGET_HIGH_MMOL_L,
    },
  });
  const displayed = (value: number | null) => value === null ? null : round(value);
  return {
    // Convert to the display unit before rounding. Rounding mmol/L here can
    // change both borderline mmol/L values and the eventual mg/dL result.
    averageMmolL: statistics.arithmeticMeanMmolL,
    standardDeviationMmolL: displayed(statistics.populationStandardDeviationMmolL),
    coefficientOfVariationPercent: displayed(statistics.coefficientOfVariationPercent),
    timeBelowPercent: statistics.distribution?.belowPercent ?? 0,
    timeInRangePercent: statistics.distribution?.inRangePercent ?? 0,
    timeAbovePercent: statistics.distribution?.abovePercent ?? 0,
    coveragePercent: statistics.coveragePercent,
    observedMinutes: round(statistics.observedMilliseconds / 60_000, 0),
  };
}

export function calculateInsulinStats(
  basal: BasalDelivery[],
  boluses: BolusDelivery[],
  range: TimeRange,
): InsulinStats {
  const basalUnits = basal.reduce((total, delivery) => {
    const overlapStart = Math.max(delivery.start, range.start);
    const overlapEnd = Math.min(delivery.end, range.end);
    if (overlapEnd <= overlapStart || delivery.end <= delivery.start) return total;
    const overlapFraction = (overlapEnd - overlapStart) / (delivery.end - delivery.start);
    return total + delivery.units * overlapFraction;
  }, 0);

  const bolusUnits = boluses
    .filter((delivery) => delivery.timestamp >= range.start && delivery.timestamp < range.end)
    .reduce((total, delivery) => total + delivery.units, 0);

  return {
    basalUnits: round(basalUnits),
    bolusUnits: round(bolusUnits),
    totalUnits: round(basalUnits + bolusUnits),
  };
}
