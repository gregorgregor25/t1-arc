import type { TimeRange } from './models';
import {
  addDays,
  type DateKey,
  getZonedDateTimeParts,
  toDateKey,
  zonedDateTimeToTimestamp,
} from './time';

/** Local wall-clock minutes after midnight. */
export interface NightSchedule {
  startMinutes: number;
  endMinutes: number;
}

/** Used when the person has not set a night schedule in alarm settings. */
export const DEFAULT_NIGHT_SCHEDULE: NightSchedule = Object.freeze({
  startMinutes: 0,
  endMinutes: 6 * 60,
});

/** The morning summary is offered from 05:00 until 12:00 local time. */
export const MORNING_SUMMARY_START_HOUR = 5;
export const MORNING_SUMMARY_END_HOUR = 12;

export interface OvernightWindow {
  /** The calendar date the night ends on, in the person's time zone. */
  endDate: DateKey;
  /** Full scheduled night, which can be 7 or 5 hours on a clock-change night. */
  scheduled: TimeRange;
  /** The part of the night that has already happened. */
  range: TimeRange;
  /** True while the scheduled night has not yet ended. */
  inProgress: boolean;
  source: 'default' | 'alarm-schedule';
}

function validMinutes(value: number) {
  return Number.isInteger(value) && value >= 0 && value < 24 * 60;
}

/** Returns a usable schedule, or the 00:00–06:00 default. */
export function resolveNightSchedule(
  schedule: NightSchedule | null | undefined,
): { schedule: NightSchedule; source: OvernightWindow['source'] } {
  if (
    schedule &&
    validMinutes(schedule.startMinutes) &&
    validMinutes(schedule.endMinutes) &&
    schedule.startMinutes !== schedule.endMinutes
  ) {
    return { schedule, source: 'alarm-schedule' };
  }
  return { schedule: DEFAULT_NIGHT_SCHEDULE, source: 'default' };
}

function wallClock(dateKey: DateKey, minutes: number, timeZone: string) {
  return zonedDateTimeToTimestamp(
    dateKey,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    timeZone,
  );
}

function scheduledNight(endDate: DateKey, schedule: NightSchedule, timeZone: string): TimeRange {
  const startDate = schedule.startMinutes < schedule.endMinutes ? endDate : addDays(endDate, -1);
  return {
    start: wallClock(startDate, schedule.startMinutes, timeZone),
    end: wallClock(endDate, schedule.endMinutes, timeZone),
  };
}

/**
 * The most recent night that has started: the night ending today when it has
 * begun, otherwise the night that ended yesterday. Times are local wall-clock
 * times in `timeZone`, so a clock-change night keeps its real length.
 */
export function lastNightWindow(
  now: number,
  timeZone: string,
  schedule?: NightSchedule | null,
): OvernightWindow {
  const resolved = resolveNightSchedule(schedule);
  let endDate = toDateKey(now, timeZone);
  let scheduled = scheduledNight(endDate, resolved.schedule, timeZone);
  if (scheduled.start > now) {
    endDate = addDays(endDate, -1);
    scheduled = scheduledNight(endDate, resolved.schedule, timeZone);
  }
  const inProgress = now < scheduled.end;
  return {
    endDate,
    scheduled,
    range: { start: scheduled.start, end: inProgress ? now : scheduled.end },
    inProgress,
    source: resolved.source,
  };
}

/** True from 05:00 up to (not including) 12:00 local time. */
export function isMorningSummaryTime(now: number, timeZone: string) {
  const { hour } = getZonedDateTimeParts(now, timeZone);
  return hour >= MORNING_SUMMARY_START_HOUR && hour < MORNING_SUMMARY_END_HOUR;
}
