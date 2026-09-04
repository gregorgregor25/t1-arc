import { isReadyTarvisIntent, TarvisIntentResolution } from "./intent";
import { TarvisAnswer } from "./types";
import {
  isLocalGlucoseScopeWithinLimit,
  MAX_LOCAL_GLUCOSE_SCOPE_DAYS,
} from "./localScopeLimit";

const LOCALLY_EXECUTABLE_GLUCOSE_METRICS = new Set([
  "glucose.mean",
  "glucose.median",
  "glucose.minimum",
  "glucose.maximum",
  "glucose.standard_deviation",
  "glucose.coefficient_of_variation",
  "glucose.gmi",
  "glucose.time_in_range",
  "glucose.low_episodes",
  "glucose.high_episodes",
  "glucose.low_readings",
  "glucose.high_readings",
]);

const LOCALLY_EXECUTABLE_PERSONAL_METRICS = new Set([
  "glucose.current",
  "insulin.delivered_total",
  "insulin.basal_total",
  "insulin.bolus_total",
  "food.carbohydrate_total",
  "activity.duration",
  "sleep.duration",
  "data_quality.coverage",
  "data_quality.gaps",
]);

const FAIL_CLOSED_TEMPORAL_CODES = new Set([
  "ambiguous_time_scope",
  "ambiguous_clock_time",
  "invalid_clock_window",
  "unsupported_time_scope",
]);

const PERSONAL_REFERENCE = /\b(?:my|mine|me|i)\b/i;
const PERSONAL_HEALTH_DATA_CUE =
  /\b(?:glucose|blood sugar|bg|cgm|sensor|readings?|levels?|numbers?|diabetes|insulin|basal|bolus|pump|food|meals?|carbs?|carbohydrates?|exercise|activity|sleep|health data|data|records?|history)\b/i;
const DIRECT_DATA_CUE =
  /\b(?:glucose|blood sugar|bg|cgm|sensor|readings?|levels?|numbers?|insulin|basal|bolus|pump|carbs?|carbohydrates?|activity|sleep|health data|data|records?|history)\b/i;
const ANALYTIC_OR_TIME_CUE =
  /\b(?:average|avg|mean|median|minimum|maximum|lowest|highest|how many|count|total|percentage|percent|time in range|tir|events?|episodes?|highs?|lows?|hypos?|hypers?|trend|pattern|variability|coverage|gaps?|today|yesterday|tonight|overnights?|night|nights|morning|afternoon|evening|midday|midnight|noon|dawn|dusk|bedtime|waking|breakfast|lunch|dinner|mealtime|working hours?|workday|hours?|days?|weeks?|months?|years?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weekends?|weeknights?|between|from|since|before|after|during|over|past|last|previous|recent)\b/i;

const EDUCATIONAL_QUESTION =
  /\b(?:what (?:does|is|are)|what's|explain|meaning of|why (?:can|does|do)|how (?:does|do|can)|can|does|dawn phenomenon|time in range actually mean)\b/i;
const EVIDENCE_SYNTHESIS_QUESTION =
  /\b(?:why was|usually|patterns?|linked|associated|relationship|make a difference|making (?:the )?.*unreliable|what changed|how (?:have|has|was|were) .*\b(?:been|doing)|how was (?:my )?(?:bg|glucose|blood sugar|sugars?)|quick summary|summari[sz]e|worth reviewing|what should i discuss|discuss with my|was .*\bbad|spot any|seem to|(?:basal|bolus|insulin|carbs?|carbohydrates?).*\b(?:higher|lower|more|less)\b|did i eat more)\b/i;
const PERSONAL_EVIDENCE_QUESTION =
  /\bmy\s+(?:glucose|blood sugar|sugars?|bg|cgm|sensor|readings?|levels?|numbers?|insulin|basal|bolus|pump|carbs?|meals?|food|activity|exercise|sleep|health data|records?|history|time in range|tir|patterns?)\b|\b(?:today|yesterday|last (?:night|week|month)|past \d+|previous period)\b/i;
const AMBIGUOUS_PERSONAL_RECORD_RETRIEVAL =
  /\bwhat (?:did|have) i (?:eat|ate|have for (?:breakfast|lunch|dinner))\b/i;

export type TarvisOnDeviceRoute =
  | { kind: "scoped-glucose" }
  | { kind: "scoped-personal-data" }
  | { kind: "capability"; answer: TarvisAnswer }
  | { kind: "model-education" }
  | { kind: "model-evidence" };

function answer(
  headline: string,
  copy: string,
  limitation: string,
): TarvisAnswer {
  return {
    headline,
    answer: copy,
    confidence: "limited",
    evidenceIds: [],
    limitations: [limitation],
  };
}

function isRecognisedGlucoseRequest(resolution: TarvisIntentResolution) {
  const hasGlucoseMetric = resolution.intent.metrics.some(({ value }) =>
    value.startsWith("glucose."),
  );
  return (
    (resolution.intent.domain?.value === "glucose" || hasGlucoseMetric) &&
    (resolution.intent.metrics.length > 0 ||
      resolution.literals.clockWindows.length > 0 ||
      resolution.intent.clockWindow !== undefined)
  );
}

function isPersonalHealthAnalyticsRequest(resolution: TarvisIntentResolution) {
  const question = resolution.intent.normalizedQuestion;
  return (
    ANALYTIC_OR_TIME_CUE.test(question) &&
    ((PERSONAL_REFERENCE.test(question) &&
      PERSONAL_HEALTH_DATA_CUE.test(question)) ||
      DIRECT_DATA_CUE.test(question))
  );
}

function locallyExecutableReadyShape(
  resolution: Extract<TarvisIntentResolution, { outcome: { status: "ready" } }>,
) {
  const { intent } = resolution;
  if (
    !intent.metrics.every(({ value }) =>
      LOCALLY_EXECUTABLE_GLUCOSE_METRICS.has(value),
    )
  ) {
    return false;
  }
  if (intent.clockWindow === null) return true;
  return (
    !intent.metrics.some(({ value }) => value === "glucose.gmi") &&
    intent.comparison === null &&
    intent.temporalScope.value.kind === "recent_local_days" &&
    intent.temporalScope.value.include === "most_recent_completed_windows"
  );
}

function locallyExecutablePersonalShape(
  resolution: Extract<TarvisIntentResolution, { outcome: { status: "ready" } }>,
) {
  const { intent } = resolution;
  return (
    intent.metrics.length === 1 &&
    LOCALLY_EXECUTABLE_PERSONAL_METRICS.has(intent.metrics[0]!.value) &&
    intent.clockWindow === null
  );
}

function modelRoute(
  resolution: TarvisIntentResolution,
): Extract<
  TarvisOnDeviceRoute,
  { kind: "model-education" | "model-evidence" }
> | null {
  const question = resolution.intent.normalizedQuestion;
  if (resolution.outcome.code === "ambiguous_clock_time") return null;
  if (
    resolution.outcome.code === "ambiguous_time_scope" &&
    !EVIDENCE_SYNTHESIS_QUESTION.test(question) &&
    !EDUCATIONAL_QUESTION.test(question)
  ) {
    return null;
  }
  if (
    resolution.outcome.code === "invalid_threshold" ||
    resolution.outcome.code === "invalid_clock_window" ||
    resolution.outcome.code === "unsupported_time_scope" ||
    resolution.outcome.code === "unsupported_metric" ||
    resolution.outcome.code === "unsupported_domain" ||
    resolution.outcome.code === "unsupported_comparison"
  ) {
    return null;
  }
  if (
    resolution.outcome.code === "missing_metric" &&
    /\b(?:show|list|give)\b[\s\S]{0,40}\b(?:readings?|records?|data)\b|\bwhat (?:did|have) i (?:eat|ate)\b/i.test(
      question,
    )
  ) {
    return null;
  }
  if (
    EVIDENCE_SYNTHESIS_QUESTION.test(question) ||
    PERSONAL_EVIDENCE_QUESTION.test(question)
  ) {
    return { kind: "model-evidence" };
  }
  return EDUCATIONAL_QUESTION.test(question)
    ? { kind: "model-education" }
    : null;
}

/**
 * Keeps high-priority glucose calculations fail-closed. A request with an
 * explicit metric or clock window is never handed to a model to reinterpret
 * after the deterministic resolver found ambiguity or missing capability.
 */
export function routeTarvisIntent(
  resolution: TarvisIntentResolution,
): TarvisOnDeviceRoute {
  if (isReadyTarvisIntent(resolution)) {
    if (!isLocalGlucoseScopeWithinLimit(resolution.intent)) {
      return {
        kind: "capability",
        answer: answer(
          "That period is too large for one on-phone answer",
          `To keep the calculation responsive and its evidence safely stored, Tarv1s can use up to ${MAX_LOCAL_GLUCOSE_SCOPE_DAYS} days of local health data in one answer, including both periods in a comparison. Ask for a shorter period, such as the last 90 days, or compare the last 30 days with the preceding 30 days.`,
          "No health records were loaded and no OpenAI request was made for this oversized calculation.",
        ),
      };
    }
    if (locallyExecutablePersonalShape(resolution)) {
      return { kind: "scoped-personal-data" };
    }
    if (locallyExecutableReadyShape(resolution)) {
      return { kind: "scoped-glucose" };
    }
    if (
      resolution.intent.clockWindow !== null &&
      resolution.intent.metrics.some(({ value }) => value === "glucose.gmi")
    ) {
      return {
        kind: "capability",
        answer: answer(
          "GMI needs a full-period glucose range",
          "GMI is derived from broadly representative mean sensor glucose, so I cannot calculate an “overnight GMI” or use selected hours. Ask for a continuous period such as the last 14 or 30 days instead.",
          "No calculation or OpenAI request was made; selected clock hours were not substituted for representative full-period CGM data.",
        ),
      };
    }
    return {
      kind: "capability",
      answer: answer(
        "I can’t calculate that safely yet",
        "I recognised what you asked to calculate, but this exact local calculation is not available yet. I won’t substitute a different metric or time period.",
        "No calculation or OpenAI request was made for this unsupported calculation shape.",
      ),
    };
  }

  // Education and evidence synthesis are both language tasks, but they have
  // different privacy boundaries. Pure education receives neither personal
  // evidence nor unrelated personal-answer history. Evidence synthesis uses
  // a separately bounded, exact report window.
  const routedModel = modelRoute(resolution);
  if (routedModel) return routedModel;

  const mustFailClosed =
    FAIL_CLOSED_TEMPORAL_CODES.has(resolution.outcome.code) ||
    isRecognisedGlucoseRequest(resolution) ||
    isPersonalHealthAnalyticsRequest(resolution) ||
    AMBIGUOUS_PERSONAL_RECORD_RETRIEVAL.test(
      resolution.intent.normalizedQuestion,
    );
  if (!mustFailClosed) {
    return PERSONAL_REFERENCE.test(resolution.intent.normalizedQuestion)
      ? { kind: "model-evidence" }
      : { kind: "model-education" };
  }

  if (resolution.outcome.status === "needs_clarification") {
    return {
      kind: "capability",
      answer: answer(
        "One detail before I calculate that",
        `${resolution.outcome.message} ${resolution.outcome.clarification}`.trim(),
        "No calculation or OpenAI request was made because the requested meaning was not unambiguous.",
      ),
    };
  }

  return {
    kind: "capability",
    answer: answer(
      "I can’t calculate that safely yet",
      `${resolution.outcome.message} I won’t substitute a different metric or time window.`,
      "No calculation or OpenAI request was made for this unsupported request.",
    ),
  };
}
