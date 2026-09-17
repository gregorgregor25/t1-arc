import { describe, expect, it } from "vitest";

import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisCapabilityCode,
  type TarvisComparison,
  type TarvisGlucoseThreshold,
  type TarvisIntentHistoryEntry,
  type TarvisMetric,
  type TarvisOperation,
  type TarvisRecurringClockWindow,
  type TarvisTemporalScope,
} from "@/data/tarvis/intent";

const NOW = Date.parse("2026-08-07T20:00:00+01:00");

const localDays = (
  count: number,
  include: Extract<
    TarvisTemporalScope,
    { kind: "recent_local_days" }
  >["include"] = "through_now",
): TarvisTemporalScope => ({ kind: "recent_local_days", count, include });

const rolling = (
  amount: number,
  unit: Extract<TarvisTemporalScope, { kind: "rolling" }>["unit"],
): TarvisTemporalScope => ({ kind: "rolling", amount, unit, anchor: "now" });

const calendar = (
  period: Extract<TarvisTemporalScope, { kind: "calendar_period" }>["period"],
): TarvisTemporalScope => ({ kind: "calendar_period", period });

const window = (
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): TarvisRecurringClockWindow => ({
  start: { hour: startHour, minute: startMinute },
  end: { hour: endHour, minute: endMinute },
  crossesMidnight: endHour * 60 + endMinute <= startHour * 60 + startMinute,
  occurrenceAnchor: "start_date",
});

const threshold = (
  operator: TarvisGlucoseThreshold["operator"],
  value: number,
  unit: TarvisGlucoseThreshold["unit"],
  role: TarvisGlucoseThreshold["role"],
): TarvisGlucoseThreshold => ({ operator, value, unit, role });

function defaultThresholds(metrics: readonly TarvisMetric[]) {
  const values: TarvisGlucoseThreshold[] = [];
  if (
    metrics.includes("glucose.low_episodes") ||
    metrics.includes("glucose.time_in_range")
  ) {
    values.push(
      threshold(
        metrics.includes("glucose.time_in_range") ? "gte" : "lt",
        3.9,
        "mmol/L",
        metrics.includes("glucose.time_in_range") ? "range_lower" : "low",
      ),
    );
  }
  if (
    metrics.includes("glucose.high_episodes") ||
    metrics.includes("glucose.time_in_range")
  ) {
    values.push(
      threshold(
        metrics.includes("glucose.time_in_range") ? "lte" : "gt",
        10,
        "mmol/L",
        metrics.includes("glucose.time_in_range") ? "range_upper" : "high",
      ),
    );
  }
  return values;
}

interface ReadyCase {
  name: string;
  question: string;
  domain?:
    | "glucose"
    | "insulin"
    | "food"
    | "activity"
    | "sleep"
    | "health"
    | "data_quality";
  metrics: TarvisMetric[];
  operation: TarvisOperation;
  scope: TarvisTemporalScope;
  clockWindow?: TarvisRecurringClockWindow;
  comparison?: TarvisComparison;
  thresholds?: TarvisGlucoseThreshold[];
}

const READY_CASES: ReadyCase[] = [
  {
    name: "current glucose lookup",
    question: "What is my current glucose right now?",
    metrics: ["glucose.current"],
    operation: "current",
    scope: rolling(24, "hour"),
  },
  {
    name: "local insulin total",
    question: "What was my total insulin over the last seven days?",
    metrics: ["insulin.delivered_total"],
    domain: "insulin",
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "local basal total",
    question: "What was my total basal insulin over the last seven days?",
    metrics: ["insulin.basal_total"],
    domain: "insulin",
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "local carbohydrate total",
    question: "How many carbs did I have over the last seven days?",
    metrics: ["food.carbohydrate_total"],
    domain: "food",
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "local sensor coverage",
    question: "What was my CGM coverage over the last seven days?",
    metrics: ["data_quality.coverage"],
    domain: "data_quality",
    operation: "inspect_data_quality",
    scope: localDays(7),
  },
  {
    name: "local sensor gaps",
    question: "Where were my sensor data gaps over the last seven days?",
    metrics: ["data_quality.gaps"],
    domain: "data_quality",
    operation: "inspect_data_quality",
    scope: localDays(7),
  },
  {
    name: "digit local-day mean",
    question: "What was my average glucose over the last 7 days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "number-word local-day mean",
    question: "Show my average glucose over the last seven days.",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "rolling 72 hours",
    question: "What was my average BG over the past 72 hours?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: rolling(72, "hour"),
  },
  {
    name: "compact rolling 24h",
    question: "Give me my mean blood sugar for the past 24h.",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: rolling(24, "hour"),
  },
  {
    name: "rolling minutes",
    question: "What was my average sensor reading over the last 90 minutes?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: rolling(90, "minute"),
  },
  {
    name: "two local weeks normalized to days",
    question: "What was my average glucose over the last two weeks?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(14),
  },
  {
    name: "past week remains rolling",
    question: "What was my average glucose over the past one week?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: rolling(1, "week"),
  },
  {
    name: "fortnight alias",
    question: "What was my average glucose over a fortnight?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(14),
  },
  ...(
    [
      ["today", "today"],
      ["yesterday", "yesterday"],
      ["this week", "this_week"],
      ["last week", "last_week"],
      ["this month", "this_month"],
      ["last month", "last_month"],
    ] as const
  ).map(([wording, period]): ReadyCase => ({
    name: `calendar mean ${wording}`,
    question: `What was my average glucose ${wording}?`,
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: calendar(period),
  })),
  {
    name: "ISO calendar date",
    question: "What was my average glucose on 2026-08-06?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: { kind: "calendar_date", date: "2026-08-06" },
  },
  {
    name: "UK calendar date",
    question: "What was my average glucose on 06/08/2026?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: { kind: "calendar_date", date: "2026-08-06" },
  },
  {
    name: "named calendar date with inferred year",
    question: "What was my average glucose on 6 August?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: { kind: "calendar_date", date: "2026-08-06" },
  },
  {
    name: "inclusive calendar date range",
    question:
      "What was my average glucose from 1 August 2026 to 3 August 2026?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: {
      kind: "calendar_date_range",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      inclusiveEndDate: true,
    },
  },
  {
    name: "average and glucose typos",
    question: "What was my avarage glocose over the last seven days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "readings typo and mean alias",
    question: "What was my mean readngs over the last 7 days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7),
  },
  {
    name: "CGM average alias",
    question: "What was my CGM average over the last thirty days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(30),
  },
  {
    name: "levels mean alias",
    question: "What were my levels mean over the last 14 days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(14),
  },
  {
    name: "screenshot midnight window",
    question:
      "What are my average readings over the last three days between midnight and 7 a.m.?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(3, "most_recent_completed_windows"),
    clockWindow: window(0, 0, 7, 0),
  },
  {
    name: "named overnight screenshot query",
    question:
      "What were my average overnight readings for the last two nights?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(2, "most_recent_completed_windows"),
    clockWindow: window(0, 0, 7, 0),
  },
  {
    name: "named overnight across local days",
    question: "What was my average glucose overnight over the last seven days?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7, "most_recent_completed_windows"),
    clockWindow: window(0, 0, 7, 0),
  },
  {
    name: "explicit glucose readings must not hide a clock window",
    question:
      "What are my average glucose readings over the last three days between midnight and 7 a.m.?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(3, "most_recent_completed_windows"),
    clockWindow: window(0, 0, 7, 0),
  },
  {
    name: "24-hour morning window",
    question:
      "What was my average glucose over the last 3 days from 00:00 to 07:00?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(3, "most_recent_completed_windows"),
    clockWindow: window(0, 0, 7, 0),
  },
  {
    name: "12-hour cross-midnight window",
    question:
      "What was my average glucose over the last seven days from 10 p.m. to 3 a.m.?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7, "most_recent_completed_windows"),
    clockWindow: window(22, 0, 3, 0),
  },
  {
    name: "24-hour cross-midnight window",
    question:
      "What was my average glucose over the last 7 days from 22:00 to 03:00?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7, "most_recent_completed_windows"),
    clockWindow: window(22, 0, 3, 0),
  },
  {
    name: "noon to evening window",
    question:
      "What was my average glucose over the last 7 days from noon to 6 p.m.?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7, "most_recent_completed_windows"),
    clockWindow: window(12, 0, 18, 0),
  },
  {
    name: "morning to noon window",
    question:
      "What was my average glucose over the last 7 days between 6 a.m. and noon?",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(7, "most_recent_completed_windows"),
    clockWindow: window(6, 0, 12, 0),
  },
  {
    name: "time in range alias",
    question: "What was my TIR over the last seven days?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: localDays(7),
  },
  {
    name: "hyphenated time in range",
    question: "What was my time-in-range over the past 24 hours?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: rolling(24, "hour"),
  },
  {
    name: "target-range percentage",
    question: "What percent of time was in my target range yesterday?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: calendar("yesterday"),
  },
  {
    name: "custom mmol range",
    question:
      "What percentage of my glucose readings were between 4 and 10 mmol/L over the last 14 days?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: localDays(14),
    thresholds: [
      threshold("gte", 4, "mmol/L", "range_lower"),
      threshold("lte", 10, "mmol/L", "range_upper"),
    ],
  },
  {
    name: "custom mg/dL range",
    question:
      "What percent of my glucose readings were between 70 and 180 mg/dL over the last 30 days?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: localDays(30),
    thresholds: [
      threshold("gte", 70, "mg/dL", "range_lower"),
      threshold("lte", 180, "mg/dL", "range_upper"),
    ],
  },
  {
    name: "time in range typo",
    question: "What was my tim in range over the last fourteen days?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: localDays(14),
  },
  {
    name: "monthly TIR",
    question: "What was my TIR this month?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: calendar("this_month"),
  },
  {
    name: "date-scoped TIR",
    question: "What was my time in range on 5 August 2026?",
    metrics: ["glucose.time_in_range"],
    operation: "range_distribution",
    scope: { kind: "calendar_date", date: "2026-08-05" },
  },
  {
    name: "low alias",
    question: "How many lows did I have over the last seven days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(7),
  },
  {
    name: "hypo alias and rolling hours",
    question: "How many hypos have I had over the past 72 hours?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: rolling(72, "hour"),
  },
  {
    name: "low-glucose event yesterday",
    question: "How many low-glucose events did I have yesterday?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: calendar("yesterday"),
  },
  {
    name: "sustained low frequency",
    question:
      "What was the frequency of sustained low-glucose events this month?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: calendar("this_month"),
  },
  {
    name: "dip alias",
    question: "How many dips did I have over the last fourteen days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(14),
  },
  {
    name: "crash alias",
    question: "How many crashes did I have over the last 30 days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(30),
  },
  {
    name: "low typo",
    question: "How many lwoes did I have over the last seven days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(7),
  },
  {
    name: "episode typo",
    question: "How many low-glucose episoeds over the last seven days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(7),
  },
  {
    name: "explicit low mmol threshold",
    question:
      "How many low-glucose episodes below 3.5 mmol/L over the last 30 days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(30),
    thresholds: [threshold("lt", 3.5, "mmol/L", "low")],
  },
  {
    name: "explicit low mg threshold",
    question:
      "How many low-glucose episodes under 70 mg/dL over the last 30 days?",
    metrics: ["glucose.low_episodes"],
    operation: "count_episodes",
    scope: localDays(30),
    thresholds: [threshold("lt", 70, "mg/dL", "low")],
  },
  {
    name: "high alias",
    question: "How many highs did I have over the last seven days?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(7),
  },
  {
    name: "spike alias and rolling hours",
    question: "How many spikes have I had over the past 72 hours?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: rolling(72, "hour"),
  },
  {
    name: "hyperglycaemia alias",
    question: "How many hyperglycaemia events did I have yesterday?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: calendar("yesterday"),
  },
  {
    name: "sustained high frequency",
    question:
      "What was the frequency of sustained high-glucose events this month?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: calendar("this_month"),
  },
  {
    name: "high typo",
    question: "How many hihgs did I have over the last seven days?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(7),
  },
  {
    name: "explicit high mmol threshold",
    question:
      "How many high-glucose episodes above 13.9 mmol/L over the last 30 days?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(30),
    thresholds: [threshold("gt", 13.9, "mmol/L", "high")],
  },
  {
    name: "explicit high mg threshold",
    question:
      "How many high-glucose episodes over 250 mg/dL during the last 30 days?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(30),
    thresholds: [threshold("gt", 250, "mg/dL", "high")],
  },
  {
    name: "low and high compound count",
    question:
      "How many lows and how many highs did I have over the last 14 days?",
    metrics: ["glucose.low_episodes", "glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(14),
  },
  {
    name: "duplicate high aliases deduplicate",
    question: "How many highs and spikes did I have over the last 14 days?",
    metrics: ["glucose.high_episodes"],
    operation: "count_episodes",
    scope: localDays(14),
  },
  {
    name: "previous equal-period comparison",
    question:
      "Compare my average glucose over the last 30 days with the previous 30 days.",
    metrics: ["glucose.mean"],
    operation: "aggregate",
    scope: localDays(30),
    comparison: { kind: "previous_equal_period" },
  },
];

interface FailClosedCase {
  name: string;
  question: string;
  status: "needs_clarification" | "unsupported";
  code: Exclude<TarvisCapabilityCode, "ready">;
  recognisedMetrics?: TarvisMetric[];
}

const FAIL_CLOSED_CASES: FailClosedCase[] = [
  {
    name: "empty input",
    question: "   ",
    status: "needs_clarification",
    code: "empty_question",
  },
  {
    name: "missing period",
    question: "What is my average glucose?",
    status: "needs_clarification",
    code: "missing_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "missing metric",
    question: "Show me the last 30 days.",
    status: "needs_clarification",
    code: "missing_metric",
  },
  {
    name: "generic readings are not assumed to mean average",
    question: "What were my readings over the last 30 days?",
    status: "needs_clarification",
    code: "missing_metric",
  },
  {
    name: "ambiguous bare cross-midnight times",
    question:
      "What was my average glucose over the last 3 days between 10 and 3?",
    status: "needs_clarification",
    code: "ambiguous_clock_time",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "ambiguous colon times without meridiem",
    question:
      "What was my average glucose over the last 3 days from 10:00 to 11:00?",
    status: "needs_clarification",
    code: "ambiguous_clock_time",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "identical clock bounds",
    question:
      "What was my average glucose over the last 3 days from midnight to midnight?",
    status: "needs_clarification",
    code: "invalid_clock_window",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "24:00 cannot start a window",
    question:
      "What was my average glucose over the last 3 days from 24:00 to 7 a.m.?",
    status: "needs_clarification",
    code: "ambiguous_clock_time",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "multiple calendar periods",
    question: "What was my average glucose today and yesterday?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "unequal comparison durations",
    question:
      "Compare my average glucose over the last 30 days with the previous 7 days.",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "backwards date range",
    question:
      "What was my average glucose from 6 August 2026 to 3 August 2026?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "numbered months are not silently converted to days",
    question: "What was my average glucose over the last three months?",
    status: "unsupported",
    code: "unsupported_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "zero-length duration",
    question: "What was my average glucose over the last 0 days?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "fractional duration",
    question: "What was my average glucose over the last 1.5 days?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "cross-domain compound question",
    question:
      "What was my average glucose and total insulin over the last seven days?",
    status: "unsupported",
    code: "unsupported_compound_question",
    recognisedMetrics: ["glucose.mean", "insulin.delivered_total"],
  },
  {
    name: "mean plus TIR needs different calculations",
    question:
      "What were my average glucose and time in range over the last seven days?",
    status: "unsupported",
    code: "unsupported_compound_question",
    recognisedMetrics: ["glucose.mean", "glucose.time_in_range"],
  },
  {
    name: "mean plus episodes needs different calculations",
    question:
      "What was my average glucose and how many lows over the last seven days?",
    status: "unsupported",
    code: "unsupported_compound_question",
    recognisedMetrics: ["glucose.mean", "glucose.low_episodes"],
  },
  {
    name: "negated low metric",
    question: "Not low episodes over the last seven days.",
    status: "needs_clarification",
    code: "ambiguous_negation",
  },
  {
    name: "one selected and one negated metric remains ambiguous",
    question: "Show lows, not highs, over the last seven days.",
    status: "needs_clarification",
    code: "ambiguous_negation",
  },
  {
    name: "two explicit calendar periods are not silently collapsed",
    question: "Compare my average glucose this week versus last week.",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "multiple clock windows",
    question:
      "What was my average glucose over the last 7 days from 00:00 to 07:00 and from 12:00 to 18:00?",
    status: "needs_clarification",
    code: "ambiguous_clock_time",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "weekday filter is not silently ignored",
    question: "What was my average glucose on weekdays over the last 30 days?",
    status: "unsupported",
    code: "unsupported_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "meal-relative filter is not silently ignored",
    question:
      "What was my average glucose after breakfast over the last seven days?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
  {
    name: "exclusion is not silently ignored",
    question:
      "What was my average glucose over the last seven days excluding today?",
    status: "needs_clarification",
    code: "ambiguous_time_scope",
    recognisedMetrics: ["glucose.mean"],
  },
];

function resolve(
  question: string,
  history?: readonly TarvisIntentHistoryEntry[],
) {
  return resolveTarvisIntent(question, {
    now: NOW,
    timezone: "Europe/London",
    history,
  });
}

describe("Tarv1s adversarial ready-question corpus", () => {
  it.each(READY_CASES)("$name", (testCase) => {
    const resolution = resolve(testCase.question);
    expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
    if (!isReadyTarvisIntent(resolution)) {
      throw new Error(`Expected ready intent for: ${testCase.question}`);
    }

    expect(resolution.intent.domain.value).toBe(testCase.domain ?? "glucose");
    expect(resolution.intent.domain.provenance.kind).toBe("explicit");
    expect(resolution.intent.metrics.map((metric) => metric.value)).toEqual(
      testCase.metrics,
    );
    expect(
      resolution.intent.metrics.map((metric) => metric.provenance.kind),
    ).toEqual(testCase.metrics.map(() => "explicit"));
    expect(resolution.intent.operation.value).toBe(testCase.operation);
    expect(resolution.intent.temporalScope.value).toEqual(testCase.scope);
    expect(resolution.intent.temporalScope.provenance.kind).toBe(
      testCase.metrics.includes("glucose.current") ? "default" : "explicit",
    );
    expect(resolution.intent.clockWindow?.value ?? null).toEqual(
      testCase.clockWindow ?? null,
    );
    expect(resolution.intent.comparison?.value ?? null).toEqual(
      testCase.comparison ?? null,
    );
    expect(resolution.intent.thresholds.map((item) => item.value)).toEqual(
      testCase.thresholds ?? defaultThresholds(testCase.metrics),
    );
  });
});

describe("Tarv1s adversarial fail-closed corpus", () => {
  it.each(FAIL_CLOSED_CASES)("$name", (testCase) => {
    const resolution = resolve(testCase.question);
    expect(resolution.outcome).toMatchObject({
      status: testCase.status,
      code: testCase.code,
    });
    if (testCase.recognisedMetrics) {
      expect(resolution.intent.metrics.map((metric) => metric.value)).toEqual(
        testCase.recognisedMetrics,
      );
    }
  });
});

describe("Tarv1s corrections and conversational follow-ups", () => {
  const base = resolve("What was my average glucose over the last 30 days?");
  if (!isReadyTarvisIntent(base)) {
    throw new Error("Corpus fixture should resolve to a ready average intent.");
  }
  const history: TarvisIntentHistoryEntry[] = [
    {
      turnId: "mean-30-days",
      question: base.intent.question,
      intent: base.intent,
    },
  ];

  it.each([
    {
      question: "What about last week?",
      metric: "glucose.mean" as const,
      scope: calendar("last_week"),
    },
    {
      question: "Do the same for yesterday.",
      metric: "glucose.mean" as const,
      scope: calendar("yesterday"),
    },
    {
      question: "Same for the past 24 hours.",
      metric: "glucose.mean" as const,
      scope: rolling(24, "hour"),
    },
  ])("inherits only for explicit follow-up: $question", (testCase) => {
    const resolution = resolve(testCase.question, history);
    expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
    if (!isReadyTarvisIntent(resolution)) throw new Error("Expected ready");
    expect(resolution.intent.metrics[0]).toMatchObject({
      value: testCase.metric,
      provenance: { kind: "conversation", turnId: "mean-30-days" },
    });
    expect(resolution.intent.temporalScope.value).toEqual(testCase.scope);
  });

  it("does not treat a bare conjunction as permission to inherit", () => {
    const resolution = resolve("And last week?", history);
    expect(resolution.outcome).toMatchObject({
      status: "needs_clarification",
      code: "missing_metric",
    });
  });

  it("uses an explicit new metric instead of the historical metric", () => {
    const resolution = resolve("What about high episodes last week?", history);
    expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
    if (!isReadyTarvisIntent(resolution)) throw new Error("Expected ready");
    expect(resolution.intent.metrics).toEqual([
      expect.objectContaining({
        value: "glucose.high_episodes",
        provenance: expect.objectContaining({ kind: "explicit" }),
      }),
    ]);
    expect(resolution.intent.temporalScope.value).toEqual(
      calendar("last_week"),
    );
  });

  it("honours an explicit correction and drops the rejected metric", () => {
    const resolution = resolve(
      "Not highs, I mean lows over the last seven days.",
      history,
    );
    expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
    if (!isReadyTarvisIntent(resolution)) throw new Error("Expected ready");
    expect(resolution.intent.metrics.map((metric) => metric.value)).toEqual([
      "glucose.low_episodes",
    ]);
  });

  it("keeps a fully explicit new average independent from prior highs", () => {
    const high = resolve("How many highs over the last 30 days?");
    if (!isReadyTarvisIntent(high)) throw new Error("Expected high fixture");
    const resolution = resolve(
      "And what are my average readings over the last three days between midnight and 7 a.m.?",
      [
        {
          turnId: "prior-highs",
          question: high.intent.question,
          intent: high.intent,
        },
      ],
    );
    expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
    if (!isReadyTarvisIntent(resolution)) throw new Error("Expected ready");
    expect(resolution.intent.metrics.map((metric) => metric.value)).toEqual([
      "glucose.mean",
    ]);
    expect(resolution.intent.temporalScope.value).toEqual(
      localDays(3, "most_recent_completed_windows"),
    );
  });
});

describe("Tarv1s corpus breadth guard", () => {
  it("contains substantially more than fifty independent realistic questions", () => {
    const followUpQuestions = 8;
    expect(
      READY_CASES.length + FAIL_CLOSED_CASES.length + followUpQuestions,
    ).toBeGreaterThanOrEqual(75);
  });
});
