import type { DateKey } from "@/domain/time";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import {
  formatDate,
  formatTime,
  getZonedDateTimeParts,
  toDateKey,
} from "@/domain/time";

export function stepProgressStatus({
  goal,
  isToday,
  locale,
  now,
  steps,
  timeZone,
}: {
  goal?: number;
  isToday: boolean;
  locale: string;
  now: number;
  steps?: number;
  timeZone: string;
}) {
  if (steps === undefined) return "Waiting for step data";
  if (!goal) return "No daily goal set";
  if (steps >= goal) return "Goal reached";
  if (!isToday) {
    return `${formatRegionalNumber((steps / goal) * 100, locale, {
      maximumFractionDigits: 0,
    })}% of goal`;
  }
  const local = getZonedDateTimeParts(now, timeZone);
  const elapsedDay = (local.hour * 60 + local.minute) / 1_440;
  return steps / goal >= elapsedDay
    ? "On track"
    : `${formatRegionalNumber(goal - steps, locale, {
        maximumFractionDigits: 0,
      })} to goal`;
}

export function resolveDailyMetricDisplay<T>({
  history,
  selected,
}: {
  history: (T | undefined)[];
  selected: T | undefined;
}) {
  return {
    hasHistory: history.some((value) => value !== undefined),
    value: selected,
  };
}

export function selectedTrendIndex(dayCount: number) {
  return Math.max(0, dayCount - 1);
}

export interface MetricChartPoint {
  x: number;
  y: number;
}

export function buildMetricChartGeometry(
  values: (number | undefined)[],
  width: number,
  height: number,
) {
  const recorded = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  if (!recorded.length || width <= 0 || height <= 0) {
    return {
      path: "",
      points: [] as (MetricChartPoint | undefined)[],
    };
  }

  const minimum = Math.min(...recorded);
  const maximum = Math.max(...recorded);
  const padding = Math.max((maximum - minimum) * 0.14, 0.5);
  const span = Math.max(1, maximum - minimum + padding * 2);
  const commands: string[] = [];
  const points: (MetricChartPoint | undefined)[] = [];
  let segmentOpen = false;

  values.forEach((value, index) => {
    if (value === undefined || !Number.isFinite(value)) {
      points[index] = undefined;
      segmentOpen = false;
      return;
    }
    const x =
      values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - minimum + padding) / span) * height;
    commands.push(`${segmentOpen ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    points[index] = { x, y };
    segmentOpen = true;
  });

  return { path: commands.join(" "), points };
}

function shortDate(timestamp: number) {
  return formatDate(toDateKey(timestamp), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function healthMetricTrendWindowLabel(
  endDate: DateKey | undefined,
  now: number,
) {
  if (!endDate) return "Seven-day overview";
  if (endDate === toDateKey(now)) return "Last seven days";
  return `Seven days ending ${formatDate(endDate, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
}

export function healthMetricIntervalPresentation({
  end,
  forceDates = false,
  selectedDate,
  start,
}: {
  end?: number;
  forceDates?: boolean;
  selectedDate?: DateKey;
  start: number;
}) {
  const validEnd = end !== undefined && end > start ? end : undefined;
  const startDate = toDateKey(start);
  const endDate = validEnd === undefined ? undefined : toDateKey(validEnd);
  const crossesDate = endDate !== undefined && endDate !== startDate;
  const boundaryOutsideSelectedDate =
    selectedDate !== undefined &&
    (startDate !== selectedDate ||
      (endDate !== undefined && endDate !== selectedDate));
  const includeDates = forceDates || crossesDate || boundaryOutsideSelectedDate;
  const formatBoundary = (timestamp: number) =>
    includeDates
      ? `${shortDate(timestamp)} · ${formatTime(timestamp)}`
      : formatTime(timestamp);
  const startLabel = formatBoundary(start);
  const showEnd =
    validEnd !== undefined && (validEnd > start + 60_000 || crossesDate);
  const endLabel = showEnd ? formatBoundary(validEnd) : undefined;

  return {
    accessibilityLabel: endLabel
      ? `From ${startLabel} to ${endLabel}`
      : startLabel,
    endLabel,
    startLabel,
  };
}
