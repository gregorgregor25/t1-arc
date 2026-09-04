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
import { minutesBetween } from './time';

const MAX_OBSERVED_GAP_MINUTES = 12;

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateGlucoseStats(
  readings: GlucoseReading[],
  range: TimeRange,
): GlucoseStats {
  const sorted = readings
    .filter((reading) => reading.timestamp >= range.start && reading.timestamp < range.end)
    .sort((a, b) => a.timestamp - b.timestamp);

  let belowMinutes = 0;
  let inRangeMinutes = 0;
  let aboveMinutes = 0;
  let weightedMmolMinutes = 0;
  let weightedSquaredMmolMinutes = 0;

  sorted.forEach((reading, index) => {
    const next = sorted[index + 1];
    const intervalEnd = Math.min(next?.timestamp ?? range.end, range.end);
    const duration = minutesBetween(reading.timestamp, intervalEnd);
    const observedDuration = Math.min(duration, MAX_OBSERVED_GAP_MINUTES);

    if (observedDuration <= 0) return;
    weightedMmolMinutes += reading.mmolL * observedDuration;
    weightedSquaredMmolMinutes +=
      reading.mmolL * reading.mmolL * observedDuration;

    if (reading.mmolL < TARGET_LOW_MMOL_L) belowMinutes += observedDuration;
    else if (reading.mmolL <= TARGET_HIGH_MMOL_L) inRangeMinutes += observedDuration;
    else aboveMinutes += observedDuration;
  });

  const observedMinutes = belowMinutes + inRangeMinutes + aboveMinutes;
  const totalRangeMinutes = minutesBetween(range.start, range.end);
  const unroundedAverage =
    observedMinutes > 0 ? weightedMmolMinutes / observedMinutes : null;
  const standardDeviation =
    unroundedAverage === null
      ? null
      : Math.sqrt(
          Math.max(
            0,
            weightedSquaredMmolMinutes / observedMinutes -
              unroundedAverage * unroundedAverage,
          ),
        );
  const percent = (minutes: number) =>
    observedMinutes > 0 ? round((minutes / observedMinutes) * 100) : 0;

  return {
    averageMmolL:
      unroundedAverage === null ? null : round(unroundedAverage),
    standardDeviationMmolL:
      standardDeviation === null ? null : round(standardDeviation),
    coefficientOfVariationPercent:
      standardDeviation === null ||
      unroundedAverage === null ||
      unroundedAverage <= 0
        ? null
        : round((standardDeviation / unroundedAverage) * 100),
    timeBelowPercent: percent(belowMinutes),
    timeInRangePercent: percent(inRangeMinutes),
    timeAbovePercent: percent(aboveMinutes),
    coveragePercent:
      totalRangeMinutes > 0
        ? Math.min(100, round((observedMinutes / totalRangeMinutes) * 100))
        : 0,
    observedMinutes: round(observedMinutes, 0),
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
