/**
 * Parses an external absolute timestamp only when the sender included a UTC
 * designator or numeric offset. Offsetless provider clocks are not instants:
 * Date.parse would reinterpret them in the phone's current timezone.
 */
export function parseExternalAbsoluteTimestamp(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const explicitIso =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):?(\d{2}))$/i.exec(
      trimmed,
    );
  const explicitRfc =
    /^([A-Za-z]{3}),\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|([+-])(\d{2})(\d{2}))$/i.exec(
      trimmed,
    );
  if (explicitIso) {
    const year = Number(explicitIso[1]);
    const month = Number(explicitIso[2]);
    const day = Number(explicitIso[3]);
    const hour = Number(explicitIso[4]);
    const minute = Number(explicitIso[5]);
    const second = Number(explicitIso[6] ?? 0);
    const offsetHour = Number(explicitIso[8] ?? 0);
    const offsetMinute = Number(explicitIso[9] ?? 0);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      offsetHour > 23 ||
      offsetMinute > 59
    ) {
      return undefined;
    }
  } else {
    if (!explicitRfc) return undefined;
    const months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const weekday = weekdays.indexOf((explicitRfc[1] ?? '').toLowerCase());
    const day = Number(explicitRfc[2]);
    const month = months.indexOf((explicitRfc[3] ?? '').toLowerCase()) + 1;
    const year = Number(explicitRfc[4]);
    const hour = Number(explicitRfc[5]);
    const minute = Number(explicitRfc[6]);
    const second = Number(explicitRfc[7] ?? 0);
    const offsetHour = Number(explicitRfc[9] ?? 0);
    const offsetMinute = Number(explicitRfc[10] ?? 0);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
      weekday < 0 ||
      month === 0 ||
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      calendar.getUTCDay() !== weekday ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      offsetHour > 23 ||
      offsetMinute > 59
    ) {
      return undefined;
    }
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
