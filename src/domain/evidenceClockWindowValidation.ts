import type { EvidenceClockWindowVisualizationReference } from './insights';
import { isIanaTimeZone } from './regionalProfile';
import { resolveEvidenceClockWindowDomain } from './evidenceClockWindowChart';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function stringIds(value: unknown) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every(nonEmptyString) &&
    new Set(value).size === value.length
    ? (value as string[])
    : null;
}

interface ValidationOptions {
  /** Exact IDs retained by the wrapping EvidenceReference. */
  evidenceRecordIds?: readonly string[];
  /** Schema-v3 answers require every chart vertex to retain source IDs. */
  requireRecordLinks?: boolean;
}

/**
 * Strict replay guard for the original recurring clock-overlay grammar. Old
 * well-formed payloads remain accepted; impossible glucose/domain/status and
 * detached record links fail closed before rendering.
 */
export function isEvidenceClockWindowVisualizationReference(
  value: unknown,
  options: ValidationOptions = {},
): value is EvidenceClockWindowVisualizationReference {
  if (!isRecord(value) || value.kind !== 'recurring-clock-overlay-v1') {
    return false;
  }
  if (
    typeof value.timezone !== 'string' ||
    !isIanaTimeZone(value.timezone) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.subtitle) ||
    !nonEmptyString(value.coverageSummary) ||
    value.units !== 'mmol/L' ||
    !finite(value.minimumAggregateContributors) ||
    !Number.isInteger(value.minimumAggregateContributors) ||
    value.minimumAggregateContributors < 1 ||
    !Array.isArray(value.missingOccurrenceLabels) ||
    !value.missingOccurrenceLabels.every(nonEmptyString) ||
    new Set(value.missingOccurrenceLabels).size !==
      value.missingOccurrenceLabels.length ||
    !isRecord(value.domain) ||
    !finite(value.domain.startMinute) ||
    !Number.isInteger(value.domain.startMinute) ||
    value.domain.startMinute < 0 ||
    value.domain.startMinute >= 24 * 60 ||
    !finite(value.domain.endMinuteUnwrapped) ||
    !Number.isInteger(value.domain.endMinuteUnwrapped) ||
    !Array.isArray(value.aggregatePoints) ||
    !Array.isArray(value.windows) ||
    !value.windows.length ||
    value.minimumAggregateContributors > value.windows.length
  ) {
    return false;
  }
  if (
    value.valueDomain !== undefined &&
    (!isRecord(value.valueDomain) ||
      !finite(value.valueDomain.minimum) ||
      !finite(value.valueDomain.maximum) ||
      value.valueDomain.minimum < 0 ||
      value.valueDomain.maximum <= value.valueDomain.minimum)
  ) {
    return false;
  }
  if (
    value.overallMeanMmolL !== undefined &&
    value.overallMeanMmolL !== null &&
    (!finite(value.overallMeanMmolL) || value.overallMeanMmolL <= 0)
  ) {
    return false;
  }
  if (
    value.traceSemantics !== undefined &&
    (!isRecord(value.traceSemantics) ||
      value.traceSemantics.occurrence !== 'clock-bin-average' ||
      value.traceSemantics.aggregate !== 'equal-occurrence-profile-average' ||
      !finite(value.traceSemantics.binMinutes) ||
      !Number.isInteger(value.traceSemantics.binMinutes) ||
      value.traceSemantics.binMinutes < 1 ||
      value.traceSemantics.binMinutes > 60)
  ) {
    return false;
  }
  if (
    value.targetRangePolicy !== undefined &&
    value.targetRangePolicy !== 'persisted-only'
  ) {
    return false;
  }
  if (
    value.targetRangeProvenance !== undefined &&
    value.targetRangeProvenance !== 'query-thresholds'
  ) {
    return false;
  }
  const minimumAggregateContributors =
    value.minimumAggregateContributors as number;
  const storedWindows = value.windows as unknown[];
  const missingOccurrenceLabels = value.missingOccurrenceLabels as string[];
  let domain: ReturnType<typeof resolveEvidenceClockWindowDomain>;
  try {
    domain = resolveEvidenceClockWindowDomain({
      startMinute: value.domain.startMinute,
      endMinuteUnwrapped: value.domain.endMinuteUnwrapped,
    });
  } catch {
    return false;
  }
  if (
    value.targetRange !== undefined &&
    (!isRecord(value.targetRange) ||
      !finite(value.targetRange.minimum) ||
      !finite(value.targetRange.maximum) ||
      value.targetRange.minimum <= 0 ||
      value.targetRange.maximum <= value.targetRange.minimum)
  ) {
    return false;
  }
  if (
    value.targetRangePolicy === 'persisted-only' &&
    ((value.targetRange === undefined) !==
      (value.targetRangeProvenance === undefined))
  ) {
    return false;
  }
  const evidenceIds = new Set(options.evidenceRecordIds ?? []);
  if (
    options.evidenceRecordIds &&
    (evidenceIds.size !== options.evidenceRecordIds.length ||
      options.evidenceRecordIds.some((id) => !nonEmptyString(id)))
  ) {
    return false;
  }
  const pointIds = (
    point: Record<string, unknown>,
  ): string[] | null => {
    if (point.recordIds === undefined && !options.requireRecordLinks) return [];
    const ids = stringIds(point.recordIds);
    if (!ids) return null;
    if (options.evidenceRecordIds && ids.some((id) => !evidenceIds.has(id))) {
      return null;
    }
    return ids;
  };
  const validPoint = (
    point: unknown,
    aggregate: boolean,
  ): point is Record<string, unknown> => {
    if (
      !isRecord(point) ||
      !finite(point.minute) ||
      point.minute < domain.startMinute ||
      point.minute > domain.startMinute + domain.durationMinutes ||
      !finite(point.mmolL) ||
      point.mmolL <= 0 ||
      pointIds(point) === null
    ) {
      return false;
    }
    if (
      point.readingCount !== undefined &&
      (!finite(point.readingCount) ||
        !Number.isInteger(point.readingCount) ||
        point.readingCount < 1)
    ) {
      return false;
    }
    if (!aggregate) return true;
    return (
      finite(point.contributingWindowCount) &&
      Number.isInteger(point.contributingWindowCount) &&
      point.contributingWindowCount >= minimumAggregateContributors &&
      point.contributingWindowCount <= storedWindows.length
    );
  };

  const windowIds = new Set<string>();
  const allWindowRecordIds = new Set<string>();
  const missingLabels: string[] = [];
  const windowsValid = storedWindows.every((window) => {
    if (
      !isRecord(window) ||
      !nonEmptyString(window.id) ||
      windowIds.has(window.id) ||
      !nonEmptyString(window.label) ||
      !['complete', 'partial', 'missing'].includes(String(window.status)) ||
      !Array.isArray(window.points) ||
      !window.points.every((point) => validPoint(point, false)) ||
      !Array.isArray(window.segments) ||
      !Array.isArray(window.clockTransitions)
    ) {
      return false;
    }
    windowIds.add(window.id);
    if (window.status === 'missing') missingLabels.push(window.label);
    if (
      window.status === 'missing' &&
      (window.points.length > 0 || window.segments.length > 0)
    ) {
      return false;
    }
    const windowPointIds = new Set(
      window.points.flatMap((point) => pointIds(point) ?? []),
    );
    if (
      [...windowPointIds].some(
        (id) => allWindowRecordIds.has(id),
      )
    ) {
      return false;
    }
    windowPointIds.forEach((id) => allWindowRecordIds.add(id));
    const segmentIds = new Set<string>();
    const segmentsValid = window.segments.every((segment) => {
      if (
        !isRecord(segment) ||
        (segment.id !== undefined &&
          (!nonEmptyString(segment.id) || segmentIds.has(segment.id))) ||
        !Array.isArray(segment.points) ||
        !segment.points.length ||
        !segment.points.every((point: unknown) => validPoint(point, false)) ||
        !isRecord(segment.startsAfter) ||
        typeof segment.startsAfter.sensorGap !== 'boolean' ||
        (segment.startsAfter.clockTransition !== null &&
          segment.startsAfter.clockTransition !== 'gap' &&
          segment.startsAfter.clockTransition !== 'fold')
      ) {
        return false;
      }
      if (typeof segment.id === 'string') segmentIds.add(segment.id);
      return true;
    });
    if (!segmentsValid) return false;
    const segmentRecordIds = new Set(
      (window.segments as { points: Record<string, unknown>[] }[]).flatMap(
        (segment) =>
          segment.points.flatMap((point) => pointIds(point) ?? []),
      ),
    );
    if (
      options.requireRecordLinks &&
      (segmentRecordIds.size !== windowPointIds.size ||
        [...windowPointIds].some((id) => !segmentRecordIds.has(id)))
    ) {
      return false;
    }
    return window.clockTransitions.every(
      (transition) =>
        isRecord(transition) &&
        (transition.kind === 'gap' || transition.kind === 'fold') &&
        finite(transition.atTimestamp) &&
        finite(transition.utcOffsetBeforeMinutes) &&
        finite(transition.utcOffsetAfterMinutes) &&
        finite(transition.changeMinutes) &&
        transition.changeMinutes > 0 &&
        finite(transition.affectedStartMinute) &&
        finite(transition.affectedEndMinute) &&
        transition.affectedEndMinute >= transition.affectedStartMinute,
    );
  });
  if (!windowsValid) return false;
  if (
    missingLabels.length !== missingOccurrenceLabels.length ||
    missingLabels.some(
      (label) => !missingOccurrenceLabels.includes(label),
    )
  ) {
    return false;
  }
  if (
    options.requireRecordLinks &&
    (allWindowRecordIds.size !== evidenceIds.size ||
      [...evidenceIds].some((id) => !allWindowRecordIds.has(id)))
  ) {
    return false;
  }
  const aggregateValid = value.aggregatePoints.every((point) => {
    if (!validPoint(point, true)) return false;
    if (Array.isArray(point.contributingWindowIds)) {
      if (
        point.contributingWindowIds.length !== point.contributingWindowCount ||
        new Set(point.contributingWindowIds).size !==
          point.contributingWindowIds.length ||
        !point.contributingWindowIds.every(
          (id) => nonEmptyString(id) && windowIds.has(id),
        )
      ) {
        return false;
      }
    }
    return true;
  });
  if (!aggregateValid) return false;
  if (isRecord(value.valueDomain)) {
    const minimum = value.valueDomain.minimum as number;
    const maximum = value.valueDomain.maximum as number;
    const plottedValues = [
      ...(storedWindows as { points: { mmolL: number }[] }[]).flatMap(
        (window) => window.points.map(({ mmolL }) => mmolL),
      ),
      ...(value.aggregatePoints as { mmolL: number }[]).map(
        ({ mmolL }) => mmolL,
      ),
      ...(finite(value.overallMeanMmolL) ? [value.overallMeanMmolL] : []),
      ...(isRecord(value.targetRange)
        ? [value.targetRange.minimum as number, value.targetRange.maximum as number]
        : []),
    ];
    if (plottedValues.some((item) => item < minimum || item > maximum)) {
      return false;
    }
  }
  return true;
}
