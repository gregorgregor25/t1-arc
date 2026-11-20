import {
  DEFAULT_OBSERVATION_GAP_MS,
  calculateGlucoseStatistics,
  glucoseObservationIntervals,
} from './glucoseStatistics';
import { type GlucoseReading, MG_DL_PER_MMOL_L, type TimeRange } from './models';
import {
  formatGlucose,
  formatRegionalNumber,
  glucoseUnitLabel,
} from './regionalFormat';
import type { T1ArcRegionalDefaults } from './regionalProfile';

/**
 * Glucose range statistics follow the international consensus on CGM time in
 * ranges (Battelino et al., Diabetes Care 2019, and the 2023 consensus update
 * that added time in tight range). All calculations use mmol/L internally;
 * the display unit never changes a result.
 */
export const GLUCOSE_RANGE_DEFINITION_VERSION =
  'consensus-time-in-ranges-2019-2023:dual-unit-boundaries-v1';
export const GLYCEMIA_RISK_INDEX_VERSION = 'klonoff-2023-gri-v1';
/** Coverage below this is described, but not treated as representative. */
export const REPRESENTATIVE_COVERAGE_PERCENT = 70;

export interface ConsensusGlucoseThreshold {
  readonly mmolL: number;
  readonly mgDl: number;
}

/** Published boundaries in both units. mg/dL values are not derived by rounding. */
export const CONSENSUS_GLUCOSE_THRESHOLDS = {
  veryLowBelow: { mmolL: 3.0, mgDl: 54 },
  rangeLower: { mmolL: 3.9, mgDl: 70 },
  tightUpper: { mmolL: 7.8, mgDl: 140 },
  rangeUpper: { mmolL: 10.0, mgDl: 180 },
  veryHighAbove: { mmolL: 13.9, mgDl: 250 },
} as const satisfies Record<string, ConsensusGlucoseThreshold>;

const CONSENSUS_THRESHOLD_LIST: readonly ConsensusGlucoseThreshold[] =
  Object.values(CONSENSUS_GLUCOSE_THRESHOLDS);
const THRESHOLD_MATCH_TOLERANCE_MMOL_L = 1e-6;
const BOUNDARY_EPSILON_MMOL_L = 1e-9;

/**
 * Returns the consensus boundary represented by a mmol/L value, whether it
 * was saved from a mmol/L number (3.9) or an mg/dL number (70 / 18.016).
 */
export function consensusThresholdFor(
  mmolL: number,
): ConsensusGlucoseThreshold | undefined {
  return CONSENSUS_THRESHOLD_LIST.find(
    (threshold) =>
      Math.abs(threshold.mmolL - mmolL) < THRESHOLD_MATCH_TOLERANCE_MMOL_L ||
      Math.abs(threshold.mgDl / MG_DL_PER_MMOL_L - mmolL) <
        THRESHOLD_MATCH_TOLERANCE_MMOL_L,
  );
}

/**
 * The lowest value counted as at or above an inclusive lower boundary.
 *
 * A consensus boundary has two published forms (3.9 mmol/L and 70 mg/dL)
 * that are not exactly equal after conversion. A reading recorded as either
 * form is counted inside, so 70 mg/dL (3.885 mmol/L) and 3.9 mmol/L are both
 * in range, while 69 mg/dL and 3.8 mmol/L are not.
 */
export function inclusiveLowerBoundMmolL(mmolL: number) {
  const consensus = consensusThresholdFor(mmolL);
  const bound = consensus
    ? Math.min(consensus.mmolL, consensus.mgDl / MG_DL_PER_MMOL_L)
    : mmolL;
  return bound - BOUNDARY_EPSILON_MMOL_L;
}

/** The highest value counted as at or below an inclusive upper boundary. */
export function inclusiveUpperBoundMmolL(mmolL: number) {
  const consensus = consensusThresholdFor(mmolL);
  const bound = consensus
    ? Math.max(consensus.mmolL, consensus.mgDl / MG_DL_PER_MMOL_L)
    : mmolL;
  return bound + BOUNDARY_EPSILON_MMOL_L;
}

/**
 * Version of the boundary rule in {@link glucoseMeetsThreshold}. Saved Tarv1s
 * answers record it so answers saved under the earlier exact comparison can
 * still be checked with that comparison.
 */
export const GLUCOSE_THRESHOLD_BOUNDARY_RULE = 'dual-unit-boundaries-v1';

export type GlucoseThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte';

/**
 * The one boundary rule for comparing a reading with a glucose level, used by
 * History, Insights and Tarv1s alike.
 *
 * A reading recorded as either published form of a consensus boundary
 * (54/3.0, 70/3.9, 140/7.8, 180/10.0, 250/13.9) counts as exactly at that
 * boundary, so 70 mg/dL is not "below 3.9" and 180 mg/dL is not "above 10".
 * Any other level, such as a personal range or "time below 4.5", is compared
 * exactly after conversion to mmol/L.
 */
export function glucoseMeetsThreshold(
  mmolL: number,
  operator: GlucoseThresholdOperator,
  thresholdMmolL: number,
): boolean {
  switch (operator) {
    case 'gte':
      return mmolL >= inclusiveLowerBoundMmolL(thresholdMmolL);
    case 'lt':
      return mmolL < inclusiveLowerBoundMmolL(thresholdMmolL);
    case 'lte':
      return mmolL <= inclusiveUpperBoundMmolL(thresholdMmolL);
    case 'gt':
      return mmolL > inclusiveUpperBoundMmolL(thresholdMmolL);
  }
}

export type GlucoseTargetRangeKind = 'standard' | 'tight' | 'personal';

export interface GlucoseTargetRange {
  kind: GlucoseTargetRangeKind;
  /** Inclusive nominal lower boundary in mmol/L. */
  lowerMmolL: number;
  /** Inclusive nominal upper boundary in mmol/L. */
  upperMmolL: number;
}

export const STANDARD_GLUCOSE_RANGE: GlucoseTargetRange = Object.freeze({
  kind: 'standard',
  lowerMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL,
  upperMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.rangeUpper.mmolL,
});

export const TIGHT_GLUCOSE_RANGE: GlucoseTargetRange = Object.freeze({
  kind: 'tight',
  lowerMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.rangeLower.mmolL,
  upperMmolL: CONSENSUS_GLUCOSE_THRESHOLDS.tightUpper.mmolL,
});

/**
 * The personal range is the "In range" band the person set in
 * Settings > Glucose display (the same band the charts shade). Invalid or
 * unordered values return null rather than a guessed range.
 */
export function personalGlucoseRange(settings: {
  targetMin: number;
  targetMax: number;
}): GlucoseTargetRange | null {
  const { targetMin, targetMax } = settings;
  if (
    !Number.isFinite(targetMin) ||
    !Number.isFinite(targetMax) ||
    targetMin <= 0 ||
    targetMin >= targetMax
  ) {
    return null;
  }
  return { kind: 'personal', lowerMmolL: targetMin, upperMmolL: targetMax };
}

export type GlucoseRangePosition = 'below' | 'in' | 'above';

export function glucoseRangePosition(
  mmolL: number,
  range: Pick<GlucoseTargetRange, 'lowerMmolL' | 'upperMmolL'>,
): GlucoseRangePosition {
  if (mmolL < inclusiveLowerBoundMmolL(range.lowerMmolL)) return 'below';
  if (mmolL > inclusiveUpperBoundMmolL(range.upperMmolL)) return 'above';
  return 'in';
}

export type ConsensusGlucoseBand =
  | 'veryLow'
  | 'low'
  | 'inRange'
  | 'high'
  | 'veryHigh';

export const CONSENSUS_GLUCOSE_BANDS: readonly ConsensusGlucoseBand[] = [
  'veryLow',
  'low',
  'inRange',
  'high',
  'veryHigh',
];

/**
 * Very low < 3.0 (54); low 3.0–3.8 (54–69); in range 3.9–10.0 (70–180);
 * high 10.1–13.9 (181–250); very high > 13.9 (250) mmol/L (mg/dL).
 */
export function consensusGlucoseBand(mmolL: number): ConsensusGlucoseBand {
  const t = CONSENSUS_GLUCOSE_THRESHOLDS;
  if (mmolL < inclusiveLowerBoundMmolL(t.veryLowBelow.mmolL)) return 'veryLow';
  if (mmolL < inclusiveLowerBoundMmolL(t.rangeLower.mmolL)) return 'low';
  if (mmolL <= inclusiveUpperBoundMmolL(t.rangeUpper.mmolL)) return 'inRange';
  if (mmolL <= inclusiveUpperBoundMmolL(t.veryHighAbove.mmolL)) return 'high';
  return 'veryHigh';
}

export interface GlucoseDurationShare {
  milliseconds: number;
  /** Share of observed sensor time, 1 decimal place; null with no observed time. */
  percent: number | null;
}

export interface GlucoseRangeShare {
  range: GlucoseTargetRange;
  below: GlucoseDurationShare;
  inRange: GlucoseDurationShare;
  above: GlucoseDurationShare;
}

export interface GlycemiaRiskIndex {
  formulaVersion: typeof GLYCEMIA_RISK_INDEX_VERSION;
  /** 0–100, 1 decimal place. Higher numbers mean more time low or high. */
  value: number;
  hypoglycaemiaComponent: number;
  hyperglycaemiaComponent: number;
}

export interface GlucoseRangeSummary {
  definitionVersion: typeof GLUCOSE_RANGE_DEFINITION_VERSION;
  range: TimeRange;
  observationGapCapMilliseconds: number;
  expectedMilliseconds: number;
  observedMilliseconds: number;
  coveragePercent: number;
  sampleCount: number;
  /** True when coverage meets the 70% consensus minimum. */
  representative: boolean;
  bands: Record<ConsensusGlucoseBand, GlucoseDurationShare>;
  standard: GlucoseRangeShare;
  tight: GlucoseRangeShare;
  personal: GlucoseRangeShare | null;
  glycemiaRiskIndex: GlycemiaRiskIndex | null;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function share(milliseconds: number, observedMilliseconds: number) {
  return {
    milliseconds,
    percent:
      observedMilliseconds > 0
        ? round((milliseconds / observedMilliseconds) * 100, 1)
        : null,
  };
}

function rangeShare(
  intervals: readonly { start: number; end: number; mmolL: number }[],
  range: GlucoseTargetRange,
  observedMilliseconds: number,
): GlucoseRangeShare {
  const totals: Record<GlucoseRangePosition, number> = {
    below: 0,
    in: 0,
    above: 0,
  };
  intervals.forEach((interval) => {
    totals[glucoseRangePosition(interval.mmolL, range)] +=
      interval.end - interval.start;
  });
  return {
    range,
    below: share(totals.below, observedMilliseconds),
    inRange: share(totals.in, observedMilliseconds),
    above: share(totals.above, observedMilliseconds),
  };
}

/**
 * Glycemia Risk Index (Klonoff et al., J Diabetes Sci Technol 2023):
 * 3.0 × (VLow + 0.8 × Low) + 1.6 × (VHigh + 0.5 × High), capped at 100.
 * Uses unrounded band percentages so display rounding cannot shift it.
 */
export function glycemiaRiskIndex(
  bandMilliseconds: Record<ConsensusGlucoseBand, number>,
  observedMilliseconds: number,
): GlycemiaRiskIndex | null {
  if (observedMilliseconds <= 0) return null;
  const percent = (band: ConsensusGlucoseBand) =>
    (bandMilliseconds[band] / observedMilliseconds) * 100;
  const hypo = percent('veryLow') + 0.8 * percent('low');
  const hyper = percent('veryHigh') + 0.5 * percent('high');
  return {
    formulaVersion: GLYCEMIA_RISK_INDEX_VERSION,
    value: round(Math.min(100, 3.0 * hypo + 1.6 * hyper), 1),
    hypoglycaemiaComponent: round(hypo, 1),
    hyperglycaemiaComponent: round(hyper, 1),
  };
}

export function calculateGlucoseRangeSummary({
  readings,
  range,
  personalRange = null,
  observationGapCapMilliseconds = DEFAULT_OBSERVATION_GAP_MS,
}: {
  readings: readonly GlucoseReading[];
  range: TimeRange;
  personalRange?: GlucoseTargetRange | null;
  observationGapCapMilliseconds?: number;
}): GlucoseRangeSummary {
  const statistics = calculateGlucoseStatistics({
    readings,
    range,
    observationGapCapMilliseconds,
  });
  const intervals = glucoseObservationIntervals(
    readings,
    range,
    observationGapCapMilliseconds,
  );
  const observed = statistics.observedMilliseconds;
  const bandMilliseconds: Record<ConsensusGlucoseBand, number> = {
    veryLow: 0,
    low: 0,
    inRange: 0,
    high: 0,
    veryHigh: 0,
  };
  intervals.forEach((interval) => {
    bandMilliseconds[consensusGlucoseBand(interval.mmolL)] +=
      interval.end - interval.start;
  });
  const bands = Object.fromEntries(
    CONSENSUS_GLUCOSE_BANDS.map((band) => [
      band,
      share(bandMilliseconds[band], observed),
    ]),
  ) as Record<ConsensusGlucoseBand, GlucoseDurationShare>;
  return {
    definitionVersion: GLUCOSE_RANGE_DEFINITION_VERSION,
    range: { ...range },
    observationGapCapMilliseconds,
    expectedMilliseconds: statistics.expectedMilliseconds,
    observedMilliseconds: observed,
    coveragePercent: statistics.coveragePercent,
    sampleCount: statistics.sampleCount,
    representative:
      observed > 0 &&
      statistics.coveragePercent >= REPRESENTATIVE_COVERAGE_PERCENT,
    bands,
    standard: rangeShare(intervals, STANDARD_GLUCOSE_RANGE, observed),
    tight: rangeShare(intervals, TIGHT_GLUCOSE_RANGE, observed),
    personal: personalRange
      ? rangeShare(intervals, personalRange, observed)
      : null,
    glycemiaRiskIndex: glycemiaRiskIndex(bandMilliseconds, observed),
  };
}

type GlucoseFormatSettings = Pick<T1ArcRegionalDefaults, 'locale' | 'glucoseUnit'>;

/**
 * Formats a range boundary. Consensus boundaries use their published value
 * in each unit (7.8 mmol/L is shown as 140 mg/dL, not a converted 141).
 */
export function formatGlucoseThreshold(
  mmolL: number,
  settings: GlucoseFormatSettings,
  options: { withUnit?: boolean } = {},
) {
  const consensus = consensusThresholdFor(mmolL);
  if (!consensus) return formatGlucose(mmolL, settings, options);
  const mgDl = settings.glucoseUnit === 'mgDl';
  const numeric = formatRegionalNumber(
    mgDl ? consensus.mgDl : consensus.mmolL,
    settings.locale,
    {
      minimumFractionDigits: mgDl ? 0 : 1,
      maximumFractionDigits: mgDl ? 0 : 1,
    },
  );
  return options.withUnit === false
    ? numeric
    : `${numeric} ${glucoseUnitLabel(settings.glucoseUnit)}`;
}

export function formatGlucoseRangeBounds(
  range: Pick<GlucoseTargetRange, 'lowerMmolL' | 'upperMmolL'>,
  settings: GlucoseFormatSettings,
) {
  return `${formatGlucoseThreshold(range.lowerMmolL, settings, { withUnit: false })}–${formatGlucoseThreshold(range.upperMmolL, settings)}`;
}

export const GLUCOSE_TARGET_RANGE_NAMES: Record<GlucoseTargetRangeKind, string> = {
  standard: 'Standard range',
  tight: 'Tight range',
  personal: 'Your range',
};

/** For example "Standard range 3.9–10.0 mmol/L" or "Your range 70–160 mg/dL". */
export function glucoseTargetRangeLabel(
  range: GlucoseTargetRange,
  settings: GlucoseFormatSettings,
) {
  return `${GLUCOSE_TARGET_RANGE_NAMES[range.kind]} ${formatGlucoseRangeBounds(range, settings)}`;
}

const GLUCOSE_TARGET_RANGE_PHRASES: Record<GlucoseTargetRangeKind, string> = {
  standard: 'the standard range',
  tight: 'the tight range',
  personal: 'your range',
};

/** Mid-sentence form, for example "the tight range 3.9–7.8 mmol/L". */
export function glucoseTargetRangePhrase(
  range: GlucoseTargetRange,
  settings: GlucoseFormatSettings,
) {
  return `${GLUCOSE_TARGET_RANGE_PHRASES[range.kind]} ${formatGlucoseRangeBounds(range, settings)}`;
}

export const CONSENSUS_GLUCOSE_BAND_NAMES: Record<ConsensusGlucoseBand, string> = {
  veryLow: 'Very low',
  low: 'Low',
  inRange: 'In range',
  high: 'High',
  veryHigh: 'Very high',
};

/**
 * Band limits as published: "below 3.0", "3.0–3.8", "3.9–10.0",
 * "10.1–13.9", "above 13.9" mmol/L, or "below 54", "54–69", "70–180",
 * "181–250", "above 250" mg/dL.
 */
export function consensusGlucoseBandBounds(
  band: ConsensusGlucoseBand,
  settings: GlucoseFormatSettings,
) {
  const mgDl = settings.glucoseUnit === 'mgDl';
  const value = (mmolL: number, mgDlValue: number) =>
    formatRegionalNumber(mgDl ? mgDlValue : mmolL, settings.locale, {
      minimumFractionDigits: mgDl ? 0 : 1,
      maximumFractionDigits: mgDl ? 0 : 1,
    });
  const unit = glucoseUnitLabel(settings.glucoseUnit);
  switch (band) {
    case 'veryLow':
      return `below ${value(3.0, 54)} ${unit}`;
    case 'low':
      return `${value(3.0, 54)}–${value(3.8, 69)} ${unit}`;
    case 'inRange':
      return `${value(3.9, 70)}–${value(10.0, 180)} ${unit}`;
    case 'high':
      return `${value(10.1, 181)}–${value(13.9, 250)} ${unit}`;
    case 'veryHigh':
      return `above ${value(13.9, 250)} ${unit}`;
  }
}
