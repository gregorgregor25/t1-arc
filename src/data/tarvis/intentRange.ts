import type { TimeRange } from "@/domain/models";
import { getCachedDateTimeFormat } from "@/domain/intlFormatterCache";
import { isIanaTimeZone } from "@/domain/regionalProfile";
import {
  getRuntimeAnalysisTimeZone,
  getRuntimeRegionalDefaults,
} from "@/domain/regionalProfileRuntime";
import {
  addDays,
  isDateKey,
  resolveZonedWallClock,
  type DateKey,
  toDateKey,
  ZonedWallClockError,
  zonedDateTimeToTimestamp,
} from "@/domain/time";

import type {
  TarvisComparison,
  TarvisIntentV1,
  TarvisTemporalScope,
} from "./intent";

export const TARVIS_INTENT_RANGE_SCHEMA_VERSION = 1 as const;

export interface ResolveTarvisIntentRangeInput {
  intent: Pick<TarvisIntentV1, "temporalScope" | "clockWindow" | "comparison">;
  asOf: number;
  timezone?: string;
}

export type TarvisIntentComparisonBasis =
  | "adjacent_equal_elapsed_time"
  | "adjacent_local_calendar_days"
  | "previous_local_calendar_week"
  | "previous_local_calendar_month"
  | "matching_local_wall_clock_progress";

export interface ResolvedTarvisIntentRange {
  status: "resolved";
  schemaVersion: typeof TARVIS_INTENT_RANGE_SCHEMA_VERSION;
  timezone: string;
  asOf: number;
  current: TimeRange;
  previous: TimeRange | null;
  comparisonBasis: TarvisIntentComparisonBasis | null;
  currentCappedAtAsOf: boolean;
  intervalConvention: "half-open";
}

export interface DelegatedTarvisIntentRange {
  status: "delegate";
  schemaVersion: typeof TARVIS_INTENT_RANGE_SCHEMA_VERSION;
  code: "recurring_clock_window";
  delegateTo: "scoped-glucose-recurring-window";
  message: string;
}

export type TarvisIntentRangeRejectionCode =
  | "unsupported_timezone"
  | "invalid_as_of"
  | "invalid_scope"
  | "invalid_range"
  | "empty_range"
  | "future_range"
  | "reversed_range"
  | "clock_window_required"
  | "unsupported_comparison"
  | "nonexistent_local_time"
  | "ambiguous_local_time"
  | "unrepresentable_calendar_progress";

export interface RejectedTarvisIntentRange {
  status: "rejected";
  schemaVersion: typeof TARVIS_INTENT_RANGE_SCHEMA_VERSION;
  code: TarvisIntentRangeRejectionCode;
  message: string;
}

export type TarvisIntentRangeResolution =
  | ResolvedTarvisIntentRange
  | DelegatedTarvisIntentRange
  | RejectedTarvisIntentRange;

interface CurrentRangeResolution {
  range: TimeRange;
  cappedAtAsOf: boolean;
}

type CurrentRangeResult = CurrentRangeResolution | RejectedTarvisIntentRange;

type PreviousRangeResult =
  | {
      range: TimeRange;
      basis: TarvisIntentComparisonBasis;
    }
  | RejectedTarvisIntentRange;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function rejected(
  code: TarvisIntentRangeRejectionCode,
  message: string,
): RejectedTarvisIntentRange {
  return {
    status: "rejected",
    schemaVersion: TARVIS_INTENT_RANGE_SCHEMA_VERSION,
    code,
    message,
  };
}

function isRejected(
  value: CurrentRangeResult | PreviousRangeResult,
): value is RejectedTarvisIntentRange {
  return "status" in value && value.status === "rejected";
}

function localParts(timestamp: number): LocalDateTimeParts {
  const parts = getCachedDateTimeFormat("en-GB", {
    timeZone: getRuntimeAnalysisTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    millisecond: ((timestamp % 1_000) + 1_000) % 1_000,
  };
}

function dateKeyParts(date: DateKey) {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

function dateKeyFromParts(year: number, month: number, day: number) {
  const value = [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  return isDateKey(value) ? value : null;
}

function startOfDate(date: DateKey) {
  return zonedDateTimeToTimestamp(date);
}

function naturalDateRange(date: DateKey): TimeRange {
  return {
    start: startOfDate(date),
    end: startOfDate(addDays(date, 1)),
  };
}

function monthStart(date: DateKey): DateKey {
  const { year, month } = dateKeyParts(date);
  return dateKeyFromParts(year, month, 1)! as DateKey;
}

function shiftMonthStart(date: DateKey, amount: number): DateKey {
  const { year, month } = dateKeyParts(date);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return dateKeyFromParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    1,
  )! as DateKey;
}

function localWeekStart(date: DateKey): DateKey {
  const { year, month, day } = dateKeyParts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const firstDay = getRuntimeRegionalDefaults().firstDayOfWeek;
  const daysSinceWeekStart = (weekday - firstDay + 7) % 7;
  return addDays(date, -daysSinceWeekStart);
}

function inclusiveCalendarDayCount(startDate: DateKey, endDate: DateKey) {
  const start = dateKeyParts(startDate);
  const end = dateKeyParts(endDate);
  return (
    Math.round(
      (Date.UTC(end.year, end.month - 1, end.day) -
        Date.UTC(start.year, start.month - 1, start.day)) /
        86_400_000,
    ) + 1
  );
}

function validRange(
  range: TimeRange,
  asOf: number,
): RejectedTarvisIntentRange | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return rejected("invalid_range", "The resolved range was not finite.");
  }
  if (range.start < 0 || range.end < 0) {
    return rejected(
      "invalid_range",
      "The resolved range predates supported timestamp storage.",
    );
  }
  if (range.end <= range.start) {
    return rejected("empty_range", "The resolved range is empty.");
  }
  if (range.end > asOf) {
    return rejected(
      "future_range",
      "The resolved range extends beyond the answer time.",
    );
  }
  return null;
}

function resolveRollingScope(
  scope: Extract<TarvisTemporalScope, { kind: "rolling" }>,
  asOf: number,
): CurrentRangeResult {
  if (
    scope.anchor !== "now" ||
    !Number.isInteger(scope.amount) ||
    scope.amount <= 0
  ) {
    return rejected(
      "invalid_scope",
      "A rolling amount must be a positive whole number.",
    );
  }
  const millisecondsPerUnit: Record<typeof scope.unit, number> = {
    minute: 60_000,
    hour: 60 * 60_000,
    day: 24 * 60 * 60_000,
    week: 7 * 24 * 60 * 60_000,
  };
  const duration = scope.amount * millisecondsPerUnit[scope.unit];
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    return rejected("invalid_scope", "The rolling duration is too large.");
  }
  const range = { start: asOf - duration, end: asOf };
  const problem = validRange(range, asOf);
  return problem ?? { range, cappedAtAsOf: false };
}

function resolveRecentLocalDays(
  scope: Extract<TarvisTemporalScope, { kind: "recent_local_days" }>,
  asOf: number,
): CurrentRangeResult {
  if (
    !Number.isInteger(scope.count) ||
    scope.count < 1 ||
    scope.count > 3_660
  ) {
    return rejected(
      "invalid_scope",
      "A recent local-day count must be an integer from 1 to 3660.",
    );
  }
  if (scope.include === "most_recent_completed_windows") {
    return rejected(
      "clock_window_required",
      "Completed recurring windows require the dedicated clock-window resolver.",
    );
  }
  if (scope.include !== "through_now" && scope.include !== "completed_days") {
    return rejected(
      "invalid_scope",
      "The recent local-day inclusion policy is invalid.",
    );
  }
  const today = toDateKey(asOf);
  const todayStart = startOfDate(today);
  const range =
    scope.include === "completed_days"
      ? {
          start: startOfDate(addDays(today, -scope.count)),
          end: todayStart,
        }
      : {
          start: startOfDate(addDays(today, -(scope.count - 1))),
          end: asOf,
        };
  const problem = validRange(range, asOf);
  return (
    problem ?? {
      range,
      cappedAtAsOf: scope.include === "through_now",
    }
  );
}

function resolveCalendarPeriod(
  scope: Extract<TarvisTemporalScope, { kind: "calendar_period" }>,
  asOf: number,
): CurrentRangeResult {
  const today = toDateKey(asOf);
  const todayStart = startOfDate(today);
  let range: TimeRange;
  let cappedAtAsOf = false;
  switch (scope.period) {
    case "today":
      range = { start: todayStart, end: asOf };
      cappedAtAsOf = true;
      break;
    case "yesterday":
      range = { start: startOfDate(addDays(today, -1)), end: todayStart };
      break;
    case "this_week": {
      const startDate = localWeekStart(today);
      range = { start: startOfDate(startDate), end: asOf };
      cappedAtAsOf = true;
      break;
    }
    case "last_week": {
      const thisWeek = localWeekStart(today);
      range = {
        start: startOfDate(addDays(thisWeek, -7)),
        end: startOfDate(thisWeek),
      };
      break;
    }
    case "this_month":
      range = { start: startOfDate(monthStart(today)), end: asOf };
      cappedAtAsOf = true;
      break;
    case "last_month": {
      const thisMonth = monthStart(today);
      range = {
        start: startOfDate(shiftMonthStart(thisMonth, -1)),
        end: startOfDate(thisMonth),
      };
      break;
    }
    default:
      return rejected("invalid_scope", "Unknown local calendar period.");
  }
  const problem = validRange(range, asOf);
  return problem ?? { range, cappedAtAsOf };
}

function resolveCalendarDate(
  scope: Extract<TarvisTemporalScope, { kind: "calendar_date" }>,
  asOf: number,
): CurrentRangeResult {
  if (!isDateKey(scope.date)) {
    return rejected("invalid_scope", "The requested local date is invalid.");
  }
  const today = toDateKey(asOf);
  if (scope.date > today) {
    return rejected(
      "future_range",
      "The requested local date is in the future.",
    );
  }
  const natural = naturalDateRange(scope.date);
  const cappedAtAsOf = scope.date === today;
  const range = {
    start: natural.start,
    end: cappedAtAsOf ? Math.min(asOf, natural.end) : natural.end,
  };
  const problem = validRange(range, asOf);
  return problem ?? { range, cappedAtAsOf };
}

function resolveCalendarDateRange(
  scope: Extract<TarvisTemporalScope, { kind: "calendar_date_range" }>,
  asOf: number,
): CurrentRangeResult {
  if (scope.inclusiveEndDate !== true) {
    return rejected(
      "invalid_scope",
      "An explicit date range must declare its inclusive end date.",
    );
  }
  if (!isDateKey(scope.startDate) || !isDateKey(scope.endDate)) {
    return rejected(
      "invalid_scope",
      "The requested local date range contains an invalid date.",
    );
  }
  if (scope.startDate > scope.endDate) {
    return rejected(
      "reversed_range",
      "The requested end date is earlier than its start date.",
    );
  }
  const today = toDateKey(asOf);
  if (scope.startDate > today || scope.endDate > today) {
    return rejected(
      "future_range",
      "An explicit local date range cannot include future dates.",
    );
  }
  const naturalEnd = startOfDate(addDays(scope.endDate, 1));
  const cappedAtAsOf = scope.endDate === today;
  const range = {
    start: startOfDate(scope.startDate),
    end: cappedAtAsOf ? Math.min(asOf, naturalEnd) : naturalEnd,
  };
  const problem = validRange(range, asOf);
  return problem ?? { range, cappedAtAsOf };
}

function resolveCurrentRange(
  scope: TarvisTemporalScope,
  asOf: number,
): CurrentRangeResult {
  switch (scope.kind) {
    case "rolling":
      return resolveRollingScope(scope, asOf);
    case "recent_local_days":
      return resolveRecentLocalDays(scope, asOf);
    case "calendar_period":
      return resolveCalendarPeriod(scope, asOf);
    case "calendar_date":
      return resolveCalendarDate(scope, asOf);
    case "calendar_date_range":
      return resolveCalendarDateRange(scope, asOf);
    default:
      return rejected("invalid_scope", "Unknown temporal scope.");
  }
}

function matchingWallClockEnd(
  targetDate: DateKey | null,
  asOf: number,
): number | RejectedTarvisIntentRange {
  if (!targetDate) {
    return rejected(
      "unrepresentable_calendar_progress",
      "The previous calendar period has no matching local date.",
    );
  }
  const currentTime = localParts(asOf);
  const timeZone = getRuntimeAnalysisTimeZone();
  try {
    return resolveZonedWallClock(
      targetDate,
      currentTime.hour,
      currentTime.minute,
      currentTime.second,
      timeZone,
      "reject",
      currentTime.millisecond,
    );
  } catch (error) {
    if (error instanceof ZonedWallClockError && error.kind === "nonexistent") {
      return rejected(
        "nonexistent_local_time",
        `Matching progress lands in a ${timeZone} clock-change gap.`,
      );
    }
    if (error instanceof ZonedWallClockError && error.kind === "ambiguous") {
      return rejected(
        "ambiguous_local_time",
        `Matching progress lands in a repeated ${timeZone} clock time.`,
      );
    }
    throw error;
  }
}

function previousForCalendarPeriod(
  scope: Extract<TarvisTemporalScope, { kind: "calendar_period" }>,
  current: TimeRange,
  asOf: number,
): PreviousRangeResult {
  const today = toDateKey(asOf);
  switch (scope.period) {
    case "today": {
      const previousDate = addDays(today, -1);
      const end = matchingWallClockEnd(previousDate, asOf);
      if (typeof end !== "number") return end;
      return {
        range: { start: startOfDate(previousDate), end },
        basis: "matching_local_wall_clock_progress",
      };
    }
    case "yesterday": {
      const previousDate = addDays(today, -2);
      return {
        range: naturalDateRange(previousDate),
        basis: "adjacent_local_calendar_days",
      };
    }
    case "this_week": {
      const previousWeekStart = addDays(localWeekStart(today), -7);
      const matchingDate = addDays(today, -7);
      const end = matchingWallClockEnd(matchingDate, asOf);
      if (typeof end !== "number") return end;
      return {
        range: { start: startOfDate(previousWeekStart), end },
        basis: "matching_local_wall_clock_progress",
      };
    }
    case "last_week":
      return {
        range: {
          start: startOfDate(addDays(toDateKey(current.start), -7)),
          end: current.start,
        },
        basis: "previous_local_calendar_week",
      };
    case "this_month": {
      const previousMonthStart = shiftMonthStart(monthStart(today), -1);
      const currentDate = dateKeyParts(today);
      const previousMonth = dateKeyParts(previousMonthStart);
      const matchingDate = dateKeyFromParts(
        previousMonth.year,
        previousMonth.month,
        currentDate.day,
      ) as DateKey | null;
      const end = matchingWallClockEnd(matchingDate, asOf);
      if (typeof end !== "number") return end;
      return {
        range: { start: startOfDate(previousMonthStart), end },
        basis: "matching_local_wall_clock_progress",
      };
    }
    case "last_month": {
      const currentStartDate = toDateKey(current.start);
      return {
        range: {
          start: startOfDate(shiftMonthStart(currentStartDate, -1)),
          end: current.start,
        },
        basis: "previous_local_calendar_month",
      };
    }
    default:
      return rejected("invalid_scope", "Unknown local calendar period.");
  }
}

function resolvePreviousRange(
  scope: TarvisTemporalScope,
  current: TimeRange,
  asOf: number,
): PreviousRangeResult {
  switch (scope.kind) {
    case "rolling": {
      const duration = current.end - current.start;
      return {
        range: { start: current.start - duration, end: current.start },
        basis: "adjacent_equal_elapsed_time",
      };
    }
    case "recent_local_days": {
      const currentStartDate = toDateKey(current.start);
      return {
        range: {
          start: startOfDate(addDays(currentStartDate, -scope.count)),
          end: current.start,
        },
        basis: "adjacent_local_calendar_days",
      };
    }
    case "calendar_period":
      return previousForCalendarPeriod(scope, current, asOf);
    case "calendar_date": {
      const previousDate = addDays(scope.date as DateKey, -1);
      return {
        range: naturalDateRange(previousDate),
        basis: "adjacent_local_calendar_days",
      };
    }
    case "calendar_date_range": {
      const dayCount = inclusiveCalendarDayCount(
        scope.startDate as DateKey,
        scope.endDate as DateKey,
      );
      return {
        range: {
          start: startOfDate(addDays(scope.startDate as DateKey, -dayCount)),
          end: current.start,
        },
        basis: "adjacent_local_calendar_days",
      };
    }
    default:
      return rejected("invalid_scope", "Unknown temporal scope.");
  }
}

function comparisonValue(
  comparison: TarvisIntentV1["comparison"],
): TarvisComparison | null {
  return comparison?.value ?? null;
}

/**
 * Resolves non-recurring Tarv1s time scopes to exact local-time half-open
 * intervals. Recurring clock windows are deliberately delegated to the
 * dedicated DST-aware scoped-query engine.
 */
export function resolveTarvisIntentRange(
  input: ResolveTarvisIntentRangeInput,
): TarvisIntentRangeResolution {
  const supportedTimeZone = getRuntimeAnalysisTimeZone();
  const timezone = input.timezone ?? supportedTimeZone;
  if (!isIanaTimeZone(timezone) || timezone !== supportedTimeZone) {
    return rejected(
      "unsupported_timezone",
      `This analysis uses ${supportedTimeZone}, not ${timezone}.`,
    );
  }
  if (!Number.isFinite(input.asOf) || input.asOf < 0) {
    return rejected(
      "invalid_as_of",
      "asOf must be a finite non-negative timestamp.",
    );
  }
  if (input.intent.clockWindow) {
    return {
      status: "delegate",
      schemaVersion: TARVIS_INTENT_RANGE_SCHEMA_VERSION,
      code: "recurring_clock_window",
      delegateTo: "scoped-glucose-recurring-window",
      message:
        "Recurring local-clock windows must use the dedicated DST-aware scoped-query resolver.",
    };
  }
  const scope = input.intent.temporalScope?.value;
  if (!scope || typeof scope !== "object" || !("kind" in scope)) {
    return rejected("invalid_scope", "The intent has no valid temporal scope.");
  }
  const comparison = comparisonValue(input.intent.comparison);
  if (
    comparison &&
    comparison.kind !== "previous_equal_period" &&
    comparison.kind !== "explicit_periods"
  ) {
    return rejected(
      "unsupported_comparison",
      "The comparison mode is not supported by this resolver.",
    );
  }
  if (comparison?.kind === "explicit_periods") {
    return rejected(
      "unsupported_comparison",
      "Explicit multi-period comparison is not supported by this resolver.",
    );
  }

  const currentResult = resolveCurrentRange(scope, input.asOf);
  if (isRejected(currentResult)) return currentResult;

  let previous: TimeRange | null = null;
  let comparisonBasis: TarvisIntentComparisonBasis | null = null;
  if (comparison?.kind === "previous_equal_period") {
    const previousResult = resolvePreviousRange(
      scope,
      currentResult.range,
      input.asOf,
    );
    if (isRejected(previousResult)) return previousResult;
    const problem = validRange(previousResult.range, currentResult.range.start);
    if (problem) return problem;
    previous = previousResult.range;
    comparisonBasis = previousResult.basis;
  }

  return {
    status: "resolved",
    schemaVersion: TARVIS_INTENT_RANGE_SCHEMA_VERSION,
    timezone,
    asOf: input.asOf,
    current: currentResult.range,
    previous,
    comparisonBasis,
    currentCappedAtAsOf: currentResult.cappedAtAsOf,
    intervalConvention: "half-open",
  };
}
