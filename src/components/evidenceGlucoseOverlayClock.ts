import { addDays, getZonedDateTimeParts, toDateKey } from '@/domain/time';

/** Clock position for an evening-to-morning overlay, using a forced 24-hour field. */
export function evidenceOverlayClockMinute(
  timestamp: number,
  _locale: string,
  timeZone: string,
) {
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  const clockMinute = parts.hour * 60 + parts.minute;
  return clockMinute < 12 * 60 ? clockMinute + 24 * 60 : clockMinute;
}

/** The overlay day begins at local noon, not at UTC noon. */
export function evidenceOverlayDateKey(timestamp: number, timeZone: string) {
  const dateKey = toDateKey(timestamp, timeZone);
  return getZonedDateTimeParts(timestamp, timeZone).hour < 12
    ? addDays(dateKey, -1)
    : dateKey;
}
