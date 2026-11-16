import { isManualBasalInjection } from '@/data/manualInsulin';
import {
  BasalDelivery,
  BolusDelivery,
  GlucoseReading,
  GlucoseStats,
  InsulinStats,
  TimeRange,
} from './models';
import { calculateGlucoseStatistics } from './glucoseStatistics';
import {
  calculateGlucoseRangeSummary,
  type GlucoseTargetRange,
} from './glucoseRanges';

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateGlucoseStats(
  readings: GlucoseReading[],
  range: TimeRange,
  personalRange: GlucoseTargetRange | null = null,
): GlucoseStats {
  const statistics = calculateGlucoseStatistics({ readings, range });
  const ranges = calculateGlucoseRangeSummary({ readings, range, personalRange });
  const displayed = (value: number | null) => value === null ? null : round(value);
  const percent = (value: number | null) => value ?? 0;
  return {
    // Convert to the display unit before rounding. Rounding mmol/L here can
    // change both borderline mmol/L values and the eventual mg/dL result.
    averageMmolL: statistics.arithmeticMeanMmolL,
    standardDeviationMmolL: displayed(statistics.populationStandardDeviationMmolL),
    coefficientOfVariationPercent: displayed(statistics.coefficientOfVariationPercent),
    timeBelowPercent: percent(ranges.standard.below.percent),
    timeInRangePercent: percent(ranges.standard.inRange.percent),
    timeAbovePercent: percent(ranges.standard.above.percent),
    timeVeryLowPercent: percent(ranges.bands.veryLow.percent),
    timeLowPercent: percent(ranges.bands.low.percent),
    timeHighPercent: percent(ranges.bands.high.percent),
    timeVeryHighPercent: percent(ranges.bands.veryHigh.percent),
    timeInTightRangePercent: percent(ranges.tight.inRange.percent),
    ...(ranges.personal
      ? {
          personalRange: {
            lowerMmolL: ranges.personal.range.lowerMmolL,
            upperMmolL: ranges.personal.range.upperMmolL,
            timeBelowPercent: percent(ranges.personal.below.percent),
            timeInRangePercent: percent(ranges.personal.inRange.percent),
            timeAbovePercent: percent(ranges.personal.above.percent),
          },
        }
      : {}),
    coveragePercent: statistics.coveragePercent,
    observedMinutes: round(statistics.observedMilliseconds / 60_000, 0),
  };
}

export function calculateInsulinStats(
  basal: BasalDelivery[],
  boluses: BolusDelivery[],
  range: TimeRange,
): InsulinStats {
  const pointDoses = boluses.filter(delivery => delivery.timestamp >= range.start && delivery.timestamp < range.end);
  const basalUnits = basal.reduce((total, delivery) => {
    const overlapStart = Math.max(delivery.start, range.start);
    const overlapEnd = Math.min(delivery.end, range.end);
    if (overlapEnd <= overlapStart || delivery.end <= delivery.start) return total;
    const overlapFraction = (overlapEnd - overlapStart) / (delivery.end - delivery.start);
    return total + delivery.units * overlapFraction;
  }, 0) + pointDoses.filter(isManualBasalInjection).reduce((sum, delivery) => sum + delivery.units, 0);

  const bolusUnits = pointDoses
    .filter((delivery) => !isManualBasalInjection(delivery))
    .reduce((total, delivery) => total + delivery.units, 0);

  return {
    basalUnits: round(basalUnits),
    bolusUnits: round(bolusUnits),
    totalUnits: round(basalUnits + bolusUnits),
  };
}
