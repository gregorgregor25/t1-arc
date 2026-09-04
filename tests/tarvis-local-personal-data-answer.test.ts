import { describe, expect, it } from "vitest";

import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import {
  buildLocalPersonalDataAnswer,
  rangesForLocalPersonalDataIntent,
} from "@/data/tarvis/localPersonalDataAnswer";
import { GLOOKO_IMPORT_CAPABILITIES } from "@/domain/sourceCapabilities";
import { addDays, toDateKey, zonedDateTimeToTimestamp } from "@/domain/time";
import type {
  DataSourceStatus,
  GlucoseReading,
  HealthContextEvent,
  InsulinDailyTotal,
  TimelineData,
  TimeRange,
} from "@/domain/models";

const NOW = Date.parse("2026-08-13T20:00:00+01:00");

function ready(question: string) {
  const resolution = resolveTarvisIntent(question, {
    now: NOW,
    timezone: "Europe/London",
  });
  expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
  if (!isReadyTarvisIntent(resolution))
    throw new Error("Expected ready intent");
  return resolution.intent;
}

function source(
  id: string,
  label: string,
  overrides: Partial<DataSourceStatus> = {},
): DataSourceStatus {
  return {
    id,
    label,
    detail: "Test source",
    freshness: "current",
    origin: "imported",
    isLive: true,
    ...overrides,
  };
}

function timeline(
  range: TimeRange,
  overrides: Partial<TimelineData> = {},
): TimelineData {
  return {
    range: { ...range },
    glucose: [],
    basal: [],
    boluses: [],
    dailyInsulinTotals: [],
    context: [],
    sources: [],
    ...overrides,
  };
}

function glucose(
  id: string,
  timestamp: number,
  mmolL: number,
  trend: GlucoseReading["trend"] = "unknown",
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend,
    quality: "measured",
    sourceId: "glucose-source",
  };
}

function execute(
  question: string,
  createCurrent: (range: TimeRange) => TimelineData,
  createPrevious?: (range: TimeRange) => TimelineData,
) {
  const intent = ready(question);
  const ranges = rangesForLocalPersonalDataIntent(intent, NOW);
  return buildLocalPersonalDataAnswer({
    asOf: NOW,
    intent,
    current: createCurrent(ranges.current),
    previous:
      ranges.previous && createPrevious
        ? createPrevious(ranges.previous)
        : undefined,
  });
}

function authoritativeTotals(
  range: TimeRange,
  prefix: string,
  dailyUnits: number,
): InsulinDailyTotal[] {
  const totals: InsulinDailyTotal[] = [];
  let dateKey = toDateKey(range.start);
  for (let index = 0; index < 32; index += 1) {
    const dayStart = zonedDateTimeToTimestamp(dateKey);
    if (dayStart >= range.end) break;
    const naturalEnd = zonedDateTimeToTimestamp(addDays(dateKey, 1));
    const timestamp = Math.min(naturalEnd - 1, range.end - 1);
    totals.push({
      id: `${prefix}-${dateKey}`,
      timestamp,
      dateKey,
      basalUnits: dailyUnits * 0.6,
      bolusUnits: dailyUnits * 0.4,
      totalUnits: dailyUnits,
      sourceId: "insulin-source",
      importedAt: naturalEnd <= range.end ? naturalEnd + 1_000 : range.end,
    });
    dateKey = addDays(dateKey, 1);
  }
  return totals;
}

describe("Tarv1s deterministic personal-data executor", () => {
  it("returns a fresh latest glucose with source trend and replayable evidence", () => {
    const result = execute("what's my sugar now?", (range) =>
      timeline(range, {
        glucose: [glucose("latest", NOW - 4 * 60_000, 7.4, "up")],
        sources: [source("glucose-source", "Glucose")],
      }),
    );

    expect(result.answer).toMatchObject({
      headline: "Latest glucose: 7.4 mmol/L",
      confidence: "high",
    });
    expect(result.answer.answer).toContain(
      "source-reported direction was rising",
    );
    expect(result.answer.answer).toContain(
      "19:56 on Thursday, 13 August 2026",
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.presentation.detail).toContain("Europe/London");
    expect(result.presentation.detail).not.toContain("UK date and time");
    expect(result.evidence[0]?.recordIds).toEqual(["latest"]);
    expect(result.answer.evidenceIds).toEqual(
      result.evidence.map(({ id }) => id),
    );
  });

  it("calculates a direction only from a recent same-source window and labels it as non-forecast", () => {
    const result = execute("am i going up?", (range) =>
      timeline(range, {
        glucose: [
          glucose("one", NOW - 15 * 60_000, 6.2),
          glucose("two", NOW - 10 * 60_000, 6.6),
          glucose("three", NOW - 5 * 60_000, 7.1),
        ],
        sources: [source("glucose-source", "Glucose")],
      }),
    );

    expect(result.answer.answer).toContain("locally calculated");
    expect(result.answer.limitations.join(" ")).toContain("not a forecast");
    expect(result.evidence[0]?.recordIds).toEqual(["one", "two", "three"]);
  });

  it("labels stale glucose as last-known and does not present its old arrow as current", () => {
    const result = execute("what is my bg now?", (range) =>
      timeline(range, {
        glucose: [glucose("stale", NOW - 20 * 60_000, 5.8, "doubleDown")],
        sources: [source("glucose-source", "Glucose", { freshness: "stale" })],
      }),
    );

    expect(result.answer.headline).toBe("Last known glucose: 5.8 mmol/L");
    expect(result.answer.answer).toContain(
      "too old to use as a current direction",
    );
    expect(result.answer.answer).not.toContain("falling quickly");
    expect(result.answer.confidence).toBe("limited");
  });

  it("uses the latest authoritative daily insulin snapshot without double counting", () => {
    const result = execute("how much insulin did i use yesterday?", (range) => {
      const totals: InsulinDailyTotal[] = [
        {
          id: "early-snapshot",
          timestamp: range.end - 4 * 60 * 60_000,
          dateKey: "2026-08-12",
          basalUnits: 8,
          bolusUnits: 11,
          totalUnits: 19,
          sourceId: "insulin-source",
          sourceDeviceId: "pump-a",
          importedAt: range.end + 1_000,
        },
        {
          id: "latest-snapshot",
          timestamp: range.end - 60_000,
          dateKey: "2026-08-12",
          basalUnits: 16,
          bolusUnits: 15,
          totalUnits: 31,
          sourceId: "insulin-source",
          sourceDeviceId: "pump-a",
          importedAt: range.end + 2_000,
        },
      ];
      return timeline(range, {
        dailyInsulinTotals: totals,
        sources: [
          source("insulin-source", "Insulin", {
            capabilities: GLOOKO_IMPORT_CAPABILITIES,
          }),
        ],
      });
    });

    expect(result.answer.headline).toBe("Delivered insulin: 31.0 U");
    expect(result.answer.answer).toContain(
      "daily totals saved in your records",
    );
    expect(result.evidence[0]?.recordIds).toContain("latest-snapshot");
    expect(result.answer.answer).not.toContain("50.0");
  });

  it("preserves an authoritative zero bolus instead of calling it missing", () => {
    const result = execute("how much bolus insulin yesterday?", (range) =>
      timeline(range, {
        dailyInsulinTotals: [
          {
            id: "zero-bolus-total",
            timestamp: range.end - 60_000,
            dateKey: "2026-08-12",
            basalUnits: 18,
            bolusUnits: 0,
            totalUnits: 18,
            sourceId: "insulin-source",
            importedAt: range.end + 1_000,
          },
        ],
        sources: [source("insulin-source", "Insulin")],
      }),
    );

    expect(result.answer.headline).toBe("Bolus insulin: 0.0 U");
    expect(result.answer.confidence).toBe("high");
    expect(result.answer.answer).toContain("Wednesday, 12 August 2026");
  });

  it("answers the exact screenshot bolus wording with the date and recorded dose times", () => {
    const result = execute(
      "How much bolus insulin did I take yesterday?",
      (range) =>
        timeline(range, {
          boluses: [
            {
              id: "breakfast-bolus",
              timestamp: range.start + 8 * 60 * 60_000,
              units: 4.25,
              sourceId: "insulin-source",
            },
            {
              id: "dinner-bolus",
              timestamp: range.start + 18 * 60 * 60_000,
              units: 6.5,
              sourceId: "insulin-source",
            },
          ],
          dailyInsulinTotals: [
            {
              id: "authoritative-total",
              timestamp: range.end - 1,
              dateKey: "2026-08-12",
              basalUnits: 17,
              bolusUnits: 10.75,
              totalUnits: 27.75,
              sourceId: "insulin-source",
              importedAt: range.end + 1_000,
            },
          ],
          sources: [source("insulin-source", "Insulin")],
        }),
    );

    expect(result.answer.headline).toBe("Bolus insulin: 10.8 U");
    expect(result.answer.answer).toContain("Wednesday, 12 August 2026");
    expect(result.answer.answer).toContain(
      "08:00 on Wednesday, 12 August 2026",
    );
    expect(result.answer.answer).toContain(
      "18:00 on Wednesday, 12 August 2026",
    );
  });

  it("keeps absent insulin records unavailable rather than turning them into zero", () => {
    const result = execute("how much bolus insulin yesterday?", (range) =>
      timeline(range, {
        sources: [
          source("insulin-source", "Insulin", {
            capabilities: GLOOKO_IMPORT_CAPABILITIES,
          }),
        ],
      }),
    );

    expect(result.answer.headline).toBe("Bolus insulin unavailable");
    expect(result.answer.answer).not.toMatch(/\b0(?:\.0)? U\b/);
    expect(result.answer.limitations.join(" ")).toContain(
      "not treated as zero",
    );
  });

  it.each([
    [
      "What was my total insulin over the last seven days?",
      "Delivered insulin",
    ],
    [
      "What was my total basal insulin over the last seven days?",
      "Basal insulin",
    ],
    [
      "What was my total bolus insulin over the last seven days?",
      "Bolus insulin",
    ],
  ])(
    "requires authoritative coverage for every day of a multi-day %s answer",
    (question, label) => {
      const result = execute(question, (range) => {
        const firstDateKey = toDateKey(range.start);
        const firstDayEnd = zonedDateTimeToTimestamp(addDays(firstDateKey, 1));
        return timeline(range, {
          basal: [
            {
              id: "detailed-basal-for-entire-range",
              start: range.start,
              end: range.end,
              rateUnitsPerHour: 1,
              units: (range.end - range.start) / 3_600_000,
              sourceId: "insulin-source",
            },
          ],
          boluses: [
            {
              id: "one-detailed-bolus",
              timestamp: range.start + 60_000,
              units: 4,
              sourceId: "insulin-source",
            },
          ],
          dailyInsulinTotals: [
            {
              id: "first-day-only",
              timestamp: firstDayEnd - 1,
              dateKey: firstDateKey,
              basalUnits: 24,
              bolusUnits: 4,
              totalUnits: 28,
              sourceId: "insulin-source",
              importedAt: firstDayEnd + 1_000,
            },
          ],
          sources: [
            source("insulin-source", "Insulin", {
              capabilities: GLOOKO_IMPORT_CAPABILITIES,
            }),
          ],
        });
      });

      expect(result.answer.headline).toBe(`${label} unavailable`);
      expect(result.answer.answer).toContain("do not support a reliable");
      expect(result.answer.answer).not.toMatch(/Recorded .* was [0-9.]+ U/);
      expect(result.answer.limitations.join(" ")).toContain(
        "not treated as zero",
      );
    },
  );

  it("clips an activity interval to its exact overlap with the half-open period", () => {
    const result = execute("how long did i exercise yesterday?", (range) =>
      timeline(range, {
        context: [
          {
            id: "crossing-activity",
            kind: "activity",
            title: "Cross-boundary walk",
            activityType: "walk",
            intensity: "moderate",
            durationMinutes: 60,
            start: range.start - 30 * 60_000,
            end: range.start + 30 * 60_000,
            sourceId: "context-source",
            origin: "imported",
          },
          {
            id: "starts-at-exclusive-end",
            kind: "activity",
            title: "Next-day walk",
            activityType: "walk",
            intensity: "light",
            durationMinutes: 20,
            start: range.end,
            end: range.end + 20 * 60_000,
            sourceId: "context-source",
            origin: "imported",
          },
        ],
      }),
    );

    expect(result.answer.headline).toBe("Recorded activity: 30 min");
    expect(result.answer.answer).toContain("across 1 activity.");
    expect(result.answer.answer).not.toContain("activitie");
    expect(result.presentation.windows[0]?.recordLabel).toBe(
      "recorded activity",
    );
    expect(result.evidence[0]?.recordIds).toEqual(["crossing-activity"]);
    expect(result.evidence[0]?.examples[0]?.timestamp).toBe(
      result.evidence[0]?.range.start,
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "falls inside the requested time",
    );
  });

  it("splits sleep across London-day boundaries by overlap, not start day", () => {
    const result = execute("how long did i sleep yesterday?", (range) =>
      timeline(range, {
        context: [
          {
            id: "cross-midnight-sleep",
            kind: "sleep",
            title: "Recorded sleep",
            durationMinutes: 8 * 60,
            start: range.start - 2 * 60 * 60_000,
            end: range.start + 6 * 60 * 60_000,
            sourceId: "context-source",
            origin: "imported",
          },
        ],
      }),
    );

    expect(result.answer.headline).toBe("Recorded sleep: 360 min");
    expect(result.evidence[0]?.examples[0]?.timestamp).toBe(
      result.evidence[0]?.range.start,
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "Sleep across midnight is divided between the two days",
    );
  });

  it("clips a basal evidence preview when the source interval began before the range", () => {
    const result = execute("how much basal insulin yesterday?", (range) =>
      timeline(range, {
        basal: [
          {
            id: "overlapping-basal",
            start: range.start - 60 * 60_000,
            end: range.end,
            rateUnitsPerHour: 1,
            units: (range.end - range.start) / 3_600_000 + 1,
            sourceId: "insulin-source",
          },
        ],
        sources: [
          source("insulin-source", "Insulin", {
            capabilities: GLOOKO_IMPORT_CAPABILITIES,
          }),
        ],
      }),
    );

    expect(result.answer.headline).toBe("Basal insulin: 24.0 U");
    expect(result.evidence[0]?.recordIds).toEqual(["overlapping-basal"]);
    expect(result.evidence[0]?.examples[0]?.timestamp).toBe(
      result.evidence[0]?.range.start,
    );
  });

  it.each([
    {
      question: "how many carbs did i eat yesterday?",
      event: (range: TimeRange): HealthContextEvent => ({
        id: "meal",
        kind: "meal",
        title: "Recorded lunch",
        mealType: "lunch",
        carbsGrams: 42.5,
        start: range.start + 12 * 60 * 60_000,
        sourceId: "context-source",
        origin: "manual",
      }),
      expected: "42.5 g",
      expectedRecordLabel: "recorded meal",
    },
    {
      question: "how long did i exercise yesterday?",
      event: (range: TimeRange): HealthContextEvent => ({
        id: "activity",
        kind: "activity",
        title: "Recorded walk",
        activityType: "walk",
        intensity: "moderate",
        durationMinutes: 35,
        start: range.start + 10 * 60 * 60_000,
        sourceId: "context-source",
        origin: "manual",
      }),
      expected: "35 min",
      expectedRecordLabel: "recorded activity",
    },
    {
      question: "how long did i sleep yesterday?",
      event: (range: TimeRange): HealthContextEvent => ({
        id: "sleep",
        kind: "sleep",
        title: "Recorded sleep",
        durationMinutes: 450,
        start: range.start + 60 * 60_000,
        end: range.start + 8.5 * 60 * 60_000,
        sourceId: "context-source",
        origin: "manual",
      }),
      expected: "450 min",
      expectedRecordLabel: "recorded sleep session",
    },
  ])(
    'sums only explicit local records for "$question"',
    ({ question, event, expected, expectedRecordLabel }) => {
      const result = execute(question, (range) =>
        timeline(range, { context: [event(range)] }),
      );

      expect(result.answer.headline).toContain(expected);
      expect(result.evidence[0]?.recordIds).toHaveLength(1);
      expect(result.presentation.windows[0]?.recordLabel).toBe(
        expectedRecordLabel,
      );
      expect(result.answer.limitations.join(" ")).toContain(
        "explicitly recorded",
      );
    },
  );

  it("does not report zero when a context category has no records", () => {
    const result = execute("how many carbs did i eat yesterday?", (range) =>
      timeline(range),
    );

    expect(result.answer.headline).toBe("Recorded carbohydrates unavailable");
    expect(result.answer.answer).toContain("No recorded meals were available");
    expect(result.answer.answer).not.toContain("0 g");
  });

  it("distinguishes a meal with missing carbohydrate from no meal record", () => {
    const result = execute("how many carbs did i eat yesterday?", (range) =>
      timeline(range, {
        context: [
          {
            id: "summary-meal",
            kind: "meal",
            title: "Meal summary",
            mealType: "lunch",
            energyKcal: 430,
            proteinGrams: 31,
            nutritionDetail: "summary",
            start: range.start + 12 * 60 * 60_000,
            sourceId: "health-connect:mfp",
            sourceLabel: "MyFitnessPal",
            origin: "imported",
          },
        ],
      }),
    );

    expect(result.answer.headline).toBe("Recorded carbohydrates unavailable");
    expect(result.answer.answer).toContain("1 recorded meal was available");
    expect(result.answer.answer).toContain(
      "did not include a carbohydrate value",
    );
    expect(result.answer.answer).not.toContain("No recorded meals");
    expect(result.answer.limitations.join(" ")).toContain(
      "not treated as zero",
    );
    expect(result.evidence[0]?.recordIds).toEqual(["summary-meal"]);
    expect(result.evidence[0]?.examples[0]?.secondary).toContain("430 kcal");
    expect(result.evidence[0]?.examples[0]?.secondary).not.toContain("items:");
  });

  it("warns when native and imported meal records may overlap", () => {
    const result = execute("how many carbs did i eat yesterday?", (range) =>
      timeline(range, {
        context: [
          {
            id: "native-meal",
            kind: "meal",
            title: "Lunch",
            mealType: "lunch",
            carbsGrams: 42,
            start: range.start + 12 * 60 * 60_000,
            sourceId: "t1arc-food",
            origin: "manual",
          },
          {
            id: "imported-meal",
            kind: "meal",
            title: "Lunch summary",
            mealType: "lunch",
            carbsGrams: 42,
            start: range.start + 12 * 60 * 60_000 + 5 * 60_000,
            sourceId: "health-connect:mfp",
            origin: "imported",
          },
        ],
      }),
    );

    expect(result.answer.headline).toContain(
      "Known carbohydrate from retained meal records",
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "cross-source meal pair",
    );
    expect(result.answer.limitations.join(" ")).toContain("may overlap");
    expect(result.evidence[0]?.recordIds).toEqual([
      "native-meal",
      "imported-meal",
    ]);
  });

  it("labels a native item subtotal as limited rather than complete", () => {
    const result = execute("how many carbs did i eat yesterday?", (range) =>
      timeline(range, {
        context: [
          {
            id: "partial-native-meal",
            kind: "meal",
            title: "Lunch",
            mealType: "lunch",
            carbsGrams: 30,
            nutritionDetail: "itemized",
            items: [
              {
                id: "wrap",
                name: "Wrap",
                amount: 120,
                unit: "g",
                carbohydrateGrams: 30,
              },
              {
                id: "sauce",
                name: "Sauce",
                amount: 20,
                unit: "g",
              },
            ],
            start: range.start + 12 * 60 * 60_000,
            sourceId: "t1arc-food",
            origin: "manual",
          },
        ],
      }),
    );

    expect(result.answer.headline).toContain(
      "Known carbohydrate from retained meal records",
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "carbohydrate subtotal",
    );
    expect(result.evidence[0]?.examples[0]?.secondary).toContain(
      "carbohydrate (partial)",
    );
  });

  it("reports a fully uncovered connected sensor period as one gap, not missing physiology", () => {
    const result = execute("any sensor gaps yesterday?", (range) =>
      timeline(range, {
        sources: [source("glucose-source", "Glucose")],
      }),
    );

    expect(result.answer.headline).toBe("Sensor gaps: 1 gaps");
    expect(result.answer.answer).toContain("1 uncovered sensor gap");
    expect(result.presentation.windows[0]?.coveragePercent).toBe(0);
  });

  it("distinguishes an unavailable glucose source from measured zero coverage", () => {
    const result = execute("what was my sensor coverage yesterday?", (range) =>
      timeline(range),
    );

    expect(result.answer.headline).toBe("Sensor coverage unavailable");
    expect(result.answer.answer).toContain("No glucose source was available");
    expect(result.presentation.windows[0]?.metrics[0]?.value).toBeNull();
  });

  it("compares exact adjacent periods without a model request", () => {
    const result = execute(
      "compare my total insulin over the last seven days with the seven before that",
      (range) =>
        timeline(range, {
          dailyInsulinTotals: authoritativeTotals(range, "current", 20),
          sources: [source("insulin-source", "Insulin")],
        }),
      (range) =>
        timeline(range, {
          dailyInsulinTotals: authoritativeTotals(range, "previous", 17),
          sources: [source("insulin-source", "Insulin")],
        }),
    );

    expect(result.answer.headline).toBe("Delivered insulin comparison");
    expect(result.answer.answer).toContain("difference was +21.0 U");
    expect(result.evidence).toHaveLength(2);
  });

  it("rejects timeline data that does not exactly match the typed range", () => {
    const intent = ready("how much insulin did i use yesterday?");
    const ranges = rangesForLocalPersonalDataIntent(intent, NOW);

    expect(() =>
      buildLocalPersonalDataAnswer({
        asOf: NOW,
        intent,
        current: timeline({
          start: ranges.current.start + 1,
          end: ranges.current.end,
        }),
      }),
    ).toThrow("does not exactly match");
  });
});
