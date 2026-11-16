import type {
  TarvisGlucoseTargetProfile,
  TarvisGlucoseThreshold,
  TarvisGlucoseUnit,
  TarvisIntentField,
} from "./types";

/**
 * Named time-in-range questions. "Time in range" always means the standard
 * consensus range (3.9–10.0 mmol/L, 70–180 mg/dL). Other ranges are used only
 * when the question names them, and every answer names the range it used.
 */
export const TARVIS_STANDARD_RANGE_PROFILE: TarvisGlucoseTargetProfile = {
  id: "standard-cgm-range",
  unit: "mmol/L",
  lowBelow: 3.9,
  highAbove: 10,
};

export const TARVIS_TIGHT_RANGE_PROFILE: TarvisGlucoseTargetProfile = {
  id: "consensus-tight-range",
  unit: "mmol/L",
  lowBelow: 3.9,
  highAbove: 7.8,
};

/** Profile id for the user's own "In range" band from glucose display settings. */
export const TARVIS_PERSONAL_RANGE_PROFILE_ID = "personal-in-range-band";

/** Provenance id for the complementary bound of a "time below/above X" question. */
export const TARVIS_TIME_BELOW_SOURCE_ID = "time-below-threshold";
export const TARVIS_TIME_ABOVE_SOURCE_ID = "time-above-threshold";

const VERY_LOW_MMOL_L = 3;
const VERY_HIGH_MMOL_L = 13.9;
/** No plausible mmol/L glucose threshold is above this; larger bare numbers are mg/dL. */
const LARGEST_BARE_MMOL_L_THRESHOLD = 30;
const MG_DL_EQUIVALENT: Readonly<Record<number, number>> = {
  3: 54,
  3.9: 70,
  7.8: 140,
  10: 180,
  13.9: 250,
};

export type TarvisTimeInRangeFocus =
  | { kind: "tight" }
  | { kind: "personal" }
  | { kind: "below"; presetMmolL: number | null }
  | { kind: "above"; presetMmolL: number | null };

const TIGHT_PATTERN =
  /\b(?:tight(?:er)?\s+(?:target\s+)?range|titr|time\s+in\s+tight)\b/;
const PERSONAL_PATTERN =
  /\b(?:my\s+(?:own\s+|personal\s+)?range|my\s+(?:own|personal)\s+target\s+range|personal\s+(?:target\s+)?range|my\s+in[- ]range\s+band)\b/;
const TIME_LEAD = String.raw`(?:time|percent(?:age)?(?:\s+of\s+(?:my\s+)?time)?)\s+(?:(?:i|it|my|glucose|did|spend|spent|was|were|have|has|been)\s+)*`;
const BELOW_WORD = String.raw`(?:below|under|less\s+than|lower\s+than)`;
const ABOVE_WORD = String.raw`(?:above|over|more\s+than|greater\s+than|higher\s+than)`;
/** A number followed by a time unit is a period ("over 14 days"), not a level. */
const LEVEL_NUMBER = String.raw`(?!\d+(?:[.,]\d+)?\s*(?:d|days?|weeks?|wks?|months?|hours?|hrs?|h|minutes?|mins?|years?|yrs?)\b)\d`;
const BELOW_NUMBER_PATTERN = new RegExp(`\\b${TIME_LEAD}${BELOW_WORD}\\s+${LEVEL_NUMBER}`);
const ABOVE_NUMBER_PATTERN = new RegExp(`\\b${TIME_LEAD}${ABOVE_WORD}\\s+${LEVEL_NUMBER}`);
const BELOW_RANGE_PATTERN = new RegExp(
  `\\b(?:${TIME_LEAD}${BELOW_WORD}\\s+(?:the\\s+)?(?:target\\s+)?(?:range|target)|time\\s+below\\s+range|tbr)\\b`,
);
const ABOVE_RANGE_PATTERN = new RegExp(
  `\\b(?:${TIME_LEAD}${ABOVE_WORD}\\s+(?:the\\s+)?(?:target\\s+)?(?:range|target)|time\\s+above\\s+range|tar)\\b`,
);
const VERY_LOW_PATTERN = new RegExp(`\\b${TIME_LEAD}(?:in\\s+(?:the\\s+)?)?very\\s+low\\b`);
const VERY_HIGH_PATTERN = new RegExp(`\\b${TIME_LEAD}(?:in\\s+(?:the\\s+)?)?very\\s+high\\b`);

/** Phrases that ask for a time share and therefore select the time-in-range metric. */
export const TARVIS_RANGE_FOCUS_METRIC_PATTERNS: readonly RegExp[] = [
  /\btime\s+in\s+(?:the\s+|my\s+)?(?:own\s+|personal\s+)?(?:tight(?:er)?\s+)?(?:target\s+)?range\b/,
  /\b(?:percent(?:age)?|share|proportion)\s+(?:of\s+(?:my\s+)?time\s+)?in\s+(?:the\s+|my\s+)?(?:own\s+|personal\s+)?tight(?:er)?\s+(?:target\s+)?range\b/,
  /\btitr\b/,
  BELOW_NUMBER_PATTERN,
  ABOVE_NUMBER_PATTERN,
  BELOW_RANGE_PATTERN,
  ABOVE_RANGE_PATTERN,
  VERY_LOW_PATTERN,
  VERY_HIGH_PATTERN,
];

export function detectTarvisTimeInRangeFocus(
  normalizedQuestion: string,
): TarvisTimeInRangeFocus | null {
  const text = normalizedQuestion.toLowerCase();
  if (TIGHT_PATTERN.test(text)) return { kind: "tight" };
  if (PERSONAL_PATTERN.test(text)) return { kind: "personal" };
  if (VERY_LOW_PATTERN.test(text)) return { kind: "below", presetMmolL: VERY_LOW_MMOL_L };
  if (VERY_HIGH_PATTERN.test(text)) return { kind: "above", presetMmolL: VERY_HIGH_MMOL_L };
  if (BELOW_NUMBER_PATTERN.test(text)) return { kind: "below", presetMmolL: null };
  if (ABOVE_NUMBER_PATTERN.test(text)) return { kind: "above", presetMmolL: null };
  if (BELOW_RANGE_PATTERN.test(text)) {
    return { kind: "below", presetMmolL: TARVIS_STANDARD_RANGE_PROFILE.lowBelow };
  }
  if (ABOVE_RANGE_PATTERN.test(text)) {
    return { kind: "above", presetMmolL: TARVIS_STANDARD_RANGE_PROFILE.highAbove };
  }
  return null;
}

/** A bare number above 30 can only be mg/dL. */
export function inferTarvisThresholdUnit(
  value: number,
  unit: TarvisGlucoseUnit | null,
): TarvisGlucoseUnit {
  if (unit) return unit;
  return value > LARGEST_BARE_MMOL_L_THRESHOLD ? "mg/dL" : "mmol/L";
}

/** Consensus threshold expressed in the requested unit, using published mg/dL values. */
export function tarvisConsensusThresholdIn(
  mmolL: number,
  unit: TarvisGlucoseUnit,
) {
  if (unit === "mmol/L") return mmolL;
  return MG_DL_EQUIVALENT[mmolL] ?? Math.round(mmolL * 18.016);
}

export type TarvisRangeFocusDescription =
  | { kind: "standard" | "tight" | "personal" | "other" }
  | { kind: "below"; threshold: TarvisGlucoseThreshold }
  | { kind: "above"; threshold: TarvisGlucoseThreshold };

function sameMmolL(threshold: TarvisGlucoseThreshold, mmolL: number) {
  const expected = tarvisConsensusThresholdIn(mmolL, threshold.unit);
  return Math.abs(threshold.value - expected) < 1e-9;
}

/**
 * Recover which range a time-in-range intent used, from its thresholds and
 * their provenance. This is deterministic and needs no question re-parsing.
 */
export function describeTarvisTimeInRangeThresholds(
  thresholds: readonly TarvisIntentField<TarvisGlucoseThreshold>[],
): TarvisRangeFocusDescription {
  const lower = thresholds.find(({ value }) => value.role === "range_lower");
  const upper = thresholds.find(({ value }) => value.role === "range_upper");
  if (!lower || !upper) return { kind: "other" };
  if (upper.provenance.sourceText === TARVIS_TIME_BELOW_SOURCE_ID) {
    return { kind: "below", threshold: lower.value };
  }
  if (lower.provenance.sourceText === TARVIS_TIME_ABOVE_SOURCE_ID) {
    return { kind: "above", threshold: upper.value };
  }
  if (
    lower.provenance.sourceText === TARVIS_PERSONAL_RANGE_PROFILE_ID &&
    upper.provenance.sourceText === TARVIS_PERSONAL_RANGE_PROFILE_ID
  ) {
    return { kind: "personal" };
  }
  const inclusive =
    lower.value.operator === "gte" && upper.value.operator === "lte";
  if (inclusive && sameMmolL(lower.value, 3.9) && sameMmolL(upper.value, 10)) {
    return { kind: "standard" };
  }
  if (inclusive && sameMmolL(lower.value, 3.9) && sameMmolL(upper.value, 7.8)) {
    return { kind: "tight" };
  }
  return { kind: "other" };
}

/**
 * The user's own range for "time in my range" questions, from the glucose
 * display "In range" band (stored in mmol/L). Invalid settings give undefined,
 * so the question falls back to the standard range and the answer says so.
 */
export function tarvisPersonalTargetProfile(
  settings: { targetMin: number; targetMax: number } | null | undefined,
): TarvisGlucoseTargetProfile | undefined {
  if (!settings) return undefined;
  const { targetMin, targetMax } = settings;
  if (
    !Number.isFinite(targetMin) ||
    !Number.isFinite(targetMax) ||
    targetMin <= 0 ||
    targetMin >= targetMax
  ) {
    return undefined;
  }
  return {
    id: TARVIS_PERSONAL_RANGE_PROFILE_ID,
    unit: "mmol/L",
    lowBelow: targetMin,
    highAbove: targetMax,
  };
}
