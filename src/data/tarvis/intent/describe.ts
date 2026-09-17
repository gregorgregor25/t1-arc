import type {
  TarvisClockTime,
  TarvisIntentV1,
  TarvisMetric,
  TarvisTemporalScope,
} from "./types";
import {
  getRuntimeAnalysisTimeZone,
  getRuntimeRegionalDefaults,
} from "@/domain/regionalProfileRuntime";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { formatRegionalWallClockMinute } from "@/domain/regionalWallClock";
import { formatShortDate, isDateKey } from "@/domain/time";

const METRIC_LABELS: Record<TarvisMetric, string> = {
  "glucose.current": "Current glucose",
  "glucose.mean": "Average glucose",
  "glucose.median": "Median glucose",
  "glucose.minimum": "Minimum glucose",
  "glucose.maximum": "Maximum glucose",
  "glucose.standard_deviation": "Glucose standard deviation",
  "glucose.coefficient_of_variation": "Glucose coefficient of variation",
  "glucose.gmi": "Glucose management indicator",
  "glucose.time_in_range": "Glucose time in range",
  "glucose.low_episodes": "Low-glucose events",
  "glucose.high_episodes": "High-glucose events",
  "glucose.low_readings": "Low-glucose readings",
  "glucose.high_readings": "High-glucose readings",
  "insulin.delivered_total": "Total delivered insulin",
  "insulin.basal_total": "Total basal insulin",
  "insulin.bolus_total": "Total bolus insulin",
  "food.carbohydrate_total": "Total carbohydrate",
  "activity.duration": "Activity duration",
  "sleep.duration": "Sleep duration",
  "data_quality.coverage": "Sensor coverage",
  "data_quality.gaps": "Sensor-data gaps",
};

const CALENDAR_PERIOD_LABELS: Record<
  Extract<TarvisTemporalScope, { kind: "calendar_period" }>["period"],
  string
> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
};

function formatClockTime(time: TarvisClockTime) {
  return formatRegionalWallClockMinute(
    time.hour * 60 + time.minute,
    getRuntimeRegionalDefaults().locale,
  );
}

function formatCount(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 0,
  });
}

function formatIntentDate(value: string) {
  return isDateKey(value)
    ? formatShortDate(value, getRuntimeAnalysisTimeZone())
    : value;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function isOvernightWindow(intent: TarvisIntentV1) {
  const field = intent.clockWindow;
  if (!field) return false;
  const startMinute = field.value.start.hour * 60 + field.value.start.minute;
  const endMinute = field.value.end.hour * 60 + field.value.end.minute;
  return (
    /overnight/i.test(field.provenance.note ?? "") ||
    field.value.crossesMidnight ||
    startMinute >= 18 * 60 ||
    endMinute <= 7 * 60
  );
}

function describeScope(intent: TarvisIntentV1) {
  const scope = intent.temporalScope.value;
  switch (scope.kind) {
    case "rolling":
      return `Past ${formatCount(scope.amount)} ${plural(scope.amount, scope.unit)}`;
    case "recent_local_days":
      if (scope.include === "most_recent_completed_windows") {
        const noun = isOvernightWindow(intent)
          ? "overnight window"
          : "clock window";
        return `${formatCount(scope.count)} completed ${plural(scope.count, noun)}`;
      }
      if (scope.include === "completed_days") {
        return `${formatCount(scope.count)} completed local ${plural(scope.count, "day")}`;
      }
      return `${formatCount(scope.count)} local ${plural(scope.count, "day")} through now`;
    case "calendar_period":
      return CALENDAR_PERIOD_LABELS[scope.period];
    case "calendar_date":
      return formatIntentDate(scope.date);
    case "calendar_date_range":
      return `${formatIntentDate(scope.startDate)}–${formatIntentDate(scope.endDate)} inclusive`;
  }
}

/**
 * Deterministic, non-model interpretation text for UI confirmation. It echoes
 * the exact metric, temporal semantics, local clock bounds, and timezone that
 * will be executed.
 */
export function describeTarvisIntent(
  intent: TarvisIntentV1,
  options: { timezone?: string } = {},
) {
  const parts = [
    intent.metrics.map(({ value }) => METRIC_LABELS[value]).join(" + "),
    describeScope(intent),
  ];
  if (intent.clockWindow) {
    parts.push(
      `${formatClockTime(intent.clockWindow.value.start)}–${formatClockTime(intent.clockWindow.value.end)}`,
    );
  }
  parts.push(options.timezone ?? getRuntimeAnalysisTimeZone());
  return parts.join(" · ");
}
