import {
  type GlucoseReading,
  MG_DL_PER_MMOL_L,
  type TimeRange,
} from "@/domain/models";

// Keep the algorithm identifier stable for saved Tarv1s evidence. History and
// Insights now use these same sample-based moments instead of duration weights.
export const GLUCOSE_STATISTICS_VERSION = "tarvis-glucose-statistics-v1";
export const GLUCOSE_MEAN_METRIC_VERSION =
  `${GLUCOSE_STATISTICS_VERSION}:mean-unique-timestamp-rounded-4dp`;
export const GMI_FORMULA_VERSION = "bergenstal-2018-gmi-v1";
export const DEFAULT_OBSERVATION_GAP_MS = 12 * 60_000;

export interface GlucoseRangeThresholds {
  lowerMmolL: number;
  upperMmolL: number;
}

export interface GlucoseObservationGap extends TimeRange {
  durationMilliseconds: number;
}

export interface GlucoseDurationDistribution {
  belowMilliseconds: number;
  inRangeMilliseconds: number;
  aboveMilliseconds: number;
  belowPercent: number | null;
  inRangePercent: number | null;
  abovePercent: number | null;
}

export interface GlucoseStatistics {
  algorithmVersion: string;
  gmiFormulaVersion: string;
  range: TimeRange;
  observationGapCapMilliseconds: number;
  recordIds: string[];
  sampleCount: number;
  arithmeticMeanMmolL: number | null;
  medianMmolL: number | null;
  minimumMmolL: number | null;
  maximumMmolL: number | null;
  populationStandardDeviationMmolL: number | null;
  coefficientOfVariationPercent: number | null;
  glucoseManagementIndicatorPercent: number | null;
  expectedMilliseconds: number;
  observedMilliseconds: number;
  coveragePercent: number;
  gaps: GlucoseObservationGap[];
  distribution: GlucoseDurationDistribution | null;
}

export interface GlucoseCanonicalSample {
  timestamp: number;
  mmolL: number;
  recordIds: string[];
}

interface ObservationInterval extends TimeRange {
  mmolL: number;
}

function assertFinitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
}

function assertRange(range: TimeRange) {
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  ) {
    throw new RangeError("The glucose statistics range must be valid.");
  }
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Produces one physiological sample per timestamp while retaining every source
 * record ID. All sample-based metrics must use this function so duplicate
 * imports recorded at the same instant cannot bias a result.
 */
export function canonicalGlucoseSamples(
  readings: readonly GlucoseReading[],
  range: TimeRange,
): GlucoseCanonicalSample[] {
  assertRange(range);
  const ids = new Set<string>();
  const byTimestamp = new Map<
    number,
    { total: number; count: number; recordIds: string[] }
  >();

  readings.forEach((reading) => {
    if (!reading.id.trim()) {
      throw new TypeError("A glucose record ID was empty.");
    }
    if (ids.has(reading.id)) {
      throw new TypeError(`Duplicate glucose record ID: ${reading.id}.`);
    }
    ids.add(reading.id);
    if (
      !Number.isFinite(reading.timestamp) ||
      reading.timestamp < 0 ||
      !Number.isFinite(reading.mmolL) ||
      reading.mmolL <= 0
    ) {
      throw new TypeError("A glucose record was invalid.");
    }
    if (reading.timestamp < range.start || reading.timestamp >= range.end) {
      return;
    }
    const existing = byTimestamp.get(reading.timestamp);
    if (existing) {
      existing.total += reading.mmolL;
      existing.count += 1;
      existing.recordIds.push(reading.id);
    } else {
      byTimestamp.set(reading.timestamp, {
        total: reading.mmolL,
        count: 1,
        recordIds: [reading.id],
      });
    }
  });

  return [...byTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, sample]) => ({
      timestamp,
      mmolL: sample.total / sample.count,
      recordIds: [...sample.recordIds].sort(),
    }));
}

function observationIntervals(
  samples: readonly GlucoseCanonicalSample[],
  range: TimeRange,
  observationGapCapMilliseconds: number,
): ObservationInterval[] {
  return samples.flatMap((sample, index) => {
    const end = Math.min(
      range.end,
      samples[index + 1]?.timestamp ?? range.end,
      sample.timestamp + observationGapCapMilliseconds,
    );
    return end > sample.timestamp
      ? [{ start: sample.timestamp, end, mmolL: sample.mmolL }]
      : [];
  });
}

function missingIntervals(
  observed: readonly ObservationInterval[],
  range: TimeRange,
): GlucoseObservationGap[] {
  const gaps: GlucoseObservationGap[] = [];
  let cursor = range.start;
  observed.forEach((interval) => {
    if (interval.start > cursor) {
      gaps.push({
        start: cursor,
        end: interval.start,
        durationMilliseconds: interval.start - cursor,
      });
    }
    cursor = Math.max(cursor, interval.end);
  });
  if (cursor < range.end) {
    gaps.push({
      start: cursor,
      end: range.end,
      durationMilliseconds: range.end - cursor,
    });
  }
  return gaps;
}

function durationDistribution(
  intervals: readonly ObservationInterval[],
  observedMilliseconds: number,
  thresholds: GlucoseRangeThresholds,
): GlucoseDurationDistribution {
  assertFinitePositive(thresholds.lowerMmolL, "The lower glucose threshold");
  assertFinitePositive(thresholds.upperMmolL, "The upper glucose threshold");
  if (thresholds.lowerMmolL >= thresholds.upperMmolL) {
    throw new RangeError("The glucose range thresholds must be ordered.");
  }
  let belowMilliseconds = 0;
  let inRangeMilliseconds = 0;
  let aboveMilliseconds = 0;
  intervals.forEach((interval) => {
    const duration = interval.end - interval.start;
    if (interval.mmolL < thresholds.lowerMmolL) {
      belowMilliseconds += duration;
    } else if (interval.mmolL > thresholds.upperMmolL) {
      aboveMilliseconds += duration;
    } else {
      inRangeMilliseconds += duration;
    }
  });
  const percent = (duration: number) =>
    observedMilliseconds > 0
      ? round((duration / observedMilliseconds) * 100, 1)
      : null;
  return {
    belowMilliseconds,
    inRangeMilliseconds,
    aboveMilliseconds,
    belowPercent: percent(belowMilliseconds),
    inRangePercent: percent(inRangeMilliseconds),
    abovePercent: percent(aboveMilliseconds),
  };
}

export function calculateGlucoseStatistics({
  readings,
  range,
  thresholds,
  observationGapCapMilliseconds = DEFAULT_OBSERVATION_GAP_MS,
}: {
  readings: readonly GlucoseReading[];
  range: TimeRange;
  thresholds?: GlucoseRangeThresholds;
  observationGapCapMilliseconds?: number;
}): GlucoseStatistics {
  assertRange(range);
  assertFinitePositive(
    observationGapCapMilliseconds,
    "The observation gap cap",
  );
  const samples = canonicalGlucoseSamples(readings, range);
  const intervals = observationIntervals(
    samples,
    range,
    observationGapCapMilliseconds,
  );
  const values = samples.map(({ mmolL }) => mmolL);
  const sortedValues = [...values].sort((left, right) => left - right);
  const sampleCount = values.length;
  const arithmeticMeanMmolL = sampleCount
    ? values.reduce((total, value) => total + value, 0) / sampleCount
    : null;
  const middle = Math.floor(sampleCount / 2);
  const medianMmolL = sampleCount
    ? sampleCount % 2 === 1
      ? sortedValues[middle]!
      : (sortedValues[middle - 1]! + sortedValues[middle]!) / 2
    : null;
  const populationStandardDeviationMmolL =
    arithmeticMeanMmolL === null
      ? null
      : Math.sqrt(
          values.reduce(
            (total, value) => total + (value - arithmeticMeanMmolL) ** 2,
            0,
          ) / sampleCount,
        );
  const coefficientOfVariationPercent =
    arithmeticMeanMmolL && populationStandardDeviationMmolL !== null
      ? (populationStandardDeviationMmolL / arithmeticMeanMmolL) * 100
      : null;
  const glucoseManagementIndicatorPercent =
    arithmeticMeanMmolL === null
      ? null
      : 3.31 + 0.02392 * arithmeticMeanMmolL * MG_DL_PER_MMOL_L;
  const expectedMilliseconds = range.end - range.start;
  const observedMilliseconds = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );

  return {
    algorithmVersion: GLUCOSE_STATISTICS_VERSION,
    gmiFormulaVersion: GMI_FORMULA_VERSION,
    range: { ...range },
    observationGapCapMilliseconds,
    recordIds: samples.flatMap(({ recordIds }) => recordIds),
    sampleCount,
    arithmeticMeanMmolL:
      arithmeticMeanMmolL === null ? null : round(arithmeticMeanMmolL, 4),
    medianMmolL: medianMmolL === null ? null : round(medianMmolL, 4),
    minimumMmolL: sampleCount ? sortedValues[0]! : null,
    maximumMmolL: sampleCount ? sortedValues.at(-1)! : null,
    populationStandardDeviationMmolL:
      populationStandardDeviationMmolL === null
        ? null
        : round(populationStandardDeviationMmolL, 4),
    coefficientOfVariationPercent:
      coefficientOfVariationPercent === null
        ? null
        : round(coefficientOfVariationPercent, 2),
    glucoseManagementIndicatorPercent:
      glucoseManagementIndicatorPercent === null
        ? null
        : round(glucoseManagementIndicatorPercent, 2),
    expectedMilliseconds,
    observedMilliseconds,
    coveragePercent: (() => {
      const rounded = round(
        (observedMilliseconds / expectedMilliseconds) * 100,
        1,
      );
      return observedMilliseconds > 0 && rounded === 0 ? 0.1 : rounded;
    })(),
    gaps: missingIntervals(intervals, range),
    distribution: thresholds
      ? durationDistribution(intervals, observedMilliseconds, thresholds)
      : null,
  };
}
