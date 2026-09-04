import type { TimeRange } from "@/domain/models";
import {
  formatDate,
  formatTime,
  getZonedDateTimeParts,
  toDateKey,
} from "@/domain/time";

function isLocalMidnight(timestamp: number) {
  const parts = getZonedDateTimeParts(timestamp);
  return (
    parts.hour === 0 &&
    parts.minute === 0 &&
    parts.second === 0 &&
    new Date(timestamp).getUTCMilliseconds() === 0
  );
}

/** User-facing date for a timestamp resolved in T1 Arc's selected timezone. */
export function formatTarvisLocalDate(timestamp: number) {
  return formatDate(toDateKey(timestamp), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Exact local time and date for a particular saved record or event. */
export function formatTarvisLocalDateTime(timestamp: number) {
  return `${formatTime(timestamp)} on ${formatTarvisLocalDate(timestamp)}`;
}

/**
 * Names an aggregate's exact period without implying that the aggregate
 * happened at one instant. Whole calendar days use dates; partial or rolling
 * ranges also expose their clock boundaries.
 */
export function formatTarvisRequestedPeriod(range: TimeRange) {
  const startDate = toDateKey(range.start);
  const finalDate = toDateKey(range.end - 1);
  const beginsAtMidnight = isLocalMidnight(range.start);
  const endsAtMidnight = isLocalMidnight(range.end);
  if (beginsAtMidnight && endsAtMidnight) {
    return startDate === finalDate
      ? formatTarvisLocalDate(range.start)
      : `${formatTarvisLocalDate(range.start)} to ${formatTarvisLocalDate(range.end - 1)}`;
  }
  if (startDate === finalDate) {
    return `${formatTarvisLocalDate(range.start)}, ${formatTime(range.start)} to ${formatTime(range.end)}`;
  }
  return `${formatTarvisLocalDateTime(range.start)} to ${formatTarvisLocalDateTime(range.end)}`;
}
