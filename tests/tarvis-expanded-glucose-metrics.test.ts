import { describe, expect, it } from "vitest";

import {
  buildLocalGlucoseAnswer,
  UnsupportedLocalGlucoseIntentError,
} from "@/data/tarvis/localGlucoseAnswer";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import { routeTarvisIntent } from "@/data/tarvis/onDeviceRouting";
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisIntentV1,
  type TarvisMetric,
  type TarvisOperation,
} from "@/data/tarvis/intent";
import type { GlucoseReading } from "@/domain/models";

const AS_OF = Date.parse("2026-08-07T20:00:00+01:00");

function ready(question: string) {
  const resolution = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: "Europe/London",
  });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected ready intent, got ${resolution.outcome.code}.`);
  }
  return resolution.intent;
}

function withMetrics(
  base: TarvisIntentV1,
  metrics: readonly TarvisMetric[],
  operation: TarvisOperation,
): TarvisIntentV1 {
  const provenance = base.metrics[0]!.provenance;
  return {
    ...base,
    metrics: metrics.map((value) => ({ value, provenance: { ...provenance } })),
    operation: { ...base.operation, value: operation },
  };
}

function reading(
  id: string,
  timestamp: string | number,
  mmolL: number,
): GlucoseReading {
  const instant =
    typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  return {
    id,
    timestamp: instant,
    receivedAt: instant,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId: `test-${id}`,
  };
}

describe("expanded deterministic exact-range glucose metrics", () => {
  it("plots one canonical point per timestamp while retaining every source ID", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my average glucose today?"),
      readings: [
        reading("source-four", "2026-08-07T01:00:00+01:00", 4),
        reading("source-eight", "2026-08-07T01:00:00+01:00", 8),
        reading("twelve", "2026-08-07T02:00:00+01:00", 12),
      ],
    });

    expect(result.evidence[0]!.visualization).toMatchObject({
      windows: [
        {
          recordCount: 3,
          meanMmolL: 9,
          points: [
            {
              mmolL: 6,
              recordIds: ["source-eight", "source-four"],
            },
            { mmolL: 12, recordIds: ["twelve"] },
          ],
        },
      ],
    });
  });

  it("calculates every sample statistic from one canonical sample per timestamp", () => {
    const intent = withMetrics(
      ready("What was my average glucose today?"),
      [
        "glucose.mean",
        "glucose.median",
        "glucose.minimum",
        "glucose.maximum",
        "glucose.standard_deviation",
        "glucose.coefficient_of_variation",
        "glucose.gmi",
      ],
      "aggregate",
    );
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("source-a", "2026-08-07T01:00:00+01:00", 4),
        reading("source-b", "2026-08-07T01:00:00+01:00", 8),
        reading("ten", "2026-08-07T02:00:00+01:00", 10),
        reading("two", "2026-08-07T03:00:00+01:00", 2),
      ],
    });

    expect(result.evidence[0]!.calculation?.metrics).toEqual([
      { id: "glucose.mean", unit: "mmol/L", value: 6 },
      { id: "glucose.median", unit: "mmol/L", value: 6 },
      { id: "glucose.minimum", unit: "mmol/L", value: 2 },
      { id: "glucose.maximum", unit: "mmol/L", value: 10 },
      { id: "glucose.standard_deviation", unit: "mmol/L", value: 3.27 },
      { id: "glucose.coefficient_of_variation", unit: "%", value: 54.43 },
      { id: "glucose.gmi", unit: "%", value: 5.9 },
    ]);
    expect(result.answerBundle.claims.map(({ value }) => value)).toEqual([
      6, 6, 2, 10, 3.27, 54.43, 5.9,
    ]);
    expect(result.answer.confidence).toBe("limited");
    expect(result.answer.limitations.join(" ")).toContain(
      "shorter than 14 days",
    );
    expect(result.answer.answer).toContain("not a laboratory HbA1c result");
    expect(result.evidence[0]!.visualization).toBeUndefined();
    expect(result.answerBundle.charts).toEqual([]);
  });

  it("counts low/high physiological samples rather than duplicate source rows", () => {
    const lowBase = ready("How many low-glucose events did I have today?");
    const highBase = ready("How many high-glucose events did I have today?");
    const intent: TarvisIntentV1 = {
      ...withMetrics(
        lowBase,
        ["glucose.low_readings", "glucose.high_readings"],
        "count_readings",
      ),
      thresholds: [lowBase.thresholds[0]!, highBase.thresholds[0]!],
    };
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        // One physiological sample at 4.0 mmol/L, not one low plus one normal.
        reading("duplicate-low", "2026-08-07T01:00:00+01:00", 2),
        reading("duplicate-normal", "2026-08-07T01:00:00+01:00", 6),
        reading("actual-low", "2026-08-07T02:00:00+01:00", 2.5),
        reading("actual-high", "2026-08-07T03:00:00+01:00", 12),
      ],
    });

    expect(result.evidence[0]!.calculation?.metrics).toEqual([
      { id: "glucose.low_readings", unit: "readings", value: 1 },
      { id: "glucose.high_readings", unit: "readings", value: 1 },
    ]);
    expect(result.presentation.windows[0]!.metrics).toMatchObject([
      { id: "low-readings", value: 1 },
      { id: "high-readings", value: 1 },
    ]);
    expect(result.evidence[0]!.visualization).toBeUndefined();
  });

  it("keeps no-data sample statistics and reading counts unavailable, never zero", () => {
    const base = ready("How many low-glucose events did I have today?");
    const intent = withMetrics(
      base,
      ["glucose.low_readings"],
      "count_readings",
    );
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [],
    });

    expect(result.evidence[0]!.calculation?.metrics).toEqual([
      { id: "glucose.low_readings", unit: "readings", value: null },
    ]);
    expect(result.answerBundle.claims[0]).toMatchObject({
      status: "unavailable",
      value: null,
    });
  });

  it("calculates comparison medians independently for the exact periods", () => {
    const intent = withMetrics(
      ready(
        "Compare my average glucose over the last 24 hours with the previous period.",
      ),
      ["glucose.median"],
      "aggregate",
    );
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("previous-six", "2026-08-06T08:00:00+01:00", 6),
        reading("previous-eight", "2026-08-06T12:00:00+01:00", 8),
        reading("current-ten", "2026-08-07T08:00:00+01:00", 10),
        reading("current-twelve", "2026-08-07T12:00:00+01:00", 12),
      ],
    });

    expect(
      result.answerBundle.claims.map(({ metric, value }) => ({
        metric,
        value,
      })),
    ).toEqual([
      { metric: "glucose.median", value: 11 },
      { metric: "glucose.median", value: 7 },
    ]);
    expect(
      result.evidence.every(({ visualization }) => visualization === undefined),
    ).toBe(true);
  });

  it("treats 14 complete London calendar days across spring-forward as 14 days", () => {
    const asOf = Date.parse("2026-04-01T12:00:00+01:00");
    const resolution = resolveTarvisIntent(
      "What was my GMI from 16 March 2026 to 29 March 2026?",
      { now: asOf, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) return;
    const start = Date.parse("2026-03-16T00:00:00Z");
    const end = Date.parse("2026-03-30T00:00:00+01:00");
    expect(end - start).toBe(14 * 24 * 60 * 60_000 - 60 * 60_000);
    const readings: GlucoseReading[] = [];
    for (
      let timestamp = start, index = 0;
      timestamp < end;
      timestamp += 10 * 60_000, index += 1
    ) {
      readings.push(reading(`dst-${index}`, timestamp, 7));
    }

    const result = buildLocalGlucoseRangeAnswer({
      asOf,
      intent: resolution.intent,
      readings,
    });
    expect(result.answer.confidence).toBe("high");
    expect(result.answer.limitations.join(" ")).not.toContain(
      "shorter than 14 days",
    );
    expect(result.answerBundle.coverage.percent).toBe(100);
  });
});

describe("expanded recurring-window metric safety", () => {
  it("canonicalises duplicate sources in window, overall result, and median answer", () => {
    const intent = withMetrics(
      ready("What was my average glucose over the last two nights?"),
      ["glucose.median"],
      "aggregate",
    );
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("source-four", "2026-08-07T01:00:00+01:00", 4),
        reading("source-eight", "2026-08-07T01:00:00+01:00", 8),
        reading("twelve", "2026-08-07T02:00:00+01:00", 12),
      ],
    });

    expect(result.bundle.result.observedMeanMmolL).toBe(9);
    expect(result.bundle.windows.at(-1)!.observedMeanMmolL).toBe(9);
    expect(result.bundle.windows.at(-1)!.points[0]).toMatchObject({
      mmolL: 6,
      readingCount: 2,
      recordIds: ["source-eight", "source-four"],
    });
    expect(result.evidence.calculation?.metrics).toEqual([
      { id: "glucose.median", unit: "mmol/L", value: 9 },
    ]);
    expect(result.evidence.visualization).toBeUndefined();
    expect(result.answerBundle.charts).toEqual([]);
  });

  it("rejects GMI for selected recurring clock hours", () => {
    const intent = withMetrics(
      ready("What was my average glucose over the last two nights?"),
      ["glucose.gmi"],
      "aggregate",
    );
    expect(() =>
      buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);
  });
});

describe("expanded metric language and fail-closed routing", () => {
  it.each([
    [
      "What was the median of my glucose over the last 30 days?",
      "glucose.median",
    ],
    ["What was my median readings over the last 30 days?", "glucose.median"],
    [
      "What was my lowest glucose value over the last 30 days?",
      "glucose.minimum",
    ],
    ["What was my minimum reading over the last 30 days?", "glucose.minimum"],
    [
      "What was my highest glucose value over the last 30 days?",
      "glucose.maximum",
    ],
    ["What was my maximum reading over the last 30 days?", "glucose.maximum"],
    [
      "How variable were my readings over the last 30 days?",
      "glucose.coefficient_of_variation",
    ],
    [
      "What was the standard deviation of my glucose over the last 30 days?",
      "glucose.standard_deviation",
    ],
    [
      "What was my glucose CV over the last 30 days?",
      "glucose.coefficient_of_variation",
    ],
    ["What was my estimated GMI over the last 30 days?", "glucose.gmi"],
    [
      "How many low readings below 4 mmol/L did I have over the last 30 days?",
      "glucose.low_readings",
    ],
    [
      "How many low-glucose readings did I have over the last 30 days?",
      "glucose.low_readings",
    ],
    [
      "How many high reading above 12 mmol/L did I have over the last 30 days?",
      "glucose.high_readings",
    ],
    [
      "How many high-glucose reading did I have over the last 30 days?",
      "glucose.high_readings",
    ],
  ] as const)("resolves, routes, and executes %s", (question, metric) => {
    const resolution = resolveTarvisIntent(question, {
      now: AS_OF,
      timezone: "Europe/London",
    });
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) return;
    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      metric,
    ]);
    expect(routeTarvisIntent(resolution).kind).toBe("scoped-glucose");

    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: resolution.intent,
      readings: [
        reading("six", "2026-08-01T10:00:00+01:00", 6),
        reading("twelve", "2026-08-02T10:00:00+01:00", 12),
      ],
    });
    expect(result.evidence[0]!.calculation?.metrics[0]?.id).toBe(metric);
  });

  it("retains every shared-object aggregate metric and executes them together", () => {
    const resolution = resolveTarvisIntent(
      "What were my mean, median and CV glucose over the last 30 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) return;
    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      "glucose.mean",
      "glucose.median",
      "glucose.coefficient_of_variation",
    ]);
    expect(routeTarvisIntent(resolution).kind).toBe("scoped-glucose");
    const answer = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: resolution.intent,
      readings: [
        reading("six", "2026-08-01T10:00:00+01:00", 6),
        reading("ten", "2026-08-02T10:00:00+01:00", 10),
      ],
    });
    expect(answer.answerBundle.claims.map(({ metric }) => metric)).toEqual([
      "glucose.mean",
      "glucose.median",
      "glucose.coefficient_of_variation",
    ]);
  });

  it("retains both extrema in a shared-object request", () => {
    const resolution = resolveTarvisIntent(
      "What were my lowest and highest glucose over the last 30 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) return;
    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      "glucose.minimum",
      "glucose.maximum",
    ]);
  });

  it("recognises shared low/high reading counts with both profile thresholds", () => {
    const resolution = resolveTarvisIntent(
      "How many low and high readings did I have over the last 30 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) return;
    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      "glucose.low_readings",
      "glucose.high_readings",
    ]);
    expect(
      resolution.intent.thresholds.map(({ value }) => value),
    ).toMatchObject([
      { role: "low", operator: "lt", value: 3.9 },
      { role: "high", operator: "gt", value: 10 },
    ]);
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: resolution.intent,
      readings: [
        reading("low", "2026-08-01T10:00:00+01:00", 3),
        reading("high", "2026-08-02T10:00:00+01:00", 12),
      ],
    });
    expect(result.answerBundle.claims.map(({ value }) => value)).toEqual([
      1, 1,
    ]);
  });

  it("rejects an unconsumed mixed-operation metric cue before routing", () => {
    const resolution = resolveTarvisIntent(
      "What were my median and time in range over the last 30 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(resolution.outcome).toMatchObject({
      status: "unsupported",
      code: "unsupported_compound_question",
    });
    expect(routeTarvisIntent(resolution).kind).toBe("capability");
  });

  it("never replaces explicit compound thresholds with profile defaults", () => {
    [
      "How many low events below 4 mmol/L and high events above 12 mmol/L over the last 30 days?",
      "How many low readings below 4 mmol/L and high readings above 12 mmol/L over the last 30 days?",
    ].forEach((question) => {
      const resolution = resolveTarvisIntent(question, {
        now: AS_OF,
        timezone: "Europe/London",
      });
      expect(resolution.outcome).toMatchObject({
        status: "unsupported",
        code: "unsupported_compound_question",
      });
      expect(resolution.intent.thresholds).toEqual([]);
      expect(routeTarvisIntent(resolution).kind).toBe("capability");
    });
  });

  it("clarifies two thresholds for one low-reading count", () => {
    const resolution = resolveTarvisIntent(
      "How many low readings below 4 mmol/L and under 3 mmol/L did I have over the last 30 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(resolution.outcome).toMatchObject({
      status: "needs_clarification",
      code: "ambiguous_metric",
    });
    expect(routeTarvisIntent(resolution).kind).toBe("capability");
  });

  it("keeps recurring-clock GMI out of both local calculation and OpenAI", () => {
    const resolution = resolveTarvisIntent(
      "What was my GMI over the last two nights?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    expect(routeTarvisIntent(resolution).kind).toBe("capability");
  });
});
