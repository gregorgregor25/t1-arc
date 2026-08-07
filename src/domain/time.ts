import { APP_TIME_ZONE, TimeRange } from './models';

export type DateKey = `${number}-${number}-${number}`;

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

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const zonedPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsFor(timestamp: number) {
  const parts = zonedPartsFormatter.formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function timeZoneOffsetMs(timestamp: number) {
  const parts = partsFor(timestamp);
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

export function zonedDateTimeToTimestamp(
  dateKey: DateKey,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcGuess = Date.UTC(year!, month! - 1, day!, hour, minute, second);
  const firstPass = utcGuess - timeZoneOffsetMs(utcGuess);
  return utcGuess - timeZoneOffsetMs(firstPass);
}

export function toDateKey(timestamp: number): DateKey {
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
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp);
}

export function formatDate(
  dateKey: DateKey,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  },
) {
  const noon = zonedDateTimeToTimestamp(dateKey, 12);
  return new Intl.DateTimeFormat('en-GB', {
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(noon);
}

export function formatShortDate(dateKey: DateKey) {
  return formatDate(dateKey, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function minutesBetween(start: number, end: number) {
  return Math.max(0, (end - start) / 60_000);
}

export function relativeAge(timestamp: number | undefined, now = Date.now()) {
  if (timestamp === undefined) return 'No data';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hr ago';
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function clampRange(range: TimeRange): TimeRange {
  if (range.end <= range.start) {
    return { start: range.start, end: range.start + 1 };
  }
  return range;
}
