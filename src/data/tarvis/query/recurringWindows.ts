import { getCachedDateTimeFormat } from "@/domain/intlFormatterCache";
import { isIanaTimeZone } from "@/domain/regionalProfile";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { formatRegionalWallClockMinute } from "@/domain/regionalWallClock";
import { addDays, formatShortDate, toDateKey } from "@/domain/time";

import type {
  LocalClockTime,
  RecurringClockWindow,
  ResolvedRecurringWindow,
  ScopedClockTransition,
  SupportedQueryTimeZone,
} from "./types";

interface ResolveRecurringWindowsInput {
  timezone: SupportedQueryTimeZone;
  asOf: number;
  count: number;
  clockWindow: RecurringClockWindow;
}

function assertFiniteTimestamp(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative timestamp.`);
  }
}

function assertClockTime(value: LocalClockTime, label: string) {
  if (
    !Number.isInteger(value.hour) ||
    value.hour < 0 ||
    value.hour > 23 ||
    !Number.isInteger(value.minute) ||
    value.minute < 0 ||
    value.minute > 59
  ) {
    throw new RangeError(`${label} must be a valid 24-hour local clock time.`);
  }
}

export function clockMinute(value: LocalClockTime) {
  return value.hour * 60 + value.minute;
}

export function formatClockTime(value: LocalClockTime) {
  return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

/** Locale-aware presentation only; canonical IDs continue to use formatClockTime. */
export function formatClockTimeForDisplay(
  value: LocalClockTime,
  locale = getRuntimeRegionalDefaults().locale,
) {
  return formatRegionalWallClockMinute(clockMinute(value), locale);
}

export function resolveClockWindowShape(clockWindow: RecurringClockWindow) {
  assertClockTime(clockWindow.start, "clockWindow.start");
  assertClockTime(clockWindow.end, "clockWindow.end");
  const startMinute = clockMinute(clockWindow.start);
  const endMinute = clockMinute(clockWindow.end);
  if (startMinute === endMinute) {
    throw new RangeError(
      "A recurring clock window must have different start and end times.",
    );
  }
  const crossesMidnight = endMinute < startMinute;
  if (
    clockWindow.crossesMidnight !== undefined &&
    clockWindow.crossesMidnight !== crossesMidnight
  ) {
    throw new RangeError(
      "clockWindow.crossesMidnight conflicts with the supplied start and end times.",
    );
  }
  return {
    startMinute,
    endMinuteUnwrapped: crossesMidnight ? endMinute + 1440 : endMinute,
    crossesMidnight,
  };
}

function absoluteRangeForAnchor(
  anchorDate: ReturnType<typeof toDateKey>,
  clockWindow: RecurringClockWindow,
  timeZone: string,
) {
  const shape = resolveClockWindowShape(clockWindow);
  const start = resolveUniqueLocalBoundary(
    anchorDate,
    clockWindow.start,
    "start",
    timeZone,
  );
  const endDate = shape.crossesMidnight ? addDays(anchorDate, 1) : anchorDate;
  const end = resolveUniqueLocalBoundary(
    endDate,
    clockWindow.end,
    "end",
    timeZone,
  );
  if (!(end > start)) {
    throw new RangeError(
      `The local window on ${anchorDate} did not resolve to a positive absolute interval.`,
    );
  }
  return { start, end };
}

/**
 * Resolves a local boundary only when it maps to exactly one instant.
 * Nonexistent spring times and repeated autumn times must be clarified by the
 * caller instead of being silently shifted or assigned to one fold occurrence.
 */
function resolveUniqueLocalBoundary(
  dateKey: ReturnType<typeof toDateKey>,
  clock: LocalClockTime,
  boundary: "start" | "end",
  timeZone: string,
) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const nominalUtc = Date.UTC(
    year!,
    month! - 1,
    day!,
    clock.hour,
    clock.minute,
  );
  const possibleOffsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    possibleOffsets.add(
      utcOffsetMinutesAt(nominalUtc + hours * 60 * 60_000, timeZone),
    );
  }
  const candidates = [...possibleOffsets]
    .map((offset) => nominalUtc - offset * 60_000)
    .filter((timestamp) => {
      const parts = localParts(timestamp, timeZone);
      return (
        parts.year === year &&
        parts.month === month &&
        parts.day === day &&
        parts.hour === clock.hour &&
        parts.minute === clock.minute &&
        parts.second === 0
      );
    })
    .sort((left, right) => left - right);
  if (candidates.length === 0) {
    throw new RangeError(
      `The ${boundary} boundary ${dateKey} ${formatClockTime(clock)} does not exist because of a daylight-saving clock change.`,
    );
  }
  if (candidates.length > 1) {
    throw new RangeError(
      `The ${boundary} boundary ${dateKey} ${formatClockTime(clock)} occurs more than once because of a daylight-saving clock change.`,
    );
  }
  return candidates[0]!;
}

function localParts(timestamp: number, timeZone: string) {
  const parts = getCachedDateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second"),
  };
}

export function utcOffsetMinutesAt(timestamp: number, timeZone: string) {
  const parts = localParts(timestamp, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (representedAsUtc - Math.floor(timestamp / 1000) * 1000) / 60_000;
}

function findOffsetTransition(start: number, end: number, timeZone: string) {
  const before = utcOffsetMinutesAt(start, timeZone);
  const finalTimestamp = end - 1;
  const after = utcOffsetMinutesAt(finalTimestamp, timeZone);
  if (before === after) return null;

  // A recurring window is shorter than one local day, so London can contain
  // at most one offset transition. Find the first absolute millisecond using
  // the new offset without depending on the host machine's timezone.
  let low = start;
  let high = finalTimestamp;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (utcOffsetMinutesAt(middle, timeZone) === before) low = middle;
    else high = middle;
  }
  return {
    atTimestamp: high,
    utcOffsetBeforeMinutes: before,
    utcOffsetAfterMinutes: after,
  };
}

export function clockTransitionsForWindow(
  range: { start: number; end: number },
  anchorDate: ReturnType<typeof toDateKey>,
  crossesMidnight: boolean,
  timeZone: string,
): ScopedClockTransition[] {
  const transition = findOffsetTransition(range.start, range.end, timeZone);
  if (!transition) return [];
  const offsetDelta =
    transition.utcOffsetAfterMinutes - transition.utcOffsetBeforeMinutes;
  const localMinuteAfter = unwrappedClockMinute(
    transition.atTimestamp,
    anchorDate,
    crossesMidnight,
    timeZone,
  );
  const kind = offsetDelta > 0 ? "gap" : "fold";
  const changeMinutes = Math.abs(offsetDelta);
  return [
    {
      kind,
      ...transition,
      changeMinutes,
      affectedStartMinute:
        kind === "gap" ? localMinuteAfter - changeMinutes : localMinuteAfter,
      affectedEndMinute:
        kind === "gap" ? localMinuteAfter : localMinuteAfter + changeMinutes,
    },
  ];
}

/**
 * Resolves the N latest fully completed recurring local-clock windows.
 *
 * Windows are absolute, half-open intervals. Expected duration is calculated
 * from their absolute boundaries, so daylight-saving transitions naturally have
 * one fewer or one additional elapsed hour.
 */
export function resolveMostRecentCompletedRecurringWindows(
  input: ResolveRecurringWindowsInput,
): ResolvedRecurringWindow[] {
  if (!isIanaTimeZone(input.timezone)) {
    throw new RangeError(`Invalid IANA timezone: ${input.timezone}.`);
  }
  assertFiniteTimestamp(input.asOf, "asOf");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 366) {
    throw new RangeError("count must be an integer between 1 and 366.");
  }
  const shape = resolveClockWindowShape(input.clockWindow);
  let anchorDate = toDateKey(input.asOf, input.timezone);
  let candidate = absoluteRangeForAnchor(
    anchorDate,
    input.clockWindow,
    input.timezone,
  );
  while (candidate.end > input.asOf) {
    anchorDate = addDays(anchorDate, -1);
    candidate = absoluteRangeForAnchor(
      anchorDate,
      input.clockWindow,
      input.timezone,
    );
  }

  const newestFirst: Omit<ResolvedRecurringWindow, "sequence">[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const range = absoluteRangeForAnchor(
      anchorDate,
      input.clockWindow,
      input.timezone,
    );
    const id = [
      "clock-window",
      anchorDate,
      formatClockTime(input.clockWindow.start).replace(":", ""),
      formatClockTime(input.clockWindow.end).replace(":", ""),
    ].join(":");
    newestFirst.push({
      id,
      anchorDate,
      label: `${formatShortDate(anchorDate, input.timezone)} · ${formatClockTimeForDisplay(input.clockWindow.start)}–${formatClockTimeForDisplay(input.clockWindow.end)}`,
      range,
      elapsedMinutes: (range.end - range.start) / 60_000,
      clockTransitions: clockTransitionsForWindow(
        range,
        anchorDate,
        shape.crossesMidnight,
        input.timezone,
      ),
    });
    anchorDate = addDays(anchorDate, -1);
  }

  // Chronological order gives deterministic evidence, chart legends and IDs.
  return newestFirst.reverse().map((window, sequence) => ({
    ...window,
    sequence,
  }));
}

export function unwrappedClockMinute(
  timestamp: number,
  anchorDate: ReturnType<typeof toDateKey>,
  crossesMidnight: boolean,
  timeZone: string,
) {
  const parts = localParts(timestamp, timeZone);
  const minute = parts.hour * 60 + parts.minute + parts.second / 60;
  const localDate = toDateKey(timestamp, timeZone);
  return crossesMidnight && localDate !== anchorDate ? minute + 1440 : minute;
}

export const recurringWindowInternals = {
  absoluteRangeForAnchor,
};
