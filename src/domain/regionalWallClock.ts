import {
  getCachedDateTimeFormat,
} from './intlFormatterCache';
import { normalizeRegionalNumberInput } from './regionalNumberInput';

const FIXED_REFERENCE_YEAR = 2000;
const INPUT_MAP_CACHE_LIMIT = 8;
const INPUT_MAP_CACHE = new Map<string, Map<string, number>>();

function formatter(locale: string) {
  return getCachedDateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function minuteDate(minuteOfDay: number) {
  return new Date(
    Date.UTC(
      FIXED_REFERENCE_YEAR,
      0,
      1,
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
    ),
  );
}

function normalizeClockText(value: string, locale: string) {
  return value
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase(locale);
}

function parseAsciiClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function inputMap(locale: string) {
  const cached = INPUT_MAP_CACHE.get(locale);
  if (cached) return cached;
  const map = new Map<string, number>();
  const twoDigit = formatter(locale);
  const compact = getCachedDateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const date = minuteDate(minute);
    map.set(normalizeClockText(twoDigit.format(date), locale), minute);
    map.set(normalizeClockText(compact.format(date), locale), minute);
  }
  INPUT_MAP_CACHE.set(locale, map);
  if (INPUT_MAP_CACHE.size > INPUT_MAP_CACHE_LIMIT) {
    const oldest = INPUT_MAP_CACHE.keys().next().value;
    if (oldest !== undefined) INPUT_MAP_CACHE.delete(oldest);
  }
  return map;
}

/**
 * Presents canonical `HH:MM` wall-clock text without involving the device
 * timezone. Invalid source text is returned unchanged for safe diagnostics.
 */
export function formatRegionalWallClock(value: string, locale: string) {
  const minute = parseAsciiClock(value);
  return minute === undefined ? value : formatter(locale).format(minuteDate(minute));
}

/** Presents a validated minute after midnight using the locale's clock style. */
export function formatRegionalWallClockMinute(
  minuteOfDay: number,
  locale: string,
) {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1_439) {
    return '';
  }
  return formatter(locale).format(minuteDate(minuteOfDay));
}

/**
 * Parses either the locale-formatted editor value or the legacy ASCII 24-hour
 * form and returns canonical minutes after midnight.
 */
export function parseRegionalWallClock(value: string, locale: string) {
  const ascii = parseAsciiClock(value);
  if (ascii !== undefined) return ascii;
  const localizedParts = value.trim().split(':');
  if (localizedParts.length === 2) {
    const hour = normalizeRegionalNumberInput(localizedParts[0]!, locale)?.value;
    const minute = normalizeRegionalNumberInput(
      localizedParts[1]!,
      locale,
    )?.value;
    if (
      hour !== undefined &&
      minute !== undefined &&
      Number.isInteger(hour) &&
      Number.isInteger(minute) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {
      return hour * 60 + minute;
    }
  }
  return inputMap(locale).get(normalizeClockText(value, locale));
}
