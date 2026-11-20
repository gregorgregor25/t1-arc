import { formatGlucoseThreshold } from "@/domain/glucoseRanges";
import { MG_DL_PER_MMOL_L } from "@/domain/models";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

import { describeTarvisTimeInRangeThresholds } from "./intent/rangeFocus";
import type {
  TarvisGlucoseThreshold,
  TarvisIntentField,
} from "./intent/types";

/**
 * How a time-in-range answer names its range. Every exact answer says which
 * range it used: plain "time in range" is the standard range 3.9–10.0 mmol/L.
 */
export interface TarvisTimeInRangeWording {
  /** Which share of observed time the answer leads with. */
  share: "inRange" | "below" | "above";
  /** Headline label, e.g. "Time in the standard range 3.9–10.0 mmol/L". */
  title: string;
  /** Sentence fragment after "x% of observed sensor time was". */
  phrase: string;
  /** False for custom ranges that keep the original requested-range copy. */
  named: boolean;
}

function mmolL(threshold: TarvisGlucoseThreshold) {
  return threshold.unit === "mg/dL"
    ? threshold.value / MG_DL_PER_MMOL_L
    : threshold.value;
}

function level(threshold: TarvisGlucoseThreshold) {
  return formatGlucoseThreshold(mmolL(threshold), getRuntimeRegionalDefaults());
}

function bounds(lower: TarvisGlucoseThreshold, upper: TarvisGlucoseThreshold) {
  const regional = getRuntimeRegionalDefaults();
  return `${formatGlucoseThreshold(mmolL(lower), regional, { withUnit: false })}–${formatGlucoseThreshold(mmolL(upper), regional)}`;
}

export function tarvisTimeInRangeWording(
  thresholds: readonly TarvisIntentField<TarvisGlucoseThreshold>[],
): TarvisTimeInRangeWording | null {
  const lower = thresholds.find(({ value }) => value.role === "range_lower")?.value;
  const upper = thresholds.find(({ value }) => value.role === "range_upper")?.value;
  if (!lower || !upper) return null;
  const description = describeTarvisTimeInRangeThresholds(thresholds);
  switch (description.kind) {
    case "below": {
      const words = `${description.threshold.operator === "gt" ? "at or below" : "below"} ${level(description.threshold)}`;
      return { share: "below", title: `Time ${words}`, phrase: words, named: true };
    }
    case "above": {
      const words = `${description.threshold.operator === "lt" ? "at or above" : "above"} ${level(description.threshold)}`;
      return { share: "above", title: `Time ${words}`, phrase: words, named: true };
    }
    case "standard":
    case "tight":
    case "personal": {
      const name =
        description.kind === "personal"
          ? `your range ${bounds(lower, upper)}`
          : `the ${description.kind} range ${bounds(lower, upper)}`;
      return {
        share: "inRange",
        title: `Time in ${name}`,
        phrase: `in ${name}`,
        named: true,
      };
    }
    case "other":
      return {
        share: "inRange",
        title: "Observed time in range",
        phrase: `within the requested ${bounds(lower, upper)} range`,
        named: false,
      };
  }
}

export interface TarvisTimeInRangeRowLabels {
  below: string;
  inRange: string;
  above: string;
}

const GENERIC_ROW_LABELS: TarvisTimeInRangeRowLabels = {
  below: "Time below range",
  inRange: "Time in range",
  above: "Time above range",
};

/** Row labels that state the levels used, e.g. "Time below 3.9 mmol/L". */
export function tarvisTimeInRangeRowLabels(
  thresholds: readonly TarvisIntentField<TarvisGlucoseThreshold>[],
): TarvisTimeInRangeRowLabels {
  const lower = thresholds.find(({ value }) => value.role === "range_lower")?.value;
  const upper = thresholds.find(({ value }) => value.role === "range_upper")?.value;
  const wording = tarvisTimeInRangeWording(thresholds);
  if (!lower || !upper || !wording?.named) return GENERIC_ROW_LABELS;
  return {
    below: `Time below ${level(lower)}`,
    inRange: wording.share === "inRange" ? wording.title : `Time ${bounds(lower, upper)}`,
    above: `Time above ${level(upper)}`,
  };
}
