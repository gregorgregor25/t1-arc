export type EvidenceQueryMetric =
  | 'glucose.mean'
  | 'glucose.time_in_range'
  | 'glucose.low_episodes'
  | 'glucose.high_episodes';

const SUFFICIENT_COVERAGE_PERCENT = 70;

export interface EvidenceQueryRange {
  /** Inclusive start and exclusive end of the calculation scope. */
  start: number;
  end: number;
}

interface EvidenceQueryChartPointBase {
  mmolL: number;
  /**
   * Retained by deterministic display compaction so renderers never bridge an
   * original sensor gap merely because intermediate vertices were omitted.
   */
  segmentId?: string;
  timestamp: number;
}

/**
 * `recordId` is retained for already-saved v1 answers. New calculations use
 * `recordIds` so duplicate sources at one instant form one physiological
 * sample without losing any exact source provenance.
 */
export type EvidenceQueryChartPoint = EvidenceQueryChartPointBase &
  (
    | { recordId: string; recordIds?: never }
    | { recordId?: never; recordIds: string[] }
  );

export interface EvidenceQueryChartSampling {
  kind: 'deterministic-time-bucket-envelope-v1';
  /** Exact source-record count represented by this window. */
  sourceRecordCount: number;
  /** Timestamp-normalised physiological samples before display compaction. */
  sourceSampleCount: number;
  /** Number of SVG/display vertices retained after deterministic compaction. */
  displayedPointCount: number;
  /** Per-window target used by the compactor. */
  maximumDisplayedPoints: number;
  /** Exact count before compaction; used for accessibility and gap disclosure. */
  sourceGapCount: number;
}

export interface EvidenceQueryDistribution {
  abovePercent: number | null;
  belowPercent: number | null;
  inRangePercent: number | null;
}

export interface EvidenceQueryEvent {
  /**
   * Absent only on already-persisted v1 payloads. New events distinguish a
   * confirmed recovery boundary from the last qualifying sample observed.
   */
  endStatus?: 'confirmed-recovery' | 'observed-through';
  end: number;
  extremeMmolL: number;
  id: string;
  kind: 'high' | 'low';
  recordIds: string[];
  start: number;
  /** Whether classification context indicates the event may cross the scope. */
  continuesBeyondWindow?: boolean;
}

export interface EvidenceQueryChartWindow {
  coveragePercent: number;
  coverageStatus: 'sufficient' | 'limited' | 'unavailable';
  distribution: EvidenceQueryDistribution | null;
  events: EvidenceQueryEvent[];
  id: string;
  label: string;
  meanMmolL: number | null;
  /** All and only readings inside `range`; never boundary-context readings. */
  points: EvidenceQueryChartPoint[];
  range: EvidenceQueryRange;
  /** Present only when `points` is a disclosed display sample. */
  sampling?: EvidenceQueryChartSampling;
  recordCount: number;
}

/** A bounded SVG path remains responsive on mid-range phones. */
export const MAX_EVIDENCE_QUERY_CHART_POINTS = 2_400;

interface EvidenceQueryVisualizationBase {
  gapThresholdMilliseconds: number;
  schemaVersion: 1;
  subtitle: string;
  targetRange: {
    maximum: number;
    minimum: number;
  };
  timezone: 'Europe/London';
  title: string;
  units: 'mmol/L';
  /** Persisted y-axis domain. Renderers must not recalculate it from loaded data. */
  valueDomain: {
    maximum: number;
    minimum: number;
  };
  windows: EvidenceQueryChartWindow[];
}

export interface EvidenceRangeTraceVisualization
  extends EvidenceQueryVisualizationBase {
  kind: 'range-trace-v1';
  metric: 'glucose.mean';
}

export interface EvidencePeriodComparisonVisualization
  extends EvidenceQueryVisualizationBase {
  kind: 'period-comparison-v1';
  metric: 'glucose.mean';
}

export interface EvidenceRangeDistributionVisualization
  extends EvidenceQueryVisualizationBase {
  kind: 'range-distribution-v1';
  lowerBoundMmolL: number;
  metric: 'glucose.time_in_range';
  upperBoundMmolL: number;
}

export interface EvidenceEventTimelineVisualization
  extends EvidenceQueryVisualizationBase {
  eventKind: 'high' | 'low';
  kind: 'event-timeline-v1';
  metric: 'glucose.high_episodes' | 'glucose.low_episodes';
  thresholdMmolL: number;
}

/**
 * Finite, versioned chart grammar for exact non-recurring glucose answers.
 * The calculation writes this object once; the evidence inspector only renders
 * it, so a sparse or partially restored local database cannot move an axis.
 */
export type EvidenceQueryVisualizationReference =
  | EvidenceRangeTraceVisualization
  | EvidencePeriodComparisonVisualization
  | EvidenceRangeDistributionVisualization
  | EvidenceEventTimelineVisualization;

export interface EvidenceQueryTimestampedPoint {
  mmolL: number;
  segmentId?: string;
  timestamp: number;
}

export function isValidEvidenceQueryRange(
  range: EvidenceQueryRange,
): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.end > range.start
  );
}

export function projectEvidenceQueryTimestamp(
  timestamp: number,
  range: EvidenceQueryRange,
  width: number,
) {
  if (!isValidEvidenceQueryRange(range)) {
    throw new RangeError('Evidence chart range must have a finite positive duration.');
  }
  return ((timestamp - range.start) / (range.end - range.start)) * width;
}

export function buildEvidenceQueryTimeTicks(
  range: EvidenceQueryRange,
  desiredCount = 5,
) {
  if (!isValidEvidenceQueryRange(range)) return [];
  const count = Math.max(2, Math.floor(desiredCount));
  return Array.from(
    { length: count },
    (_, index) =>
      range.start + ((range.end - range.start) * index) / (count - 1),
  );
}

export function segmentEvidenceQueryPoints<T extends EvidenceQueryTimestampedPoint>(
  points: readonly T[],
  range: EvidenceQueryRange,
  gapThresholdMilliseconds: number,
): T[][] {
  if (!isValidEvidenceQueryRange(range)) return [];
  const threshold = Math.max(1, gapThresholdMilliseconds);
  const scoped = [...points]
    .filter(
      ({ mmolL, timestamp }) =>
        Number.isFinite(timestamp) &&
        Number.isFinite(mmolL) &&
        timestamp >= range.start &&
        timestamp < range.end,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  return scoped.reduce<T[][]>((segments, point) => {
    const active = segments.at(-1);
    const previous = active?.at(-1);
    const explicitSegmentBoundary =
      previous?.segmentId !== undefined || point.segmentId !== undefined
        ? previous?.segmentId !== point.segmentId
        : point.timestamp - (previous?.timestamp ?? point.timestamp) > threshold;
    if (!active || !previous || explicitSegmentBoundary) {
      segments.push([point]);
    } else {
      active.push(point);
    }
    return segments;
  }, []);
}

export function evidenceQueryChartPointRecordIds(
  point: Pick<EvidenceQueryChartPoint, 'recordId' | 'recordIds'>,
) {
  return point.recordIds ?? (point.recordId ? [point.recordId] : []);
}

function chartPointSort(
  left: EvidenceQueryChartPoint,
  right: EvidenceQueryChartPoint,
) {
  return (
    left.timestamp - right.timestamp ||
    evidenceQueryChartPointRecordIds(left)
      .join('\u0000')
      .localeCompare(evidenceQueryChartPointRecordIds(right).join('\u0000'))
  );
}

function pointKey(point: EvidenceQueryChartPoint) {
  return `${point.timestamp}:${evidenceQueryChartPointRecordIds(point).join('\u0000')}`;
}

function pointIdsOverlap(point: EvidenceQueryChartPoint, ids: Set<string>) {
  return evidenceQueryChartPointRecordIds(point).some((id) => ids.has(id));
}

function allocatedPointBudgets(counts: readonly number[], maximum: number) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= maximum) return [...counts];
  const budgets = counts.map((count) =>
    count === 0
      ? 0
      : Math.min(count, Math.max(1, Math.floor((maximum * count) / total))),
  );
  let allocated = budgets.reduce((sum, count) => sum + count, 0);
  while (allocated < maximum) {
    const candidate = counts
      .map((count, index) => ({
        index,
        remaining: count - budgets[index]!,
      }))
      .filter(({ remaining }) => remaining > 0)
      .sort(
        (left, right) =>
          right.remaining - left.remaining || left.index - right.index,
      )[0];
    if (!candidate) break;
    budgets[candidate.index]! += 1;
    allocated += 1;
  }
  while (allocated > maximum) {
    const candidate = budgets
      .map((count, index) => ({ index, count }))
      .filter(({ count }) => count > 1)
      .sort(
        (left, right) =>
          right.count - left.count || right.index - left.index,
      )[0];
    if (!candidate) break;
    budgets[candidate.index]! -= 1;
    allocated -= 1;
  }
  return budgets;
}

function compactWindowPoints(
  window: EvidenceQueryChartWindow,
  maximumDisplayedPoints: number,
  gapThresholdMilliseconds: number,
): EvidenceQueryChartWindow {
  if (
    window.points.length <= maximumDisplayedPoints ||
    window.sampling
  ) {
    return window;
  }
  const sorted = [...window.points].sort(chartPointSort);
  let segmentIndex = 0;
  const segmented = sorted.map((point, index) => {
    if (
      index > 0 &&
      point.timestamp - sorted[index - 1]!.timestamp >
        gapThresholdMilliseconds
    ) {
      segmentIndex += 1;
    }
    return {
      ...point,
      segmentId: `source-segment-${segmentIndex}`,
    } satisfies EvidenceQueryChartPoint;
  });
  const selected = new Map<string, EvidenceQueryChartPoint>();
  const include = (point: EvidenceQueryChartPoint | undefined) => {
    if (point) selected.set(pointKey(point), point);
  };
  const includeIfSpace = (point: EvidenceQueryChartPoint | undefined) => {
    if (
      point &&
      (selected.has(pointKey(point)) || selected.size < maximumDisplayedPoints)
    ) {
      include(point);
    }
  };

  // Event spans are already exact metadata. Retain their nearest start/end
  // samples and the sample carrying the stated extreme so compaction cannot
  // visually detach an episode from its evidence.
  const eventPoints = [...window.events]
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
    .map((event) => {
      const eventIds = new Set(event.recordIds);
      const points = segmented.filter((point) =>
        pointIdsOverlap(point, eventIds),
      );
      const extreme = [...points].sort((left, right) => {
          const leftDistance = Math.abs(left.mmolL - event.extremeMmolL);
          const rightDistance = Math.abs(right.mmolL - event.extremeMmolL);
          return leftDistance - rightDistance || chartPointSort(left, right);
        })[0];
      return { extreme, points };
    });
  eventPoints.forEach(({ extreme }) => include(extreme));
  includeIfSpace(segmented[0]);
  includeIfSpace(segmented.at(-1));
  eventPoints.forEach(({ points }) => {
    includeIfSpace(points[0]);
    includeIfSpace(points.at(-1));
  });

  const remaining = Math.max(0, maximumDisplayedPoints - selected.size);
  const bucketCount = Math.floor(remaining / 4);
  if (bucketCount > 0) {
    const buckets = Array.from(
      { length: bucketCount },
      () => [] as EvidenceQueryChartPoint[],
    );
    const duration = window.range.end - window.range.start;
    segmented.forEach((point) => {
      const index = Math.min(
        bucketCount - 1,
        Math.max(
          0,
          Math.floor(
            ((point.timestamp - window.range.start) / duration) * bucketCount,
          ),
        ),
      );
      buckets[index]!.push(point);
    });
    buckets.forEach((bucket) => {
      if (!bucket.length) return;
      include(bucket[0]);
      include(bucket.at(-1));
      include(
        [...bucket].sort(
          (left, right) =>
            left.mmolL - right.mmolL || chartPointSort(left, right),
        )[0],
      );
      include(
        [...bucket].sort(
          (left, right) =>
            right.mmolL - left.mmolL || chartPointSort(left, right),
        )[0],
      );
    });
  }

  if (selected.size < maximumDisplayedPoints) {
    const candidates = segmented.filter((point) => !selected.has(pointKey(point)));
    const needed = maximumDisplayedPoints - selected.size;
    const denominator = Math.max(1, needed - 1);
    for (let index = 0; index < needed && candidates.length; index += 1) {
      include(
        candidates[Math.round((index * (candidates.length - 1)) / denominator)],
      );
    }
  }
  const points = [...selected.values()]
    .sort(chartPointSort)
    .slice(0, maximumDisplayedPoints);
  return {
    ...window,
    points,
    sampling: {
      kind: 'deterministic-time-bucket-envelope-v1',
      sourceRecordCount: window.recordCount,
      sourceSampleCount: window.points.length,
      displayedPointCount: points.length,
      maximumDisplayedPoints,
      sourceGapCount: Math.max(0, segmentIndex),
    },
  };
}

/**
 * Bounds the first render as well as stored replay. Exact IDs remain on the
 * EvidenceReference and immutable answer bundle; only SVG vertices are
 * compacted.
 */
export function compactEvidenceQueryVisualization(
  visualization: EvidenceQueryVisualizationReference,
  maximumPoints = MAX_EVIDENCE_QUERY_CHART_POINTS,
): EvidenceQueryVisualizationReference | null {
  const maximum = Math.max(16, Math.floor(maximumPoints));
  const counts = visualization.windows.map(({ points }) => points.length);
  if (
    counts.reduce((sum, count) => sum + count, 0) <= maximum ||
    visualization.windows.every(({ sampling }) => sampling !== undefined)
  ) {
    return visualization;
  }
  const budgets = allocatedPointBudgets(counts, maximum);
  if (
    visualization.kind === 'event-timeline-v1' &&
    visualization.windows.some(
      (window, index) => window.events.length > budgets[index]!,
    )
  ) {
    // Each event must retain at least its extreme source sample. Suppressing an
    // impossibly dense chart is safer than silently detaching event metadata
    // from its evidence or handing an unbounded SVG path to the phone.
    return null;
  }
  return {
    ...visualization,
    windows: visualization.windows.map((window, index) =>
      compactWindowPoints(
        window,
        budgets[index]!,
        visualization.gapThresholdMilliseconds,
      ),
    ),
  };
}

export function evidenceQueryPath<T extends EvidenceQueryTimestampedPoint>(
  points: readonly T[],
  x: (timestamp: number) => number,
  y: (mmolL: number) => number,
) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.timestamp)} ${y(point.mmolL)}`,
    )
    .join(' ');
}

export function buildEvidenceQueryValueTicks(
  domain: { minimum: number; maximum: number },
  desiredCount = 5,
) {
  if (
    !Number.isFinite(domain.minimum) ||
    !Number.isFinite(domain.maximum) ||
    domain.maximum <= domain.minimum
  ) {
    return [];
  }
  const count = Math.max(2, Math.floor(desiredCount));
  return Array.from(
    { length: count },
    (_, index) =>
      domain.minimum +
      ((domain.maximum - domain.minimum) * index) / (count - 1),
  );
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: 'short',
  timeZone: 'Europe/London',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: 'Europe/London',
});

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/London',
});

const DAY_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: 'short',
  timeZone: 'Europe/London',
});

const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/London',
  year: 'numeric',
});

export function formatEvidenceQueryTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
}

export function formatEvidenceQueryTick(
  timestamp: number,
  range: EvidenceQueryRange,
) {
  const isOneLocalDay =
    DAY_KEY_FORMATTER.format(range.start) ===
    DAY_KEY_FORMATTER.format(range.end);
  if (isOneLocalDay) return TIME_FORMATTER.format(timestamp);
  return range.end - range.start <= 2 * 24 * 60 * 60_000
    ? DAY_TIME_FORMATTER.format(timestamp)
    : DAY_FORMATTER.format(timestamp);
}

export function formatEvidenceQueryRange(range: EvidenceQueryRange) {
  return `${formatEvidenceQueryTimestamp(range.start)} to ${formatEvidenceQueryTimestamp(
    range.end,
  )}`;
}

function rounded(value: number, decimals = 1) {
  return value.toFixed(decimals);
}

function coverageSentence(window: EvidenceQueryChartWindow) {
  if (window.coverageStatus === 'unavailable' || window.recordCount === 0) {
    return `${window.label} has no glucose readings in its exact requested period.`;
  }
  const quality =
    window.coverageStatus === 'limited'
      ? 'Limited coverage'
      : 'Sensor coverage';
  return `${quality} is ${rounded(window.coveragePercent)} percent for ${window.label}.`;
}

function gapCount(window: EvidenceQueryChartWindow, threshold: number) {
  if (window.sampling) return window.sampling.sourceGapCount;
  return Math.max(
    0,
    segmentEvidenceQueryPoints(window.points, window.range, threshold).length - 1,
  );
}

/** Concise TalkBack description; the Records tab remains the full data table. */
export function buildEvidenceQueryAccessibilitySummary(
  visualization: EvidenceQueryVisualizationReference,
) {
  const windowCopy = visualization.windows.map((window) => {
    const gaps = gapCount(window, visualization.gapThresholdMilliseconds);
    const period = `${window.label}, exact period ${formatEvidenceQueryRange(
      window.range,
    )}.`;
    const base = `${period} ${coverageSentence(window)}`;
    const sampling = window.sampling
      ? `For display, ${window.sampling.displayedPointCount} of ${window.sampling.sourceSampleCount} timestamp-normalised samples are plotted using a deterministic time-bucket envelope; the calculation and Records view retain all ${window.sampling.sourceRecordCount} exact source records.`
      : '';
    if (visualization.kind === 'range-distribution-v1') {
      const distribution = window.distribution;
      return distribution !== null &&
        distribution.belowPercent !== null &&
        distribution.inRangePercent !== null &&
        distribution.abovePercent !== null
        ? `${base} ${sampling} Of observed sensor time, ${rounded(
            distribution.belowPercent,
          )} percent was below range, ${rounded(
            distribution.inRangePercent,
          )} percent was in range, and ${rounded(
            distribution.abovePercent,
          )} percent was above range.`
        : `${base} ${sampling} The range distribution is unavailable.`;
    }
    if (visualization.kind === 'event-timeline-v1') {
      const events = window.events.filter(
        (event) =>
          event.kind === visualization.eventKind &&
          event.start >= window.range.start &&
          event.start < window.range.end,
      );
      const extreme = events.length
        ? visualization.eventKind === 'high'
          ? Math.max(...events.map((event) => event.extremeMmolL))
          : Math.min(...events.map((event) => event.extremeMmolL))
        : null;
      const continuing = events.filter(
        (event) =>
          event.endStatus === 'observed-through' &&
          event.continuesBeyondWindow === true,
      ).length;
      return `${base} ${sampling} ${events.length} sustained ${visualization.eventKind} event${
        events.length === 1 ? '' : 's'
      } started in this period${
        extreme === null
          ? '.'
          : `; the most extreme value was ${rounded(extreme)} mmol/L.`
      }${
        continuing
          ? ` ${continuing} event${continuing === 1 ? '' : 's'} may continue beyond the requested period.`
          : ''
      }${gaps ? ` The trace contains ${gaps} sensor gap${gaps === 1 ? '' : 's'}.` : ''}`;
    }
    const mean =
      window.meanMmolL === null
        ? 'The average is unavailable.'
        : `The observed arithmetic mean is ${rounded(window.meanMmolL)} mmol/L.`;
    return `${base} ${sampling} ${mean}${
      gaps
        ? ` The trace contains ${gaps} sensor gap${gaps === 1 ? '' : 's'}; lines stop across missing time.`
        : ''
    }`;
  });
  const comparison =
    visualization.windows.length > 1
      ? `This view compares ${visualization.windows.length} exact periods.`
      : '';
  return [
    visualization.title,
    comparison,
    ...windowCopy,
    `The shaded target range is ${rounded(
      visualization.targetRange.minimum,
    )} to ${rounded(visualization.targetRange.maximum)} mmol/L.`,
    'All Records is the complete text alternative for every exact source record.',
  ]
    .filter(Boolean)
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validRange(value: unknown): value is EvidenceQueryRange {
  return (
    isRecord(value) &&
    finite(value.start) &&
    finite(value.end) &&
    value.end > value.start
  );
}

function percentage(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 100;
}

function nullablePercentage(value: unknown): value is number | null {
  return value === null || percentage(value);
}

function validDistribution(value: unknown): value is EvidenceQueryDistribution | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    keys.join('|') !== 'abovePercent|belowPercent|inRangePercent' ||
    !nullablePercentage(value.abovePercent) ||
    !nullablePercentage(value.belowPercent) ||
    !nullablePercentage(value.inRangePercent)
  ) {
    return false;
  }
  const values = [
    value.abovePercent,
    value.belowPercent,
    value.inRangePercent,
  ];
  if (values.every((item) => item === null)) return true;
  if (values.some((item) => item === null)) return false;
  const sum = (values as number[]).reduce((total, item) => total + item, 0);
  return Math.abs(sum - 100) <= 0.2;
}

function validKindAndMetric(value: Record<string, unknown>) {
  if (value.kind === 'range-trace-v1') return value.metric === 'glucose.mean';
  if (value.kind === 'range-distribution-v1') {
    return value.metric === 'glucose.time_in_range';
  }
  if (value.kind === 'event-timeline-v1') {
    return (
      (value.eventKind === 'high' &&
        value.metric === 'glucose.high_episodes') ||
      (value.eventKind === 'low' && value.metric === 'glucose.low_episodes')
    );
  }
  return value.kind === 'period-comparison-v1' && value.metric === 'glucose.mean';
}

function meanFromPersistedPoints(
  points: Array<Record<string, unknown>>,
): number | null {
  if (!points.length) return null;
  const byTimestamp = new Map<number, { count: number; total: number }>();
  points.forEach((point) => {
    const timestamp = point.timestamp as number;
    const mmolL = point.mmolL as number;
    const sample = byTimestamp.get(timestamp);
    if (sample) {
      sample.count += 1;
      sample.total += mmolL;
    } else {
      byTimestamp.set(timestamp, { count: 1, total: mmolL });
    }
  });
  const samples = [...byTimestamp.values()].map(
    ({ count, total }) => total / count,
  );
  const mean =
    samples.reduce((total, sample) => total + sample, 0) / samples.length;
  return Math.round((mean + Number.EPSILON) * 100) / 100;
}

function coverageFromPersistedPoints(
  points: Array<Record<string, unknown>>,
  range: EvidenceQueryRange,
  gapThresholdMilliseconds: number,
) {
  if (!points.length) return 0;
  const timestamps = [
    ...new Set(points.map((point) => point.timestamp as number)),
  ].sort((left, right) => left - right);
  const observed = timestamps.reduce((total, timestamp, index) => {
    const end = Math.min(
      range.end,
      timestamps[index + 1] ?? range.end,
      timestamp + gapThresholdMilliseconds,
    );
    return total + Math.max(0, end - timestamp);
  }, 0);
  const raw = (observed / (range.end - range.start)) * 100;
  return Math.round((raw + Number.EPSILON) * 10) / 10;
}

function distributionFromPersistedPoints(
  points: Array<Record<string, unknown>>,
  range: EvidenceQueryRange,
  gapThresholdMilliseconds: number,
  lowerBoundMmolL: number,
  upperBoundMmolL: number,
): EvidenceQueryDistribution | null {
  if (!points.length) return null;
  const byTimestamp = new Map<number, { count: number; total: number }>();
  points.forEach((point) => {
    const timestamp = point.timestamp as number;
    const mmolL = point.mmolL as number;
    const sample = byTimestamp.get(timestamp);
    if (sample) {
      sample.count += 1;
      sample.total += mmolL;
    } else {
      byTimestamp.set(timestamp, { count: 1, total: mmolL });
    }
  });
  const samples = [...byTimestamp.entries()]
    .map(([timestamp, { count, total }]) => ({
      timestamp,
      mmolL: total / count,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
  const durations = { below: 0, within: 0, above: 0 };
  let observed = 0;
  samples.forEach((sample, index) => {
    const end = Math.min(
      range.end,
      samples[index + 1]?.timestamp ?? range.end,
      sample.timestamp + gapThresholdMilliseconds,
    );
    const duration = Math.max(0, end - sample.timestamp);
    observed += duration;
    if (sample.mmolL < lowerBoundMmolL) durations.below += duration;
    else if (sample.mmolL > upperBoundMmolL) durations.above += duration;
    else durations.within += duration;
  });
  if (!observed) return null;
  const percent = (duration: number) =>
    Math.round(((duration / observed) * 100 + Number.EPSILON) * 10) / 10;
  return {
    belowPercent: percent(durations.below),
    inRangePercent: percent(durations.within),
    abovePercent: percent(durations.above),
  };
}

function validSampling(
  value: unknown,
  recordCount: number,
  displayedPointCount: number,
) {
  if (!isRecord(value)) return false;
  return (
    value.kind === 'deterministic-time-bucket-envelope-v1' &&
    finite(value.sourceRecordCount) &&
    Number.isInteger(value.sourceRecordCount) &&
    value.sourceRecordCount === recordCount &&
    finite(value.sourceSampleCount) &&
    Number.isInteger(value.sourceSampleCount) &&
    value.sourceSampleCount > displayedPointCount &&
    value.sourceSampleCount <= value.sourceRecordCount &&
    finite(value.displayedPointCount) &&
    Number.isInteger(value.displayedPointCount) &&
    value.displayedPointCount === displayedPointCount &&
    finite(value.maximumDisplayedPoints) &&
    Number.isInteger(value.maximumDisplayedPoints) &&
    value.maximumDisplayedPoints >= displayedPointCount &&
    value.maximumDisplayedPoints > 0 &&
    value.maximumDisplayedPoints <= MAX_EVIDENCE_QUERY_CHART_POINTS &&
    finite(value.sourceGapCount) &&
    Number.isInteger(value.sourceGapCount) &&
    value.sourceGapCount >= 0 &&
    value.sourceGapCount <= value.sourceSampleCount - 1
  );
}

/** Runtime guard for replaying stored evidence without trusting old JSON. */
export function isEvidenceQueryVisualizationReference(
  value: unknown,
): value is EvidenceQueryVisualizationReference {
  if (!isRecord(value)) return false;
  const kinds = new Set([
    'range-trace-v1',
    'period-comparison-v1',
    'range-distribution-v1',
    'event-timeline-v1',
  ]);
  if (
    !kinds.has(String(value.kind)) ||
    !validKindAndMetric(value) ||
    value.schemaVersion !== 1 ||
    value.timezone !== 'Europe/London' ||
    value.units !== 'mmol/L' ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    typeof value.subtitle !== 'string' ||
    !value.subtitle.trim() ||
    !finite(value.gapThresholdMilliseconds) ||
    value.gapThresholdMilliseconds <= 0 ||
    !isRecord(value.targetRange) ||
    !finite(value.targetRange.minimum) ||
    !finite(value.targetRange.maximum) ||
    value.targetRange.minimum <= 0 ||
    value.targetRange.maximum <= value.targetRange.minimum ||
    !isRecord(value.valueDomain) ||
    !finite(value.valueDomain.minimum) ||
    !finite(value.valueDomain.maximum) ||
    value.valueDomain.minimum < 0 ||
    value.valueDomain.maximum <= value.valueDomain.minimum ||
    value.valueDomain.minimum > value.targetRange.minimum ||
    value.valueDomain.maximum < value.targetRange.maximum ||
    !Array.isArray(value.windows) ||
    !value.windows.length
  ) {
    return false;
  }
  if (
    (value.kind === 'range-trace-v1' && value.windows.length !== 1) ||
    (value.kind === 'period-comparison-v1' && value.windows.length < 2)
  ) {
    return false;
  }
  if (
    value.kind === 'range-distribution-v1' &&
    (!finite(value.lowerBoundMmolL) ||
      !finite(value.upperBoundMmolL) ||
      value.lowerBoundMmolL <= 0 ||
      value.upperBoundMmolL <= value.lowerBoundMmolL ||
      value.lowerBoundMmolL !== value.targetRange.minimum ||
      value.upperBoundMmolL !== value.targetRange.maximum)
  ) {
    return false;
  }
  if (
    value.kind === 'event-timeline-v1' &&
    ((value.eventKind !== 'high' && value.eventKind !== 'low') ||
      !finite(value.thresholdMmolL) ||
      value.thresholdMmolL <= 0)
  ) {
    return false;
  }
  const eventThreshold =
    value.kind === 'event-timeline-v1'
      ? (value.thresholdMmolL as number)
      : null;
  const windowIds = new Set<string>();
  const visualizationPointIds = new Set<string>();
  const visualizationEventIds = new Set<string>();
  const storedWindows = value.windows as Array<Record<string, unknown>>;
  if (
    storedWindows.some((window) => window.sampling !== undefined) &&
    storedWindows.reduce(
      (total, window) =>
        total + (Array.isArray(window.points) ? window.points.length : 0),
      0,
    ) > MAX_EVIDENCE_QUERY_CHART_POINTS
  ) {
    return false;
  }
  return value.windows.every((window) => {
    if (
      !isRecord(window) ||
      typeof window.id !== 'string' ||
      !window.id.trim() ||
      windowIds.has(window.id) ||
      typeof window.label !== 'string' ||
      !window.label.trim() ||
      !validRange(window.range) ||
      !finite(window.recordCount) ||
      !Number.isInteger(window.recordCount) ||
      window.recordCount < 0 ||
      !percentage(window.coveragePercent) ||
      !['sufficient', 'limited', 'unavailable'].includes(
        String(window.coverageStatus),
      ) ||
      (window.meanMmolL !== null &&
        (!finite(window.meanMmolL) || window.meanMmolL <= 0)) ||
      !Array.isArray(window.points) ||
      !Array.isArray(window.events) ||
      !validDistribution(window.distribution)
    ) {
      return false;
    }
    windowIds.add(window.id);
    const pointIds = new Set<string>();
    const pointByRecordId = new Map<string, Record<string, unknown>>();
    const eventIds = new Set<string>();
    const pointsValid = window.points.every((point) => {
      if (!isRecord(point)) return false;
      const hasLegacyId = typeof point.recordId === 'string';
      const hasRecordIds = Array.isArray(point.recordIds);
      const representedIds = hasRecordIds
        ? (point.recordIds as unknown[])
        : hasLegacyId
          ? [point.recordId]
          : [];
      if (
        hasLegacyId === hasRecordIds ||
        !representedIds.length ||
        new Set(representedIds).size !== representedIds.length ||
        !representedIds.every(
          (id) =>
            typeof id === 'string' &&
            id.trim() &&
            !pointIds.has(id) &&
            !visualizationPointIds.has(id),
        ) ||
        (point.segmentId !== undefined &&
          (typeof point.segmentId !== 'string' || !point.segmentId.trim())) ||
        !finite(point.timestamp) ||
        !finite(point.mmolL) ||
        point.mmolL <= 0 ||
        point.timestamp < (window.range as EvidenceQueryRange).start ||
        point.timestamp >= (window.range as EvidenceQueryRange).end
      ) {
        return false;
      }
      representedIds.forEach((id) => {
        const recordId = id as string;
        pointIds.add(recordId);
        visualizationPointIds.add(recordId);
        pointByRecordId.set(recordId, point);
      });
      return true;
    });
    const samplingValid =
      window.sampling === undefined
        ? true
        : validSampling(window.sampling, window.recordCount, window.points.length);
    const statusValid =
      (window.sampling === undefined
        ? window.recordCount === pointIds.size
        : samplingValid) &&
      (window.recordCount === 0
        ? window.coverageStatus === 'unavailable' &&
          window.coveragePercent === 0 &&
          window.meanMmolL === null &&
          window.points.length === 0 &&
          window.sampling === undefined
        : window.coverageStatus !== 'unavailable' && window.meanMmolL !== null);
    const calculatedMean = pointsValid && window.sampling === undefined
      ? meanFromPersistedPoints(window.points)
      : null;
    const meanValid =
      window.sampling !== undefined
        ? window.meanMmolL !== null
        : calculatedMean === null
        ? window.meanMmolL === null
        : window.meanMmolL !== null &&
          Math.abs(window.meanMmolL - calculatedMean) <= 1e-9;
    const calculatedCoverage = pointsValid && window.sampling === undefined
      ? coverageFromPersistedPoints(
          window.points,
          window.range,
          value.gapThresholdMilliseconds as number,
        )
      : null;
    const coverageValid =
      (window.sampling !== undefined ||
        (calculatedCoverage !== null &&
          Math.abs(window.coveragePercent - calculatedCoverage) <= 1e-9)) &&
      (window.coverageStatus === 'unavailable'
        ? window.coveragePercent === 0
        : window.coverageStatus === 'limited'
          ? window.coveragePercent > 0 &&
            window.coveragePercent < SUFFICIENT_COVERAGE_PERCENT
          : window.coveragePercent >= SUFFICIENT_COVERAGE_PERCENT);
    const expectedDistribution =
      value.kind === 'range-distribution-v1' &&
      window.sampling === undefined &&
      pointsValid
        ? distributionFromPersistedPoints(
            window.points,
            window.range,
            value.gapThresholdMilliseconds as number,
            value.lowerBoundMmolL as number,
            value.upperBoundMmolL as number,
          )
        : null;
    const distributionValid =
      value.kind === 'range-distribution-v1'
        ? window.recordCount === 0
          ? window.distribution === null ||
            (window.distribution.abovePercent === null &&
              window.distribution.belowPercent === null &&
              window.distribution.inRangePercent === null)
          : window.distribution !== null &&
            window.distribution.abovePercent !== null &&
            window.distribution.belowPercent !== null &&
            window.distribution.inRangePercent !== null &&
            (window.sampling !== undefined ||
              (expectedDistribution !== null &&
                Math.abs(
                  window.distribution.abovePercent -
                    expectedDistribution.abovePercent!,
                ) <= 0.1 &&
                Math.abs(
                  window.distribution.belowPercent -
                    expectedDistribution.belowPercent!,
                ) <= 0.1 &&
                Math.abs(
                  window.distribution.inRangePercent -
                    expectedDistribution.inRangePercent!,
                ) <= 0.1))
        : window.distribution === null;
    const eventsValid = window.events.every((event) => {
      const hasEndStatus = event.endStatus !== undefined;
      const hasContinuation = event.continuesBeyondWindow !== undefined;
      if (
        !isRecord(event) ||
        typeof event.id !== 'string' ||
        !event.id.trim() ||
        eventIds.has(event.id) ||
        visualizationEventIds.has(event.id) ||
        (event.kind !== 'high' && event.kind !== 'low') ||
        finite(event.start) === false ||
        finite(event.end) === false ||
        event.start < (window.range as EvidenceQueryRange).start ||
        event.start >= (window.range as EvidenceQueryRange).end ||
        event.end < event.start ||
        (event.endStatus === 'confirmed-recovery' &&
          event.end <= event.start) ||
        event.end > (window.range as EvidenceQueryRange).end ||
        !finite(event.extremeMmolL) ||
        event.extremeMmolL <= 0 ||
        !Array.isArray(event.recordIds) ||
        !event.recordIds.length ||
        new Set(event.recordIds).size !== event.recordIds.length ||
        !event.recordIds.every((id) => typeof id === 'string' && id.trim()) ||
        hasEndStatus !== hasContinuation ||
        (hasEndStatus &&
          event.endStatus !== 'confirmed-recovery' &&
          event.endStatus !== 'observed-through') ||
        (hasContinuation && typeof event.continuesBeyondWindow !== 'boolean') ||
        (event.endStatus === 'confirmed-recovery' &&
          event.continuesBeyondWindow !== false) ||
        (window.sampling === undefined &&
          !event.recordIds.every((id) => pointIds.has(id)))
      ) {
        return false;
      }
      if (
        value.kind === 'event-timeline-v1' &&
        (event.kind !== value.eventKind ||
          (event.kind === 'high'
            ? event.extremeMmolL <= eventThreshold!
            : event.extremeMmolL >= eventThreshold!))
      ) {
        return false;
      }
      if (value.kind !== 'event-timeline-v1') return false;
      const displayedEventPoints = event.recordIds.flatMap((id) => {
        const point = pointByRecordId.get(id);
        return point ? [point] : [];
      });
      if (!displayedEventPoints.length) return false;
      const expectedExtreme =
        event.kind === 'high'
          ? Math.max(...displayedEventPoints.map((point) => point.mmolL as number))
          : Math.min(...displayedEventPoints.map((point) => point.mmolL as number));
      if (Math.abs(expectedExtreme - event.extremeMmolL) > 1e-9) return false;
      if (
        window.sampling === undefined &&
        displayedEventPoints.some((point) =>
          event.kind === 'high'
            ? (point.mmolL as number) <= eventThreshold!
            : (point.mmolL as number) >= eventThreshold!,
        )
      ) {
        return false;
      }
      eventIds.add(event.id);
      visualizationEventIds.add(event.id);
      return true;
    });
    return (
      pointsValid &&
      samplingValid &&
      statusValid &&
      meanValid &&
      coverageValid &&
      distributionValid &&
      eventsValid &&
      (value.kind === 'event-timeline-v1' || window.events.length === 0)
    );
  });
}
