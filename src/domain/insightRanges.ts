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
