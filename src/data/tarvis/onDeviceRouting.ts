import {
  isReadyTarvisIntent,
  TarvisIntentResolution,
} from './intent';
import { TarvisAnswer } from './types';
import {
  isLocalGlucoseScopeWithinLimit,
  MAX_LOCAL_GLUCOSE_SCOPE_DAYS,
} from './localScopeLimit';

const LOCALLY_EXECUTABLE_GLUCOSE_METRICS = new Set([
  'glucose.mean',
  'glucose.median',
  'glucose.minimum',
  'glucose.maximum',
  'glucose.standard_deviation',
  'glucose.coefficient_of_variation',
  'glucose.gmi',
  'glucose.time_in_range',
  'glucose.low_episodes',
  'glucose.high_episodes',
  'glucose.low_readings',
  'glucose.high_readings',
]);

const FAIL_CLOSED_TEMPORAL_CODES = new Set([
  'ambiguous_time_scope',
  'ambiguous_clock_time',
  'invalid_clock_window',
  'unsupported_time_scope',
]);

const PERSONAL_REFERENCE = /\b(?:my|mine|me|i)\b/i;
const PERSONAL_HEALTH_DATA_CUE =
  /\b(?:glucose|blood sugar|bg|cgm|sensor|readings?|levels?|numbers?|diabetes|insulin|basal|bolus|pump|food|meals?|carbs?|carbohydrates?|exercise|activity|sleep|health data|data|records?|history)\b/i;
const DIRECT_DATA_CUE =
  /\b(?:glucose|blood sugar|bg|cgm|sensor|readings?|levels?|numbers?|insulin|basal|bolus|pump|carbs?|carbohydrates?|activity|sleep|health data|data|records?|history)\b/i;
const ANALYTIC_OR_TIME_CUE =
  /\b(?:average|avg|mean|median|minimum|maximum|lowest|highest|how many|count|total|percentage|percent|time in range|tir|events?|episodes?|highs?|lows?|hypos?|hypers?|trend|pattern|variability|coverage|gaps?|today|yesterday|tonight|overnights?|night|nights|morning|afternoon|evening|midday|midnight|noon|dawn|dusk|bedtime|waking|breakfast|lunch|dinner|mealtime|working hours?|workday|hours?|days?|weeks?|months?|years?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekdays?|weekends?|weeknights?|between|from|since|before|after|during|over|past|last|previous|recent)\b/i;

export type TarvisOnDeviceRoute =
  | { kind: 'scoped-glucose' }
  | { kind: 'capability'; answer: TarvisAnswer }
  | { kind: 'legacy' };

function answer(
  headline: string,
  copy: string,
  limitation: string,
): TarvisAnswer {
  return {
    headline,
    answer: copy,
    confidence: 'limited',
    evidenceIds: [],
    limitations: [limitation],
  };
}

function isRecognisedGlucoseRequest(resolution: TarvisIntentResolution) {
  const hasGlucoseMetric = resolution.intent.metrics.some(({ value }) =>
    value.startsWith('glucose.'),
  );
  return (
    (resolution.intent.domain?.value === 'glucose' || hasGlucoseMetric) &&
    (resolution.intent.metrics.length > 0 ||
      resolution.literals.clockWindows.length > 0 ||
      resolution.intent.clockWindow !== undefined)
  );
}

function isPersonalHealthAnalyticsRequest(
  resolution: TarvisIntentResolution,
) {
  const question = resolution.intent.normalizedQuestion;
  return (
    ANALYTIC_OR_TIME_CUE.test(question) &&
    ((PERSONAL_REFERENCE.test(question) &&
      PERSONAL_HEALTH_DATA_CUE.test(question)) ||
      DIRECT_DATA_CUE.test(question))
  );
}

function locallyExecutableReadyShape(
  resolution: Extract<TarvisIntentResolution, { outcome: { status: 'ready' } }>,
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
    !intent.metrics.some(({ value }) => value === 'glucose.gmi') &&
    intent.comparison === null &&
    intent.temporalScope.value.kind === 'recent_local_days' &&
    intent.temporalScope.value.include === 'most_recent_completed_windows'
  );
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
    if (resolution.intent.domain.value !== 'glucose') return { kind: 'legacy' };
    if (!isLocalGlucoseScopeWithinLimit(resolution.intent)) {
      return {
        kind: 'capability',
        answer: answer(
          'That period is too large for one on-phone answer',
          `To keep the calculation responsive and its evidence safely stored, Tarv1s can use up to ${MAX_LOCAL_GLUCOSE_SCOPE_DAYS} days of glucose data in one answer, including both periods in a comparison. Ask for a shorter period, such as the last 90 days, or compare the last 30 days with the preceding 30 days.`,
          'No glucose records were loaded and no OpenAI request was made for this oversized calculation.',
        ),
      };
    }
    if (locallyExecutableReadyShape(resolution)) {
      return { kind: 'scoped-glucose' };
    }
    if (
      resolution.intent.clockWindow !== null &&
      resolution.intent.metrics.some(({ value }) => value === 'glucose.gmi')
    ) {
      return {
        kind: 'capability',
        answer: answer(
          'GMI needs a full-period glucose range',
          'GMI is derived from broadly representative mean sensor glucose, so I cannot calculate an “overnight GMI” or use selected hours. Ask for a continuous period such as the last 14 or 30 days instead.',
          'No calculation or OpenAI request was made; selected clock hours were not substituted for representative full-period CGM data.',
        ),
      };
    }
    return {
      kind: 'capability',
      answer: answer(
        'I can’t calculate that safely yet',
        'I recognised the requested glucose metric, but the exact local calculation is not available yet. I won’t substitute a different metric or time period.',
        'No calculation or OpenAI request was made for this unsupported calculation shape.',
      ),
    };
  }

  const mustFailClosed =
    FAIL_CLOSED_TEMPORAL_CODES.has(resolution.outcome.code) ||
    isRecognisedGlucoseRequest(resolution) ||
    isPersonalHealthAnalyticsRequest(resolution);
  if (!mustFailClosed) return { kind: 'legacy' };

  if (resolution.outcome.status === 'needs_clarification') {
    return {
      kind: 'capability',
      answer: answer(
        'One detail before I calculate that',
        `${resolution.outcome.message} ${resolution.outcome.clarification}`.trim(),
        'No calculation or OpenAI request was made because the requested meaning was not unambiguous.',
      ),
    };
  }

  return {
    kind: 'capability',
    answer: answer(
      'I can’t calculate that safely yet',
      `${resolution.outcome.message} I won’t substitute a different metric or time window.`,
      'No calculation or OpenAI request was made for this unsupported request.',
    ),
  };
}
