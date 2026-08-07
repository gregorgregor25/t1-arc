export const TARVIS_INTENT_SCHEMA_VERSION = 1 as const;

export type TarvisIntentSchemaVersion = typeof TARVIS_INTENT_SCHEMA_VERSION;

export type TarvisDomain =
  | 'glucose'
  | 'insulin'
  | 'food'
  | 'activity'
  | 'sleep'
  | 'health'
  | 'data_quality';

/**
 * Metrics are deliberately explicit. Recognising a metric here does not mean
 * the local app can calculate it yet; the capability outcome carries that
 * distinction so an unsupported request can never fall through to a similar
 * calculation.
 */
export type TarvisMetric =
  | 'glucose.current'
  | 'glucose.mean'
  | 'glucose.median'
  | 'glucose.minimum'
  | 'glucose.maximum'
  | 'glucose.standard_deviation'
  | 'glucose.coefficient_of_variation'
  | 'glucose.gmi'
  | 'glucose.time_in_range'
  | 'glucose.low_episodes'
  | 'glucose.high_episodes'
  | 'glucose.low_readings'
  | 'glucose.high_readings'
  | 'insulin.delivered_total'
  | 'insulin.basal_total'
  | 'insulin.bolus_total'
  | 'food.carbohydrate_total'
  | 'activity.duration'
  | 'sleep.duration'
  | 'data_quality.coverage'
  | 'data_quality.gaps';

export type TarvisOperation =
  | 'current'
  | 'aggregate'
  | 'count_episodes'
  | 'count_readings'
  | 'range_distribution'
  | 'inspect_data_quality';

export type TarvisProvenanceKind =
  | 'explicit'
  | 'conversation'
  | 'profile'
  | 'default'
  | 'derived';

export interface TarvisFieldProvenance {
  kind: TarvisProvenanceKind;
  /** Exact text that supplied the field when it came from this question. */
  sourceText: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  /** Conversation turn identifier for inherited fields. */
  turnId: string | null;
  /** Explains a deterministic normalization or inference. */
  note: string | null;
}

export interface TarvisIntentField<T> {
  value: T;
  provenance: TarvisFieldProvenance;
}

export interface TarvisClockTime {
  hour: number;
  minute: number;
}

export interface TarvisRecurringClockWindow {
  start: TarvisClockTime;
  end: TarvisClockTime;
  /** True when the end belongs to the following local calendar date. */
  crossesMidnight: boolean;
  /** Recurring windows are named by the local date containing their start. */
  occurrenceAnchor: 'start_date';
}

export type TarvisTemporalScope =
  | {
      kind: 'rolling';
      amount: number;
      unit: 'minute' | 'hour' | 'day' | 'week';
      anchor: 'now';
    }
  | {
      kind: 'recent_local_days';
      count: number;
      /**
       * A recurring clock window selects completed occurrences. Without one,
       * the current local day is included through now.
       */
      include:
        | 'through_now'
        | 'completed_days'
        | 'most_recent_completed_windows';
    }
  | {
      kind: 'calendar_period';
      period:
        | 'today'
        | 'yesterday'
        | 'this_week'
        | 'last_week'
        | 'this_month'
        | 'last_month';
    }
  | {
      kind: 'calendar_date';
      date: string;
    }
  | {
      kind: 'calendar_date_range';
      startDate: string;
      endDate: string;
      inclusiveEndDate: true;
    };

export type TarvisComparison =
  | { kind: 'previous_equal_period' }
  | { kind: 'explicit_periods' };

export type TarvisGlucoseUnit = 'mmol/L' | 'mg/dL';

export interface TarvisGlucoseThreshold {
  operator: 'lt' | 'lte' | 'gt' | 'gte';
  value: number;
  unit: TarvisGlucoseUnit;
  role: 'low' | 'high' | 'range_lower' | 'range_upper';
}

export interface TarvisIntentV1 {
  schemaVersion: TarvisIntentSchemaVersion;
  question: string;
  normalizedQuestion: string;
  domain: TarvisIntentField<TarvisDomain>;
  metrics: Array<TarvisIntentField<TarvisMetric>>;
  operation: TarvisIntentField<TarvisOperation>;
  temporalScope: TarvisIntentField<TarvisTemporalScope>;
  /** Required-but-nullable for strict JSON schema compatibility. */
  clockWindow: TarvisIntentField<TarvisRecurringClockWindow> | null;
  /** Required-but-nullable for strict JSON schema compatibility. */
  comparison: TarvisIntentField<TarvisComparison> | null;
  thresholds: Array<TarvisIntentField<TarvisGlucoseThreshold>>;
}

export interface TarvisIntentDraftV1 {
  schemaVersion: TarvisIntentSchemaVersion;
  question: string;
  normalizedQuestion: string;
  domain?: TarvisIntentField<TarvisDomain>;
  metrics: Array<TarvisIntentField<TarvisMetric>>;
  operation?: TarvisIntentField<TarvisOperation>;
  temporalScope?: TarvisIntentField<TarvisTemporalScope>;
  clockWindow?: TarvisIntentField<TarvisRecurringClockWindow>;
  comparison?: TarvisIntentField<TarvisComparison>;
  thresholds: Array<TarvisIntentField<TarvisGlucoseThreshold>>;
}

export interface TarvisSourceSpan {
  raw: string;
  start: number;
  end: number;
}

export interface TarvisNumberLiteral extends TarvisSourceSpan {
  value: number;
  notation: 'digits' | 'words';
}

export interface TarvisDurationLiteral extends TarvisSourceSpan {
  value: number;
  unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  number: TarvisNumberLiteral;
}

export interface TarvisDateLiteral extends TarvisSourceSpan {
  kind: 'absolute' | 'relative';
  date: string;
  yearWasInferred: boolean;
}

export interface TarvisTimeLiteral extends TarvisSourceSpan {
  minuteOfDay: number | null;
  candidates: number[];
  notation: 'keyword' | 'twelve_hour' | 'twenty_four_hour' | 'ambiguous';
  inference?: string;
}

export interface TarvisClockWindowLiteral extends TarvisSourceSpan {
  startTime: TarvisTimeLiteral;
  endTime: TarvisTimeLiteral;
  window: TarvisRecurringClockWindow | null;
  ambiguity?: string;
}

export interface TarvisUnitLiteral extends TarvisSourceSpan {
  unit: TarvisGlucoseUnit;
}

export interface TarvisThresholdLiteral extends TarvisSourceSpan {
  operator: 'lt' | 'lte' | 'gt' | 'gte';
  value: number;
  unit: TarvisGlucoseUnit | null;
  number: TarvisNumberLiteral;
}

export interface TarvisNegationLiteral extends TarvisSourceSpan {
  kind: 'not' | 'exclude' | 'without' | 'except' | 'correction';
}

export interface TarvisComparisonLiteral extends TarvisSourceSpan {
  kind:
    | 'compare'
    | 'versus'
    | 'previous_period'
    | 'before_after'
    | 'relative_difference';
}

export interface TarvisLiteralExtraction {
  numbers: TarvisNumberLiteral[];
  durations: TarvisDurationLiteral[];
  dates: TarvisDateLiteral[];
  times: TarvisTimeLiteral[];
  clockWindows: TarvisClockWindowLiteral[];
  units: TarvisUnitLiteral[];
  thresholds: TarvisThresholdLiteral[];
  negations: TarvisNegationLiteral[];
  comparisons: TarvisComparisonLiteral[];
}

export type TarvisCapabilityCode =
  | 'ready'
  | 'empty_question'
  | 'missing_metric'
  | 'ambiguous_metric'
  | 'missing_time_scope'
  | 'ambiguous_time_scope'
  | 'ambiguous_clock_time'
  | 'invalid_clock_window'
  | 'ambiguous_negation'
  | 'unsupported_time_scope'
  | 'unsupported_metric'
  | 'unsupported_domain'
  | 'unsupported_compound_question'
  | 'unsupported_comparison';

export type TarvisCapabilityOutcome =
  | {
      status: 'ready';
      code: 'ready';
    }
  | {
      status: 'needs_clarification';
      code:
        | 'empty_question'
        | 'missing_metric'
        | 'ambiguous_metric'
        | 'missing_time_scope'
        | 'ambiguous_time_scope'
        | 'ambiguous_clock_time'
        | 'invalid_clock_window'
        | 'ambiguous_negation';
      message: string;
      clarification: string;
    }
  | {
      status: 'unsupported';
      code:
        | 'unsupported_metric'
        | 'unsupported_time_scope'
        | 'unsupported_domain'
        | 'unsupported_compound_question'
        | 'unsupported_comparison';
      message: string;
    };

interface TarvisIntentResolutionBase {
  schemaVersion: TarvisIntentSchemaVersion;
  literals: TarvisLiteralExtraction;
}

export interface ReadyTarvisIntentResolution
  extends TarvisIntentResolutionBase {
  outcome: Extract<TarvisCapabilityOutcome, { status: 'ready' }>;
  intent: TarvisIntentV1;
}

export interface IncompleteTarvisIntentResolution
  extends TarvisIntentResolutionBase {
  outcome: Exclude<TarvisCapabilityOutcome, { status: 'ready' }>;
  intent: TarvisIntentDraftV1;
}

export type TarvisIntentResolution =
  | ReadyTarvisIntentResolution
  | IncompleteTarvisIntentResolution;

export interface TarvisIntentHistoryEntry {
  turnId: string;
  question: string;
  intent: TarvisIntentV1;
}

export interface TarvisGlucoseTargetProfile {
  id: string;
  unit: TarvisGlucoseUnit;
  lowBelow: number;
  highAbove: number;
}

export interface ResolveTarvisIntentOptions {
  now?: number;
  timezone?: string;
  history?: readonly TarvisIntentHistoryEntry[];
  targetProfile?: TarvisGlucoseTargetProfile;
}
