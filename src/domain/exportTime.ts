import { getCachedDateTimeFormat } from './intlFormatterCache';
import { getZonedDateTimeParts } from './time';

function pad(value: number, length = 2) {
  return String(Math.trunc(Math.abs(value))).padStart(length, '0');
}

/** Offset of local wall-clock time from UTC at this instant, in whole minutes. */
export function timeZoneOffsetMinutes(timestamp: number, timeZone: string): number {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((representedAsUtc - Math.floor(timestamp / 1000) * 1000) / 60_000);
}

/**
 * ISO 8601 local time with its UTC offset, for example
 * `2026-03-29T02:30:00+01:00`. Seconds precision; the offset is taken at the
 * instant itself, so clock-change days are written correctly.
 */
export function isoWithOffset(timestamp: number, timeZone: string): string {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  const offset = timeZoneOffsetMinutes(timestamp, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** UTC ISO 8601 with milliseconds, for example `2026-03-29T01:30:00.000Z`. */
export function isoUtc(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Plain description of a time zone without technical identifiers, for
 * example "London (British Summer Time)". Falls back to the place name.
 */
export function describeTimeZone(timeZone: string, locale: string, at: number): string {
  const segments = timeZone.split('/');
  const place = (segments[segments.length - 1] ?? timeZone).replace(/_/g, ' ');
  let name: string | undefined;
  try {
    name = getCachedDateTimeFormat(locale, { timeZone, timeZoneName: 'long' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    name = undefined;
  }
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return name ?? 'Coordinated Universal Time';
  return name && name !== place ? `${place} (${name})` : place;
}

export interface ClockSettings {
  locale: string;
  timeZone: string;
}

/** Local clock time, for example "14:05". */
export function formatClock(timestamp: number, settings: ClockSettings): string {
  return getCachedDateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

/** Local date, for example "15 Nov 2026". */
export function formatDay(timestamp: number, settings: ClockSettings): string {
  return getCachedDateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(timestamp);
}

/**
 * "14:05" when the time is on the same local day as `reference`, otherwise
 * "14 Nov 2026, 14:05".
 */
export function formatClockNear(
  timestamp: number,
  reference: number,
  settings: ClockSettings,
): string {
  const sameDay = formatDay(timestamp, settings) === formatDay(reference, settings);
  return sameDay
    ? formatClock(timestamp, settings)
    : `${formatDay(timestamp, settings)}, ${formatClock(timestamp, settings)}`;
}
