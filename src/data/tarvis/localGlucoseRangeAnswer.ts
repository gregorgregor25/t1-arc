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
  resolveTarvisIntentRange,
  type TarvisIntentComparisonBasis,
} from './intentRange';
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

const LOCAL_RANGE_ANSWER_VERSION = 'tarvis-local-glucose-range-v1';
const OBSERVATION_GAP_MS = 12 * 60_000;
const EPISODE_BOUNDARY_CONTEXT_MS = 15 * 60_000;
const SUFFICIENT_COVERAGE_PERCENT = 70;

type SupportedMetric = Extract<
  TarvisMetric,
  | 'glucose.mean'
  | 'glucose.time_in_range'
  | 'glucose.low_episodes'
  | 'glucose.high_episodes'
>;

const SUPPORTED_METRICS = new Set<SupportedMetric>([
  'glucose.mean',
  'glucose.time_in_range',
  'glucose.low_episodes',
  'glucose.high_episodes',
]);

const EXPECTED_OPERATION: Record<SupportedMetric, TarvisOperation> = {
  'glucose.mean': 'aggregate',
  'glucose.time_in_range': 'range_distribution',
  'glucose.low_episodes': 'count_episodes',
  'glucose.high_episodes': 'count_episodes',
};

interface NormalizedThreshold extends Omit<TarvisGlucoseThreshold, 'unit'> {
  unit: 'mmol/L';
}

interface ExecutableRangeIntent {
  intent: TarvisIntentV1;
  metrics: SupportedMetric[];
  thresholds: NormalizedThreshold[];
}

interface RangeCalculation {
  coveragePercent: number;
  metrics: EvidenceCalculationReference['metrics'];
  observedMilliseconds: number;
  readings: GlucoseReading[];
  evidenceReadings: GlucoseReading[];
  evidenceRange: TimeRange;
  range: TimeRange;
  distribution: {
    abovePercent: number | null;
    belowPercent: number | null;
    inRangePercent: number | null;
  } | null;
}

export interface LocalGlucoseRangeAnswerResult {
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  presentation: TarvisEvidencePresentation;
}

export class UnsupportedLocalGlucoseRangeIntentError extends Error {
  readonly code = 'unsupported-local-glucose-range-intent';

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLocalGlucoseRangeIntentError';
  }
}

function unsupported(message: string): never {
  throw new UnsupportedLocalGlucoseRangeIntentError(message);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeThreshold(
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

function validateIntent(intent: TarvisIntentV1): ExecutableRangeIntent {
  if (intent.schemaVersion !== 1 || intent.domain.value !== 'glucose') {
    return unsupported('Only schema-v1 glucose intents are locally executable.');
  }
  if (intent.clockWindow !== null) {
    return unsupported('Recurring clock windows use the clock-window executor.');
  }
  if (!intent.metrics.length) {
    return unsupported('A local glucose calculation requires a metric.');
  }
  const metrics = intent.metrics.map(({ value }) => value);
  if (
    new Set(metrics).size !== metrics.length ||
    metrics.some((metric) => !SUPPORTED_METRICS.has(metric as SupportedMetric))
  ) {
    return unsupported('The intent contains an unsupported or duplicate metric.');
  }
  const supportedMetrics = metrics as SupportedMetric[];
  if (
    supportedMetrics.some(
      (metric) => EXPECTED_OPERATION[metric] !== intent.operation.value,
    )
  ) {
    return unsupported('The metric and operation do not agree.');
  }

  const thresholds = intent.thresholds.map(({ value }) =>
    normalizeThreshold(value),
  );
  const roles = new Set(thresholds.map(({ role }) => role));
  if (roles.size !== thresholds.length) {
    return unsupported('The intent contains duplicate threshold roles.');
  }
  const expectedRoles = new Set<NormalizedThreshold['role']>();
  if (supportedMetrics.includes('glucose.time_in_range')) {
    expectedRoles.add('range_lower');
    expectedRoles.add('range_upper');
  }
  if (supportedMetrics.includes('glucose.low_episodes')) expectedRoles.add('low');
  if (supportedMetrics.includes('glucose.high_episodes')) expectedRoles.add('high');
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
  if ((low && low.operator !== 'lt') || (high && high.operator !== 'gt')) {
    return unsupported(
      'Episode detection supports strict below/above thresholds only.',
    );
  }
  return { intent, metrics: supportedMetrics, thresholds };
}

function resolveRanges(executable: ExecutableRangeIntent, asOf: number) {
  const resolution = resolveTarvisIntentRange({
    asOf,
    intent: executable.intent,
    timezone: APP_TIME_ZONE,
  });
  if (resolution.status !== 'resolved') {
    return unsupported(
      resolution.status === 'rejected'
        ? resolution.message
        : 'The requested period requires the recurring-window executor.',
    );
  }
  return resolution;
}

/** The smallest half-open repository range needed for the exact calculation. */
export function rangeForLocalGlucoseRangeIntent(
  intent: TarvisIntentV1,
  asOf: number,
): TimeRange {
  const executable = validateIntent(intent);
  const resolved = resolveRanges(executable, asOf);
  const exact = {
    start: Math.min(resolved.current.start, resolved.previous?.start ?? Infinity),
    end: Math.max(resolved.current.end, resolved.previous?.end ?? -Infinity),
  };
  return executable.metrics.some((metric) => metric.endsWith('_episodes'))
    ? {
        start: Math.max(0, exact.start - EPISODE_BOUNDARY_CONTEXT_MS),
        end: Math.min(asOf, exact.end + EPISODE_BOUNDARY_CONTEXT_MS),
      }
    : exact;
}

function canonicalReadings(readings: readonly GlucoseReading[]) {
  const ids = new Set<string>();
  return [...readings]
    .map((reading) => {
      if (!reading.id.trim() || ids.has(reading.id)) {
        return unsupported(
          reading.id.trim()
            ? `Duplicate glucose record ID: ${reading.id}.`
            : 'A glucose record ID was empty.',
        );
      }
      ids.add(reading.id);
      if (
        !Number.isFinite(reading.timestamp) ||
        reading.timestamp < 0 ||
        !Number.isFinite(reading.mmolL) ||
        reading.mmolL <= 0 ||
        !reading.sourceId.trim()
      ) {
        return unsupported('A glucose record was not valid for calculation.');
      }
      return reading;
    })
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
}

function thresholdFor(
  thresholds: NormalizedThreshold[],
  role: NormalizedThreshold['role'],
) {
  const threshold = thresholds.find((candidate) => candidate.role === role);
  return threshold ?? unsupported(`Missing ${role} threshold.`);
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

function observationIntervals(readings: readonly GlucoseReading[], range: TimeRange) {
  const groups: Array<{ timestamp: number; mmolL: number; count: number }> = [];
  readings.forEach((reading) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === reading.timestamp) {
      previous.mmolL =
        (previous.mmolL * previous.count + reading.mmolL) /
        (previous.count + 1);
      previous.count += 1;
      return;
    }
    groups.push({ timestamp: reading.timestamp, mmolL: reading.mmolL, count: 1 });
  });
  return groups.flatMap((group, index) => {
    const end = Math.min(
      range.end,
      groups[index + 1]?.timestamp ?? range.end,
      group.timestamp + OBSERVATION_GAP_MS,
    );
    return end > group.timestamp
      ? [{ start: group.timestamp, end, mmolL: group.mmolL }]
      : [];
  });
}

function calculateRange(
  executable: ExecutableRangeIntent,
  allReadings: readonly GlucoseReading[],
  range: TimeRange,
  asOf: number,
): RangeCalculation {
  const readings = allReadings.filter(
    ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
  );
  const needsEpisodeContext = executable.metrics.some((metric) =>
    metric.endsWith('_episodes'),
  );
  const evidenceRange = needsEpisodeContext
    ? {
        start: Math.max(0, range.start - EPISODE_BOUNDARY_CONTEXT_MS),
        end: Math.min(asOf, range.end + EPISODE_BOUNDARY_CONTEXT_MS),
      }
    : range;
  const evidenceReadings = needsEpisodeContext
    ? allReadings.filter(
        ({ timestamp }) =>
          timestamp >= evidenceRange.start && timestamp < evidenceRange.end,
      )
    : readings;
  const intervals = observationIntervals(readings, range);
  const observedMilliseconds = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const expectedMilliseconds = range.end - range.start;
  const coveragePercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;

  let distribution: RangeCalculation['distribution'] = null;
  if (executable.metrics.includes('glucose.time_in_range')) {
    const lower = thresholdFor(executable.thresholds, 'range_lower');
    const upper = thresholdFor(executable.thresholds, 'range_upper');
    let below = 0;
    let within = 0;
    let above = 0;
    intervals.forEach((interval) => {
      const duration = interval.end - interval.start;
      if (
        matchesThreshold(interval.mmolL, lower) &&
        matchesThreshold(interval.mmolL, upper)
      ) {
        within += duration;
      } else if (
        interval.mmolL < lower.value ||
        (interval.mmolL === lower.value && lower.operator === 'gt')
      ) {
        below += duration;
      } else {
        above += duration;
      }
    });
    const percent = (duration: number) =>
      observedMilliseconds > 0
        ? round((duration / observedMilliseconds) * 100, 1)
        : null;
    distribution = {
      abovePercent: percent(above),
      belowPercent: percent(below),
      inRangePercent: percent(within),
    };
  }

  const mean = readings.length
    ? round(
        readings.reduce((total, reading) => total + reading.mmolL, 0) /
          readings.length,
        2,
      )
    : null;
  const metrics = executable.metrics.map((metric) => {
    switch (metric) {
      case 'glucose.mean':
        return { id: metric, unit: 'mmol/L' as const, value: mean };
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
          value: readings.length
            ? detectGlucoseEpisodes(
                evidenceReadings,
                'low',
                thresholdFor(executable.thresholds, 'low').value,
              ).filter(
                (episode) =>
                  episode.start >= range.start && episode.start < range.end,
              ).length
            : null,
        };
      case 'glucose.high_episodes':
        return {
          id: metric,
          unit: 'events' as const,
          value: readings.length
            ? detectGlucoseEpisodes(
                evidenceReadings,
                'high',
                thresholdFor(executable.thresholds, 'high').value,
              ).filter(
                (episode) =>
                  episode.start >= range.start && episode.start < range.end,
              ).length
            : null,
        };
    }
  });
  return {
    coveragePercent,
    distribution,
    evidenceRange,
    evidenceReadings,
    metrics,
    observedMilliseconds,
    range,
    readings,
  };
}

function representativeReadings(readings: readonly GlucoseReading[]) {
  if (!readings.length) return [];
  const chronological = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const byLow = [...readings].sort(
    (left, right) =>
      left.mmolL - right.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  );
  const byHigh = [...readings].sort(
    (left, right) =>
      right.mmolL - left.mmolL ||
      left.timestamp - right.timestamp ||
      left.id.localeCompare(right.id),
  );
  return [chronological[0]!, byLow[0]!, byHigh[0]!, chronological.at(-1)!]
    .filter(
      (reading, index, values) =>
        values.findIndex((candidate) => candidate.id === reading.id) === index,
    );
}

function metricPresentation(
  calculation: RangeCalculation,
): TarvisEvidenceMetric[] {
  return calculation.metrics.flatMap((metric): TarvisEvidenceMetric[] => {
    switch (metric.id) {
      case 'glucose.mean':
        return [{
          id: 'average-glucose',
          label: 'Observed arithmetic mean glucose',
          value: metric.value,
          decimals: 1,
          unit: 'mmol/L',
        }];
      case 'glucose.low_episodes':
        return [{
          id: 'low-events',
          label: 'Observed sustained lows',
          value: metric.value,
          decimals: 0,
        }];
      case 'glucose.high_episodes':
        return [{
          id: 'high-events',
          label: 'Observed sustained highs',
          value: metric.value,
          decimals: 0,
        }];
      case 'glucose.time_in_range':
        return [
          {
            id: 'time-below-range',
            label: 'Observed time below range',
            value: calculation.distribution?.belowPercent ?? null,
            decimals: 1,
            unit: '%',
          },
          {
            id: 'time-in-range',
            label: 'Observed time in range',
            value: calculation.distribution?.inRangePercent ?? null,
            decimals: 1,
            unit: '%',
          },
          {
            id: 'time-above-range',
            label: 'Observed time above range',
            value: calculation.distribution?.abovePercent ?? null,
            decimals: 1,
            unit: '%',
          },
        ];
    }
  });
}

function metricCopy(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
) {
  return calculation.metrics.map((metric) => {
    if (metric.value === null) return 'the requested result is unavailable';
    switch (metric.id) {
      case 'glucose.mean':
        return `the observed arithmetic mean was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.time_in_range': {
        const lower = thresholdFor(executable.thresholds, 'range_lower');
        const upper = thresholdFor(executable.thresholds, 'range_upper');
        return `${metric.value.toFixed(1)}% of observed sensor time was within ${lower.value.toFixed(1)}–${upper.value.toFixed(1)} mmol/L`;
      }
      case 'glucose.low_episodes':
        return `${metric.value} sustained low-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
      case 'glucose.high_episodes':
        return `${metric.value} sustained high-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
    }
  });
}

function evidenceFor(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
  label: string,
  queryKey: string,
) {
  const canonicalThresholds = [...executable.thresholds]
    .sort(
      (left, right) =>
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
  const queryId = `${LOCAL_RANGE_ANSWER_VERSION}:${JSON.stringify({
      schemaVersion: 1,
      timezone: APP_TIME_ZONE,
      queryKey,
      range: calculation.range,
      evidenceRange: calculation.evidenceRange,
      metrics: executable.metrics,
      thresholds: canonicalThresholds,
      observationGapMilliseconds: OBSERVATION_GAP_MS,
      episodeBoundaryContextMilliseconds: EPISODE_BOUNDARY_CONTEXT_MS,
      episodeDefinitionVersion: executable.metrics.some((metric) =>
        metric.endsWith('_episodes'),
      )
        ? GLUCOSE_EPISODE_DEFINITION_VERSION
        : null,
    })}`;
  const calculationReference: EvidenceCalculationReference = {
    kind: 'tarvis-local-glucose-v1',
    queryId,
    algorithmVersion: [
      LOCAL_RANGE_ANSWER_VERSION,
      ...(executable.metrics.includes('glucose.time_in_range')
        ? ['duration-forward-cap-12m-v1']
        : []),
      ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
        ? [GLUCOSE_EPISODE_DEFINITION_VERSION]
        : []),
    ].join('+'),
    metrics: calculation.metrics,
    thresholds: executable.thresholds.map((threshold) => ({
      operator: threshold.operator,
      role: threshold.role,
      unit: 'mmol/L',
      value: threshold.value,
    })),
    requestedWindowCount: 1,
    windowsWithData: calculation.readings.length > 0 ? 1 : 0,
    coveragePercent: calculation.coveragePercent,
    ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
      ? { episodeDefinitionVersion: GLUCOSE_EPISODE_DEFINITION_VERSION }
      : {}),
  };
  const evidence: EvidenceReference = {
    id: `${queryId}:${label === 'Requested period' ? 'current' : 'previous'}`,
    label: `${label} exact glucose inputs`,
    description: `${calculation.readings.length} exact normalised glucose readings inside the requested half-open period.${calculation.evidenceRange.start !== calculation.range.start || calculation.evidenceRange.end !== calculation.range.end ? ' A 15-minute boundary context is retained only to attribute sustained event starts and is not included in period averages, duration, or coverage.' : ''} Every calculation record ID is retained; missing time is not represented as zero.`,
    range: { ...calculation.evidenceRange },
    recordIds: calculation.evidenceReadings.map(({ id }) => id),
    examples: representativeReadings(calculation.evidenceReadings).map((reading) => ({
      id: reading.id,
      kind: 'glucose',
      timestamp: reading.timestamp,
      primary: `${reading.mmolL.toFixed(1)} mmol/L`,
      secondary: `${reading.quality} · exact scoped record`,
      sourceId: reading.sourceId,
    })),
    calculation: calculationReference,
  };
  return evidence;
}

function presentationKind(metrics: SupportedMetric[]) {
  if (metrics.length > 1) return 'glucose-summary' as const;
  switch (metrics[0]) {
    case 'glucose.mean':
      return 'average-glucose' as const;
    case 'glucose.time_in_range':
      return 'time-in-range' as const;
    case 'glucose.low_episodes':
      return 'low-events' as const;
    default:
      return 'high-events' as const;
  }
}

function answerHeadline(calculation: RangeCalculation) {
  const first = calculation.metrics[0];
  if (!first || first.value === null) return 'Glucose result unavailable';
  if (calculation.metrics.length > 1) return 'Observed glucose results';
  switch (first.id) {
    case 'glucose.mean':
      return `Observed average glucose: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.time_in_range':
      return `Observed time in range: ${first.value.toFixed(1)}%`;
    case 'glucose.low_episodes':
      return `Observed low-glucose events: ${first.value}`;
    case 'glucose.high_episodes':
      return `Observed high-glucose events: ${first.value}`;
  }
}

function previousPeriodLabel(
  basis: TarvisIntentComparisonBasis | null,
) {
  switch (basis) {
    case 'adjacent_equal_elapsed_time':
      return 'Previous equal elapsed period';
    case 'adjacent_local_calendar_days':
      return 'Previous local calendar days';
    case 'previous_local_calendar_week':
      return 'Previous local calendar week';
    case 'previous_local_calendar_month':
      return 'Previous local calendar month';
    case 'matching_local_wall_clock_progress':
      return 'Previous matching local-clock period';
    default:
      return 'Previous comparison period';
  }
}

/**
 * Executes exact rolling/calendar glucose intents locally. The model is never
 * allowed to replace the resolved half-open range with a nearby report.
 */
export function buildLocalGlucoseRangeAnswer({
  asOf,
  intent,
  readings,
}: {
  asOf: number;
  intent: TarvisIntentV1;
  readings: GlucoseReading[];
}): LocalGlucoseRangeAnswerResult {
  const executable = validateIntent(intent);
  const resolved = resolveRanges(executable, asOf);
  const canonical = canonicalReadings(readings);
  const calculations = [
    {
      label: 'Requested period',
      value: calculateRange(executable, canonical, resolved.current, asOf),
    },
    ...(resolved.previous
      ? [{
          label: previousPeriodLabel(resolved.comparisonBasis),
          value: calculateRange(executable, canonical, resolved.previous, asOf),
        }]
      : []),
  ];
  const evidence = calculations.map(({ label, value }) =>
    evidenceFor(executable, value, label, `${asOf}:${resolved.comparisonBasis ?? 'none'}`),
  );
  const current = calculations[0]!.value;
  const answerParts = calculations.map(({ label, value }) => {
    if (!value.readings.length) {
      return `${label} has no glucose readings, so its result is unavailable`;
    }
    const coverage = `${value.coveragePercent.toFixed(1)}% observed sensor coverage`;
    return `${label} has ${coverage}; ${metricCopy(executable, value).join('; ')}`;
  });
  const limited = calculations.some(
    ({ value }) => value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT,
  );
  const noData = calculations.some(({ value }) => !value.readings.length);
  const limitations = [
    ...(limited
      ? ['At least one period had less than 70% sensor coverage, so values describe observed sensor time only.']
      : []),
    ...(executable.metrics.includes('glucose.time_in_range')
      ? ['Missing sensor time was excluded rather than estimated.']
      : []),
    ...(executable.metrics.some((metric) => metric.endsWith('_episodes'))
      ? [`Episode counts use ${GLUCOSE_EPISODE_DEFINITION_VERSION}; up to 15 minutes of boundary context is used only to attribute each event to its observed start period.`]
      : []),
    ...(calculations.length > 1 &&
    calculations[0]!.value.range.end - calculations[0]!.value.range.start !==
      calculations[1]!.value.range.end - calculations[1]!.value.range.start
      ? [
          `The local-calendar periods have different elapsed durations (${round((calculations[0]!.value.range.end - calculations[0]!.value.range.start) / 3_600_000, 2)} versus ${round((calculations[1]!.value.range.end - calculations[1]!.value.range.start) / 3_600_000, 2)} hours); raw event counts are not duration-normalised.`,
        ]
      : []),
  ];
  const kind = presentationKind(executable.metrics);
  return {
    answer: {
      headline:
        calculations.length > 1
          ? noData
            ? 'Glucose comparison incomplete'
            : 'Observed glucose comparison'
          : answerHeadline(current),
      answer: `${answerParts.join('. ')}. I kept the calculation to those exact periods and did not treat missing time as zero. This describes your recorded data, not a treatment recommendation.`,
      confidence: limited || noData ? 'limited' : 'high',
      evidenceIds: evidence.map(({ id }) => id),
      limitations: limitations.slice(0, 5),
    },
    evidence,
    presentation: {
      kind,
      title:
        calculations.length > 1
          ? 'Glucose comparison for the exact periods'
          : kind === 'average-glucose'
            ? 'Average glucose for the exact period'
            : kind === 'time-in-range'
              ? 'Time in range for the exact period'
              : kind === 'low-events'
                ? 'Low-glucose events for the exact period'
                : 'High-glucose events for the exact period',
      detail: executable.metrics.some((metric) => metric.endsWith('_episodes'))
        ? `Events use ${GLUCOSE_EPISODE_DEFINITION_VERSION}: 15 minutes beyond the threshold confirms a start, 15 minutes back across it confirms recovery, and a sensor gap over 12 minutes breaks continuity.`
        : executable.metrics.includes('glucose.time_in_range')
          ? 'Observed duration is carried forward only until the next reading or 12 minutes, whichever comes first. Missing time is excluded.'
          : 'Arithmetic mean of every exact reading inside the requested half-open period. Missing readings were not estimated.',
      windows: calculations.map(({ label, value }) => ({
        label,
        range: { ...value.range },
        recordCount: value.readings.length,
        coveragePercent: value.coveragePercent,
        coverageStatus:
          value.readings.length === 0
            ? ('unavailable' as const)
            : value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT
              ? ('limited' as const)
              : ('sufficient' as const),
        metrics: metricPresentation(value),
      })),
    },
  };
}
