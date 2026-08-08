import type { GlucoseReading, TimeRange } from '@/domain/models';
import type { DateKey } from '@/domain/time';

export const SCOPED_GLUCOSE_SCHEMA_VERSION = 2 as const;

export type SupportedQueryTimeZone = 'Europe/London';

export interface LocalClockTime {
  hour: number;
  minute: number;
}

export interface RecurringClockWindow {
  start: LocalClockTime;
  end: LocalClockTime;
  /**
   * Optional intent-parser assertion. When supplied, it must agree with the
   * relationship between start and end; disagreement is rejected rather than
   * silently changing the requested scope.
   */
  crossesMidnight?: boolean;
}

export interface ScopedGlucoseQuery {
  /** Stable caller ID. A deterministic ID is generated when omitted. */
  queryId?: string;
  timezone: SupportedQueryTimeZone;
  /** The answer may only use recurring windows whose absolute end is <= asOf. */
  asOf: number;
  windowCount: number;
  clockWindow: RecurringClockWindow;
  /** Clock-aligned chart bins. Defaults to 15 minutes. */
  binMinutes?: number;
  /** Defaults to two distinct windows. */
  minimumAggregateContributors?: number;
  /** A longer interval is missing data, never a connected chart line. Defaults to 12 minutes. */
  maximumObservedGapMinutes?: number;
}

export interface ResolvedRecurringWindow {
  id: string;
  sequence: number;
  anchorDate: DateKey;
  label: string;
  range: TimeRange;
  /** Actual elapsed duration. This can be 60 minutes shorter/longer over DST. */
  elapsedMinutes: number;
  /** Structural local-clock changes inside this absolute interval. */
  clockTransitions: ScopedClockTransition[];
}

export interface ScopedClockTransition {
  kind: 'gap' | 'fold';
  atTimestamp: number;
  utcOffsetBeforeMinutes: number;
  utcOffsetAfterMinutes: number;
  changeMinutes: number;
  /** Unwrapped local-clock interval skipped (gap) or repeated (fold). */
  affectedStartMinute: number;
  affectedEndMinute: number;
}

export interface ScopedCoverage {
  expectedMilliseconds: number;
  observedMilliseconds: number;
  expectedMinutes: number;
  observedMinutes: number;
  percent: number;
}

/**
 * A capped, non-overlapping interval represented by one or more readings at
 * the same instant. These intervals are useful for deterministic duration
 * metrics such as time in range.
 */
export interface ScopedObservationInterval {
  start: number;
  end: number;
  mmolL: number;
  recordIds: string[];
}

export interface ScopedGlucoseChartPoint {
  /** Stable within a window; repeated autumn bins have different keys. */
  clockBinKey: string;
  /** Centre of the clock-aligned bin, on an unwrapped clock domain. */
  minute: number;
  binStartMinute: number;
  binEndMinute: number;
  mmolL: number;
  readingCount: number;
  recordIds: string[];
  /** One normally; two identifies the second occurrence in an autumn fold. */
  clockOccurrence: number;
  utcOffsetMinutes: number;
  /** Mean absolute elapsed position from this window's start. */
  elapsedMinute: number;
}

export interface ScopedGlucoseChartSegment {
  id: string;
  startsAfter: {
    sensorGap: boolean;
    clockTransition: 'gap' | 'fold' | null;
  };
  points: ScopedGlucoseChartPoint[];
}

export type ScopedWindowStatus = 'complete' | 'partial' | 'missing';

export interface ScopedGlucoseWindowResult extends ResolvedRecurringWindow {
  status: ScopedWindowStatus;
  readingCount: number;
  observedMeanMmolL: number | null;
  recordIds: string[];
  coverage: ScopedCoverage;
  observationIntervals: ScopedObservationInterval[];
  /** All binned points. Consumers must use segments when drawing lines. */
  points: ScopedGlucoseChartPoint[];
  /** Authoritative line segments; separate entries must never be connected. */
  segments: ScopedGlucoseChartSegment[];
}

export interface ScopedAggregateChartPoint {
  clockBinKey: string;
  minute: number;
  binStartMinute: number;
  binEndMinute: number;
  mmolL: number;
  contributingWindowCount: number;
  contributingWindowIds: string[];
  recordIds: string[];
  clockOccurrence: number;
}

export interface ScopedGlucoseEvidenceRecord {
  id: string;
  timestamp: number;
  mmolL: number;
  sourceId: string;
  windowId: string;
  /** Unwrapped local-clock minute used for chart placement. */
  minute: number;
}

export interface ScopedGlucoseEvidenceBundle {
  schemaVersion: typeof SCOPED_GLUCOSE_SCHEMA_VERSION;
  kind: 'scoped-glucose-recurring-window';
  queryId: string;
  generatedAt: number;
  timezone: SupportedQueryTimeZone;
  units: { glucose: 'mmol/L'; duration: 'minutes' };
  resolvedScope: {
    kind: 'most-recent-completed-recurring-clock-windows';
    asOf: number;
    windowCount: number;
    clockWindow: {
      start: LocalClockTime;
      end: LocalClockTime;
      crossesMidnight: boolean;
    };
    intervals: ResolvedRecurringWindow[];
  };
  calculation: {
    metric: 'observed-arithmetic-mean-glucose';
    precisionDecimals: 2;
    sampleNormalization: 'same-timestamp-records-averaged-v1';
    coverageModel: 'forward-observation-capped-at-gap';
    maximumObservedGapMinutes: number;
    halfOpenIntervals: true;
  };
  result: {
    observedMeanMmolL: number | null;
    readingCount: number;
    requestedWindowCount: number;
    windowsWithData: number;
    missingWindowCount: number;
    recordIds: string[];
    coverage: ScopedCoverage;
  };
  windows: ScopedGlucoseWindowResult[];
  evidence: {
    records: ScopedGlucoseEvidenceRecord[];
    recordIds: string[];
    missingWindows: ResolvedRecurringWindow[];
  };
  chart: {
    kind: 'recurring-clock-overlay-v1';
    units: 'mmol/L';
    domain: {
      startMinute: number;
      endMinuteUnwrapped: number;
      binMinutes: number;
    };
    minimumAggregateContributors: number;
    windows: Array<{
      id: string;
      label: string;
      anchorDate: DateKey;
      status: ScopedWindowStatus;
      range: TimeRange;
      coverage: ScopedCoverage;
      clockTransitions: ScopedClockTransition[];
      points: ScopedGlucoseChartPoint[];
      segments: ScopedGlucoseChartSegment[];
    }>;
    aggregatePoints: ScopedAggregateChartPoint[];
    missingWindowIds: string[];
  };
  safeguards: {
    outOfScopeReadingsExcluded: true;
    missingValues: 'omitted-not-zero';
    lineGaps: 'pre-segmented-never-bridged';
    aggregateRequiresDistinctWindows: true;
    clockChanges: 'annotated-not-sensor-missingness';
    repeatedClockBins: 'preserved-by-occurrence';
  };
}

export type ScopedGlucoseReadingInput = Pick<
  GlucoseReading,
  'id' | 'timestamp' | 'mmolL' | 'sourceId'
>;
