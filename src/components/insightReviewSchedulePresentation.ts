import { getCachedDateTimeFormat } from '@/domain/intlFormatterCache';

const REFERENCE_SUNDAY_UTC = Date.UTC(2026, 7, 2, 12);

function validWeekday(weekday: number) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError('A review weekday must be between Sunday and Saturday.');
  }
  return weekday;
}

export function reviewWeekdayLabel(
  locale: string,
  weekday: number,
  width: 'short' | 'long' = 'short',
) {
  return getCachedDateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: width,
  }).format(new Date(REFERENCE_SUNDAY_UTC + validWeekday(weekday) * 86_400_000));
}

export function reviewTimeLabel(locale: string, hour: number, minute: number) {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new RangeError('A review time must be a valid local clock time.');
  }
  return getCachedDateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
}

export function weeklyReviewScheduleLabel({
  hour,
  locale,
  minute,
  timeZone,
  weekday,
}: {
  hour: number;
  locale: string;
  minute: number;
  timeZone: string;
  weekday: number;
}) {
  return `${reviewWeekdayLabel(locale, weekday)} ${reviewTimeLabel(
    locale,
    hour,
    minute,
  )} · ${timeZone}`;
}
