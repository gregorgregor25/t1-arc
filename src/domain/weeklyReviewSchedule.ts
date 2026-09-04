import { getCachedDateTimeFormat } from './intlFormatterCache';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import { addDays, DateKey, toDateKey, zonedDateTimeToTimestamp } from './time';

const WEEKDAY_OFFSETS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface WeeklyReviewScheduleOptions {
  /** Sunday is 0 through Saturday 6. Defaults to the regional first day. */
  weekday?: number;
  hour?: number;
  minute?: number;
  timeZone?: string;
}

export interface WeeklyReviewSchedule {
  weekKey: DateKey;
  eligibleAt: number;
  due: boolean;
}
function integerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return Number.isInteger(value) && value! >= minimum && value! <= maximum
    ? value!
    : fallback;
}

/**
 * A review becomes eligible at the selected local weekday and time. Android
 * background work is deliberately inexact, so a missed run remains eligible
 * for the rest of that regional week instead of silently disappearing.
 */
export function weeklyReviewSchedule(
  now: number,
  lastNotifiedWeek?: DateKey,
  options: WeeklyReviewScheduleOptions = {},
): WeeklyReviewSchedule {
  const regional = getRuntimeRegionalDefaults();
  const timeZone = options.timeZone ?? regional.timeZone;
  const reviewWeekday = integerInRange(
    options.weekday,
    regional.firstDayOfWeek,
    0,
    6,
  );
  const hour = integerInRange(options.hour, 7, 0, 23);
  const minute = integerInRange(options.minute, 0, 0, 59);
  const today = toDateKey(now, timeZone);
  const weekday = getCachedDateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(now);
  const currentWeekday = WEEKDAY_OFFSETS[weekday] ?? reviewWeekday;
  const daysSinceReviewDay = (currentWeekday - reviewWeekday + 7) % 7;
  const weekKey = addDays(today, -daysSinceReviewDay);
  const eligibleAt = zonedDateTimeToTimestamp(
    weekKey,
    hour,
    minute,
    0,
    timeZone,
  );
  return {
    weekKey,
    eligibleAt,
    due: now >= eligibleAt && lastNotifiedWeek !== weekKey,
  };
}
