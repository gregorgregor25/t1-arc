import type { InsulinDailyTotal, PumpStateInterval, TimeRange } from "./models";
import { formatRegionalFixedNumber } from "./regionalFormat";
import type { T1ArcRegionalDefaults } from "./regionalProfile";
import { getRuntimeRegionalDefaults } from "./regionalProfileRuntime";
import { formatDate, formatTime, toDateKey } from "./time";

function shortDate(timestamp: number) {
  return formatDate(toDateKey(timestamp), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formatTimelineInspectionTimestamp(timestamp: number) {
  return `${shortDate(timestamp)} · ${formatTime(timestamp)}`;
}

export function formatTimelineEntryTimestamp(
  timestamp: number,
  includeDate: boolean,
) {
  return includeDate
    ? `${shortDate(timestamp)} · ${formatTime(timestamp)}`
    : formatTime(timestamp);
}

export function rangeSpansMultipleDates(range: TimeRange) {
  const safeEnd = Math.max(range.start, range.end - 1);
  return toDateKey(range.start) !== toDateKey(safeEnd);
}

export function formatTimelineEndTimestamp(start: number, end: number) {
  return formatTimelineEntryTimestamp(end, toDateKey(start) !== toDateKey(end));
}

export function formatTimelineRange(range: TimeRange) {
  const safeEnd = Math.max(range.start, range.end - 1);
  const displayEnd =
    toDateKey(range.end) === toDateKey(safeEnd) ? range.end : safeEnd;
  if (!rangeSpansMultipleDates(range)) {
    return `${shortDate(range.start)} · ${formatTime(range.start)}–${formatTime(
      displayEnd,
    )}`;
  }
  return `${shortDate(range.start)} ${formatTime(range.start)} – ${shortDate(
    safeEnd,
  )} ${formatTime(displayEnd)}`;
}

export function timelineTimestampAtX({
  location,
  plotLeft,
  plotRight,
  range,
}: {
  location: number;
  plotLeft: number;
  plotRight: number;
  range: TimeRange;
}) {
  const safeRight = Math.max(plotLeft + 1, plotRight);
  const clamped = Math.max(plotLeft, Math.min(safeRight, location));
  const fraction = (clamped - plotLeft) / (safeRight - plotLeft);
  const lastInspectableTimestamp = Math.max(range.start, range.end - 1);
  return range.start + fraction * (lastInspectableTimestamp - range.start);
}

export function timelineTickTimestamp(
  range: TimeRange,
  index: number,
  tickCount: number,
) {
  const safeCount = Math.max(1, Math.floor(tickCount));
  const safeIndex = Math.max(0, Math.min(safeCount - 1, Math.floor(index)));
  const fraction = safeCount === 1 ? 0 : safeIndex / (safeCount - 1);
  const lastTimestamp = Math.max(range.start, range.end - 1);
  return range.start + fraction * (lastTimestamp - range.start);
}

export function inspectionTimestampForRange(
  timestamp: number | undefined,
  range: TimeRange,
) {
  return timestamp !== undefined &&
    timestamp >= range.start &&
    timestamp < range.end
    ? timestamp
    : undefined;
}

export type TimelineLayerAvailability = {
  glucose: boolean;
  basal: boolean;
  bolus: boolean;
  activity: boolean;
  pause: boolean;
};

export function resolveTimelineLayerAvailability({
  glucoseCount,
  basalCount,
  bolusCount,
  dailyTotals,
  pumpStates,
}: {
  glucoseCount: number;
  basalCount: number;
  bolusCount: number;
  dailyTotals: InsulinDailyTotal[];
  pumpStates: PumpStateInterval[];
}): TimelineLayerAvailability {
  return {
    glucose: glucoseCount > 0,
    basal:
      basalCount > 0 ||
      dailyTotals.some((total) => total.basalUnits !== undefined),
    bolus:
      bolusCount > 0 ||
      dailyTotals.some((total) => total.bolusUnits !== undefined),
    activity: pumpStates.some((state) => state.kind === "activity-mode"),
    pause: pumpStates.some((state) => state.kind === "automated-pause"),
  };
}

export function timelineInspectorInsulinParts({
  basalRateUnitsPerHour,
  bolusUnits,
  dailyTotal,
  regional = getRuntimeRegionalDefaults(),
  showBasal,
  showBolus,
}: {
  basalRateUnitsPerHour?: number;
  bolusUnits?: number;
  dailyTotal?: InsulinDailyTotal;
  regional?: T1ArcRegionalDefaults;
  showBasal: boolean;
  showBolus: boolean;
}) {
  const parts: string[] = [];
  if (showBasal) {
    if (basalRateUnitsPerHour !== undefined) {
      parts.push(`Basal ${formatRegionalFixedNumber(basalRateUnitsPerHour, regional.locale, 2)} U/h`);
    } else if (dailyTotal?.basalUnits !== undefined) {
      parts.push(`Basal ${formatRegionalFixedNumber(dailyTotal.basalUnits, regional.locale, 1)} U this day`);
    }
  }
  if (showBolus) {
    if (bolusUnits !== undefined) {
      parts.push(`Bolus ${formatRegionalFixedNumber(bolusUnits, regional.locale, 1)} U`);
    } else if (dailyTotal?.bolusUnits !== undefined) {
      parts.push(`Bolus ${formatRegionalFixedNumber(dailyTotal.bolusUnits, regional.locale, 1)} U this day`);
    }
  }
  return parts;
}
