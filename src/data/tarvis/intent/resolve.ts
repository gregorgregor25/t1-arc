import { extractTarvisLiterals } from './literals';
import {
  IncompleteTarvisIntentResolution,
  ReadyTarvisIntentResolution,
  ResolveTarvisIntentOptions,
  TARVIS_INTENT_SCHEMA_VERSION,
  TarvisCapabilityOutcome,
  TarvisComparison,
  TarvisDomain,
  TarvisDurationLiteral,
  TarvisGlucoseTargetProfile,
  TarvisGlucoseThreshold,
  TarvisIntentDraftV1,
  TarvisIntentField,
  TarvisIntentHistoryEntry,
  TarvisIntentResolution,
  TarvisIntentV1,
  TarvisMetric,
  TarvisOperation,
  TarvisSourceSpan,
  TarvisTemporalScope,
} from './types';

const DEFAULT_TARGET_PROFILE: TarvisGlucoseTargetProfile = {
  id: 'standard-cgm-range',
  unit: 'mmol/L',
  lowBelow: 3.9,
  highAbove: 10,
};

const SUPPORTED_METRICS = new Set<TarvisMetric>([
  'glucose.mean',
  'glucose.low_episodes',
  'glucose.high_episodes',
  'glucose.time_in_range',
]);

const TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(?:avarage|averge|averege)\b/g, 'average'],
  [/\b(?:glocose|glucoes|glucoce)\b/g, 'glucose'],
  [/\b(?:readngs|readins)\b/g, 'readings'],
  [/\b(?:episoeds|episdoes|episods)\b/g, 'episodes'],
  [/\b(?:hihgs|higs)\b/g, 'highs'],
  [/\b(?:lwo|lwoes)\b/g, 'lows'],
  [/\btim[ -]in[ -]range\b/g, 'time in range'],
];

interface MetricCandidate {
  metric: TarvisMetric;
  operation: TarvisOperation;
  span: TarvisSourceSpan;
}

interface ScopeResolution {
  scope?: TarvisIntentField<TarvisTemporalScope>;
  problem?:
    | 'ambiguous_time_scope'
    | 'unsupported_time_scope'
    | 'ambiguous_clock_time'
    | 'invalid_clock_window';
  message?: string;
}

function normalizeQuestion(question: string) {
  let normalized = question
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function explicitField<T>(
  value: T,
  source: TarvisSourceSpan,
  note?: string,
): TarvisIntentField<T> {
  return {
    value,
    provenance: {
      kind: 'explicit',
      sourceText: source.raw,
      sourceStart: source.start,
      sourceEnd: source.end,
      turnId: null,
      note: note ?? null,
    },
  };
}

function matchedSpan(
  originalQuestion: string,
  normalizedQuestion: string,
  match: RegExpExecArray,
): TarvisSourceSpan {
  const start = match.index;
  const length = match[0].length;
  return {
    raw:
      originalQuestion.slice(start, start + length) ||
      normalizedQuestion.slice(start, start + length),
    start,
    end: start + length,
  };
}

function firstMatch(
  expression: RegExp,
  normalizedQuestion: string,
): RegExpExecArray | null {
  expression.lastIndex = 0;
  return expression.exec(normalizedQuestion);
}

function pushCandidate(
  candidates: MetricCandidate[],
  candidate: MetricCandidate | null,
) {
  if (!candidate) return;
  if (!candidates.some((existing) => existing.metric === candidate.metric)) {
    candidates.push(candidate);
  }
}

function candidateFromPattern(
  originalQuestion: string,
  normalizedQuestion: string,
  metric: TarvisMetric,
  operation: TarvisOperation,
  expression: RegExp,
): MetricCandidate | null {
  const match = firstMatch(expression, normalizedQuestion);
  if (!match) return null;
  return {
    metric,
    operation,
    span: matchedSpan(originalQuestion, normalizedQuestion, match),
  };
}

function isCorrectionExcluded(
  normalizedQuestion: string,
  candidate: MetricCandidate,
) {
  const before = normalizedQuestion.slice(
    Math.max(0, candidate.span.start - 24),
    candidate.span.start,
  );
  const after = normalizedQuestion.slice(candidate.span.end, candidate.span.end + 36);
  return (
    /(?:\bnot\b|\binstead of\b|\brather than\b)\s*(?:the\s*)?$/.test(
      before,
    ) &&
    /^(?:\s+(?:but|i mean|use|show)|\s*[,;]\s*(?:but|i mean|use|show|lows?|hypos?|dips?|crashes?|highs?|hypers?|spikes?))/.test(
      after,
    )
  );
}

function hasAmbiguousMetricNegation(
  normalizedQuestion: string,
  candidates: MetricCandidate[],
) {
  return candidates.some((candidate) => {
    const before = normalizedQuestion.slice(
      Math.max(0, candidate.span.start - 18),
      candidate.span.start,
    );
    return (
      /\b(?:not|without|except|exclude|excluding)\s*(?:the\s*)?$/.test(before) &&
      !isCorrectionExcluded(normalizedQuestion, candidate)
    );
  });
}

function extractMetricCandidates(
  originalQuestion: string,
  normalizedQuestion: string,
): MetricCandidate[] {
  const candidates: MetricCandidate[] = [];
  const glucoseObject =
    '(?:glucose|blood[- ]?sugar|bg|cgm|sensor|readings?|levels?|numbers?)';
  const meanPattern = new RegExp(
    `\\b(?:(?:average|avg|mean)(?:\\s+${glucoseObject})|${glucoseObject}\\s+(?:average|mean))\\b`,
  );
  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      'glucose.mean',
      'aggregate',
      meanPattern,
    ),
  );

  pushCandidate(
    candidates,
    candidateFromPattern(
      originalQuestion,
      normalizedQuestion,
      'glucose.time_in_range',
      'range_distribution',
      /\b(?:time[- ]in[- ]range|tir|percentage\s+(?:of\s+time\s+)?(?:was\s+)?in\s+(?:my\s+)?(?:target\s+)?range|percent\s+(?:of\s+time\s+)?(?:was\s+)?in\s+(?:my\s+)?(?:target\s+)?range|(?:what\s+)?(?:percentage|percent)\s+of\s+(?:my\s+)?(?:glucose\s+)?readings?\s+(?:was|were)\s+between)\b/,
    ),
  );

  const lowReadings = candidateFromPattern(
    originalQuestion,
    normalizedQuestion,
    'glucose.low_readings',
    'count_readings',
    /\b(?:how many|number of|count(?: of)?)\s+(?:(?:glucose|cgm|sensor)\s+)?readings?\s+(?:were\s+)?(?:low|below|under)\b/,
  );
  const highReadings = candidateFromPattern(
    originalQuestion,
    normalizedQuestion,
    'glucose.high_readings',
    'count_readings',
    /\b(?:how many|number of|count(?: of)?)\s+(?:(?:glucose|cgm|sensor)\s+)?readings?\s+(?:were\s+)?(?:high|above|over)\b/,
  );
  pushCandidate(candidates, lowReadings);
  pushCandidate(candidates, highReadings);

  if (!lowReadings) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        'glucose.low_episodes',
        'count_episodes',
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:low[- ]glucose\s+)?(?:events?|episodes?|hypos?|lows?|dips?|crashes?)|(?:low(?:[- ]glucose)?|hypoglyc(?:aemia|emia|emic)|hypo)\s+(?:events?|episodes?)|(?:lows|hypos|dips|crashes)\s+(?:have|did|during|over|in)\b|(?:lows|hypos|dips|crashes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))/,
      ),
    );
  }
  if (!highReadings) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        'glucose.high_episodes',
        'count_episodes',
        /\b(?:(?:how many|number of|count(?: of)?|frequency of)\s+(?:sustained\s+)?(?:high[- ]glucose\s+)?(?:events?|episodes?|hypers?|highs?|spikes?)|(?:high(?:[- ]glucose)?|hyperglyc(?:aemia|emia|emic)|hyper)\s+(?:events?|episodes?)|(?:highs|hypers|spikes)\s+(?:have|did|during|over|in)\b|(?:highs|hypers|spikes)\b(?=\s*(?:[,;]|\band\b|\bor\b|\bnot\b)))/,
      ),
    );
  }

  const unsupportedPatterns: Array<
    [TarvisMetric, TarvisOperation, RegExp]
  > = [
    ['glucose.current', 'current', /\b(?:current|latest|right now)\s+(?:glucose|reading|blood sugar)\b/],
    ['glucose.median', 'aggregate', /\bmedian\s+(?:glucose|reading|blood sugar)\b/],
    ['glucose.minimum', 'aggregate', /\b(?:minimum|lowest)\s+(?:glucose|reading|blood sugar)\b/],
    ['glucose.maximum', 'aggregate', /\b(?:maximum|highest)\s+(?:glucose|reading|blood sugar)\b/],
    ['glucose.standard_deviation', 'aggregate', /\b(?:standard deviation|sd)\b/],
    ['glucose.coefficient_of_variation', 'aggregate', /\b(?:coefficient of variation|glucose variability|cv)\b/],
    ['glucose.gmi', 'aggregate', /\b(?:gmi|glucose management indicator)\b/],
    ['insulin.delivered_total', 'aggregate', /\b(?:total|how much)\s+(?:delivered\s+)?insulin\b/],
    ['insulin.basal_total', 'aggregate', /\b(?:total\s+)?basal(?: insulin)?\b/],
    ['insulin.bolus_total', 'aggregate', /\b(?:total\s+)?bolus(?: insulin)?\b/],
    ['food.carbohydrate_total', 'aggregate', /\b(?:total|how many|how much)\s+(?:carbs?|carbohydrates?)\b/],
    ['activity.duration', 'aggregate', /\b(?:exercise|activity|workout)\s+(?:time|duration|minutes?)\b/],
    ['sleep.duration', 'aggregate', /\b(?:sleep|asleep)\s+(?:time|duration|hours?)\b/],
    ['data_quality.coverage', 'inspect_data_quality', /\b(?:sensor|cgm|glucose)?\s*coverage\b/],
    ['data_quality.gaps', 'inspect_data_quality', /\b(?:data|sensor|cgm)?\s*(?:gaps?|missing data)\b/],
  ];
  for (const [metric, operation, expression] of unsupportedPatterns) {
    pushCandidate(
      candidates,
      candidateFromPattern(
        originalQuestion,
        normalizedQuestion,
        metric,
        operation,
        expression,
      ),
    );
  }

  return candidates
    .filter((candidate) => !isCorrectionExcluded(normalizedQuestion, candidate))
    .sort((left, right) => left.span.start - right.span.start);
}

function inferDomains(
  normalizedQuestion: string,
  candidates: MetricCandidate[],
): TarvisDomain[] {
  const domains = new Set<TarvisDomain>();
  const isExplicitDataQualityRequest =
    candidates.length > 0 &&
    candidates.every((candidate) => candidate.metric.startsWith('data_quality.'));
  if (
    candidates.some((candidate) => candidate.metric.startsWith('glucose.')) ||
    (!isExplicitDataQualityRequest &&
      /\b(?:glucose|blood sugar|bg|cgm|sensor readings?|glucose readings?)\b/.test(
        normalizedQuestion,
      ))
  ) {
    domains.add('glucose');
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith('insulin.')) ||
    /\b(?:insulin|basal|bolus|pump)\b/.test(normalizedQuestion)
  ) {
    domains.add('insulin');
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith('food.')) ||
    /\b(?:food|meal|carbs?|carbohydrates?)\b/.test(normalizedQuestion)
  ) {
    domains.add('food');
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith('activity.')) ||
    /\b(?:exercise|activity|workout|steps?)\b/.test(normalizedQuestion)
  ) {
    domains.add('activity');
  }
  if (
    candidates.some((candidate) => candidate.metric.startsWith('sleep.')) ||
    /\b(?:sleep|asleep)\b/.test(normalizedQuestion)
  ) {
    domains.add('sleep');
  }
  if (candidates.some((candidate) => candidate.metric.startsWith('data_quality.'))) {
    domains.add('data_quality');
  }
  return [...domains];
}

function spanForText(question: string, normalized: string, text: string) {
  const start = normalized.indexOf(text);
  return {
    raw: start >= 0 ? question.slice(start, start + text.length) : text,
    start: Math.max(0, start),
    end: Math.max(0, start) + text.length,
  };
}

function durationContext(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
) {
  return normalizedQuestion.slice(Math.max(0, duration.start - 30), duration.start);
}

function isScopeDuration(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
) {
  const before = durationContext(normalizedQuestion, duration);
  return /(?:\b(?:last|past|previous|during|for|over|in)\s+(?:the\s+)?|\bwithin\s+(?:the\s+)?)$/.test(
    before,
  );
}

function scopeFromDuration(
  normalizedQuestion: string,
  duration: TarvisDurationLiteral,
  hasClockWindow: boolean,
): ScopeResolution {
  if (!Number.isInteger(duration.value) || duration.value <= 0) {
    return {
      problem: 'ambiguous_time_scope',
      message: 'The requested duration must be a positive whole number.',
    };
  }
  if (duration.unit === 'month') {
    return {
      problem: 'unsupported_time_scope',
      message:
        'Numbered month windows are not yet supported because their calendar boundaries need to be explicit.',
    };
  }
  const before = durationContext(normalizedQuestion, duration);
  const isRolling =
    duration.unit === 'minute' ||
    duration.unit === 'hour' ||
    /\bpast\s+(?:the\s+)?$/.test(before);
  if (isRolling) {
    return {
      scope: explicitField(
        {
          kind: 'rolling',
          amount: duration.value,
          unit: duration.unit,
          anchor: 'now',
        },
        duration,
      ),
    };
  }
  const count =
    duration.unit === 'week' ? duration.value * 7 : duration.value;
  return {
    scope: explicitField(
      {
        kind: 'recent_local_days',
        count,
        include: hasClockWindow
          ? 'most_recent_completed_windows'
          : /\bcompleted\s+$/.test(before)
            ? 'completed_days'
            : 'through_now',
      },
      duration,
      duration.unit === 'week' ? 'Normalized to local calendar days.' : undefined,
    ),
  };
}

function resolveTemporalScope(
  question: string,
  normalizedQuestion: string,
  literals: ReturnType<typeof extractTarvisLiterals>,
): ScopeResolution {
  if (literals.clockWindows.length > 1) {
    return {
      problem: 'ambiguous_clock_time',
      message: 'More than one recurring clock window was found.',
    };
  }
  const clockWindow = literals.clockWindows[0];
  if (clockWindow?.ambiguity) {
    return {
      problem:
        clockWindow.startTime.minuteOfDay !== null &&
        clockWindow.endTime.minuteOfDay !== null &&
        clockWindow.startTime.minuteOfDay === clockWindow.endTime.minuteOfDay
          ? 'invalid_clock_window'
          : 'ambiguous_clock_time',
      message: clockWindow.ambiguity,
    };
  }
  if (
    !clockWindow &&
    !(
      literals.thresholds.some((threshold) => threshold.operator === 'gte') &&
      literals.thresholds.some((threshold) => threshold.operator === 'lte')
    ) &&
    /\b(?:between|from)\s+(?:midnight|noon|\d{1,2}(?::\d{1,2}|\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)|\s+(?:and|to|until|till)))\b/.test(
      normalizedQuestion,
    )
  ) {
    return {
      problem: 'ambiguous_clock_time',
      message: 'The clock window could not be resolved safely.',
    };
  }

  if (/\b(?:weekdays?|weekends?)\b/.test(normalizedQuestion)) {
    return {
      problem: 'unsupported_time_scope',
      message: 'Weekday and weekend filters are not executable yet.',
    };
  }
  if (
    /\b(?:overnight|last night|at night|during the night)\b/.test(
      normalizedQuestion,
    ) && !clockWindow?.window
  ) {
    return {
      problem: 'ambiguous_time_scope',
      message:
        'Overnight needs explicit clock bounds or a configured sleep interval.',
    };
  }
  if (
    /\b(?:before|after|around)\s+(?:breakfast|lunch|dinner|a meal|meals?)\b/.test(
      normalizedQuestion,
    )
  ) {
    return {
      problem: 'ambiguous_time_scope',
      message: 'Meal-relative windows need an explicit before/after duration.',
    };
  }
  if (
    /\b(?:excluding|exclude|except(?: for)?|but not)\s+(?:today|yesterday|the current day)\b/.test(
      normalizedQuestion,
    )
  ) {
    return {
      problem: 'ambiguous_time_scope',
      message: 'The requested date exclusion is not represented by this scope.',
    };
  }

  const namedPeriods: Array<
    [RegExp, TarvisTemporalScope & { kind: 'calendar_period' }]
  > = [
    [/\btoday\b/, { kind: 'calendar_period', period: 'today' }],
    [/\byesterday\b/, { kind: 'calendar_period', period: 'yesterday' }],
    [/\bthis week\b/, { kind: 'calendar_period', period: 'this_week' }],
    [/\blast week\b/, { kind: 'calendar_period', period: 'last_week' }],
    [/\bthis month\b/, { kind: 'calendar_period', period: 'this_month' }],
    [/\blast month\b/, { kind: 'calendar_period', period: 'last_month' }],
  ];
  const matchedNamed = namedPeriods
    .map(([pattern, value]) => ({ match: firstMatch(pattern, normalizedQuestion), value }))
    .filter(
      (entry): entry is { match: RegExpExecArray; value: TarvisTemporalScope & { kind: 'calendar_period' } } =>
        entry.match !== null,
    );
  if (matchedNamed.length > 1) {
    return {
      problem: 'ambiguous_time_scope',
      message: 'More than one calendar period was requested.',
    };
  }
  if (matchedNamed[0]) {
    return {
      scope: explicitField(
        matchedNamed[0].value,
        matchedSpan(question, normalizedQuestion, matchedNamed[0].match),
      ),
    };
  }

  const absoluteDates = literals.dates.filter((date) => date.kind === 'absolute');
  if (absoluteDates.length >= 2) {
    const rangeCue = /\b(?:from|between)\b[\s\S]+\b(?:to|and|through|until)\b/.test(
      normalizedQuestion,
    );
    if (!rangeCue || absoluteDates.length > 2) {
      return {
        problem: 'ambiguous_time_scope',
        message: 'The requested calendar dates do not form one clear range.',
      };
    }
    const first = absoluteDates[0]!;
    const second = absoluteDates[1]!;
    if (first.date > second.date) {
      return {
        problem: 'ambiguous_time_scope',
        message: 'The end date is earlier than the start date.',
      };
    }
    return {
      scope: explicitField(
        {
          kind: 'calendar_date_range',
          startDate: first.date,
          endDate: second.date,
          inclusiveEndDate: true,
        },
        {
          raw: question.slice(first.start, second.end),
          start: first.start,
          end: second.end,
        },
      ),
    };
  }
  if (absoluteDates.length === 1) {
    const date = absoluteDates[0]!;
    return {
      scope: explicitField(
        { kind: 'calendar_date', date: date.date },
        date,
        date.yearWasInferred ? 'The year was inferred from the current local year.' : undefined,
      ),
    };
  }

  // Literal offsets refer to the original question. Metric typo correction can
  // change normalized-string length, so duration context must use an
  // offset-stable lower-case copy rather than the corrected text.
  const offsetStableQuestion = question.toLocaleLowerCase('en-GB');
  const durations = literals.durations.filter((duration) =>
    isScopeDuration(offsetStableQuestion, duration),
  );
  if (durations.length > 1) {
    const comparisonToPrevious =
      literals.comparisons.length > 0 && /\bprevious\b/.test(normalizedQuestion);
    const [first, second] = durations;
    if (
      comparisonToPrevious &&
      first &&
      second &&
      first.value === second.value &&
      first.unit === second.unit
    ) {
      return scopeFromDuration(
        offsetStableQuestion,
        first,
        Boolean(clockWindow?.window),
      );
    }
    return {
      problem: 'ambiguous_time_scope',
      message: 'More than one non-equivalent duration was requested.',
    };
  }
  if (durations[0]) {
    return scopeFromDuration(
      offsetStableQuestion,
      durations[0],
      Boolean(clockWindow?.window),
    );
  }
  return {};
}

function isExplicitFollowUp(normalizedQuestion: string) {
  return /^(?:(?:and\s+)?(?:what|how)\s+about\b|(?:same|do the same)\b|(?:can you\s+)?compare\s+(?:that|it)\b)/.test(
    normalizedQuestion,
  );
}

function latestHistory(
  history: readonly TarvisIntentHistoryEntry[] | undefined,
) {
  return history && history.length > 0 ? history[history.length - 1] : undefined;
}

function inheritedField<T>(
  field: TarvisIntentField<T>,
  history: TarvisIntentHistoryEntry,
): TarvisIntentField<T> {
  return {
    value: field.value,
    provenance: {
      kind: 'conversation',
      turnId: history.turnId,
      sourceText: history.question,
      sourceStart: null,
      sourceEnd: null,
      note: 'Inherited only because the new question used an explicit follow-up form.',
    },
  };
}

function comparisonField(
  question: string,
  normalizedQuestion: string,
  literals: ReturnType<typeof extractTarvisLiterals>,
): TarvisIntentField<TarvisComparison> | undefined {
  if (literals.comparisons.length === 0) return undefined;
  const source = literals.comparisons[0]!;
  if (/\bprevious\b/.test(normalizedQuestion)) {
    return explicitField({ kind: 'previous_equal_period' }, source);
  }
  if (
    /\b(?:today|yesterday|this week|last week|this month|last month)\b[\s\S]*\b(?:versus|vs\.?|compar)/.test(
      normalizedQuestion,
    ) || literals.dates.length >= 2
  ) {
    return explicitField({ kind: 'explicit_periods' }, source);
  }
  return explicitField(
    { kind: 'explicit_periods' },
    spanForText(question, normalizedQuestion, source.raw.toLowerCase()),
  );
}

function targetThresholds(
  metrics: Array<TarvisIntentField<TarvisMetric>>,
  literals: ReturnType<typeof extractTarvisLiterals>,
  profile: TarvisGlucoseTargetProfile,
): Array<TarvisIntentField<TarvisGlucoseThreshold>> {
  const metricValues = new Set(metrics.map((metric) => metric.value));
  const explicitThresholds = literals.thresholds;
  if (explicitThresholds.length > 0 && metrics.length === 1) {
    const metric = metrics[0]!.value;
    return explicitThresholds.map((literal) => {
      const role: TarvisGlucoseThreshold['role'] =
        metric === 'glucose.low_episodes'
          ? 'low'
          : metric === 'glucose.high_episodes'
            ? 'high'
            : literal.operator === 'lt' || literal.operator === 'lte'
              ? 'range_upper'
              : 'range_lower';
      return explicitField(
        {
          operator: literal.operator,
          value: literal.value,
          unit: literal.unit ?? profile.unit,
          role,
        },
        literal,
        literal.unit
          ? undefined
          : `Unit inherited from target profile ${profile.id}.`,
      );
    });
  }

  const provenance = {
    kind: profile === DEFAULT_TARGET_PROFILE ? ('default' as const) : ('profile' as const),
    sourceText: profile.id,
    sourceStart: null,
    sourceEnd: null,
    turnId: null,
    note: `Threshold supplied by target profile ${profile.id}.`,
  };
  const thresholds: Array<TarvisIntentField<TarvisGlucoseThreshold>> = [];
  if (metricValues.has('glucose.low_episodes') || metricValues.has('glucose.time_in_range')) {
    thresholds.push({
      value: {
        operator: metricValues.has('glucose.time_in_range') ? 'gte' : 'lt',
        value: profile.lowBelow,
        unit: profile.unit,
        role: metricValues.has('glucose.time_in_range') ? 'range_lower' : 'low',
      },
      provenance,
    });
  }
  if (metricValues.has('glucose.high_episodes') || metricValues.has('glucose.time_in_range')) {
    thresholds.push({
      value: {
        operator: metricValues.has('glucose.time_in_range') ? 'lte' : 'gt',
        value: profile.highAbove,
        unit: profile.unit,
        role: metricValues.has('glucose.time_in_range') ? 'range_upper' : 'high',
      },
      provenance,
    });
  }
  return thresholds;
}

function clarification(
  code: Extract<
    TarvisCapabilityOutcome,
    { status: 'needs_clarification' }
  >['code'],
  message: string,
  clarificationText: string,
): Extract<TarvisCapabilityOutcome, { status: 'needs_clarification' }> {
  return {
    status: 'needs_clarification',
    code,
    message,
    clarification: clarificationText,
  };
}

function unsupported(
  code: Extract<TarvisCapabilityOutcome, { status: 'unsupported' }>['code'],
  message: string,
): Extract<TarvisCapabilityOutcome, { status: 'unsupported' }> {
  return { status: 'unsupported', code, message };
}

function incomplete(
  intent: TarvisIntentDraftV1,
  literals: ReturnType<typeof extractTarvisLiterals>,
  outcome: IncompleteTarvisIntentResolution['outcome'],
): IncompleteTarvisIntentResolution {
  return {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    intent,
    literals,
    outcome,
  };
}

export function resolveTarvisIntent(
  question: string,
  options: ResolveTarvisIntentOptions = {},
): TarvisIntentResolution {
  const normalizedQuestion = normalizeQuestion(question);
  const literals = extractTarvisLiterals(question, {
    now: options.now,
    timezone: options.timezone,
  });
  const draft: TarvisIntentDraftV1 = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    question,
    normalizedQuestion,
    metrics: [],
    thresholds: [],
  };
  if (!normalizedQuestion) {
    return incomplete(
      draft,
      literals,
      clarification(
        'empty_question',
        'No question was provided.',
        'What would you like to know about your glucose data?',
      ),
    );
  }

  const explicitCandidates = extractMetricCandidates(question, normalizedQuestion);
  if (hasAmbiguousMetricNegation(normalizedQuestion, explicitCandidates)) {
    return incomplete(
      draft,
      literals,
      clarification(
        'ambiguous_negation',
        'The metric appears to be negated rather than selected.',
        'Which metric should I calculate?',
      ),
    );
  }
  const history = latestHistory(options.history);
  const explicitFollowUp = isExplicitFollowUp(normalizedQuestion);
  if (explicitCandidates.length > 0) {
    draft.metrics = explicitCandidates.map((candidate) =>
      explicitField(candidate.metric, candidate.span),
    );
  } else if (explicitFollowUp && history) {
    draft.metrics = history.intent.metrics.map((metric) =>
      inheritedField(metric, history),
    );
  }

  const domains = inferDomains(normalizedQuestion, explicitCandidates);
  if (explicitCandidates.length === 0 && explicitFollowUp && history) {
    draft.domain = inheritedField(history.intent.domain, history);
  } else if (domains.length === 1) {
    const domain = domains[0]!;
    const domainMetric = explicitCandidates.find((candidate) =>
      candidate.metric.startsWith(`${domain}.`),
    );
    draft.domain = explicitField(
      domain,
      domainMetric?.span ?? spanForText(question, normalizedQuestion, domain),
    );
  } else if (domains.length > 1) {
    return incomplete(
      draft,
      literals,
      unsupported(
        'unsupported_compound_question',
        'This foundation does not yet execute a query spanning multiple health-data domains.',
      ),
    );
  }

  const operations = new Set(
    explicitCandidates.map((candidate) => candidate.operation),
  );
  if (explicitCandidates.length === 0 && explicitFollowUp && history) {
    draft.operation = inheritedField(history.intent.operation, history);
  } else if (operations.size === 1) {
    const operation = [...operations][0]!;
    draft.operation = explicitField(operation, explicitCandidates[0]!.span);
  } else if (operations.size > 1) {
    return incomplete(
      draft,
      literals,
      unsupported(
        'unsupported_compound_question',
        'The question combines metrics that need different calculations.',
      ),
    );
  }

  const scopeResolution = resolveTemporalScope(
    question,
    normalizedQuestion,
    literals,
  );
  if (scopeResolution.problem) {
    if (scopeResolution.problem === 'unsupported_time_scope') {
      return incomplete(
        draft,
        literals,
        unsupported(
          'unsupported_time_scope',
          scopeResolution.message ?? 'That time scope is not supported.',
        ),
      );
    }
    return incomplete(
      draft,
      literals,
      clarification(
        scopeResolution.problem,
        scopeResolution.message ?? 'The time scope is ambiguous.',
        scopeResolution.problem === 'ambiguous_clock_time'
          ? 'Please give both times with a.m./p.m. or in 24-hour time.'
          : 'Which exact period should I use?',
      ),
    );
  }
  if (scopeResolution.scope) {
    draft.temporalScope = scopeResolution.scope;
  } else if (explicitFollowUp && history) {
    draft.temporalScope = inheritedField(history.intent.temporalScope, history);
  }

  const clockWindowLiteral = literals.clockWindows[0];
  if (clockWindowLiteral?.window) {
    const note = [
      clockWindowLiteral.startTime.inference,
      clockWindowLiteral.endTime.inference,
    ]
      .filter(Boolean)
      .join(' ');
    draft.clockWindow = explicitField(
      clockWindowLiteral.window,
      clockWindowLiteral,
      note || undefined,
    );
  } else if (explicitFollowUp && history?.intent.clockWindow) {
    draft.clockWindow = inheritedField(history.intent.clockWindow, history);
  }

  draft.comparison = comparisonField(
    question,
    normalizedQuestion,
    literals,
  );
  if (!draft.comparison && explicitFollowUp && history?.intent.comparison) {
    draft.comparison = inheritedField(history.intent.comparison, history);
  }

  const profile = options.targetProfile ?? DEFAULT_TARGET_PROFILE;
  draft.thresholds = targetThresholds(draft.metrics, literals, profile);

  if (draft.metrics.length === 0) {
    return incomplete(
      draft,
      literals,
      clarification(
        'missing_metric',
        'No supported metric was stated or safely inherited.',
        'Should I calculate average glucose, low episodes, high episodes, or time in range?',
      ),
    );
  }
  if (!draft.domain) {
    return incomplete(
      draft,
      literals,
      clarification(
        'ambiguous_metric',
        'The requested metric has no clear health-data domain.',
        'Which reading or health-data type do you mean?',
      ),
    );
  }
  if (draft.domain.value !== 'glucose') {
    return incomplete(
      draft,
      literals,
      unsupported(
        'unsupported_domain',
        `Structured execution for the ${draft.domain.value} domain is not available yet.`,
      ),
    );
  }
  const unsupportedMetric = draft.metrics.find(
    (metric) => !SUPPORTED_METRICS.has(metric.value),
  );
  if (unsupportedMetric) {
    return incomplete(
      draft,
      literals,
      unsupported(
        'unsupported_metric',
        `${unsupportedMetric.value} was recognised exactly but is not locally executable yet.`,
      ),
    );
  }
  if (!draft.operation) {
    return incomplete(
      draft,
      literals,
      clarification(
        'ambiguous_metric',
        'The requested calculation is ambiguous.',
        'What calculation should I perform?',
      ),
    );
  }
  if (!draft.temporalScope) {
    return incomplete(
      draft,
      literals,
      clarification(
        'missing_time_scope',
        'No time period was stated or safely inherited.',
        'Which dates or period should I use?',
      ),
    );
  }
  if (draft.comparison?.value.kind === 'explicit_periods') {
    return incomplete(
      draft,
      literals,
      unsupported(
        'unsupported_comparison',
        'Only comparison with the immediately preceding equal-length period is executable in this foundation.',
      ),
    );
  }

  const intent: TarvisIntentV1 = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    question,
    normalizedQuestion,
    domain: draft.domain,
    metrics: draft.metrics,
    operation: draft.operation,
    temporalScope: draft.temporalScope,
    clockWindow: draft.clockWindow ?? null,
    comparison: draft.comparison ?? null,
    thresholds: draft.thresholds,
  };
  const ready: ReadyTarvisIntentResolution = {
    schemaVersion: TARVIS_INTENT_SCHEMA_VERSION,
    intent,
    literals,
    outcome: { status: 'ready', code: 'ready' },
  };
  return ready;
}

export function isReadyTarvisIntent(
  resolution: TarvisIntentResolution,
): resolution is ReadyTarvisIntentResolution {
  return resolution.outcome.status === 'ready';
}
