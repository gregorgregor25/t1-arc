import type { TimeRange } from "@/domain/models";
import type { ResolvedTarvisIntentRange } from "./intentRange";
import { formatTarvisNumber } from "./regionalNumberPresentation";
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

/** Short answer copy; evidence retains the exact resolved boundaries. */
export function formatTarvisCompactPeriod(range: TimeRange) {
  const date = (timestamp: number) => formatDate(toDateKey(timestamp), {
    day: "numeric", month: "short", year: "numeric",
  });
  const start = date(range.start);
  const final = date(range.end - 1);
  const dates = start === final ? start : `${start} to ${final}`;
  if (isLocalMidnight(range.start)) {
    return isLocalMidnight(range.end) ? dates : `${dates}, through ${formatTime(range.end)}`;
  }
  return `${start} ${formatTime(range.start)} to ${date(range.end)} ${formatTime(range.end)}`;
}

/** Duration is observable; unequal durations alone do not establish a DST change. */
export function tarvisComparisonDurationNote(
  resolved: Pick<ResolvedTarvisIntentRange, "current" | "previous" | "currentCappedAtAsOf">,
) {
  if (!resolved.previous) return null;
  const currentHours = (resolved.current.end - resolved.current.start) / 3_600_000;
  const previousHours = (resolved.previous.end - resolved.previous.start) / 3_600_000;
  if (currentHours === previousHours) return null;
  const currentDuration = formatTarvisNumber(currentHours, { maximumFractionDigits: 2 });
  const previousDuration = formatTarvisNumber(previousHours, { maximumFractionDigits: 2 });
  // A millisecond-short synthetic boundary must not produce "168 versus 168"
  // as a warning about different durations. Exact ranges remain in evidence.
  if (currentDuration === previousDuration) return null;
  const duration = `${currentDuration} versus ${previousDuration} hours`;
  const reason = resolved.currentCappedAtAsOf
    ? "The current period ends at the time you asked. These periods have different durations"
    : "These calendar periods have different elapsed durations";
  return `${reason} (${duration}). Counts and totals are shown as recorded, not adjusted to equal lengths.`;
}
