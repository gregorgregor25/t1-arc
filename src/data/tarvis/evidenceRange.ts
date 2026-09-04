import type { TimeRange } from "@/domain/models";

import type {
  TarvisIntentField,
  TarvisIntentResolution,
  TarvisTemporalScope,
} from "./intent";
import { resolveTarvisIntentRange } from "./intentRange";

export interface TarvisEvidenceRanges {
  current: TimeRange;
  previous: TimeRange;
}

export type TarvisEvidenceRangeRequest =
  | { kind: "none" }
  | { kind: "resolved"; ranges: TarvisEvidenceRanges }
  | { kind: "unsupported"; reason: string };

const TEMPORAL_OUTCOME_CODES = new Set([
  "ambiguous_time_scope",
  "ambiguous_clock_time",
  "invalid_clock_window",
  "unsupported_time_scope",
  "unsupported_comparison",
]);

const EXPLICIT_TEMPORAL_OR_COMPARISON_TEXT =
  /\b(?:today|yesterday|tonight|last night|this (?:week|month)|last (?:week|month|year|summer|winter|spring|autumn)|past\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty|ninety)\s+(?:hours?|days?|weeks?|months?|years?)|\d+\s+(?:hours?|days?|weeks?|months?|years?)\s+ago|between|from\s+.+\s+to|since|before|after|during|on\s+(?:mon|tue|wed|thu|fri|sat|sun|\d)|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|january|february|march|april|may|june|july|august|september|october|november|december|compare|compared|versus|vs\.?|previous period|prior period)\b/i;

function derivedPreviousComparison() {
  return {
    value: { kind: "previous_equal_period" as const },
    provenance: {
      kind: "derived" as const,
      sourceText: null,
      sourceStart: null,
      sourceEnd: null,
      turnId: null,
      note: "The preceding equal local period is loaded only as comparison context for bounded evidence synthesis.",
    },
  };
}

function dateLiteralScope(
  resolution: TarvisIntentResolution,
): TarvisIntentField<TarvisTemporalScope> | undefined {
  if (resolution.literals.dates.length !== 1) return undefined;
  const date = resolution.literals.dates[0]!;
  return {
    value: { kind: "calendar_date", date: date.date },
    provenance: {
      kind: "explicit",
      sourceText: date.raw,
      sourceStart: date.start,
      sourceEnd: date.end,
      turnId: null,
      note: "Recovered from the explicit date literal for evidence loading.",
    },
  };
}

/**
 * Resolves an exact requested period for model evidence. It never guesses a
 * clock window or arbitrary two-period comparison. The immediately preceding
 * equal local period is included as bounded context, not as a user-requested
 * result.
 */
export function rangesForTarvisEvidenceResolution(
  resolution: TarvisIntentResolution,
  asOf: number,
): TarvisEvidenceRanges | null {
  const request = resolveTarvisEvidenceRangeRequest(resolution, asOf);
  return request.kind === "resolved" ? request.ranges : null;
}

/**
 * Distinguishes a question with no requested evidence window from a question
 * whose explicit time/comparison request cannot be represented exactly. This
 * distinction prevents the production flow from silently substituting the
 * report that happens to be visible on the Insights screen.
 */
export function resolveTarvisEvidenceRangeRequest(
  resolution: TarvisIntentResolution,
  asOf: number,
): TarvisEvidenceRangeRequest {
  if (
    resolution.outcome.code === "ambiguous_clock_time" ||
    (resolution.intent.clockWindow !== undefined &&
      resolution.intent.clockWindow !== null) ||
    resolution.intent.comparison?.value.kind === "explicit_periods"
  ) {
    return {
      kind: "unsupported",
      reason:
        "The requested clock window or comparison cannot be represented exactly.",
    };
  }
  const temporalScope =
    resolution.intent.temporalScope ?? dateLiteralScope(resolution);
  if (!temporalScope) {
    const explicitlyRequested =
      resolution.literals.dates.length > 0 ||
      resolution.literals.durations.length > 0 ||
      resolution.literals.times.length > 0 ||
      resolution.literals.clockWindows.length > 0 ||
      resolution.literals.comparisons.length > 0 ||
      TEMPORAL_OUTCOME_CODES.has(resolution.outcome.code) ||
      EXPLICIT_TEMPORAL_OR_COMPARISON_TEXT.test(
        resolution.intent.normalizedQuestion,
      );
    return explicitlyRequested
      ? {
          kind: "unsupported",
          reason:
            "The requested time period could not be resolved to an exact local-time range.",
        }
      : { kind: "none" };
  }
  const resolved = resolveTarvisIntentRange({
    asOf,
    intent: {
      temporalScope,
      clockWindow: null,
      comparison:
        resolution.intent.comparison?.value.kind === "previous_equal_period"
          ? resolution.intent.comparison
          : derivedPreviousComparison(),
    },
  });
  if (resolved.status !== "resolved" || !resolved.previous) {
    return {
      kind: "unsupported",
      reason:
        resolved.status === "rejected"
          ? resolved.message
          : "The requested time period could not be loaded exactly.",
    };
  }
  return {
    kind: "resolved",
    ranges: { current: resolved.current, previous: resolved.previous },
  };
}
