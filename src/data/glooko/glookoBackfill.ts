import { addDays, DateKey } from '@/domain/time';

export const GLOOKO_MAX_EXPORT_DAYS = 90;

export interface GlookoBackfillRange {
  startDate: DateKey;
  endDate: DateKey;
  days: number;
}

export function glookoRangeDays(startDate: DateKey, endDate: DateKey) {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  return (
    Math.round(
      (Date.UTC(endYear!, endMonth! - 1, endDay!) -
        Date.UTC(startYear!, startMonth! - 1, startDay!)) /
        86_400_000,
    ) + 1
  );
}

export function isDateKey(value: unknown): value is DateKey {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/**
 * Glooko limits each CSV export to 90 inclusive calendar days. This planner
 * walks backwards without overlaps. A persisted cursor is included so an
 * empty-but-successful source export still advances the backfill.
 */
export function planNextGlookoBackfill(input: {
  earliestKnownDate?: DateKey;
  backfilledBeforeDate?: DateKey;
  targetDate?: DateKey;
}): GlookoBackfillRange | undefined {
  const anchors = [
    input.earliestKnownDate,
    input.backfilledBeforeDate,
  ].filter((date): date is DateKey => Boolean(date));
  if (!anchors.length) return undefined;
  const earliestCoveredDate = anchors.sort()[0]!;
  if (
    input.targetDate !== undefined &&
    input.targetDate >= earliestCoveredDate
  ) {
    return undefined;
  }
  const endDate = addDays(earliestCoveredDate, -1);
  const naturalStart = addDays(endDate, -(GLOOKO_MAX_EXPORT_DAYS - 1));
  const startDate =
    input.targetDate !== undefined && input.targetDate > naturalStart
      ? input.targetDate
      : naturalStart;
  return {
    startDate,
    endDate,
    days: glookoRangeDays(startDate, endDate),
  };
}
