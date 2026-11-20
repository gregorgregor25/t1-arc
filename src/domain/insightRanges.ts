import { TimeRange } from './models';
import { addDays, DateKey, dayRange } from './time';

export type InsightPeriodDays = 3 | 7 | 14 | 30 | 90;

export interface InsightComparisonRanges {
  current: TimeRange;
  previous: TimeRange;
}

/**
 * Builds adjacent, non-overlapping analysis-zone calendar windows. The selected
 * date is the final included day. Calendar boundaries keep comparisons correct
 * across local clock transitions.
 */
export function buildInsightComparisonRanges(
  endDate: DateKey,
  periodDays: InsightPeriodDays,
  now = Date.now(),
): InsightComparisonRanges {
  const currentStartDate = addDays(endDate, -(periodDays - 1));
  const previousStartDate = addDays(endDate, -(periodDays * 2 - 1));
  const currentStart = dayRange(currentStartDate, now).start;

  return {
    current: {
      start: currentStart,
      end: dayRange(endDate, now).end,
    },
    previous: {
      start: dayRange(previousStartDate, now).start,
      end: currentStart,
    },
  };
}

export const INSIGHT_PERIOD_DAYS: readonly InsightPeriodDays[] = [3, 7, 14, 30, 90];

/** One-shot navigation command that opens Insights on a chosen comparison. */
export interface InsightComparisonRequest {
  periodDays: InsightPeriodDays;
  /** Final included day of the recent period. */
  endDate: DateKey;
  /** Unique token so repeating the same request is still applied. */
  request: string;
}

export function isInsightComparisonRequest(
  value: unknown,
): value is InsightComparisonRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    INSIGHT_PERIOD_DAYS.includes(candidate.periodDays as InsightPeriodDays) &&
    typeof candidate.endDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.endDate) &&
    typeof candidate.request === 'string' &&
    candidate.request.length > 0
  );
}

/**
 * Chooses the comparison period for a History view. Multi-day views keep
 * their length; a single day has no day-level comparison, so it opens the
 * seven days ending on that day. The end date is never after the latest
 * complete day, because Insights compares complete days only.
 */
export function insightComparisonForHistoryView(
  historyDays: number,
  selectedDate: DateKey,
  latestCompleteDate: DateKey,
): Omit<InsightComparisonRequest, 'request'> {
  const periodDays: InsightPeriodDays =
    historyDays === 3 || historyDays === 7 || historyDays === 30 ? historyDays : 7;
  return {
    periodDays,
    endDate: selectedDate > latestCompleteDate ? latestCompleteDate : selectedDate,
  };
}
