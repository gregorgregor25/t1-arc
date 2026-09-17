import { getCachedDateTimeFormat } from '@/domain/intlFormatterCache';
import {
  getZonedDateTimeParts,
  type DateKey,
} from '@/domain/time';

// A time-only picker must not transport the selected calendar date through the
// device zone: that date may be a DST gap on the device even when the selected
// analysis-zone clock is valid. This mid-year anchor has no transition in the
// supported modern device zones and the date itself is never persisted.
export function pickerTimeForWallClock(
  hour: number,
  minute: number,
  second = 0,
) {
  return new Date(
    2000,
    6,
    1,
    hour,
    minute,
    second,
    0,
  );
}

export function pickerTimeForZonedTimestamp(
  timestamp: number,
  timeZone: string,
) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return pickerTimeForWallClock(parts.hour, parts.minute, parts.second);
}

export function regionalClockUses24Hours(locale: string) {
  return getCachedDateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
    .hour12 === false;
}

/**
 * Android's picker reads a Date in the device zone. Build a display-only Date
 * whose device-local fields equal the selected profile-zone wall clock.
 */
export function pickerDateForZonedTimestamp(
  timestamp: number,
  timeZone: string,
) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** A calendar-only picker value that cannot shift across zones or the date line. */
export function pickerDateForDateKey(date: DateKey) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12, 0, 0, 0);
}

export function dateKeyFromPickerDate(value: Date): DateKey {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-') as DateKey;
}

export function wallClockFromPickerDate(value: Date) {
  return {
    hour: value.getHours(),
    minute: value.getMinutes(),
    second: value.getSeconds(),
  };
}
