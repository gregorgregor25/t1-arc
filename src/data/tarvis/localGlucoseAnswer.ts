import type {
  TarvisEvidenceMetric,
  TarvisEvidencePresentation,
} from './evidencePresentation';
import type {
  TarvisGlucoseThreshold,
  TarvisIntentV1,
  TarvisMetric,
  TarvisOperation,
} from './intent';
import {
  executeScopedGlucoseQuery,
  formatClockTime,
  resolveMostRecentCompletedRecurringWindows,
  type RecurringClockWindow,
  type ScopedGlucoseEvidenceBundle,
} from './query';
import type { TarvisAnswer } from './types';
import {
  detectGlucoseEpisodes,
  type EvidenceCalculationReference,
  type EvidenceReference,
  GLUCOSE_EPISODE_DEFINITION_VERSION,
} from '@/domain/insights';
import {
  APP_TIME_ZONE,
  type GlucoseReading,
  MG_DL_PER_MMOL_L,
  type TimeRange,
} from '@/domain/models';

const LOCAL_ANSWER_VERSION = 'tarvis-local-glucose-v1';
const OBSERVATION_GAP_MINUTES = 12;
const CHART_BIN_MINUTES = 15;
const SUFFICIENT_COVERAGE_PERCENT = 70;

const SUPPORTED_METRICS = new Set<TarvisMetric>([
  'glucose.mean',
  'glucose.time_in_range',
  'glucose.low_episodes',
  'glucose.high_episodes',
]);

const EXPECTED_OPERATION: Record<
  Extract<
    TarvisMetric,
    | 'glucose.mean'
    | 'glucose.time_in_range'
    | 'glucose.low_episodes'
    | 'glucose.high_episodes'
  >,
  TarvisOperation
> = {
  'glucose.mean': 'aggregate',
  'glucose.time_in_range': 'range_distribution',
  'glucose.low_episodes': 'count_episodes',
  'glucose.high_episodes': 'count_episodes',
};

type SupportedMetric = keyof typeof EXPECTED_OPERATION;

interface NormalizedThreshold
  extends Omit<TarvisGlucoseThreshold, 'unit'> {
  unit: 'mmol/L';
}

interface ExecutableLocalGlucoseIntent {
  clockWindow: RecurringClockWindow;
  metrics: SupportedMetric[];
  thresholds: NormalizedThreshold[];
  windowCount: number;
}

interface DurationDistribution {
  abovePercent: number | null;
  belowPercent: number | null;
  inRangePercent: number | null;
  observedMilliseconds: number;
}

export interface BuildLocalGlucoseAnswerInput {
  asOf: number;
  intent: TarvisIntentV1;
  readings: GlucoseReading[];
}

export interface LocalGlucoseAnswerResult {
  answer: TarvisAnswer;
  bundle: ScopedGlucoseEvidenceBundle;
  evidence: EvidenceReference;
  presentation: TarvisEvidencePresentation;
}

export class UnsupportedLocalGlucoseIntentError extends Error {
  readonly code = 'unsupported-local-glucose-intent';

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLocalGlucoseIntentError';
  }
}

function unsupported(message: string): never {
  throw new UnsupportedLocalGlucoseIntentError(message);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizedThreshold(
  threshold: TarvisGlucoseThreshold,
): NormalizedThreshold {
  if (!Number.isFinite(threshold.value) || threshold.value <= 0) {
    return unsupported('Glucose thresholds must be finite positive values.');
  }
  return {
    ...threshold,
    unit: 'mmol/L',
    value:
      threshold.unit === 'mg/dL'
        ? threshold.value / MG_DL_PER_MMOL_L
        : threshold.value,
  };
}

function validateIntent(intent: TarvisIntentV1): ExecutableLocalGlucoseIntent {
  if (intent.schemaVersion !== 1 || intent.domain.value !== 'glucose') {
    return unsupported('Only schema-v1 glucose intents are locally executable.');
  }
  if (!intent.metrics.length) {
    return unsupported('A local glucose calculation requires a metric.');
  }
  const metrics = intent.metrics.map(({ value }) => value);
  if (
    new Set(metrics).size !== metrics.length ||
    metrics.some((metric) => !SUPPORTED_METRICS.has(metric))
  ) {
    return unsupported('The ready intent contains unsupported or duplicate metrics.');
  }
  const supportedMetrics = metrics as SupportedMetric[];
  if (
    supportedMetrics.some(
      (metric) => EXPECTED_OPERATION[metric] !== intent.operation.value,
    )
  ) {
    return unsupported('The metric and operation in the ready intent do not agree.');
  }
  if (intent.comparison !== null) {
    return unsupported('Local recurring-window comparison is not executable yet.');
  }
  const scope = intent.temporalScope.value;
  if (
    scope.kind !== 'recent_local_days' ||
    scope.include !== 'most_recent_completed_windows' ||
    !Number.isInteger(scope.count) ||
    scope.count < 1 ||
    scope.count > 366
  ) {
    return unsupported(
      'Only most-recent completed recurring local-clock windows are executable.',
    );
  }
  const clock = intent.clockWindow?.value;
  if (!clock || clock.occurrenceAnchor !== 'start_date') {
    return unsupported('The ready intent does not contain a recurring clock window.');
  }

  const thresholds = intent.thresholds.map(({ value }) =>
    normalizedThreshold(value),
  );
  const roles = new Set(thresholds.map(({ role }) => role));
  if (roles.size !== thresholds.length) {
    return unsupported('The ready intent contains duplicate threshold roles.');
  }
  const hasMetric = (metric: SupportedMetric) =>
    supportedMetrics.includes(metric);
  const expectedRoles = new Set<NormalizedThreshold['role']>();
  if (hasMetric('glucose.time_in_range')) {
    expectedRoles.add('range_lower');
    expectedRoles.add('range_upper');
  }
  if (hasMetric('glucose.low_episodes')) expectedRoles.add('low');
  if (hasMetric('glucose.high_episodes')) expectedRoles.add('high');
  if (
    thresholds.length !== expectedRoles.size ||
    thresholds.some(({ role }) => !expectedRoles.has(role))
  ) {
    return unsupported(
      'The threshold roles do not exactly match the requested calculation.',
    );
  }

  const lower = thresholds.find(({ role }) => role === 'range_lower');
  const upper = thresholds.find(({ role }) => role === 'range_upper');
  if (
    (lower && lower.operator !== 'gt' && lower.operator !== 'gte') ||
    (upper && upper.operator !== 'lt' && upper.operator !== 'lte') ||
    (lower && upper && lower.value >= upper.value)
  ) {
    return unsupported('The requested glucose range is invalid or inverted.');
  }
  const low = thresholds.find(({ role }) => role === 'low');
  const high = thresholds.find(({ role }) => role === 'high');
  if (
    (low && low.operator !== 'lt') ||
    (high && high.operator !== 'gt')
  ) {
    return unsupported(
      'Episode detection supports strict below/above thresholds only.',
    );
  }

  return {
    clockWindow: {
      start: { ...clock.start },
      end: { ...clock.end },
      crossesMidnight: clock.crossesMidnight,
    },
    metrics: supportedMetrics,
    thresholds,
    windowCount: scope.count,
  };
}

function resolvedWindows(
  executable: ExecutableLocalGlucoseIntent,
  asOf: number,
) {
  if (!Number.isFinite(asOf) || asOf < 0) {
    return unsupported('asOf must be a finite non-negative timestamp.');
  }
  return resolveMostRecentCompletedRecurringWindows({
    asOf,
    clockWindow: executable.clockWindow,
    count: executable.windowCount,
    timezone: APP_TIME_ZONE,
  });
}

/** Returns the smallest half-open repository range needed by the local query. */
export function rangeForLocalGlucoseIntent(
  intent: TarvisIntentV1,
  asOf: number,
): TimeRange {
  const windows = resolvedWindows(validateIntent(intent), asOf);
  const first = windows[0];
  const last = windows.at(-1);
  if (!first || !last) {
    return unsupported('The recurring scope did not resolve any windows.');
  }
  return { start: first.range.start, end: last.range.end };
}

function matchesThreshold(value: number, threshold: NormalizedThreshold) {
  switch (threshold.operator) {
    case 'lt':
      return value < threshold.value;
    case 'lte':
      return value <= threshold.value;
    case 'gt':
      return value > threshold.value;
    case 'gte':
      return value >= threshold.value;
  }
}

function durationDistribution(
  bundle: ScopedGlucoseEvidenceBundle,
  thresholds: NormalizedThreshold[],
): DurationDistribution {
  const lower = thresholds.find(({ role }) => role === 'range_lower');
  const upper = thresholds.find(({ role }) => role === 'range_upper');
  if (!lower || !upper) {
    return unsupported('Time in range requires exact lower and upper thresholds.');
  }
  let belowMilliseconds = 0;
  let inRangeMilliseconds = 0;
  let aboveMilliseconds = 0;
  bundle.windows.forEach((window) => {
    window.observationIntervals.forEach((interval) => {
      const duration = interval.end - interval.start;
      if (matchesThreshold(interval.mmolL, lower) && matchesThreshold(interval.mmolL, upper)) {
        inRangeMilliseconds += duration;
      } else if (interval.mmolL < lower.value ||
        (interval.mmolL === lower.value && lower.operator === 'gt')) {
        belowMilliseconds += duration;
      } else {
        aboveMilliseconds += duration;
      }
    });
  });
  const observedMilliseconds =
    belowMilliseconds + inRangeMilliseconds + aboveMilliseconds;
  const percent = (duration: number) =>
    observedMilliseconds > 0
      ? round((duration / observedMilliseconds) * 100, 1)
      : null;
  return {
    abovePercent: percent(aboveMilliseconds),
    belowPercent: percent(belowMilliseconds),
    inRangePercent: percent(inRangeMilliseconds),
    observedMilliseconds,
  };
}

function scopedReadings(
  readings: GlucoseReading[],
  bundle: ScopedGlucoseEvidenceBundle,
) {
  const ids = new Set(bundle.evidence.recordIds);
  return readings
    .filter((reading) => ids.has(reading.id))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
}

function representativeReadings(readings: GlucoseReading[]) {
  if (!readings.length) return [];
  const chronological = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const lowest = [...readings].sort(
    (left, right) =>
      left.mmolL - right.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  )[0]!;
  const highest = [...readings].sort(
    (left, right) =>
      right.mmolL - left.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  )[0]!;
  return [...new Map(
    [chronological[0]!, lowest, highest, chronological.at(-1)!].map((reading) => [
      reading.id,
      reading,
    ]),
  ).values()];
}

function coverageStatus(bundle: ScopedGlucoseEvidenceBundle) {
  if (bundle.result.readingCount === 0) return 'unavailable' as const;
  return bundle.result.coverage.percent < SUFFICIENT_COVERAGE_PERCENT
    ? ('limited' as const)
    : ('sufficient' as const);
}

function clockTransitionSummary(bundle: ScopedGlucoseEvidenceBundle) {
  const descriptions = bundle.chart.windows.flatMap((window) =>
    window.clockTransitions.map((transition) => {
      const minutes = Math.abs(transition.changeMinutes);
      return `${window.label} ${transition.kind === 'gap' ? 'skips' : 'repeats'} ${minutes} local minute${minutes === 1 ? '' : 's'}`;
    }),
  );
  if (!descriptions.length) return null;
  const bounded =
    descriptions.length <= 4
      ? descriptions.join('; ')
      : `${descriptions.slice(0, 3).join('; ')}; and ${descriptions.length - 3} more`;
  return `Daylight-saving clock change: ${bounded}. This is a local clock transition, not missing sensor data.`;
}

function thresholdFor(
  thresholds: NormalizedThreshold[],
  role: NormalizedThreshold['role'],
) {
  const threshold = thresholds.find((candidate) => candidate.role === role);
  if (!threshold) return unsupported(`Missing ${role} threshold.`);
  return threshold;
}

function clockLabel(executable: ExecutableLocalGlucoseIntent) {
  return `${formatClockTime(executable.clockWindow.start)}–${formatClockTime(executable.clockWindow.end)}`;
}

function occurrenceNoun(executable: ExecutableLocalGlucoseIntent) {
  const start = executable.clockWindow.start.hour * 60 +
    executable.clockWindow.start.minute;
  const end = executable.clockWindow.end.hour * 60 +
    executable.clockWindow.end.minute;
  return executable.clockWindow.crossesMidnight || start >= 18 * 60 || end <= 7 * 60
    ? 'overnight windows'
    : 'clock windows';
}

function requestedCoverageSentence(
  bundle: ScopedGlucoseEvidenceBundle,
  executable: ExecutableLocalGlucoseIntent,
) {
  return `I found readings in ${bundle.result.windowsWithData} of the ${bundle.result.requestedWindowCount} requested ${occurrenceNoun(executable)} from ${clockLabel(executable)}.`;
}

function metricResults(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  readings: GlucoseReading[],
  distribution: DurationDistribution | null,
) {
  const hasData = bundle.result.readingCount > 0;
  return executable.metrics.map((metric) => {
    switch (metric) {
      case 'glucose.mean':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: bundle.result.observedMeanMmolL,
        };
      case 'glucose.time_in_range':
        return {
          id: metric,
          unit: '%' as const,
          value: distribution?.inRangePercent ?? null,
        };
      case 'glucose.low_episodes':
        return {
          id: metric,
          unit: 'events' as const,
          value: hasData
            ? detectGlucoseEpisodes(
                readings,
                'low',
                thresholdFor(executable.thresholds, 'low').value,
              ).length
            : null,
        };
      case 'glucose.high_episodes':
        return {
          id: metric,
          unit: 'events' as const,
          value: hasData
            ? detectGlucoseEpisodes(
                readings,
                'high',
                thresholdFor(executable.thresholds, 'high').value,
              ).length
            : null,
        };
    }
  });
}

function answerFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference['metrics'],
  distribution: DurationDistribution | null,
  evidenceId: string,
): TarvisAnswer {
  if (bundle.result.readingCount === 0) {
    return {
      headline: 'Glucose result unavailable',
      answer: `I couldn't find glucose readings in any of the ${bundle.result.requestedWindowCount} requested ${occurrenceNoun(executable)} from ${clockLabel(executable)}. I haven't treated missing time as zero, so the requested result is unavailable.`,
      confidence: 'limited',
      evidenceIds: [evidenceId],
      limitations: [
        'No glucose readings were available inside the exact requested windows.',
      ],
    };
  }

  const copies = metrics.map((metric) => {
    if (metric.value === null) return 'the requested result was unavailable';
    switch (metric.id) {
      case 'glucose.mean':
        return `Across those readings, your observed arithmetic mean was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.time_in_range': {
        const lower = thresholdFor(executable.thresholds, 'range_lower');
        const upper = thresholdFor(executable.thresholds, 'range_upper');
        return `Across those readings, ${metric.value.toFixed(1)}% of observed sensor time was within the requested ${lower.value.toFixed(1)}–${upper.value.toFixed(1)} mmol/L range`;
      }
      case 'glucose.low_episodes':
        return `Across those readings, I found ${metric.value} sustained low-glucose event${metric.value === 1 ? '' : 's'}`;
      case 'glucose.high_episodes':
        return `Across those readings, I found ${metric.value} sustained high-glucose event${metric.value === 1 ? '' : 's'}`;
    }
  });
  const status = coverageStatus(bundle);
  const limitations = [
    ...(status === 'limited'
      ? ['Coverage was below 70%, so this describes observed sensor time only.']
      : []),
    ...(bundle.result.missingWindowCount > 0
      ? ['At least one requested window contained no glucose readings.']
      : []),
    ...(distribution
      ? ['Missing sensor time was excluded rather than estimated.']
      : []),
    ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
      ? [
          `Episode counts use ${GLUCOSE_EPISODE_DEFINITION_VERSION}; records outside the requested windows were excluded.`,
        ]
      : []),
    ...(clockTransitionSummary(bundle)
      ? [clockTransitionSummary(bundle)!]
      : []),
  ];
  const first = metrics[0];
  const headline =
    metrics.length > 1
      ? 'Observed glucose events'
      : first?.id === 'glucose.mean'
        ? `Observed average glucose: ${first.value?.toFixed(1)} mmol/L`
        : first?.id === 'glucose.time_in_range'
          ? `Observed time in range: ${first.value?.toFixed(1)}%`
          : first?.id === 'glucose.low_episodes'
            ? `Observed low-glucose events: ${first.value}`
            : `Observed high-glucose events: ${first?.value}`;
  return {
    headline,
    answer: `${requestedCoverageSentence(bundle, executable)} ${copies.join('; ')}. This is a description of the recorded data, not a treatment recommendation.`,
    confidence: status === 'sufficient' ? 'high' : 'limited',
    evidenceIds: [evidenceId],
    limitations: limitations.slice(0, 5),
  };
}

function presentationFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference['metrics'],
  distribution: DurationDistribution | null,
): TarvisEvidencePresentation {
  const metricPresentations: TarvisEvidenceMetric[] = metrics.flatMap(
    (metric): TarvisEvidenceMetric[] => {
    switch (metric.id) {
      case 'glucose.mean':
        return [{
          id: 'average-glucose' as const,
          label: 'Observed arithmetic mean glucose',
          value: metric.value,
          decimals: 1 as const,
          unit: 'mmol/L' as const,
        }];
      case 'glucose.low_episodes':
        return [{
          id: 'low-events' as const,
          label: 'Observed sustained lows',
          value: metric.value,
          decimals: 0 as const,
        }];
      case 'glucose.high_episodes':
        return [{
          id: 'high-events' as const,
          label: 'Observed sustained highs',
          value: metric.value,
          decimals: 0 as const,
        }];
      case 'glucose.time_in_range':
        return [
          {
            id: 'time-below-range' as const,
            label: 'Observed time below range',
            value: distribution?.belowPercent ?? null,
            decimals: 1 as const,
            unit: '%' as const,
          },
          {
            id: 'time-in-range' as const,
            label: 'Observed time in range',
            value: distribution?.inRangePercent ?? null,
            decimals: 1 as const,
            unit: '%' as const,
          },
          {
            id: 'time-above-range' as const,
            label: 'Observed time above range',
            value: distribution?.abovePercent ?? null,
            decimals: 1 as const,
            unit: '%' as const,
          },
        ];
    }
    },
  );
  const kind =
    metrics.length > 1
      ? ('glucose-events' as const)
      : metrics[0]?.id === 'glucose.mean'
        ? ('average-glucose' as const)
        : metrics[0]?.id === 'glucose.time_in_range'
          ? ('time-in-range' as const)
          : metrics[0]?.id === 'glucose.low_episodes'
            ? ('low-events' as const)
            : ('high-events' as const);
  const detail =
    kind === 'average-glucose'
      ? 'Arithmetic mean of every exact reading inside the requested half-open clock windows. Missing readings were not estimated.'
      : kind === 'time-in-range'
        ? `Observed duration is carried forward only until the next reading or ${OBSERVATION_GAP_MINUTES} minutes, whichever comes first. Missing time is excluded.`
        : `Events ${[
            ...executable.thresholds
              .filter((threshold) => threshold.role === 'low')
              .map((threshold) => `below ${threshold.value.toFixed(1)} mmol/L`),
            ...executable.thresholds
              .filter((threshold) => threshold.role === 'high')
              .map((threshold) => `above ${threshold.value.toFixed(1)} mmol/L`),
          ].join(' or ')} use ${GLUCOSE_EPISODE_DEFINITION_VERSION}: 15 minutes beyond the threshold confirms a start, 15 minutes across it confirms recovery, and a sensor gap over 12 minutes breaks continuity.`;
  const firstRange = bundle.windows[0]!.range;
  const lastRange = bundle.windows.at(-1)!.range;
  return {
    kind,
    title:
      kind === 'average-glucose'
        ? 'Average glucose in the requested clock window'
        : kind === 'time-in-range'
          ? 'Time in range in the requested clock window'
          : kind === 'low-events'
            ? 'Low-glucose events in the requested clock window'
            : kind === 'high-events'
              ? 'High-glucose events in the requested clock window'
              : 'Glucose events in the requested clock window',
    detail,
    windows: [
      {
        label: `${bundle.result.requestedWindowCount} completed ${clockLabel(executable)} windows`,
        range: { start: firstRange.start, end: lastRange.end },
        recordCount: bundle.result.readingCount,
        coveragePercent: bundle.result.coverage.percent,
        coverageStatus: coverageStatus(bundle),
        metrics: metricPresentations,
      },
    ],
  };
}

function evidenceFor(
  executable: ExecutableLocalGlucoseIntent,
  bundle: ScopedGlucoseEvidenceBundle,
  metrics: EvidenceCalculationReference['metrics'],
  readings: GlucoseReading[],
) {
  const id = `${bundle.queryId}:evidence`;
  const firstRange = bundle.windows[0]!.range;
  const lastRange = bundle.windows.at(-1)!.range;
  const thresholdValues: EvidenceCalculationReference['thresholds'] =
    executable.thresholds.map((threshold) => ({
      operator: threshold.operator,
      role: threshold.role,
      unit: 'mmol/L',
      value: threshold.value,
    }));
  const calculation: EvidenceCalculationReference = {
    kind: 'tarvis-local-glucose-v1',
    queryId: bundle.queryId,
    algorithmVersion: [
      `scoped-glucose-v${bundle.schemaVersion}`,
      ...(executable.metrics.includes('glucose.time_in_range')
        ? [`duration-gap-cap-${OBSERVATION_GAP_MINUTES}m-v1`]
        : []),
      ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
        ? [GLUCOSE_EPISODE_DEFINITION_VERSION]
        : []),
    ].join('+'),
    metrics,
    thresholds: thresholdValues,
    requestedWindowCount: bundle.result.requestedWindowCount,
    windowsWithData: bundle.result.windowsWithData,
    coveragePercent: bundle.result.coverage.percent,
    ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
      ? { episodeDefinitionVersion: GLUCOSE_EPISODE_DEFINITION_VERSION }
      : {}),
  };
  const lower = executable.thresholds.find(
    (threshold) => threshold.role === 'range_lower',
  );
  const upper = executable.thresholds.find(
    (threshold) => threshold.role === 'range_upper',
  );
  const evidence: EvidenceReference = {
    id,
    label: `Exact ${clockLabel(executable)} glucose inputs`,
    description: `${bundle.result.readingCount} exact normalised glucose readings from ${bundle.result.requestedWindowCount} completed Europe/London clock windows. Every calculation record ID is retained; missing time is not represented as zero.${clockTransitionSummary(bundle) ? ` ${clockTransitionSummary(bundle)}` : ''}`,
    range: { start: firstRange.start, end: lastRange.end },
    recordIds: [...bundle.evidence.recordIds],
    examples: representativeReadings(readings).map((reading) => ({
      id: reading.id,
      kind: 'glucose',
      timestamp: reading.timestamp,
      primary: `${reading.mmolL.toFixed(1)} mmol/L`,
      secondary: `${reading.quality} · exact scoped record`,
      sourceId: reading.sourceId,
    })),
    calculation,
    visualization: {
      ...bundle.chart,
      timezone: APP_TIME_ZONE,
      title: `Glucose from ${clockLabel(executable)}`,
      subtitle: `${bundle.result.requestedWindowCount} completed local windows overlaid on the exact requested clock axis. The thicker line is the ${CHART_BIN_MINUTES}-minute average where enough windows contribute.`,
      coverageSummary: `${bundle.result.windowsWithData} of ${bundle.result.requestedWindowCount} requested windows contain readings · ${bundle.result.coverage.percent.toFixed(1)}% observed coverage${clockTransitionSummary(bundle) ? ` · ${clockTransitionSummary(bundle)}` : ''}`,
      missingOccurrenceLabels: bundle.evidence.missingWindows.map(
        (window) => window.label,
      ),
      ...(lower && upper
        ? {
            targetRange: {
              minimum: lower.value,
              maximum: upper.value,
            },
          }
        : {}),
    },
  };
  return evidence;
}

function localQueryId(
  executable: ExecutableLocalGlucoseIntent,
  asOf: number,
) {
  const thresholds = [...executable.thresholds]
    .sort((left, right) =>
      left.role.localeCompare(right.role) ||
      left.operator.localeCompare(right.operator) ||
      left.value - right.value,
    )
    .map(({ operator, role, unit, value }) => ({
      operator,
      role,
      unit,
      value,
    }));
  return `${LOCAL_ANSWER_VERSION}:${JSON.stringify({
    schemaVersion: 1,
    timezone: APP_TIME_ZONE,
    asOf,
    metrics: executable.metrics,
    windowCount: executable.windowCount,
    clockWindow: executable.clockWindow,
    thresholds,
    binMinutes: CHART_BIN_MINUTES,
    maximumObservedGapMinutes: OBSERVATION_GAP_MINUTES,
    minimumAggregateContributors: Math.min(2, executable.windowCount),
  })}`;
}

/**
 * Executes a ready recurring-clock glucose intent without model calculation or
 * prose generation. Unsupported ready shapes throw instead of falling back to
 * a nearby report.
 */
export function buildLocalGlucoseAnswer({
  asOf,
  intent,
  readings,
}: BuildLocalGlucoseAnswerInput): LocalGlucoseAnswerResult {
  const executable = validateIntent(intent);
  // Resolve once before execution so invalid asOf/scope values fail before any
  // result object can be partially assembled.
  resolvedWindows(executable, asOf);
  const bundle = executeScopedGlucoseQuery(
    {
      asOf,
      binMinutes: CHART_BIN_MINUTES,
      clockWindow: executable.clockWindow,
      maximumObservedGapMinutes: OBSERVATION_GAP_MINUTES,
      minimumAggregateContributors: Math.min(2, executable.windowCount),
      queryId: localQueryId(executable, asOf),
      timezone: APP_TIME_ZONE,
      windowCount: executable.windowCount,
    },
    readings,
  );
  const exactReadings = scopedReadings(readings, bundle);
  const distribution = executable.metrics.includes('glucose.time_in_range')
    ? durationDistribution(bundle, executable.thresholds)
    : null;
  const metrics = metricResults(
    executable,
    bundle,
    exactReadings,
    distribution,
  );
  const evidence = evidenceFor(executable, bundle, metrics, exactReadings);
  return {
    answer: answerFor(
      executable,
      bundle,
      metrics,
      distribution,
      evidence.id,
    ),
    bundle,
    evidence,
    presentation: presentationFor(
      executable,
      bundle,
      metrics,
      distribution,
    ),
  };
}
