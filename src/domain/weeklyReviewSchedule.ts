import { addDays, DateKey, toDateKey, zonedDateTimeToTimestamp } from './time';
import { APP_TIME_ZONE } from './models';

const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
});

const WEEKDAY_OFFSETS: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export interface WeeklyReviewSchedule {
  weekKey: DateKey;
  eligibleAt: number;
  due: boolean;
}
/**
 * A review becomes eligible from 07:00 Europe/London each Monday. Android
 * background work is deliberately inexact, so a missed Monday run remains
 * eligible for the rest of that week instead of silently disappearing.
 */
export function weeklyReviewSchedule(
  now: number,
  lastNotifiedWeek?: DateKey,
): WeeklyReviewSchedule {
  const today = toDateKey(now);
  const weekday = weekdayFormatter.format(now);
  const monday = addDays(today, -(WEEKDAY_OFFSETS[weekday] ?? 0));
  const eligibleAt = zonedDateTimeToTimestamp(monday, 7);
  return {
    weekKey: monday,
    eligibleAt,
    due: now >= eligibleAt && lastNotifiedWeek !== monday,
  };
}
