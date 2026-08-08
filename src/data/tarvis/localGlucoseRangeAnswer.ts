import type {
  TarvisEvidenceMetric,
  TarvisEvidencePresentation,
} from './evidencePresentation';
import {
  createGlucoseAnswerBundleV2,
  type GlucoseAnswerBundleV2,
} from './glucoseAnswerBundleV2';
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
import {
  calculateGlucoseStatistics,
  canonicalGlucoseSamples,
  GMI_FORMULA_VERSION,
  GLUCOSE_STATISTICS_VERSION,
} from './query/glucoseStatistics';
import type { TarvisAnswer } from './types';
import { isLocalGlucoseScopeWithinLimit } from './localScopeLimit';
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
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type TimeRange,
} from '@/domain/models';
import { toDateKey, zonedDateTimeToTimestamp } from '@/domain/time';
import {
  isEvidenceQueryVisualizationReference,
  type EvidenceQueryEvent,
  type EvidenceQueryVisualizationReference,
} from '@/domain/evidenceQueryChart';

const LOCAL_RANGE_ANSWER_VERSION = 'tarvis-local-glucose-range-v1';
const OBSERVATION_GAP_MS = 12 * 60_000;
const EPISODE_BOUNDARY_CONTEXT_MS = 15 * 60_000;
const SUFFICIENT_COVERAGE_PERCENT = 70;
const GMI_MINIMUM_EXPECTED_MILLISECONDS = 14 * 24 * 60 * 60_000;

type SupportedMetric = Extract<
  TarvisMetric,
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
>;

const SUPPORTED_METRICS = new Set<SupportedMetric>([
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

const EXPECTED_OPERATION: Record<SupportedMetric, TarvisOperation> = {
  'glucose.mean': 'aggregate',
  'glucose.median': 'aggregate',
  'glucose.minimum': 'aggregate',
  'glucose.maximum': 'aggregate',
  'glucose.standard_deviation': 'aggregate',
  'glucose.coefficient_of_variation': 'aggregate',
  'glucose.gmi': 'aggregate',
  'glucose.time_in_range': 'range_distribution',
  'glucose.low_episodes': 'count_episodes',
  'glucose.high_episodes': 'count_episodes',
  'glucose.low_readings': 'count_readings',
  'glucose.high_readings': 'count_readings',
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
  observationIntervals: Array<{
    start: number;
    end: number;
    mmolL: number;
    recordIds: string[];
  }>;
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

interface LabeledRangeCalculation {
  id: string;
  label: string;
  role: 'requested' | 'comparison';
  value: RangeCalculation;
}

const SAMPLE_STATISTIC_METRICS = new Set<SupportedMetric>([
  'glucose.mean',
  'glucose.median',
  'glucose.minimum',
  'glucose.maximum',
  'glucose.standard_deviation',
  'glucose.coefficient_of_variation',
  'glucose.gmi',
  'glucose.low_readings',
  'glucose.high_readings',
]);

function metricAlgorithmVersion(metric: SupportedMetric) {
  if (metric === 'glucose.time_in_range') {
    return 'duration-forward-cap-12m-v1';
  }
  if (metric.endsWith('_episodes')) {
    return GLUCOSE_EPISODE_DEFINITION_VERSION;
  }
  if (metric === 'glucose.gmi') {
    return `${GLUCOSE_STATISTICS_VERSION}:${GMI_FORMULA_VERSION}:unique-timestamp-rounded-2dp`;
  }
  if (metric.endsWith('_readings')) {
    return `${GLUCOSE_STATISTICS_VERSION}:threshold-count-unique-timestamp-v1`;
  }
  return `${GLUCOSE_STATISTICS_VERSION}:${metric.split('.').at(-1)}-unique-timestamp-rounded-2dp`;
}

function completeLocalCalendarDayCount(range: TimeRange) {
  const startDate = toDateKey(range.start);
  const endDate = toDateKey(range.end);
  if (
    zonedDateTimeToTimestamp(startDate) !== range.start ||
    zonedDateTimeToTimestamp(endDate) !== range.end
  ) {
    return null;
  }
  const utcDate = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
  return Math.round((utcDate(endDate) - utcDate(startDate)) / 86_400_000);
}

function hasRepresentativeGmiDuration(range: TimeRange) {
  const localCalendarDays = completeLocalCalendarDayCount(range);
  return localCalendarDays !== null
    ? localCalendarDays >= 14
    : range.end - range.start >= GMI_MINIMUM_EXPECTED_MILLISECONDS;
}

export interface LocalGlucoseRangeAnswerResult {
  answer: TarvisAnswer;
  /** Immutable, runtime-validated calculation provenance for this answer. */
  answerBundle: GlucoseAnswerBundleV2;
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
  if (!isLocalGlucoseScopeWithinLimit(intent)) {
    return unsupported(
      'Local glucose answers support at most 90 total days per query.',
    );
  }
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
  if (
    supportedMetrics.includes('glucose.low_episodes') ||
    supportedMetrics.includes('glucose.low_readings')
  ) {
    expectedRoles.add('low');
  }
  if (
    supportedMetrics.includes('glucose.high_episodes') ||
    supportedMetrics.includes('glucose.high_readings')
  ) {
    expectedRoles.add('high');
  }
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
      'Low/high calculations support strict below/above thresholds only.',
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
  const groups: Array<{
    timestamp: number;
    mmolL: number;
    recordIds: string[];
  }> = [];
  readings.forEach((reading) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === reading.timestamp) {
      const count = previous.recordIds.length;
      previous.mmolL =
        (previous.mmolL * count + reading.mmolL) / (count + 1);
      previous.recordIds.push(reading.id);
      return;
    }
    groups.push({
      timestamp: reading.timestamp,
      mmolL: reading.mmolL,
      recordIds: [reading.id],
    });
  });
  return groups.flatMap((group, index) => {
    const end = Math.min(
      range.end,
      groups[index + 1]?.timestamp ?? range.end,
      group.timestamp + OBSERVATION_GAP_MS,
    );
    return end > group.timestamp
      ? [{
          start: group.timestamp,
          end,
          mmolL: group.mmolL,
          recordIds: [...group.recordIds],
        }]
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
  const roundedCoveragePercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;
  const coveragePercent =
    observedMilliseconds > 0 && roundedCoveragePercent === 0
      ? 0.1
      : roundedCoveragePercent;

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

  const statistics = calculateGlucoseStatistics({
    readings,
    range,
    observationGapCapMilliseconds: OBSERVATION_GAP_MS,
  });
  const samples = canonicalGlucoseSamples(readings, range);
  const statistic = (value: number | null) =>
    value === null ? null : round(value, 2);
  const metrics = executable.metrics.map((metric) => {
    switch (metric) {
      case 'glucose.mean':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: statistic(statistics.arithmeticMeanMmolL),
        };
      case 'glucose.median':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: statistic(statistics.medianMmolL),
        };
      case 'glucose.minimum':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: statistic(statistics.minimumMmolL),
        };
      case 'glucose.maximum':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: statistic(statistics.maximumMmolL),
        };
      case 'glucose.standard_deviation':
        return {
          id: metric,
          unit: 'mmol/L' as const,
          value: statistic(statistics.populationStandardDeviationMmolL),
        };
      case 'glucose.coefficient_of_variation':
        return {
          id: metric,
          unit: '%' as const,
          value: statistic(statistics.coefficientOfVariationPercent),
        };
      case 'glucose.gmi':
        return {
          id: metric,
          unit: '%' as const,
          value: statistic(statistics.glucoseManagementIndicatorPercent),
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
      case 'glucose.low_readings':
      case 'glucose.high_readings': {
        const threshold = thresholdFor(
          executable.thresholds,
          metric === 'glucose.low_readings' ? 'low' : 'high',
        );
        return {
          id: metric,
          unit: 'readings' as const,
          value: readings.length
            ? samples.filter(({ mmolL }) => matchesThreshold(mmolL, threshold))
                .length
            : null,
        };
      }
    }
  });
  return {
    coveragePercent,
    distribution,
    evidenceRange,
    evidenceReadings,
    metrics,
    observationIntervals: intervals,
    observedMilliseconds,
    range,
    readings,
  };
}

function arithmeticMean(
  readings: readonly GlucoseReading[],
  range: TimeRange,
) {
  const value = calculateGlucoseStatistics({
    readings,
    range,
    observationGapCapMilliseconds: OBSERVATION_GAP_MS,
  }).arithmeticMeanMmolL;
  return value === null ? null : round(value, 2);
}

function queryChartEvents(
  executable: ExecutableRangeIntent,
  calculation: RangeCalculation,
  selectedKind: 'high' | 'low' | null,
): EvidenceQueryEvent[] {
  return executable.metrics
    .filter(
      (metric): metric is Extract<
        SupportedMetric,
        'glucose.low_episodes' | 'glucose.high_episodes'
      > => metric.endsWith('_episodes'),
    )
    .flatMap((metric) => {
      const kind = metric === 'glucose.low_episodes' ? 'low' : 'high';
      if (selectedKind !== null && kind !== selectedKind) return [];
      const threshold = thresholdFor(executable.thresholds, kind);
      return detectGlucoseEpisodes(
        calculation.evidenceReadings,
        kind,
        threshold.value,
      )
        .filter(
          (episode) =>
            episode.start >= calculation.range.start &&
            episode.start < calculation.range.end,
        )
        .map((episode): EvidenceQueryEvent => {
          const exactReadings = episode.readings.filter(
            ({ timestamp }) =>
              timestamp >= calculation.range.start &&
              timestamp < calculation.range.end,
          );
          const recoveryConfirmedInside =
            episode.endStatus === 'confirmed-recovery' &&
            episode.end <= calculation.range.end;
          const lastObservedInside =
            exactReadings.at(-1)?.timestamp ?? episode.start;
          const displayedEnd = recoveryConfirmedInside
            ? episode.end
            : lastObservedInside;
          const continuesBeyondWindow =
            !recoveryConfirmedInside &&
            (episode.end > calculation.range.end ||
              episode.readings.some(
                ({ timestamp }) => timestamp >= calculation.range.end,
              ));
          return {
            id: `${kind}:${threshold.value}:${episode.start}:${displayedEnd}:${
              recoveryConfirmedInside ? 'confirmed' : 'observed'
            }`,
            kind,
            start: episode.start,
            end: displayedEnd,
            endStatus: recoveryConfirmedInside
              ? 'confirmed-recovery'
              : 'observed-through',
            continuesBeyondWindow: recoveryConfirmedInside
              ? false
              : continuesBeyondWindow,
            // Boundary context may classify the event, but cannot supply a
            // plotted extreme or any other displayed chart value.
            extremeMmolL:
              kind === 'high'
                ? Math.max(...exactReadings.map(({ mmolL }) => mmolL))
                : Math.min(...exactReadings.map(({ mmolL }) => mmolL)),
            recordIds: exactReadings.flatMap(({ recordIds }) => recordIds),
          };
        });
    })
    .sort(
      (left, right) =>
        left.start - right.start || left.id.localeCompare(right.id),
    );
}

function queryVisualizationFor(
  executable: ExecutableRangeIntent,
  calculations: readonly LabeledRangeCalculation[],
): EvidenceQueryVisualizationReference | null {
  // The current visualization grammar can prove only one of these exact
  // semantics. Suppress charts for median/min/max/dispersion/GMI/sample-count
  // questions instead of displaying an arithmetic-mean line under another
  // metric's answer.
  if (
    executable.metrics.length !== 1 ||
    ![
      'glucose.mean',
      'glucose.time_in_range',
      'glucose.low_episodes',
      'glucose.high_episodes',
    ].includes(executable.metrics[0]!)
  ) {
    return null;
  }
  const requestedEventMetrics = executable.metrics.filter((metric) =>
    metric.endsWith('_episodes'),
  );
  // The current evidence grammar has one event kind per timeline. Suppressing
  // a compound low+high chart is safer than silently visualising only one
  // claim; the complete exact records remain available in the Records tab.
  if (
    requestedEventMetrics.includes('glucose.low_episodes') &&
    requestedEventMetrics.includes('glucose.high_episodes')
  ) {
    return null;
  }
  const rangeLower = executable.thresholds.find(
    ({ role }) => role === 'range_lower',
  )?.value;
  const rangeUpper = executable.thresholds.find(
    ({ role }) => role === 'range_upper',
  )?.value;
  const targetRange = {
    minimum: rangeLower ?? TARGET_LOW_MMOL_L,
    maximum: rangeUpper ?? TARGET_HIGH_MMOL_L,
  };
  const values = [
    targetRange.minimum,
    targetRange.maximum,
    ...calculations.flatMap(({ value }) =>
      value.readings.map(({ mmolL }) => mmolL),
    ),
  ];
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(0.5, (rawMaximum - rawMinimum) * 0.08);
  const valueDomain = {
    minimum: Math.max(0, Math.floor((rawMinimum - padding) * 10) / 10),
    maximum: Math.ceil((rawMaximum + padding) * 10) / 10,
  };
  if (valueDomain.maximum <= valueDomain.minimum) {
    valueDomain.maximum = valueDomain.minimum + 1;
  }
  const selectedEventMetric = executable.metrics.find(
    (metric): metric is Extract<
      SupportedMetric,
      'glucose.low_episodes' | 'glucose.high_episodes'
    > => metric.endsWith('_episodes'),
  );
  const selectedEventKind = selectedEventMetric
    ? selectedEventMetric === 'glucose.low_episodes'
      ? 'low'
      : 'high'
    : null;
  const windows = calculations.map(({ id, label, value }) => {
    const samples = canonicalGlucoseSamples(value.readings, value.range);
    return {
      id,
      label,
      range: { ...value.range },
      // Source-record count remains auditable while each plotted point is one
      // timestamp-normalised physiological sample retaining every source ID.
      recordCount: value.readings.length,
      coveragePercent: value.coveragePercent,
      coverageStatus:
        value.readings.length === 0
          ? ('unavailable' as const)
          : value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT
            ? ('limited' as const)
            : ('sufficient' as const),
      meanMmolL: arithmeticMean(value.readings, value.range),
      points: samples.map(({ recordIds, mmolL, timestamp }) => ({
        recordIds,
        mmolL,
        timestamp,
      })),
      distribution: value.distribution
        ? { ...value.distribution }
        : null,
      events: queryChartEvents(executable, value, selectedEventKind),
    };
  });
  const common = {
    schemaVersion: 1 as const,
    timezone: 'Europe/London' as const,
    units: 'mmol/L' as const,
    gapThresholdMilliseconds: OBSERVATION_GAP_MS,
    targetRange,
    valueDomain,
    windows,
  };
  if (executable.metrics.includes('glucose.time_in_range')) {
    return {
      ...common,
      kind: 'range-distribution-v1',
      metric: 'glucose.time_in_range',
      title: calculations.length > 1
        ? 'Time in range across the exact comparison periods'
        : 'Time in range for the exact requested period',
      subtitle:
        'Each reading and duration segment is restricted to the exact calculation period; missing sensor time is omitted.',
      lowerBoundMmolL: targetRange.minimum,
      upperBoundMmolL: targetRange.maximum,
    };
  }
  const eventMetric = selectedEventMetric;
  if (eventMetric) {
    const eventKind = eventMetric === 'glucose.low_episodes' ? 'low' : 'high';
    return {
      ...common,
      kind: 'event-timeline-v1',
      metric: eventMetric,
      eventKind,
      thresholdMmolL: thresholdFor(executable.thresholds, eventKind).value,
      title: calculations.length > 1
        ? `${eventKind === 'low' ? 'Low' : 'High'}-glucose events across the exact periods`
        : `${eventKind === 'low' ? 'Low' : 'High'}-glucose events in the exact requested period`,
      subtitle:
        'The trace contains only in-period readings. Boundary context can classify a start or recovery, but never supplies plotted values, extremes, or record IDs.',
    };
  }
  if (calculations.length > 1) {
    return {
      ...common,
      kind: 'period-comparison-v1',
      metric: 'glucose.mean',
      title: 'Glucose across the exact comparison periods',
      subtitle:
        'The periods retain their exact elapsed ranges, readings, coverage and observed arithmetic means.',
    };
  }
  return {
    ...common,
    kind: 'range-trace-v1',
    metric: 'glucose.mean',
    title: 'Glucose readings and observed average',
    subtitle:
      'Timestamp-normalised samples from the exact half-open requested period are shown; any deterministic display compaction is disclosed with the chart. Lines stop across sensor gaps.',
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
      case 'glucose.median':
        return [{
          id: 'median-glucose',
          label: 'Observed median glucose',
          value: metric.value,
          decimals: 1,
          unit: 'mmol/L',
        }];
      case 'glucose.minimum':
        return [{
          id: 'minimum-glucose',
          label: 'Observed minimum glucose',
          value: metric.value,
          decimals: 1,
          unit: 'mmol/L',
        }];
      case 'glucose.maximum':
        return [{
          id: 'maximum-glucose',
          label: 'Observed maximum glucose',
          value: metric.value,
          decimals: 1,
          unit: 'mmol/L',
        }];
      case 'glucose.standard_deviation':
        return [{
          id: 'glucose-standard-deviation',
          label: 'Observed population standard deviation',
          value: metric.value,
          decimals: 1,
          unit: 'mmol/L',
        }];
      case 'glucose.coefficient_of_variation':
        return [{
          id: 'glucose-coefficient-of-variation',
          label: 'Observed glucose coefficient of variation',
          value: metric.value,
          decimals: 1,
          unit: '%',
        }];
      case 'glucose.gmi':
        return [{
          id: 'glucose-management-indicator',
          label: 'Estimated glucose management indicator',
          value: metric.value,
          decimals: 1,
          unit: '%',
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
      case 'glucose.low_readings':
        return [{
          id: 'low-readings',
          label: 'Timestamp-normalised readings below threshold',
          value: metric.value,
          decimals: 0,
        }];
      case 'glucose.high_readings':
        return [{
          id: 'high-readings',
          label: 'Timestamp-normalised readings above threshold',
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
      case 'glucose.median':
        return `the observed median was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.minimum':
        return `the lowest observed timestamp-normalised reading was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.maximum':
        return `the highest observed timestamp-normalised reading was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.standard_deviation':
        return `the observed population standard deviation was ${metric.value.toFixed(1)} mmol/L`;
      case 'glucose.coefficient_of_variation':
        return `the observed coefficient of variation was ${metric.value.toFixed(1)}%`;
      case 'glucose.gmi':
        return `the estimated glucose management indicator was ${metric.value.toFixed(1)}% (derived from mean sensor glucose, not a laboratory HbA1c result)`;
      case 'glucose.time_in_range': {
        const lower = thresholdFor(executable.thresholds, 'range_lower');
        const upper = thresholdFor(executable.thresholds, 'range_upper');
        return `${metric.value.toFixed(1)}% of observed sensor time was within ${lower.value.toFixed(1)}–${upper.value.toFixed(1)} mmol/L`;
      }
      case 'glucose.low_episodes':
        return `${metric.value} sustained low-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
      case 'glucose.high_episodes':
        return `${metric.value} sustained high-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
      case 'glucose.low_readings':
      case 'glucose.high_readings': {
        const kind = metric.id === 'glucose.low_readings' ? 'below' : 'above';
        const threshold = thresholdFor(
          executable.thresholds,
          metric.id === 'glucose.low_readings' ? 'low' : 'high',
        );
        return `${metric.value} timestamp-normalised reading${metric.value === 1 ? ' was' : 's were'} ${kind} ${threshold.value.toFixed(1)} mmol/L`;
      }
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
      metricAlgorithmVersions: executable.metrics.map((metric) => ({
        metric,
        version: metricAlgorithmVersion(metric),
      })),
    })}`;
  const calculationReference: EvidenceCalculationReference = {
    kind: 'tarvis-local-glucose-v1',
    queryId,
    algorithmVersion: [
      LOCAL_RANGE_ANSWER_VERSION,
      ...(executable.metrics.some((metric) =>
        SAMPLE_STATISTIC_METRICS.has(metric),
      )
        ? [
            ...new Set(
              executable.metrics
                .filter((metric) => SAMPLE_STATISTIC_METRICS.has(metric))
                .map(metricAlgorithmVersion),
            ),
          ]
        : []),
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
    label: `${label} exact ${executable.metrics.map(metricTitle).join(' and ').toLocaleLowerCase('en-GB')} inputs`,
    description: `${calculation.readings.length} exact normalised glucose readings inside the requested half-open period.${calculation.evidenceRange.start !== calculation.range.start || calculation.evidenceRange.end !== calculation.range.end ? ' A 15-minute boundary context is retained in immutable answer provenance only to classify sustained event starts; it is excluded from this calculation evidence, All Records, averages, duration, and coverage.' : ''} Every calculation record ID is retained; missing time is not represented as zero.`,
    range: { ...calculation.range },
    recordIds: calculation.readings.map(({ id }) => id),
    examples: representativeReadings(calculation.readings).map((reading) => ({
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
    case 'glucose.high_episodes':
      return 'high-events' as const;
    case 'glucose.low_readings':
    case 'glucose.high_readings':
      return 'glucose-reading-count' as const;
    default:
      return 'glucose-statistic' as const;
  }
}

function answerHeadline(calculation: RangeCalculation) {
  const first = calculation.metrics[0];
  if (!first || first.value === null) return 'Glucose result unavailable';
  if (calculation.metrics.length > 1) return 'Observed glucose results';
  switch (first.id) {
    case 'glucose.mean':
      return `Observed average glucose: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.median':
      return `Observed median glucose: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.minimum':
      return `Observed minimum glucose: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.maximum':
      return `Observed maximum glucose: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.standard_deviation':
      return `Observed glucose standard deviation: ${first.value.toFixed(1)} mmol/L`;
    case 'glucose.coefficient_of_variation':
      return `Observed glucose coefficient of variation: ${first.value.toFixed(1)}%`;
    case 'glucose.gmi':
      return `Estimated glucose management indicator: ${first.value.toFixed(1)}%`;
    case 'glucose.time_in_range':
      return `Observed time in range: ${first.value.toFixed(1)}%`;
    case 'glucose.low_episodes':
      return `Observed low-glucose events: ${first.value}`;
    case 'glucose.high_episodes':
      return `Observed high-glucose events: ${first.value}`;
    case 'glucose.low_readings':
      return `Observed readings below threshold: ${first.value}`;
    case 'glucose.high_readings':
      return `Observed readings above threshold: ${first.value}`;
  }
}

function metricTitle(metric: SupportedMetric) {
  switch (metric) {
    case 'glucose.mean':
      return 'Average glucose';
    case 'glucose.median':
      return 'Median glucose';
    case 'glucose.minimum':
      return 'Minimum glucose';
    case 'glucose.maximum':
      return 'Maximum glucose';
    case 'glucose.standard_deviation':
      return 'Glucose standard deviation';
    case 'glucose.coefficient_of_variation':
      return 'Glucose coefficient of variation';
    case 'glucose.gmi':
      return 'Estimated glucose management indicator';
    case 'glucose.time_in_range':
      return 'Time in range';
    case 'glucose.low_episodes':
      return 'Low-glucose events';
    case 'glucose.high_episodes':
      return 'High-glucose events';
    case 'glucose.low_readings':
      return 'Readings below the low threshold';
    case 'glucose.high_readings':
      return 'Readings above the high threshold';
  }
}

function metricDetail(executable: ExecutableRangeIntent) {
  const metric = executable.metrics[0];
  if (executable.metrics.length > 1) {
    return 'Each requested result is calculated independently from the same timestamp-normalised samples inside the exact half-open period. Missing readings are not estimated.';
  }
  if (metric === 'glucose.time_in_range') {
    return 'Observed duration is carried forward only until the next reading or 12 minutes, whichever comes first. Missing time is excluded.';
  }
  if (metric?.endsWith('_episodes')) {
    return `Events use ${GLUCOSE_EPISODE_DEFINITION_VERSION}: 15 minutes beyond the threshold confirms a start, 15 minutes back across it confirms recovery, and a sensor gap over 12 minutes breaks continuity.`;
  }
  if (metric?.endsWith('_readings')) {
    return 'This counts timestamp-normalised physiological samples, not sustained events. Source records at the same instant are averaged once before the threshold is applied.';
  }
  if (metric === 'glucose.gmi') {
    return `GMI uses ${GMI_FORMULA_VERSION} on the timestamp-normalised arithmetic mean. It is an estimate derived from sensor glucose and is not a laboratory HbA1c result.`;
  }
  if (metric === 'glucose.standard_deviation') {
    return 'Population standard deviation of timestamp-normalised samples inside the exact half-open period. Missing readings are not estimated.';
  }
  if (metric === 'glucose.coefficient_of_variation') {
    return 'Coefficient of variation is the population standard deviation divided by the arithmetic mean for the same timestamp-normalised samples.';
  }
  const name = metric === 'glucose.mean'
    ? 'Arithmetic mean'
    : metric === 'glucose.median'
      ? 'Median'
      : metric === 'glucose.minimum'
        ? 'Minimum'
        : 'Maximum';
  return `${name} of timestamp-normalised samples inside the exact half-open period. Source records at the same instant are averaged once while every source record ID is retained.`;
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
  const calculations: LabeledRangeCalculation[] = [
    {
      id: 'requested-period',
      label: 'Requested period',
      role: 'requested',
      value: calculateRange(executable, canonical, resolved.current, asOf),
    },
    ...(resolved.previous
      ? [{
          id: 'comparison-period',
          label: previousPeriodLabel(resolved.comparisonBasis),
          role: 'comparison' as const,
          value: calculateRange(executable, canonical, resolved.previous, asOf),
        }]
      : []),
  ];
  const visualization = queryVisualizationFor(executable, calculations);
  if (
    visualization !== null &&
    !isEvidenceQueryVisualizationReference(visualization)
  ) {
    return unsupported('The exact-range evidence chart failed validation.');
  }
  const periodEvidence = calculations.map(({ label, value }) =>
    evidenceFor(
      executable,
      value,
      label,
      `${asOf}:${resolved.comparisonBasis ?? 'none'}`,
    ),
  );
  const combinedCalculationIds = new Set(
    calculations.flatMap(({ value }) => value.readings.map(({ id }) => id)),
  );
  const combinedCalculationReadings = canonical.filter(({ id }) =>
    combinedCalculationIds.has(id),
  );
  const combinedChartEvidence: EvidenceReference | null =
    visualization && calculations.length > 1
      ? {
          id: `${periodEvidence[0]!.id}:combined-chart:${visualization.kind}`,
          label: 'Combined exact comparison chart inputs',
          description:
            `${combinedCalculationReadings.length} exact normalised glucose readings across both calculation periods. The chart uses all and only these record IDs; each period's calculation claim remains linked to its separate evidence reference.`,
          range: {
            start: Math.min(...calculations.map(({ value }) => value.range.start)),
            end: Math.max(...calculations.map(({ value }) => value.range.end)),
          },
          recordIds: combinedCalculationReadings.map(({ id }) => id),
          examples: representativeReadings(combinedCalculationReadings).map(
            (reading) => ({
              id: reading.id,
              kind: 'glucose' as const,
              timestamp: reading.timestamp,
              primary: `${reading.mmolL.toFixed(1)} mmol/L`,
              secondary: `${reading.quality} · exact chart record`,
              sourceId: reading.sourceId,
            }),
          ),
          visualization,
        }
      : null;
  const evidence: EvidenceReference[] = [
    ...periodEvidence.map((reference) =>
      visualization && calculations.length === 1
        ? { ...reference, visualization }
        : reference,
    ),
    ...(combinedChartEvidence ? [combinedChartEvidence] : []),
  ];
  const answerBundle = createGlucoseAnswerBundleV2({
    executor: 'exact-range',
    originalIntent: intent,
    normalizedThresholds: executable.thresholds,
    timezone: APP_TIME_ZONE,
    asOf,
    windows: calculations.map(({ id, label, role, value }) => ({
      id,
      label,
      role,
      calculationRange: value.range,
      evidenceContextRange: value.evidenceRange,
      calculationReadings: value.readings,
      contextReadings: value.evidenceReadings.filter(
        ({ timestamp }) =>
          timestamp < value.range.start || timestamp >= value.range.end,
      ),
      observationIntervals: value.observationIntervals,
    })),
    algorithms: {
      answerVersion: LOCAL_RANGE_ANSWER_VERSION,
      coverageVersion: 'forward-observation-capped-at-gap-v1',
      maximumObservedGapMilliseconds: OBSERVATION_GAP_MS,
      observationValuePrecisionDecimals: null,
      metricVersions: executable.metrics.map((metric) => ({
        metric,
        version: metricAlgorithmVersion(metric),
      })),
      episodeDefinitionVersion: executable.metrics.some((metric) =>
        metric.endsWith('_episodes'),
      )
        ? GLUCOSE_EPISODE_DEFINITION_VERSION
        : null,
      chartVersions: visualization ? [visualization.kind] : [],
    },
    claims: calculations.flatMap(({ id, value }, calculationIndex) =>
      value.metrics.map((metric) => ({
        id: `${evidence[calculationIndex]!.id}:claim:${metric.id}`,
        metric: metric.id as SupportedMetric,
        value: metric.value,
        unit: metric.unit,
        windowIds: [id],
      })),
    ),
    charts: visualization
      ? [{
          id: `${
            combinedChartEvidence?.id ?? periodEvidence[0]!.id
          }:chart:${visualization.kind}`,
          kind: visualization.kind,
          sourceReferenceId:
            combinedChartEvidence?.id ?? periodEvidence[0]!.id,
          windowIds: calculations.map(({ id }) => id),
          recordIds: calculations.flatMap(({ value }) =>
            value.readings.map(({ id }) => id),
          ),
        }]
      : [],
  });
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
  const gmiInsufficient =
    executable.metrics.includes('glucose.gmi') &&
    calculations.some(
      ({ value }) =>
        !hasRepresentativeGmiDuration(value.range) ||
        value.coveragePercent < SUFFICIENT_COVERAGE_PERCENT,
    );
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
    ...(executable.metrics.includes('glucose.gmi')
      ? [
          `GMI uses ${GMI_FORMULA_VERSION} and is an estimate derived from mean sensor glucose, not a laboratory HbA1c result. Pregnancy status and individual treatment targets were not inferred.`,
        ]
      : []),
    ...(gmiInsufficient
      ? [
          'GMI confidence is limited because at least one period was shorter than 14 days or had less than 70% observed sensor coverage.',
        ]
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
      confidence: limited || noData || gmiInsufficient ? 'limited' : 'high',
      evidenceIds: evidence.map(({ id }) => id),
      limitations: limitations.slice(0, 5),
    },
    answerBundle,
    evidence,
    presentation: {
      kind,
      title:
        calculations.length > 1
          ? 'Glucose comparison for the exact periods'
          : `${metricTitle(executable.metrics[0]!)} for the exact period`,
      detail: metricDetail(executable),
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
