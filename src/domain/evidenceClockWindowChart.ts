import {
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import { formatRegionalWallClockMinute } from './regionalWallClock';

export interface EvidenceClockWindowDomain {
  /** Local clock minute in the range 0 (00:00) to 1439 (23:59). */
  startMinute: number;
  /**
   * The exact window end. Cross-midnight windows should preferably use an
   * unwrapped value, for example 03:00 after 22:00 is 1620. Wrapped local
   * minutes are also accepted and normalised.
   */
  endMinuteUnwrapped: number;
}

export interface EvidenceClockWindowValueDomain {
  maximum: number;
  minimum: number;
}

export interface EvidenceClockWindowTraceSemantics {
  aggregate: 'equal-occurrence-profile-average';
  binMinutes: number;
  occurrence: 'clock-bin-average';
}

export interface ResolvedEvidenceClockWindowDomain {
  durationMinutes: number;
  endMinute: number;
  startMinute: number;
}

export interface EvidenceClockWindowPoint {
  minute: number;
  mmolL: number;
  clockBinKey?: string;
  clockOccurrence?: number;
  elapsedMinute?: number;
  readingCount?: number;
  recordIds?: string[];
  utcOffsetMinutes?: number;
}

export interface EvidenceClockWindowAggregatePoint
  extends EvidenceClockWindowPoint {
  contributingWindowCount: number;
}

export interface EvidenceClockWindowSegment {
  points: EvidenceClockWindowPoint[];
  startsAfter?: {
    sensorGap: boolean;
    clockTransition: 'gap' | 'fold' | null;
  };
}

export interface EvidenceClockWindowTransition {
  affectedEndMinute: number;
  affectedStartMinute: number;
  atTimestamp: number;
  changeMinutes: number;
  kind: 'gap' | 'fold';
  utcOffsetAfterMinutes: number;
  utcOffsetBeforeMinutes: number;
}

export interface EvidenceClockWindowOccurrence {
  clockTransitions?: EvidenceClockWindowTransition[];
  id: string;
  label: string;
  points: EvidenceClockWindowPoint[];
  segments?: EvidenceClockWindowSegment[];
  status: 'complete' | 'missing' | 'partial';
}

export interface EvidenceClockWindowTargetRange {
  maximum: number;
  minimum: number;
}

export interface EvidenceClockWindowVisualization {
  aggregatePoints: EvidenceClockWindowAggregatePoint[];
  domain: EvidenceClockWindowDomain;
  minimumAggregateContributors: number;
  units: string;
  windows: EvidenceClockWindowOccurrence[];
  /** Persisted on exact evidence so replay cannot silently rescale to settings. */
  valueDomain?: EvidenceClockWindowValueDomain;
  /** Persisted calculation result; distinct from the clock-bin profile line. */
  overallMeanMmolL?: number | null;
  traceSemantics?: EvidenceClockWindowTraceSemantics;
}

export interface EvidenceClockWindowScale {
  maximum: number;
  minimum: number;
  ticks: number[];
}

const MINUTES_PER_DAY = 24 * 60;
const TRACE_PATTERNS = [
  { dash: null, marker: 'circle' },
  { dash: '8 4', marker: 'square' },
  { dash: '2 4', marker: 'diamond' },
  { dash: '10 3 2 3', marker: 'triangle' },
] as const;

export function evidenceClockWindowTracePattern(index: number) {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError('A trace index must be a non-negative integer.');
  }
  return TRACE_PATTERNS[index % TRACE_PATTERNS.length]!;
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function sentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function regionalCount(value: number, locale = getRuntimeRegionalDefaults().locale) {
  return formatRegionalNumber(value, locale, { maximumFractionDigits: 0 });
}

function summariseLabels(labels: string[]) {
  const values = unique(labels);
  if (values.length <= 4) return values.join(', ');
  return `${values.slice(0, 3).join(', ')}, and ${regionalCount(values.length - 3)} more`;
}

export function resolveEvidenceClockWindowDomain(
  domain: EvidenceClockWindowDomain,
): ResolvedEvidenceClockWindowDomain {
  if (
    !Number.isFinite(domain.startMinute) ||
    !Number.isFinite(domain.endMinuteUnwrapped) ||
    domain.startMinute < 0 ||
    domain.startMinute >= MINUTES_PER_DAY
  ) {
    throw new RangeError('Clock-window minutes must be finite local minutes.');
  }

  const startMinute = domain.startMinute;
  let endMinute = domain.endMinuteUnwrapped;
  if (endMinute <= startMinute) {
    endMinute = modulo(endMinute, MINUTES_PER_DAY);
    while (endMinute <= startMinute) endMinute += MINUTES_PER_DAY;
  }
  const durationMinutes = endMinute - startMinute;
  if (durationMinutes <= 0 || durationMinutes > MINUTES_PER_DAY) {
    throw new RangeError('A clock window must span more than 0 and at most 24 hours.');
  }

  return { durationMinutes, endMinute, startMinute };
}

/** Maps a local minute-of-day into the domain's unwrapped clock axis. */
export function normaliseEvidenceClockMinute(
  minute: number,
  domain: ResolvedEvidenceClockWindowDomain,
) {
  if (!Number.isFinite(minute)) return Number.NaN;
  if (minute >= domain.startMinute && minute <= domain.endMinute) {
    return minute;
  }
  let normalised = modulo(minute, MINUTES_PER_DAY);
  while (normalised < domain.startMinute) normalised += MINUTES_PER_DAY;
  return normalised;
}

function normalisePoint<T extends EvidenceClockWindowPoint>(
  point: T,
  domain: ResolvedEvidenceClockWindowDomain,
): T | null {
  const minute = normaliseEvidenceClockMinute(point.minute, domain);
  if (
    !Number.isFinite(minute) ||
    !Number.isFinite(point.mmolL) ||
    minute < domain.startMinute ||
    minute > domain.endMinute
  ) {
    return null;
  }
  return { ...point, minute };
}

/**
 * Produces line-safe segments. A missing interval is represented by two paths,
 * never by a line interpolated through the gap.
 */
export function segmentEvidenceClockWindowPoints<
  T extends EvidenceClockWindowPoint,
>(
  points: T[],
  domain: ResolvedEvidenceClockWindowDomain,
  gapThresholdMinutes = 20,
): T[][] {
  const threshold = Math.max(0, gapThresholdMinutes);
  const ordered = points
    .map((point) => normalisePoint(point, domain))
    .filter((point): point is T => point !== null)
    .sort((left, right) => left.minute - right.minute);
  const segments: T[][] = [];

  ordered.forEach((point) => {
    const current = segments[segments.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || point.minute - previous.minute > threshold) {
      segments.push([point]);
    } else {
      current.push(point);
    }
  });
  return segments;
}

/**
 * Uses evidence-engine segments as authoritative boundaries. If an older
 * bundle has no segments, it safely derives them from its points.
 */
export function prepareEvidenceClockWindowSegments(
  occurrence: EvidenceClockWindowOccurrence,
  domain: ResolvedEvidenceClockWindowDomain,
  gapThresholdMinutes = 20,
) {
  if (occurrence.status === 'missing') return [];
  const supplied = occurrence.segments?.filter(
    (segment) => segment.points.length > 0,
  );
  if (!supplied?.length) {
    return segmentEvidenceClockWindowPoints(
      occurrence.points,
      domain,
      gapThresholdMinutes,
    );
  }
  return supplied.flatMap((segment) =>
    segmentEvidenceClockWindowPoints(
      segment.points,
      domain,
      gapThresholdMinutes,
    ),
  );
}

export function prepareEvidenceClockWindowAggregate(
  points: EvidenceClockWindowAggregatePoint[],
  domain: ResolvedEvidenceClockWindowDomain,
  minimumContributors: number,
  gapThresholdMinutes = 20,
) {
  const minimum = Math.max(1, Math.floor(minimumContributors));
  return segmentEvidenceClockWindowPoints(
    points.filter(
      (point) =>
        Number.isFinite(point.contributingWindowCount) &&
        point.contributingWindowCount >= minimum,
    ),
    domain,
    gapThresholdMinutes,
  );
}

export function projectEvidenceClockMinute(
  minute: number,
  domain: ResolvedEvidenceClockWindowDomain,
  width: number,
) {
  const normalised = normaliseEvidenceClockMinute(minute, domain);
  const fraction =
    (normalised - domain.startMinute) / Math.max(1, domain.durationMinutes);
  return Math.max(0, Math.min(Math.max(0, width), fraction * width));
}

export function formatEvidenceClockMinute(
  minute: number,
  locale = getRuntimeRegionalDefaults().locale,
) {
  const localMinute = modulo(Math.round(minute), MINUTES_PER_DAY);
  return formatRegionalWallClockMinute(localMinute, locale);
}

export function formatEvidenceClockWindow(
  domain: ResolvedEvidenceClockWindowDomain,
  locale = getRuntimeRegionalDefaults().locale,
) {
  const range = `${formatEvidenceClockMinute(domain.startMinute, locale)} to ${formatEvidenceClockMinute(domain.endMinute, locale)}`;
  return domain.durationMinutes === MINUTES_PER_DAY
    ? `${range}, a full ${regionalCount(24, locale)}-hour window`
    : range;
}

export function buildEvidenceClockWindowTicks(
  domain: ResolvedEvidenceClockWindowDomain,
  maximumTicks = 5,
) {
  const steps = [15, 30, 60, 120, 180, 240, 360, 720];
  const limit = Math.max(2, Math.floor(maximumTicks));
  const step =
    steps.find((candidate) => {
      const first = Math.ceil(domain.startMinute / candidate) * candidate;
      const internal = Math.max(
        0,
        Math.ceil((domain.endMinute - first) / candidate),
      );
      return internal + 2 <= limit;
    }) ?? 720;
  const ticks = [domain.startMinute];
  for (
    let minute = Math.ceil(domain.startMinute / step) * step;
    minute < domain.endMinute;
    minute += step
  ) {
    if (minute > domain.startMinute) ticks.push(minute);
  }
  ticks.push(domain.endMinute);
  return [...new Set(ticks)];
}

function niceStep(span: number, desiredTicks = 4) {
  const rough = span / Math.max(1, desiredTicks);
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 0.1)));
  const fraction = rough / power;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : 5;
  return niceFraction * power;
}

export function buildEvidenceClockWindowScale(
  values: number[],
  targetRange?: EvidenceClockWindowTargetRange,
): EvidenceClockWindowScale {
  const finiteValues = values.filter(Number.isFinite);
  if (
    targetRange &&
    Number.isFinite(targetRange.minimum) &&
    Number.isFinite(targetRange.maximum)
  ) {
    finiteValues.push(targetRange.minimum, targetRange.maximum);
  }
  if (!finiteValues.length) return { maximum: 10, minimum: 0, ticks: [0, 5, 10] };

  const rawMinimum = Math.min(...finiteValues);
  const rawMaximum = Math.max(...finiteValues);
  const rawSpan = Math.max(1, rawMaximum - rawMinimum);
  const padding = Math.max(rawSpan * 0.08, rawMaximum > 40 ? 5 : 0.6);
  const step = niceStep(rawSpan + padding * 2);
  const minimum = Math.max(0, Math.floor((rawMinimum - padding) / step) * step);
  const maximum = Math.max(
    minimum + step,
    Math.ceil((rawMaximum + padding) / step) * step,
  );
  const ticks: number[] = [];
  for (let value = minimum; value <= maximum + step / 2; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }
  return { maximum, minimum, ticks };
}

/** Builds deterministic ticks without changing a persisted exact value domain. */
export function buildEvidenceClockWindowScaleForDomain(
  domain: EvidenceClockWindowValueDomain,
): EvidenceClockWindowScale {
  if (
    !Number.isFinite(domain.minimum) ||
    !Number.isFinite(domain.maximum) ||
    domain.minimum < 0 ||
    domain.maximum <= domain.minimum
  ) {
    throw new RangeError('A persisted chart value domain must be finite and increasing.');
  }
  const span = domain.maximum - domain.minimum;
  const step = niceStep(span, 4);
  const ticks: number[] = [];
  let value = Math.ceil(domain.minimum / step) * step;
  while (value <= domain.maximum + step / 1000) {
    ticks.push(Number(value.toFixed(2)));
    value += step;
  }
  if (!ticks.length) ticks.push(domain.minimum, domain.maximum);
  return {
    maximum: domain.maximum,
    minimum: domain.minimum,
    ticks: [...new Set(ticks)],
  };
}

export function formatEvidenceClockWindowValue(value: number, units: string) {
  const locale = getRuntimeRegionalDefaults().locale;
  return /mg\s*\/\s*dL/i.test(units)
    ? formatRegionalFixedNumber(value, locale, 0)
    : formatRegionalFixedNumber(value, locale, 1);
}

export function evidenceClockWindowPath(
  points: EvidenceClockWindowPoint[],
  x: (minute: number) => number,
  y: (value: number) => number,
) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.minute)} ${y(point.mmolL)}`,
    )
    .join(' ');
}

export interface EvidenceClockWindowAccessibilityInput
  extends EvidenceClockWindowVisualization {
  coverageSummary: string;
  gapThresholdMinutes?: number;
  missingOccurrenceLabels?: string[];
  targetRange?: EvidenceClockWindowTargetRange;
  title: string;
  /** IANA zone used to calculate the persisted clock-window evidence. */
  timeZone?: string;
  targetRangePolicy?: 'persisted-only';
  /** Formats a canonical mmol/L value for the active display profile. */
  valueFormatter?: (mmolL: number) => string;
}

export function buildEvidenceClockWindowAccessibilitySummary({
  aggregatePoints,
  coverageSummary,
  domain,
  gapThresholdMinutes = 20,
  minimumAggregateContributors,
  missingOccurrenceLabels = [],
  targetRange,
  targetRangePolicy,
  title,
  timeZone,
  units,
  windows,
  overallMeanMmolL,
  traceSemantics,
  valueFormatter,
}: EvidenceClockWindowAccessibilityInput) {
  const formatValue =
    valueFormatter ?? ((value: number) => formatEvidenceClockWindowValue(value, units));
  let resolved: ResolvedEvidenceClockWindowDomain;
  try {
    resolved = resolveEvidenceClockWindowDomain(domain);
  } catch {
    return `${sentence(title)} This clock window could not be displayed because its time range is invalid.`;
  }

  const prepared = windows.map((window) => ({
    segments: prepareEvidenceClockWindowSegments(
      window,
      resolved,
      gapThresholdMinutes,
    ),
    window,
  }));
  const observed = prepared.filter(({ segments }) => segments.length > 0);
  const missing = unique([
    ...missingOccurrenceLabels,
    ...prepared
      .filter(({ segments, window }) =>
        window.status === 'missing' || segments.length === 0,
      )
      .map(({ window }) => window.label),
  ]);
  const partial = observed
    .filter(({ window }) => window.status === 'partial')
    .map(({ window }) => window.label);
  const complete = observed
    .filter(({ window }) => window.status === 'complete')
    .map(({ window }) => window.label);
  const knownLabels = unique(windows.map((window) => window.label));
  const externalMissing = missing.filter(
    (label) => !knownLabels.includes(label),
  ).length;
  const requestedCount = windows.length + externalMissing;
  const values = observed.flatMap(({ segments }) =>
    segments.flatMap((segment) => segment.map((point) => point.mmolL)),
  );
  const aggregate = prepareEvidenceClockWindowAggregate(
    aggregatePoints,
    resolved,
    minimumAggregateContributors,
    gapThresholdMinutes,
  ).flat();
  const clockTransitions = windows.flatMap(
    (window) => window.clockTransitions ?? [],
  );
  const hasSensorGaps = observed.some(({ segments, window }) => {
    if (segments.length <= 1) return false;
    const supplied = window.segments?.filter(
      (segment) => segment.points.length > 0,
    );
    if (!supplied?.length) return true;
    return supplied.slice(1).some(
      (segment) => segment.startsAfter?.sensorGap ?? true,
    );
  });
  const parts = [
    sentence(title),
    sentence(
      `Clock window ${formatEvidenceClockWindow(
        resolved,
        getRuntimeRegionalDefaults().locale,
      )}`,
    ),
    sentence(coverageSummary),
  ];

  if (!observed.length) {
    parts.push('No glucose readings are available for this window.');
  } else {
    parts.push(
      `${regionalCount(observed.length)} of ${regionalCount(Math.max(requestedCount, observed.length))} requested occurrences contain readings.`,
    );
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    parts.push(
      minimum === maximum
        ? `The observed value is ${formatValue(minimum)} ${units}.`
        : `Observed values range from ${formatValue(minimum)} to ${formatValue(maximum)} ${units}.`,
    );
  }
  if (missing.length) {
    parts.push(`No readings for ${summariseLabels(missing)}.`);
  }
  if (complete.length) {
    parts.push(`Complete occurrences: ${summariseLabels(complete)}.`);
  }
  if (partial.length) {
    parts.push(`Partial readings for ${summariseLabels(partial)}.`);
  }
  if (
    observed.length &&
    targetRange &&
    Number.isFinite(targetRange.minimum) &&
    Number.isFinite(targetRange.maximum)
  ) {
    parts.push(
      `The shaded target range is ${formatValue(targetRange.minimum)} to ${formatValue(targetRange.maximum)} ${units}.`,
    );
  }
  if (aggregate.length) {
    const contributors = aggregate.map(
      (point) => point.contributingWindowCount,
    );
    const minimum = Math.min(...contributors);
    const maximum = Math.max(...contributors);
    parts.push(
      minimum === maximum
        ? `The ${regionalCount(traceSemantics?.binMinutes ?? 15)}-minute clock-bin profile average uses ${regionalCount(minimum)} contributing occurrences per point.`
        : `The ${regionalCount(traceSemantics?.binMinutes ?? 15)}-minute clock-bin profile average uses between ${regionalCount(minimum)} and ${regionalCount(maximum)} contributing occurrences per point.`,
    );
  } else if (aggregatePoints.length) {
    parts.push(
      `No average line is shown because fewer than ${regionalCount(Math.max(1, minimumAggregateContributors))} occurrences contribute at each interval.`,
    );
  }
  if (traceSemantics) {
    parts.push(
      `Each thin occurrence trace is made from ${regionalCount(traceSemantics.binMinutes)}-minute clock-bin averages; the thick profile line averages those bins equally across contributing occurrences.`,
    );
  }
  if (overallMeanMmolL !== undefined && overallMeanMmolL !== null) {
    parts.push(
      `A separate horizontal line marks the exact overall answer mean of ${formatValue(overallMeanMmolL)} ${units}; it need not equal the visual profile average when coverage is uneven.`,
    );
  }
  if (targetRangePolicy === 'persisted-only' && !targetRange) {
    parts.push('No reference band is shown because none was part of this saved calculation.');
  }
  if (clockTransitions.length) {
    const kinds = unique(clockTransitions.map((transition) => transition.kind));
    const clockZone = timeZone ? `${timeZone} clock` : 'selected local clock';
    parts.push(
      `The trace is split at a ${clockZone} ${kinds.join(' and ')}; this is a clock change, not missing sensor data.`,
    );
  }
  if (hasSensorGaps) parts.push('Lines stop where readings are missing.');
  parts.push('All Records is the complete text alternative for every exact source record.');
  return parts.filter(Boolean).join(' ');
}
