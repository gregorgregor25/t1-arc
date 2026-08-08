import { APP_TIME_ZONE } from '@/domain/models';

import {
  resolveClockWindowShape,
  resolveMostRecentCompletedRecurringWindows,
  unwrappedClockMinute,
  utcOffsetMinutesAt,
} from './recurringWindows';
import {
  SCOPED_GLUCOSE_SCHEMA_VERSION,
  type ResolvedRecurringWindow,
  type ScopedAggregateChartPoint,
  type ScopedCoverage,
  type ScopedGlucoseChartPoint,
  type ScopedGlucoseChartSegment,
  type ScopedGlucoseEvidenceBundle,
  type ScopedGlucoseEvidenceRecord,
  type ScopedGlucoseQuery,
  type ScopedGlucoseReadingInput,
  type ScopedGlucoseWindowResult,
  type ScopedObservationInterval,
} from './types';

const DEFAULT_BIN_MINUTES = 15;
const DEFAULT_MAXIMUM_OBSERVED_GAP_MINUTES = 12;
const DEFAULT_MINIMUM_AGGREGATE_CONTRIBUTORS = 2;
const PHYSIOLOGICAL_SAMPLE_NORMALIZATION_VERSION =
  'same-timestamp-records-averaged-v1' as const;

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function assertQuery(query: ScopedGlucoseQuery) {
  if (query.timezone !== APP_TIME_ZONE) {
    throw new RangeError(`Unsupported timezone: ${query.timezone}.`);
  }
  if (!Number.isFinite(query.asOf) || query.asOf < 0) {
    throw new RangeError('asOf must be a finite non-negative timestamp.');
  }
  if (
    !Number.isInteger(query.windowCount) ||
    query.windowCount < 1 ||
    query.windowCount > 366
  ) {
    throw new RangeError('windowCount must be an integer between 1 and 366.');
  }
  resolveClockWindowShape(query.clockWindow);
}

function normalizedOptions(query: ScopedGlucoseQuery) {
  const binMinutes = query.binMinutes ?? DEFAULT_BIN_MINUTES;
  if (
    !Number.isInteger(binMinutes) ||
    binMinutes < 5 ||
    binMinutes > 60 ||
    1440 % binMinutes !== 0
  ) {
    throw new RangeError(
      'binMinutes must be an integer from 5 to 60 that divides a local day.',
    );
  }
  const maximumObservedGapMinutes =
    query.maximumObservedGapMinutes ??
    DEFAULT_MAXIMUM_OBSERVED_GAP_MINUTES;
  if (
    !Number.isFinite(maximumObservedGapMinutes) ||
    maximumObservedGapMinutes <= 0 ||
    maximumObservedGapMinutes > 120
  ) {
    throw new RangeError(
      'maximumObservedGapMinutes must be greater than zero and no more than 120.',
    );
  }
  const minimumAggregateContributors =
    query.minimumAggregateContributors ??
    Math.min(DEFAULT_MINIMUM_AGGREGATE_CONTRIBUTORS, query.windowCount);
  if (
    !Number.isInteger(minimumAggregateContributors) ||
    minimumAggregateContributors < 1 ||
    minimumAggregateContributors > query.windowCount
  ) {
    throw new RangeError(
      'minimumAggregateContributors must be between 1 and windowCount.',
    );
  }
  return {
    binMinutes,
    maximumObservedGapMinutes,
    minimumAggregateContributors,
  };
}

function assertReadings(readings: readonly ScopedGlucoseReadingInput[]) {
  const ids = new Set<string>();
  readings.forEach((reading, index) => {
    if (!reading.id.trim()) {
      throw new TypeError(`readings[${index}].id must not be empty.`);
    }
    if (ids.has(reading.id)) {
      throw new TypeError(`Duplicate glucose record ID: ${reading.id}.`);
    }
    ids.add(reading.id);
    if (!Number.isFinite(reading.timestamp) || reading.timestamp < 0) {
      throw new TypeError(
        `readings[${index}].timestamp must be a finite non-negative number.`,
      );
    }
    if (!Number.isFinite(reading.mmolL) || reading.mmolL <= 0) {
      throw new TypeError(
        `readings[${index}].mmolL must be a finite positive number.`,
      );
    }
    if (!reading.sourceId.trim()) {
      throw new TypeError(`readings[${index}].sourceId must not be empty.`);
    }
  });
}

function sortReadings(
  readings: readonly ScopedGlucoseReadingInput[],
): ScopedGlucoseReadingInput[] {
  return [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
}

function mean(values: readonly number[]) {
  if (!values.length) return null;
  return round(
    values.reduce((total, value) => total + value, 0) / values.length,
    2,
  );
}

function physiologicalSampleMean(
  readings: readonly ScopedGlucoseReadingInput[],
) {
  return mean(
    groupReadingsAtTimestamp(readings).map(({ mmolL }) => mmolL),
  );
}

function coverage(
  range: ResolvedRecurringWindow['range'],
  intervals: readonly ScopedObservationInterval[],
): ScopedCoverage {
  const expectedMilliseconds = range.end - range.start;
  const observedMilliseconds = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  if (observedMilliseconds > expectedMilliseconds) {
    throw new Error('Observed glucose coverage exceeded the resolved scope.');
  }
  const roundedPercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;
  return {
    expectedMilliseconds,
    observedMilliseconds,
    expectedMinutes: round(expectedMilliseconds / 60_000, 2),
    observedMinutes: round(observedMilliseconds / 60_000, 2),
    percent:
      observedMilliseconds > 0 && roundedPercent === 0 ? 0.1 : roundedPercent,
  };
}

function groupReadingsAtTimestamp(
  readings: readonly ScopedGlucoseReadingInput[],
) {
  const groups: Array<{
    timestamp: number;
    mmolL: number;
    recordIds: string[];
  }> = [];
  readings.forEach((reading) => {
    const previous = groups.at(-1);
    if (previous?.timestamp === reading.timestamp) {
      const previousCount = previous.recordIds.length;
      previous.mmolL =
        (previous.mmolL * previousCount + reading.mmolL) / (previousCount + 1);
      previous.recordIds.push(reading.id);
      return;
    }
    groups.push({
      timestamp: reading.timestamp,
      mmolL: reading.mmolL,
      recordIds: [reading.id],
    });
  });
  return groups;
}

function observationIntervals(
  readings: readonly ScopedGlucoseReadingInput[],
  range: ResolvedRecurringWindow['range'],
  maximumObservedGapMilliseconds: number,
): ScopedObservationInterval[] {
  const groups = groupReadingsAtTimestamp(readings);
  return groups.flatMap((group, index) => {
    const next = groups[index + 1];
    const end = Math.min(
      range.end,
      next?.timestamp ?? range.end,
      group.timestamp + maximumObservedGapMilliseconds,
    );
    return end > group.timestamp
      ? [
          {
            start: group.timestamp,
            end,
            mmolL: round(group.mmolL, 2),
            recordIds: [...group.recordIds],
          },
        ]
      : [];
  });
}

function pointForBin(
  readings: readonly ScopedGlucoseReadingInput[],
  binStartMinute: number,
  binMinutes: number,
  clockOccurrence: number,
  windowStart: number,
): ScopedGlucoseChartPoint {
  const recordIds = readings.map((reading) => reading.id);
  const samples = groupReadingsAtTimestamp(readings);
  return {
    clockBinKey: `${binStartMinute}:occurrence:${clockOccurrence}`,
    minute: binStartMinute + binMinutes / 2,
    binStartMinute,
    binEndMinute: binStartMinute + binMinutes,
    mmolL: mean(samples.map(({ mmolL }) => mmolL))!,
    readingCount: readings.length,
    recordIds,
    clockOccurrence,
    utcOffsetMinutes: utcOffsetMinutesAt(readings[0]!.timestamp),
    elapsedMinute: round(
      samples.reduce(
        (total, sample) => total + (sample.timestamp - windowStart) / 60_000,
        0,
      ) / samples.length,
      2,
    ),
  };
}

function clockOccurrence(
  timestamp: number,
  minute: number,
  window: ResolvedRecurringWindow,
) {
  const fold = window.clockTransitions.find(
    (transition) =>
      transition.kind === 'fold' &&
      timestamp >= transition.atTimestamp &&
      minute >= transition.affectedStartMinute &&
      minute < transition.affectedEndMinute,
  );
  return fold ? 2 : 1;
}

function binReadings(
  readings: readonly ScopedGlucoseReadingInput[],
  window: ResolvedRecurringWindow,
  crossesMidnight: boolean,
  domainStartMinute: number,
  domainEndMinute: number,
  binMinutes: number,
) {
  const buckets = new Map<
    string,
    {
      binStart: number;
      occurrence: number;
      readings: ScopedGlucoseReadingInput[];
    }
  >();
  readings.forEach((reading) => {
    const minute = unwrappedClockMinute(
      reading.timestamp,
      window.anchorDate,
      crossesMidnight,
    );
    const binStart =
      domainStartMinute +
      Math.floor((minute - domainStartMinute) / binMinutes) * binMinutes;
    if (binStart < domainStartMinute || binStart >= domainEndMinute) {
      throw new Error(
        `Scoped record ${reading.id} could not be placed in the resolved clock domain.`,
      );
    }
    const occurrence = clockOccurrence(reading.timestamp, minute, window);
    const key = `${binStart}:occurrence:${occurrence}`;
    const bucket = buckets.get(key) ?? {
      binStart,
      occurrence,
      readings: [],
    };
    bucket.readings.push(reading);
    buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .sort(
      (left, right) =>
        left.readings[0]!.timestamp - right.readings[0]!.timestamp ||
        left.binStart - right.binStart ||
        left.occurrence - right.occurrence,
    )
    .map((bucket) =>
      pointForBin(
        bucket.readings,
        bucket.binStart,
        binMinutes,
        bucket.occurrence,
        window.range.start,
      ),
    );
}

function continuityGroups(
  readings: readonly ScopedGlucoseReadingInput[],
  maximumObservedGapMilliseconds: number,
  window: ResolvedRecurringWindow,
) {
  const groups: Array<{
    readings: ScopedGlucoseReadingInput[];
    startsAfter: ScopedGlucoseChartSegment['startsAfter'];
  }> = [];
  readings.forEach((reading) => {
    const group = groups.at(-1);
    const previous = group?.readings.at(-1);
    const transition = previous
      ? window.clockTransitions.find(
          (candidate) =>
            candidate.atTimestamp > previous.timestamp &&
            candidate.atTimestamp <= reading.timestamp,
        )
      : undefined;
    const sensorGap = previous
      ? reading.timestamp - previous.timestamp > maximumObservedGapMilliseconds
      : false;
    if (
      !group ||
      !previous ||
      sensorGap ||
      transition
    ) {
      groups.push({
        readings: [reading],
        startsAfter: {
          sensorGap,
          clockTransition: transition?.kind ?? null,
        },
      });
    } else {
      group.readings.push(reading);
    }
  });
  return groups;
}

function chartSegments(
  readings: readonly ScopedGlucoseReadingInput[],
  window: ResolvedRecurringWindow,
  crossesMidnight: boolean,
  domainStartMinute: number,
  domainEndMinute: number,
  binMinutes: number,
  maximumObservedGapMilliseconds: number,
): ScopedGlucoseChartSegment[] {
  return continuityGroups(
    readings,
    maximumObservedGapMilliseconds,
    window,
  ).map(
    (group, index) => ({
      id: `${window.id}:segment:${index}`,
      startsAfter: group.startsAfter,
      points: binReadings(
        group.readings,
        window,
        crossesMidnight,
        domainStartMinute,
        domainEndMinute,
        binMinutes,
      ),
    }),
  );
}

function resultForWindow(
  window: ResolvedRecurringWindow,
  readings: readonly ScopedGlucoseReadingInput[],
  shape: ReturnType<typeof resolveClockWindowShape>,
  binMinutes: number,
  maximumObservedGapMilliseconds: number,
): ScopedGlucoseWindowResult {
  const intervals = observationIntervals(
    readings,
    window.range,
    maximumObservedGapMilliseconds,
  );
  const windowCoverage = coverage(window.range, intervals);
  const status =
    readings.length === 0
      ? 'missing'
      : windowCoverage.observedMilliseconds ===
          windowCoverage.expectedMilliseconds
        ? 'complete'
        : 'partial';
  return {
    ...window,
    status,
    readingCount: readings.length,
    observedMeanMmolL: physiologicalSampleMean(readings),
    recordIds: readings.map((reading) => reading.id),
    coverage: windowCoverage,
    observationIntervals: intervals,
    points: binReadings(
      readings,
      window,
      shape.crossesMidnight,
      shape.startMinute,
      shape.endMinuteUnwrapped,
      binMinutes,
    ),
    segments: chartSegments(
      readings,
      window,
      shape.crossesMidnight,
      shape.startMinute,
      shape.endMinuteUnwrapped,
      binMinutes,
      maximumObservedGapMilliseconds,
    ),
  };
}

function aggregatePoints(
  windows: readonly ScopedGlucoseWindowResult[],
  minimumContributors: number,
): ScopedAggregateChartPoint[] {
  const bins = new Map<
    string,
    Array<{ windowId: string; point: ScopedGlucoseChartPoint }>
  >();
  windows.forEach((window) => {
    window.points.forEach((point) => {
      const bucket = bins.get(point.clockBinKey) ?? [];
      bucket.push({ windowId: window.id, point });
      bins.set(point.clockBinKey, bucket);
    });
  });
  return [...bins.entries()]
    .sort(([, left], [, right]) => {
      const leftPoint = left[0]!.point;
      const rightPoint = right[0]!.point;
      return (
        leftPoint.binStartMinute - rightPoint.binStartMinute ||
        leftPoint.clockOccurrence - rightPoint.clockOccurrence
      );
    })
    .flatMap(([clockBinKey, contributors]) => {
      if (contributors.length < minimumContributors) return [];
      const first = contributors[0]!.point;
      const recordIds = contributors.flatMap(({ point }) => point.recordIds);
      return [
        {
          clockBinKey,
          minute: first.minute,
          binStartMinute: first.binStartMinute,
          binEndMinute: first.binEndMinute,
          // Each represented window contributes equally, regardless of how
          // many source readings happened to land in its bin.
          mmolL: mean(contributors.map(({ point }) => point.mmolL))!,
          contributingWindowCount: contributors.length,
          contributingWindowIds: contributors.map(({ windowId }) => windowId),
          recordIds,
          clockOccurrence: first.clockOccurrence,
        },
      ];
    });
}

function combineCoverage(windows: readonly ScopedGlucoseWindowResult[]) {
  const expectedMilliseconds = windows.reduce(
    (total, window) => total + window.coverage.expectedMilliseconds,
    0,
  );
  const observedMilliseconds = windows.reduce(
    (total, window) => total + window.coverage.observedMilliseconds,
    0,
  );
  const roundedPercent =
    expectedMilliseconds > 0
      ? round((observedMilliseconds / expectedMilliseconds) * 100, 1)
      : 0;
  return {
    expectedMilliseconds,
    observedMilliseconds,
    expectedMinutes: round(expectedMilliseconds / 60_000, 2),
    observedMinutes: round(observedMilliseconds / 60_000, 2),
    percent:
      observedMilliseconds > 0 && roundedPercent === 0 ? 0.1 : roundedPercent,
  } satisfies ScopedCoverage;
}

function deterministicQueryId(
  query: ScopedGlucoseQuery,
  shape: ReturnType<typeof resolveClockWindowShape>,
  options: ReturnType<typeof normalizedOptions>,
) {
  return `scoped-glucose-v${SCOPED_GLUCOSE_SCHEMA_VERSION}:${JSON.stringify({
    timezone: query.timezone,
    asOf: query.asOf,
    windowCount: query.windowCount,
    startMinute: shape.startMinute,
    endMinuteUnwrapped: shape.endMinuteUnwrapped,
    crossesMidnight: shape.crossesMidnight,
    binMinutes: options.binMinutes,
    maximumObservedGapMinutes: options.maximumObservedGapMinutes,
    minimumAggregateContributors: options.minimumAggregateContributors,
    sampleNormalization: PHYSIOLOGICAL_SAMPLE_NORMALIZATION_VERSION,
  })}`;
}

/**
 * Executes an observed-mean glucose query over exact, completed local-clock
 * windows. It never estimates missing values or asks a model to perform maths.
 */
export function executeScopedGlucoseQuery(
  query: ScopedGlucoseQuery,
  readings: readonly ScopedGlucoseReadingInput[],
): ScopedGlucoseEvidenceBundle {
  assertQuery(query);
  assertReadings(readings);
  const options = normalizedOptions(query);
  const shape = resolveClockWindowShape(query.clockWindow);
  const intervals = resolveMostRecentCompletedRecurringWindows({
    timezone: query.timezone,
    asOf: query.asOf,
    count: query.windowCount,
    clockWindow: query.clockWindow,
  });
  const sorted = sortReadings(readings);
  const maximumObservedGapMilliseconds =
    options.maximumObservedGapMinutes * 60_000;
  const windows = intervals.map((window) => {
    const scoped = sorted.filter(
      (reading) =>
        reading.timestamp >= window.range.start &&
        reading.timestamp < window.range.end,
    );
    return resultForWindow(
      window,
      scoped,
      shape,
      options.binMinutes,
      maximumObservedGapMilliseconds,
    );
  });
  const scopedRecords: ScopedGlucoseEvidenceRecord[] = windows.flatMap(
    (window) => {
      const ids = new Set(window.recordIds);
      return sorted
        .filter((reading) => ids.has(reading.id))
        .map((reading) => ({
          id: reading.id,
          timestamp: reading.timestamp,
          mmolL: reading.mmolL,
          sourceId: reading.sourceId,
          windowId: window.id,
          minute: round(
            unwrappedClockMinute(
              reading.timestamp,
              window.anchorDate,
              shape.crossesMidnight,
            ),
            4,
          ),
        }));
    },
  );
  const recordIds = scopedRecords.map((record) => record.id);
  const missingWindows = intervals.filter((_, index) =>
    windows[index]?.status === 'missing',
  );
  const queryId =
    query.queryId?.trim() || deterministicQueryId(query, shape, options);
  const combined = combineCoverage(windows);
  const chartAggregatePoints = aggregatePoints(
    windows,
    options.minimumAggregateContributors,
  );

  const bundle: ScopedGlucoseEvidenceBundle = {
    schemaVersion: SCOPED_GLUCOSE_SCHEMA_VERSION,
    kind: 'scoped-glucose-recurring-window',
    queryId,
    generatedAt: query.asOf,
    timezone: query.timezone,
    units: { glucose: 'mmol/L', duration: 'minutes' },
    resolvedScope: {
      kind: 'most-recent-completed-recurring-clock-windows',
      asOf: query.asOf,
      windowCount: query.windowCount,
      clockWindow: {
        start: { ...query.clockWindow.start },
        end: { ...query.clockWindow.end },
        crossesMidnight: shape.crossesMidnight,
      },
      intervals: intervals.map((interval) => ({ ...interval })),
    },
    calculation: {
      metric: 'observed-arithmetic-mean-glucose',
      precisionDecimals: 2,
      sampleNormalization: PHYSIOLOGICAL_SAMPLE_NORMALIZATION_VERSION,
      coverageModel: 'forward-observation-capped-at-gap',
      maximumObservedGapMinutes: options.maximumObservedGapMinutes,
      halfOpenIntervals: true,
    },
    result: {
      observedMeanMmolL: physiologicalSampleMean(scopedRecords),
      readingCount: scopedRecords.length,
      requestedWindowCount: query.windowCount,
      windowsWithData: windows.filter((window) => window.readingCount > 0)
        .length,
      missingWindowCount: missingWindows.length,
      recordIds,
      coverage: combined,
    },
    windows,
    evidence: {
      records: scopedRecords,
      recordIds,
      missingWindows,
    },
    chart: {
      kind: 'recurring-clock-overlay-v1',
      units: 'mmol/L',
      domain: {
        startMinute: shape.startMinute,
        endMinuteUnwrapped: shape.endMinuteUnwrapped,
        binMinutes: options.binMinutes,
      },
      minimumAggregateContributors:
        options.minimumAggregateContributors,
      windows: windows.map((window) => ({
        id: window.id,
        label: window.label,
        anchorDate: window.anchorDate,
        status: window.status,
        range: { ...window.range },
        coverage: { ...window.coverage },
        clockTransitions: window.clockTransitions.map((transition) => ({
          ...transition,
        })),
        points: window.points,
        segments: window.segments,
      })),
      aggregatePoints: chartAggregatePoints,
      missingWindowIds: missingWindows.map((window) => window.id),
    },
    safeguards: {
      outOfScopeReadingsExcluded: true,
      missingValues: 'omitted-not-zero',
      lineGaps: 'pre-segmented-never-bridged',
      aggregateRequiresDistinctWindows: true,
      clockChanges: 'annotated-not-sensor-missingness',
      repeatedClockBins: 'preserved-by-occurrence',
    },
  };

  assertScopedGlucoseBundle(bundle);
  return bundle;
}

/** Runtime invariants protect integration code from displaying mismatched evidence. */
export function assertScopedGlucoseBundle(
  bundle: ScopedGlucoseEvidenceBundle,
) {
  const evidenceIds = new Set(bundle.evidence.recordIds);
  if (evidenceIds.size !== bundle.evidence.recordIds.length) {
    throw new Error('Scoped glucose evidence contains duplicate record IDs.');
  }
  if (bundle.result.readingCount !== bundle.evidence.records.length) {
    throw new Error('Scoped glucose reading count does not match its evidence.');
  }
  bundle.evidence.records.forEach((record) => {
    const window = bundle.windows.find((item) => item.id === record.windowId);
    if (
      !window ||
      record.timestamp < window.range.start ||
      record.timestamp >= window.range.end
    ) {
      throw new Error(`Evidence record ${record.id} is outside its resolved scope.`);
    }
  });
  bundle.chart.aggregatePoints.forEach((point) => {
    if (
      point.contributingWindowCount <
      bundle.chart.minimumAggregateContributors
    ) {
      throw new Error('An aggregate point has too few contributing windows.');
    }
    if (
      new Set(point.contributingWindowIds).size !==
      point.contributingWindowCount
    ) {
      throw new Error(
        'An aggregate point contains duplicate contributing windows.',
      );
    }
    point.recordIds.forEach((id) => {
      if (!evidenceIds.has(id)) {
        throw new Error(`Aggregate chart record ${id} is not calculation evidence.`);
      }
    });
  });
  bundle.windows.forEach((window) => {
    window.recordIds.forEach((id) => {
      if (!evidenceIds.has(id)) {
        throw new Error(`Window record ${id} is not calculation evidence.`);
      }
    });
    window.segments.flatMap((segment) => segment.points).forEach((point) => {
      point.recordIds.forEach((id) => {
        if (!evidenceIds.has(id)) {
          throw new Error(`Chart record ${id} is not calculation evidence.`);
        }
      });
    });
  });
}
