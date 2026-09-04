import { APP_TIME_ZONE, TimeRange } from './models';
import { getCachedDateTimeFormat } from './intlFormatterCache';
import { formatRegionalNumber } from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

export type DateKey = `${number}-${number}-${number}`;
export type AmbiguousWallClockResolution = 'reject' | 'earlier' | 'later';

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export class ZonedWallClockError extends Error {
  constructor(
    readonly kind: 'invalid' | 'nonexistent' | 'ambiguous',
    message: string,
  ) {
    super(message);
    this.name = 'ZonedWallClockError';
  }
}

export const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000;

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function runtimeTimeZone() {
  try {
    return getRuntimeRegionalDefaults().timeZone;
  } catch {
    return APP_TIME_ZONE;
  }
}

function wallClockFormatter(timeZone: string) {
  try {
    return getCachedDateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new ZonedWallClockError(
      'invalid',
      `"${timeZone}" is not a valid IANA time zone.`,
    );
  }
}

function partsFromFormatter(
  timestamp: number,
  formatter: Intl.DateTimeFormat,
): ZonedDateTimeParts {
  if (!Number.isFinite(timestamp)) {
    throw new ZonedWallClockError('invalid', 'The selected date and time are invalid.');
  }
  const parts = formatter.formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);

  const result = {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
  if (Object.values(result).some((part) => !Number.isFinite(part))) {
    throw new ZonedWallClockError('invalid', 'The selected date and time are invalid.');
  }
  return result;
}

/** Numeric calendar fields in the requested zone; never parse localized text. */
export function getZonedDateTimeParts(
  timestamp: number,
  timeZone = runtimeTimeZone(),
) {
  return partsFromFormatter(timestamp, wallClockFormatter(timeZone));
}

function timeZoneOffsetMs(timestamp: number, timeZone: string) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(timestamp / 1000) * 1000;
}

function offsetsAroundWallClock(
  representedAsUtc: number,
  formatter: Intl.DateTimeFormat,
) {
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 1) {
    const sample = representedAsUtc + deltaHours * 3_600_000;
    const parts = partsFromFormatter(sample, formatter);
    offsets.add(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - Math.floor(sample / 1_000) * 1_000,
    );
  }
  return [...offsets];
}

function normalizedUtcParts(timestamp: number): ZonedDateTimeParts {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

export function zonedDateTimeToTimestamp(
  dateKey: DateKey,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = runtimeTimeZone(),
) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcGuess = Date.UTC(year!, month! - 1, day!, hour, minute, second);
  const firstPass = utcGuess - timeZoneOffsetMs(utcGuess, timeZone);
  const fastCandidate = utcGuess - timeZoneOffsetMs(firstPass, timeZone);
  const formatter = wallClockFormatter(timeZone);
  const desired = normalizedUtcParts(utcGuess);

  // The two-pass fixed-point path is inexpensive and exact for ordinary wall
  // clocks. Verify it because a DST transition at 00:00 can otherwise settle
  // on 23:00 of the previous calendar day.
  if (sameWallClock(partsFromFormatter(fastCandidate, formatter), desired)) {
    return fastCandidate;
  }

  const candidates = offsetsAroundWallClock(utcGuess, formatter).map((offset) => {
    const timestamp = utcGuess - offset;
    const parts = partsFromFormatter(timestamp, formatter);
    return {
      timestamp,
      representedAsUtc: Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ),
    };
  });
  const exact = candidates
    .filter((candidate) => candidate.representedAsUtc === utcGuess)
    .sort((left, right) => left.timestamp - right.timestamp);
  if (exact.length) return exact[0]!.timestamp;

  // Keep the historical range-helper behaviour for a nonexistent wall clock:
  // move forward by the clock-change gap (Temporal's "compatible" rule). This
  // makes a midnight gap begin at the first representable time on that date
  // instead of leaking into the previous day.
  const afterGap = candidates
    .filter((candidate) => candidate.representedAsUtc > utcGuess)
    .sort(
      (left, right) =>
        left.representedAsUtc - right.representedAsUtc ||
        left.timestamp - right.timestamp,
    );
  if (afterGap.length) return afterGap[0]!.timestamp;

  throw new ZonedWallClockError(
    'nonexistent',
    `${dateKey} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} cannot be represented in ${timeZone}.`,
  );
}

function sameWallClock(
  left: ZonedDateTimeParts,
  right: ZonedDateTimeParts,
) {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second;
}

/**
 * Returns every instant represented by one local wall clock in an IANA zone.
 * There are normally one, zero in a forward gap, or two in a backward fold.
 * Offset discovery is transition-size agnostic (for example Lord Howe's
 * 30-minute clock changes).
 */
export function zonedWallClockCandidates(
  dateKey: DateKey,
  hour: number,
  minute = 0,
  second = 0,
  timeZone = runtimeTimeZone(),
  millisecond = 0,
) {
  if (!isDateKey(dateKey)) {
    throw new ZonedWallClockError('invalid', 'Choose a valid date.');
  }
  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59 ||
    !Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999
  ) {
    throw new ZonedWallClockError('invalid', 'Choose a valid time.');
  }

  const formatter = wallClockFormatter(timeZone);
  const [year, month, day] = dateKey.split('-').map(Number);
  const desired: ZonedDateTimeParts = {
    year: year!,
    month: month!,
    day: day!,
    hour,
    minute,
    second,
  };
  const representedAsUtc = Date.UTC(year!, month! - 1, day!, hour, minute, second);
  return [
    ...new Set(
      offsetsAroundWallClock(representedAsUtc, formatter)
        .map((offset) => representedAsUtc - offset + millisecond)
        .filter((candidate) =>
          sameWallClock(partsFromFormatter(candidate, formatter), desired),
        ),
    ),
  ].sort((left, right) => left - right);
}

/**
 * Resolves a user-selected local wall-clock time. Unlike the lightweight range
 * helper above, this rejects daylight-saving gaps and makes repeated hours an
 * explicit choice so an editor never silently changes a health-record time.
 */
export function resolveZonedWallClock(
  dateKey: DateKey,
  hour: number,
  minute = 0,
  second = 0,
  timeZone = runtimeTimeZone(),
  ambiguousResolution: AmbiguousWallClockResolution = 'reject',
  millisecond = 0,
) {
  const candidates = zonedWallClockCandidates(
    dateKey,
    hour,
    minute,
    second,
    timeZone,
    millisecond,
  );

  const clock = `${dateKey} ${String(hour).padStart(2, '0')}:${String(
    minute,
  ).padStart(2, '0')}`;
  if (!candidates.length) {
    throw new ZonedWallClockError(
      'nonexistent',
      `${clock} does not exist in ${timeZone} because of a clock change. Choose another time.`,
    );
  }
  if (candidates.length > 1 && ambiguousResolution === 'reject') {
    throw new ZonedWallClockError(
      'ambiguous',
      `${clock} occurs twice in ${timeZone}. Choose the first or second occurrence.`,
    );
  }
  return ambiguousResolution === 'later'
    ? candidates[candidates.length - 1]!
    : candidates[0]!;
}

export function toDateKey(timestamp: number, timeZone = runtimeTimeZone()): DateKey {
  const dateKeyFormatter = getCachedDateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dateKeyFormatter.formatToParts(timestamp);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}` as DateKey;
}

export function addDays(dateKey: DateKey, amount: number): DateKey {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + amount));
  const result = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return result as DateKey;
}

export function dayRange(dateKey: DateKey, now = Date.now()): TimeRange {
  const start = zonedDateTimeToTimestamp(dateKey);
  const naturalEnd = zonedDateTimeToTimestamp(addDays(dateKey, 1));
  const today = toDateKey(now);
  return {
    start,
    end: dateKey === today ? Math.min(now, naturalEnd) : naturalEnd,
  };
}

export function multiDayRange(
  endDateKey: DateKey,
  days: number,
  now = Date.now(),
): TimeRange {
  const endDay = dayRange(endDateKey, now);
  return {
    start: zonedDateTimeToTimestamp(addDays(endDateKey, -(days - 1))),
    end: endDay.end,
  };
}

export function formatTime(timestamp: number) {
  const defaults = getRuntimeRegionalDefaults();
  return getCachedDateTimeFormat(defaults.locale, {
    timeZone: defaults.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function formatDate(
  dateKey: DateKey,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  },
  timeZone = runtimeTimeZone(),
) {
  const noon = zonedDateTimeToTimestamp(dateKey, 12, 0, 0, timeZone);
  const defaults = getRuntimeRegionalDefaults();
  return getCachedDateTimeFormat(defaults.locale, {
    ...options,
    timeZone,
  }).format(noon);
}

export function formatShortDate(
  dateKey: DateKey,
  timeZone = runtimeTimeZone(),
) {
  return formatDate(dateKey, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }, timeZone);
}

export function minutesBetween(start: number, end: number) {
  return Math.max(0, (end - start) / 60_000);
}

export function relativeAge(timestamp: number | undefined, now = Date.now()) {
  if (timestamp === undefined) return 'No data';
  const locale = getRuntimeRegionalDefaults().locale;
  const formatCount = (value: number) =>
    formatRegionalNumber(value, locale, { maximumFractionDigits: 0 });
  const futureBy = timestamp - now;
  if (futureBy > FUTURE_CLOCK_SKEW_TOLERANCE_MS) {
    const minutesAhead = Math.ceil(futureBy / 60_000);
    if (minutesAhead < 60) return `${formatCount(minutesAhead)} min ahead`;
    const hoursAhead = Math.ceil(minutesAhead / 60);
    if (hoursAhead < 24) {
      return `${formatCount(hoursAhead)} hr ahead`;
    }
    const daysAhead = Math.ceil(hoursAhead / 24);
    return `${formatCount(daysAhead)} ${daysAhead === 1 ? 'day' : 'days'} ahead`;
  }
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${formatCount(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${formatCount(hours)} hr ago`;
  const days = Math.floor(hours / 24);
  return `${formatCount(days)} ${days === 1 ? 'day' : 'days'} ago`;
}

export function clampRange(range: TimeRange): TimeRange {
  if (range.end <= range.start) {
    return { start: range.start, end: range.start + 1 };
  }
  return range;
}
