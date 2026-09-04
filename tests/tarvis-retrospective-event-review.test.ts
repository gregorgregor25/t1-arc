import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRetrospectiveEventReview,
  isRetrospectiveEventQuestion,
  loadRetrospectiveEventReview,
  rangeForRetrospectiveActivity,
  rangeForRetrospectiveEventQuestion,
  retrospectiveGlucoseCoverage,
  retrospectiveGlucoseEventKind,
} from "@/data/tarvis/retrospectiveEventReview";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import type { TimelineData } from "@/domain/models";
import type { TimestampedNotificationIob } from "@/data/notification/NotificationEventStore";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

const NOW = Date.parse("2026-08-15T09:00:00+01:00");
const WALK_START = Date.parse("2026-08-14T19:00:00+01:00");

function timeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    range: {
      start: Date.parse("2026-08-14T16:00:00+01:00"),
      end: NOW,
    },
    glucose: [],
    basal: [],
    boluses: [],
    pumpStates: [],
    dailyInsulinTotals: [],
    context: [],
    sources: [],
    ...overrides,
  };
}

function reading(id: string, minutes: number, mmolL: number) {
  const timestamp = WALK_START + minutes * 60_000;
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: "unknown" as const,
    quality: "measured" as const,
    sourceId: "cgm",
  };
}

const walk = {
  id: "walk-one",
  kind: "activity" as const,
  start: WALK_START,
  end: WALK_START + 35 * 60_000,
  title: "Outdoor walk",
  activityType: "walk" as const,
  durationMinutes: 35,
  intensity: "moderate" as const,
  sourceId: "health-connect",
  origin: "imported" as const,
};

function iob(
  id: string,
  capturedAt: number,
  iobUnits: number,
  packageName = "com.insulet.myblue.pdm",
  sourceLabel = "Omnipod 5",
  origin: TimestampedNotificationIob["origin"] = "local",
): TimestampedNotificationIob {
  return {
    id,
    sourceId: `android-notification:${packageName}`,
    packageName,
    sourceLabel,
    capturedAt,
    iobUnits,
    origin,
  };
}

describe("Tarv1s retrospective event review", () => {
  it("recognises ordinary past-tense and varied activity language", () => {
    expect(
      isRetrospectiveEventQuestion(
        "Why did my glucose go low when I walked to the pub after dinner on Friday night?",
      ),
    ).toBe(true);
    expect(
      isRetrospectiveEventQuestion(
        "Can you explain why I fell low after I ran?",
      ),
    ).toBe(true);
    expect(
      isRetrospectiveEventQuestion("Review the glucose drop after I cycled."),
    ).toBe(true);
  });

  it.each([
    "Can you explain exercise and glucose?",
    "Explain why exercise lowers glucose",
    "Why can exercise make glucose fall?",
    "Why does walking lower blood sugar?",
  ])(
    "does not treat conceptual exercise education as a personal event: %s",
    (question) => {
      expect(isRetrospectiveEventQuestion(question)).toBe(false);
    },
  );

  it.each([
    "Why did I go high during my walk on Saturday 8 August? Please check food, insulin, activity and data gaps.",
    "Why did my walk make me high yesterday? Check food and activity.",
    "How did walking after dinner affect my high on Saturday 8 August? Check food, insulin and activity.",
    "Why did walking make me low yesterday? Check food, insulin and activity.",
    "Was my high related to exercise on Saturday 8 August? Check food, insulin and activity.",
    "Why did I go high whilst walking on Saturday 8 August? Check food, insulin and activity.",
    "Why did I go low when out walking yesterday? Check food, insulin and activity.",
  ])(
    "keeps a separately stated activity incident even when evidence categories follow: %s",
    (question) => {
      expect(isRetrospectiveEventQuestion(question)).toBe(true);
    },
  );

  it.each([
    "Why did I go high on Saturday 15 August? Please check food, insulin, activity and data gaps.",
    "Why did I go high on Saturday 15 August? Please check my activity, food, insulin and data gaps.",
    "Why did I go high on Saturday 15 August? Please check my exercise, meals and insulin.",
    "Why did I go high on Saturday 15 August? Please review my activity, food, insulin and data gaps.",
    "Why did I go high on Saturday 15 August? Review activity, meals, insulin and sensor gaps.",
    "Why did I go high on Saturday 15 August? Factor in my activity, meals, insulin and data gaps.",
    "Why did I go high on Saturday 15 August? Running, meals and insulin.",
    "Why did I go high on Saturday 15 August? Cycling, meals and insulin.",
    "Why did I go high on Saturday 15 August? Swimming, meals and insulin.",
    "Why did I go high on Saturday 15 August? Gym, meals and insulin.",
    "Could activity, food or insulin have caused my high on Saturday 15 August?",
    "Did food, insulin or activity make me high on Saturday 15 August?",
    "Could activity, meals or insulin be responsible for my high on Saturday 15 August?",
    "Was my high on Saturday 15 August caused by food, insulin or activity?",
    "Could activity plus food have caused my high on Saturday 15 August?",
    "Could activity together with insulin have caused my high on Saturday 15 August?",
    "Could exercise alongside food have caused my high on Saturday 15 August?",
    "Did activity as well as insulin make me high on Saturday 15 August?",
    "Was my high on Saturday 15 August caused by activity plus food?",
    "Why did I go low yesterday? Look at exercise, meals and insulin.",
    "Investigate my high last Sunday and include activity records.",
  ])(
    "does not mistake an activity evidence category for a recorded incident: %s",
    (question) => {
      expect(isRetrospectiveEventQuestion(question)).toBe(false);
    },
  );

  it("reports timestamped notification IOB per source without calculating, merging, or claiming causality", () => {
    const records = [
      iob("omnipod-old", WALK_START - 30 * 60_000, 1.4),
      iob("omnipod-zero", WALK_START - 5 * 60_000, 0),
      iob("omnipod-after", WALK_START + 10 * 60_000, 0.3),
      iob(
        "gluroo-before",
        WALK_START - 4 * 60_000,
        2.6,
        "com.gluroo.gluroo",
        "Gluroo",
      ),
    ];
    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: { status: "loaded", records, truncated: false },
    });

    expect(result.answer.answer).toContain("Omnipod 5 notification");
    expect(result.answer.answer).toContain("0 U IOB");
    expect(result.answer.answer).toContain("Gluroo notification");
    expect(result.answer.answer).toContain("2.6 U IOB");
    expect(result.answer.answer).not.toContain("1.4 U IOB");
    expect(result.answer.answer).not.toContain("0.3 U IOB");
    expect(result.answer.answer).toContain("separate sources");
    expect(result.answer.answer).not.toMatch(/because|caused|recommend/i);
    expect(result.answer.limitations.join(" ")).toContain(
      "reported by notifications",
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "does not calculate or interpolate IOB",
    );
    expect(result.answer.limitations.join(" ")).not.toContain(
      "no timestamped insulin-on-board record",
    );
    const evidence = result.evidence.find(
      (reference) => reference.label === "Notification-reported IOB",
    );
    expect(evidence?.recordIds).toEqual([
      "omnipod-old",
      "omnipod-zero",
      "gluroo-before",
      "omnipod-after",
    ]);
    expect(evidence?.examples).toHaveLength(4);
    expect(
      evidence?.examples.every((example) => example.kind === "source-record"),
    ).toBe(true);
    expect(evidence?.description).toContain("capture time");
    expect(evidence?.examples[0]).toEqual({
      id: "omnipod-old",
      kind: "source-record",
      timestamp: WALK_START - 30 * 60_000,
      primary: "1.4 U IOB",
      secondary: "Omnipod 5 notification · this-phone capture time",
      sourceId: "android-notification:com.insulet.myblue.pdm",
    });
    expect(JSON.stringify(evidence)).not.toContain("SECRET-NOTIFICATION-TEXT");
    expect(JSON.stringify(evidence)).not.toContain("payload_json");
  });

  it("labels restored notification evidence without claiming this phone captured it", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: {
        status: "loaded",
        records: [
          iob(
            "restored-omnipod",
            WALK_START - 5 * 60_000,
            1.2,
            "com.insulet.myblue.pdm",
            "Omnipod 5",
            "restored",
          ),
        ],
        truncated: false,
      },
    });

    expect(result.answer.answer).toContain(
      "restored Omnipod 5 notification record",
    );
    expect(result.answer.answer).not.toContain("T1 Arc captured");
    expect(result.answer.limitations.join(" ")).not.toContain(
      "captured on this phone",
    );
    const evidence = result.evidence.find(
      (reference) => reference.label === "Notification-reported IOB",
    );
    expect(evidence?.examples[0]?.secondary).toBe(
      "Omnipod 5 notification · restored · original capture time",
    );
  });

  it("labels pre-provenance notification evidence as unknown rather than restored", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: {
        status: "loaded",
        records: [
          iob(
            "legacy-omnipod",
            WALK_START - 5 * 60_000,
            1.2,
            "com.insulet.myblue.pdm",
            "Omnipod 5",
            "unknown",
          ),
        ],
        truncated: false,
      },
    });

    expect(result.answer.answer).toContain(
      "legacy Omnipod 5 notification record",
    );
    expect(result.answer.answer).toContain("origin could not be verified");
    expect(result.answer.answer).not.toContain("restored Omnipod 5");
    expect(result.answer.answer).not.toContain("T1 Arc captured");
    const evidence = result.evidence.find(
      (reference) => reference.label === "Notification-reported IOB",
    );
    expect(evidence?.examples[0]?.secondary).toBe(
      "Omnipod 5 notification · legacy origin unknown · recorded capture time",
    );
  });

  it("uses the first capture after activity start only when that source has no earlier capture", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: {
        status: "loaded",
        records: [iob("first-after", WALK_START + 2 * 60_000, 1.25)],
        truncated: false,
      },
    });

    expect(result.answer.answer).toContain(
      "first available Omnipod 5 notification after the activity started",
    );
    expect(result.answer.answer).toContain("1.25 U IOB");
  });

  it("distinguishes empty, unavailable and truncated IOB history without manufacturing a value", () => {
    const empty = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: { status: "loaded", records: [], truncated: false },
    });
    expect(empty.answer.limitations.join(" ")).toContain(
      "No revalidated timestamped IOB record was available in the review window",
    );
    expect(empty.answer.limitations.join(" ")).toContain(
      "not proof that no active insulin was present",
    );

    const unavailable = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: { status: "unavailable", records: [], truncated: false },
    });
    expect(unavailable.answer.limitations.join(" ")).toContain(
      "could not check timestamped notification IOB",
    );

    const truncated = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
      iob: { status: "loaded", records: [], truncated: true },
    });
    expect(truncated.answer.limitations.join(" ")).toContain(
      "bounded notification IOB query was truncated",
    );
    for (const result of [empty, unavailable, truncated]) {
      expect(result.answer.answer).not.toMatch(/\b\d+(?:\.\d+)? U IOB\b/);
    }
  });

  it("loads IOB only after one activity is resolved, using the exact incident window, and survives loader failure", async () => {
    const incidentRange = rangeForRetrospectiveActivity(walk);
    const successfulLoader = vi.fn(async () => ({
      records: [iob("bounded-iob", WALK_START - 60_000, 1.1)],
      truncated: false,
    }));
    const successful = await loadRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      searchRange: timeline().range,
      loadTimelineData: async (range) => timeline({ range, context: [walk] }),
      loadTimestampedIob: successfulLoader,
    });
    expect(successfulLoader).toHaveBeenCalledOnce();
    expect(successfulLoader).toHaveBeenCalledWith(incidentRange);
    expect(successful.answer.answer).toContain("1.1 U IOB");

    const failed = await loadRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      searchRange: timeline().range,
      loadTimelineData: async (range) => timeline({ range, context: [walk] }),
      loadTimestampedIob: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(failed.answer.limitations.join(" ")).toContain(
      "could not check timestamped notification IOB",
    );

    const ambiguousLoader = vi.fn(async () => ({
      records: [iob("must-not-load", WALK_START, 9.9)],
      truncated: false,
    }));
    const ambiguous = await loadRetrospectiveEventReview({
      question: "Why did I go low during a walk last week?",
      searchRange: timeline().range,
      loadTimelineData: async (range) =>
        timeline({
          range,
          context: [walk, { ...walk, id: "walk-two" }],
        }),
      loadTimestampedIob: ambiguousLoader,
    });
    expect(ambiguous.answer.headline).toBe("Which activity did you mean?");
    expect(ambiguousLoader).not.toHaveBeenCalled();
  });

  it("classifies the requested glucose event instead of treating every question as a low", () => {
    expect(retrospectiveGlucoseEventKind("Why did I go low on my walk?")).toBe(
      "low",
    );
    expect(
      retrospectiveGlucoseEventKind("Why did my glucose spike after my walk?"),
    ).toBe("high");
    expect(
      retrospectiveGlucoseEventKind("Why did my glucose drop after my walk?"),
    ).toBe("drop");
    expect(
      retrospectiveGlucoseEventKind(
        "What happened to my glucose during my walk?",
      ),
    ).toBe("neutral");
    expect(
      isRetrospectiveEventQuestion(
        "Why did my glucose spike after my walk yesterday?",
      ),
    ).toBe(true);
  });

  it("recognises a why-low activity question and keeps it on device", () => {
    const question = "Why did my sugars go low during my walk last night?";
    expect(isRetrospectiveEventQuestion(question)).toBe(true);
    const plan = coordinateTarvisRequest({ question, asOf: NOW });
    expect(plan).toMatchObject({ kind: "retrospective-event" });
    if (plan.kind !== "retrospective-event")
      throw new Error("Expected event route");
    expect(plan.range).toEqual(
      rangeForRetrospectiveEventQuestion(question, NOW),
    );
    expect(plan.range.start).toBe(Date.parse("2026-08-14T16:00:00+01:00"));
    expect(plan.range.end).toBe(NOW);
  });

  it("states observed timing without claiming a cause or inventing IOB", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({
        context: [
          walk,
          {
            id: "lunch",
            kind: "meal",
            start: WALK_START - 90 * 60_000,
            title: "Late lunch",
            mealType: "lunch",
            carbsGrams: 42,
            energyKcal: 510,
            proteinGrams: 28,
            nutritionDetail: "itemized",
            items: [
              {
                id: "wrap",
                name: "Chicken wrap",
                amount: 250,
                unit: "g",
                carbohydrateGrams: 42,
                sourceLabel: "My foods",
              },
            ],
            sourceId: "manual",
            origin: "manual",
          },
        ],
        glucose: [
          reading("start", -2, 5.6),
          reading("during", 15, 4.2),
          reading("first-low", 25, 3.7),
          reading("lowest", 32, 3.3),
          reading("after", 45, 4.1),
        ],
        boluses: [
          {
            id: "bolus",
            timestamp: WALK_START - 75 * 60_000,
            units: 4.2,
            sourceId: "pump",
          },
        ],
      }),
    });

    expect(result.answer.headline).toContain("Recorded low");
    expect(result.answer.answer).toContain("first recorded value below 3.9");
    expect(result.answer.answer).toContain("42 g carbohydrate");
    expect(result.answer.answer).toContain("510 kcal");
    expect(result.answer.answer).toContain("Chicken wrap");
    expect(result.answer.answer).toContain("4.2 U of bolus insulin");
    expect(result.answer.answer).toContain("do not establish what caused");
    expect(result.answer.answer.toLowerCase()).not.toContain("because");
    expect(result.answer.limitations.join(" ")).toContain(
      "does not estimate historical IOB",
    );
    expect(result.answer.evidenceIds).toEqual(
      result.evidence.map(({ id }) => id),
    );
  });

  it("uses supplied summary macros without inventing foods", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({
        context: [
          walk,
          {
            id: "summary-meal",
            kind: "meal",
            start: WALK_START - 90 * 60_000,
            end: WALK_START - 89 * 60_000,
            title: "Meal summary",
            mealType: "lunch",
            energyKcal: 430,
            proteinGrams: 31,
            nutritionDetail: "summary",
            sourceId: "health-connect:mfp",
            sourceLabel: "MyFitnessPal",
            origin: "imported",
          },
        ],
      }),
    });

    expect(result.answer.answer).toContain("430 kcal");
    expect(result.answer.answer).toContain("31 g protein");
    expect(result.answer.answer).not.toContain("items:");
    expect(result.answer.answer).not.toContain("Chicken wrap");
  });

  it("asks which event rather than silently choosing between multiple walks", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did I go low during a walk last week?",
      timeline: timeline({
        context: [
          walk,
          {
            ...walk,
            id: "walk-two",
            start: WALK_START - 24 * 60 * 60_000,
            end: WALK_START - 24 * 60 * 60_000 + 20 * 60_000,
            durationMinutes: 20,
          },
        ],
      }),
    });
    expect(result.answer.headline).toBe("Which activity did you mean?");
    expect(result.answer.answer).toContain("walk at 19:30");
    expect(result.answer.confidence).toBe("limited");
  });

  it("uses regional digits when reporting multiple matching activities", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: "ar-EG",
    });
    const result = buildRetrospectiveEventReview({
      question: "Why did I go low during a walk last week?",
      timeline: timeline({
        context: [
          walk,
          {
            ...walk,
            id: "walk-two",
            start: WALK_START - 24 * 60 * 60_000,
            end: WALK_START - 24 * 60 * 60_000 + 20 * 60_000,
            durationMinutes: 20,
          },
        ],
      }),
    });

    expect(result.answer.answer).toContain("I found ٢ matching activities");
  });

  it("uses a stated time of day to select the intended activity", () => {
    const morningStart = Date.parse("2026-08-14T09:00:00+01:00");
    const eveningStart = Date.parse("2026-08-14T20:15:00+01:00");
    const result = buildRetrospectiveEventReview({
      question:
        "Why did my glucose go low when I walked after dinner on Friday night?",
      timeline: timeline({
        context: [
          {
            ...walk,
            id: "morning-walk",
            title: "Morning walk",
            start: morningStart,
            end: morningStart + 20 * 60_000,
            durationMinutes: 20,
          },
          {
            ...walk,
            id: "evening-walk",
            title: "Evening walk",
            start: eveningStart,
            end: eveningStart + 30 * 60_000,
            durationMinutes: 30,
          },
        ],
      }),
    });

    expect(result.outcome).toBe("ready");
    expect(result.answer.answer).toContain("Evening walk");
    expect(result.answer.answer).not.toContain("Morning walk");
  });

  it("does not infer a route or manufacture an activity when none was imported", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did I go low walking to the bar last night?",
      timeline: timeline(),
    });
    expect(result.answer.headline).toContain("could not find");
    expect(result.answer.answer).not.toContain("bar route");
    expect(result.answer.limitations.join(" ")).toContain(
      "route or destination cannot be inferred",
    );
  });

  it("reports highs and drops using their own recorded event semantics", () => {
    const high = buildRetrospectiveEventReview({
      question: "Why did my glucose spike after my walk last night?",
      timeline: timeline({
        context: [walk],
        glucose: [
          reading("high-start", -2, 7.2),
          reading("first-high", 50, 10.4),
          reading("highest", 80, 12.1),
        ],
      }),
    });
    expect(high.answer.headline).toContain("Recorded high");
    expect(high.answer.answer).toContain("first recorded value above 10.0");
    expect(high.answer.answer).not.toContain("first recorded value below");

    const drop = buildRetrospectiveEventReview({
      question: "Why did my glucose drop after my walk last night?",
      timeline: timeline({
        context: [walk],
        glucose: [
          reading("drop-start", -2, 8.4),
          reading("drop-later", 55, 5.1),
        ],
      }),
    });
    expect(drop.answer.headline).toContain("Recorded drop");
    expect(drop.answer.answer).toContain("recorded fall of 3.3 mmol/L");
    expect(drop.answer.answer).toContain(
      "do not establish what caused the drop",
    );
  });

  it("uses the complete two-hour follow-up and excludes meals at or after activity start", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({
        context: [
          walk,
          {
            id: "meal-before",
            kind: "meal",
            start: WALK_START - 30 * 60_000,
            title: "Meal before",
            mealType: "dinner",
            carbsGrams: 35,
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "meal-during",
            kind: "meal",
            start: WALK_START + 5 * 60_000,
            title: "Meal during",
            mealType: "snack",
            carbsGrams: 12,
            sourceId: "manual",
            origin: "manual",
          },
        ],
        glucose: [
          reading("follow-up-start", 0, 5.8),
          reading("late-low", 140, 3.4),
        ],
      }),
    });

    expect(result.answer.headline).toContain("Recorded low");
    expect(result.answer.answer).toContain("21:20");
    expect(result.answer.answer).toContain("Meal before");
    expect(result.answer.answer).not.toContain("Meal during");
    const mealEvidence = result.evidence.find(
      (reference) => reference.label === "Meals before the activity",
    );
    expect(mealEvidence?.recordIds).toEqual(["meal-before"]);
    expect(
      result.evidence.find(
        (reference) => reference.label === "Glucose around the activity",
      )?.recordIds,
    ).toContain("late-low");
  });

  it("describes exact basal and pump-state timing and retains every contributing record ID", () => {
    const basalBefore = {
      id: "basal-before",
      start: WALK_START - 30 * 60_000,
      end: WALK_START + 10 * 60_000,
      rateUnitsPerHour: 0.8,
      units: 0.53,
      sourceId: "pump",
    };
    const basalAfter = {
      id: "basal-after",
      start: WALK_START + 10 * 60_000,
      end: WALK_START + 70 * 60_000,
      rateUnitsPerHour: 0.65,
      units: 0.65,
      sourceId: "pump",
    };
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({
        context: [walk],
        glucose: [reading("glucose", 0, 6.2)],
        basal: [basalBefore, basalAfter],
        boluses: [
          {
            id: "bolus-after",
            timestamp: WALK_START + 60 * 60_000,
            units: 1.2,
            sourceId: "pump",
          },
        ],
        pumpStates: [
          {
            id: "activity-mode",
            start: WALK_START - 15 * 60_000,
            end: WALK_START + 45 * 60_000,
            kind: "activity-mode",
            sourceId: "glooko-report",
          },
          {
            id: "automated-pause",
            start: WALK_START + 75 * 60_000,
            end: WALK_START + 90 * 60_000,
            kind: "automated-pause",
            sourceId: "glooko-report",
          },
        ],
      }),
    });

    expect(result.answer.answer).toContain("0.80 U/hr from 18:30 to 19:10");
    expect(result.answer.answer).toContain("0.65 U/hr from 19:10 to 20:10");
    expect(result.answer.answer).toContain(
      "Activity mode was recorded from 18:45 to 19:45 (60 minutes)",
    );
    expect(result.answer.answer).toContain(
      "Automated pause was recorded from 20:15 to 20:30 (15 minutes)",
    );
    expect(result.answer.answer).toContain("1.2 U of bolus insulin at 20:00");
    expect(result.answer.answer).toContain("(after the activity)");
    const insulinEvidence = result.evidence.find(
      (reference) => reference.label === "Insulin and pump records",
    );
    expect(insulinEvidence?.recordIds).toEqual([
      "bolus-after",
      "basal-before",
      "basal-after",
      "activity-mode",
      "automated-pause",
    ]);
  });

  it("uses gap-aware coverage rather than reading count and keeps all glucose evidence IDs", () => {
    const range = {
      start: WALK_START,
      end: WALK_START + 155 * 60_000,
    };
    const sparse = retrospectiveGlucoseCoverage(
      [reading("only-reading", 0, 3.7)],
      range,
    );
    expect(sparse.coveragePercent).toBeCloseTo(9.68, 1);
    expect(sparse.longestGapMinutes).toBe(140);

    const completeReadings = Array.from({ length: 32 }, (_, index) =>
      reading(`complete-${index}`, index * 5, index === 10 ? 3.6 : 5.4),
    );
    const complete = retrospectiveGlucoseCoverage(completeReadings, range);
    expect(complete.coveragePercent).toBe(100);
    expect(complete.longestGapMinutes).toBe(0);

    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({ context: [walk], glucose: completeReadings }),
    });
    expect(result.answer.confidence).toBe("moderate");
    const glucoseEvidence = result.evidence.find(
      (reference) => reference.label === "Glucose around the activity",
    );
    expect(glucoseEvidence?.recordIds).toEqual(
      completeReadings.map((item) => item.id),
    );
    expect(glucoseEvidence?.examples.length).toBeLessThanOrEqual(5);
  });

  it("distinguishes a low already underway from a fall that reaches low after activity starts", () => {
    const alreadyLow = buildRetrospectiveEventReview({
      question: "Why did I go low during my walk last night?",
      timeline: timeline({
        context: [walk],
        glucose: [
          reading("before-low", -10, 3.7),
          reading("later-low", 10, 3.5),
        ],
      }),
    });
    expect(alreadyLow.answer.answer).toContain(
      "already below 3.9 mmol/L before the activity began",
    );
    expect(alreadyLow.answer.answer).toContain(
      "cannot explain the start of the low on its own",
    );

    const laterLow = buildRetrospectiveEventReview({
      question: "Why did I go low during my walk last night?",
      timeline: timeline({
        context: [walk],
        glucose: [reading("start", 0, 6.2), reading("first-low", 40, 3.7)],
      }),
    });
    expect(laterLow.answer.answer).toContain(
      "recorded fall of 2.5 mmol/L over 40 minutes",
    );
    expect(laterLow.answer.answer).toContain("5 minutes after it ended");
  });

  it("ranks context by interval proximity, evidence completeness and stable ID while retaining every evidence ID", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did my sugars go low during my walk last night?",
      timeline: timeline({
        range: {
          start: WALK_START - 24 * 60 * 60_000,
          end: NOW,
        },
        context: [
          walk,
          {
            id: "sleep-before",
            kind: "sleep",
            start: WALK_START - 20 * 60 * 60_000,
            end: WALK_START - 12.5 * 60 * 60_000,
            title: "Night sleep",
            durationMinutes: 450,
            qualityPercent: 82,
            sourceId: "health-connect",
            origin: "imported",
          },
          {
            id: "illness-before",
            kind: "note",
            start: WALK_START - 90 * 60_000,
            title: "Feeling unwell",
            category: "illness",
            detail: "Sore throat",
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "medication-before",
            kind: "medication",
            start: WALK_START - 60 * 60_000,
            title: "Antihistamine",
            amount: 10,
            unit: "mg",
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "zeta-overlap-incomplete",
            kind: "note",
            start: WALK_START - 60 * 60_000,
            end: WALK_START + 5 * 60_000,
            title: "Long-running stress context",
            category: "stress",
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "beta-inside-complete",
            kind: "note",
            start: WALK_START + 5 * 60_000,
            title: "Busy evening",
            category: "stress",
            detail: "Work deadline",
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "alpha-inside-complete",
            kind: "note",
            start: WALK_START + 20 * 60_000,
            title: "Crowded route",
            category: "stress",
            detail: "Unexpected disruption",
            sourceId: "manual",
            origin: "manual",
          },
          {
            id: "hormones-before",
            kind: "note",
            start: WALK_START - 15 * 60_000,
            title: "Cycle context",
            category: "hormones",
            detail: "Cycle day 2",
            sourceId: "health-connect",
            origin: "imported",
          },
          {
            id: "travel-not-ranked",
            kind: "note",
            start: WALK_START - 5 * 60_000,
            title: "Travel note",
            category: "travel",
            sourceId: "manual",
            origin: "manual",
          },
        ],
      }),
    });

    const contextEvidence = result.evidence.find(
      (reference) => reference.label === "Other recorded review context",
    );
    expect(contextEvidence?.recordIds).toEqual([
      "alpha-inside-complete",
      "beta-inside-complete",
      "zeta-overlap-incomplete",
      "hormones-before",
      "medication-before",
      "illness-before",
      "sleep-before",
    ]);
    expect(contextEvidence?.recordIds).toHaveLength(7);
    expect(contextEvidence?.examples.map((example) => example.id)).toEqual([
      "alpha-inside-complete",
      "beta-inside-complete",
      "zeta-overlap-incomplete",
      "hormones-before",
      "medication-before",
    ]);
    expect(contextEvidence?.description).toContain("temporal proximity");
    expect(contextEvidence?.description).toContain("evidence completeness");
    expect(contextEvidence?.description).toContain("does not establish cause");
    expect(result.answer.answer).toContain("Night sleep");
    expect(result.answer.answer).toContain("7h 30m");
    expect(result.answer.answer).toContain("Antihistamine (10 mg)");
    expect(result.answer.answer).toContain(
      "Feeling unwell (Illness · Sore throat)",
    );
    expect(result.answer.answer).toContain(
      "Busy evening (Stress · Work deadline)",
    );
    expect(result.answer.answer).toContain(
      "Long-running stress context (Stress · no additional detail recorded)",
    );
    expect(result.answer.answer).toContain(
      "Cycle context (Hormones · Cycle day 2)",
    );
    expect(result.answer.answer).not.toContain("Travel note");
    expect(result.answer.limitations.join(" ")).toContain(
      "does not establish adherence and must not be used to infer or recommend a dose or medication change",
    );
    const completeReviewText = [
      result.answer.answer,
      ...result.answer.limitations,
    ].join(" ");
    const unsafeCausality =
      /\b(?:because of|caused by|led to|triggered|contributed to|explains?|explained|(?:may|might|probably|likely)(?:\s+\w+){0,3}\s+(?:cause(?:d)?|contribute(?:d)?\s+to|explain(?:s|ed)?))\b/i;
    const unsafeDoseRecommendation =
      /\b(?:you should|i recommend|consider)\s+(?:take|taking|skip|skipping|increase|increasing|decrease|decreasing|reduce|reducing|lower|lowering|raise|raising|adjust|adjusting|stop|stopping|start|starting|change|changing)\b/i;
    expect("Antihistamine may have caused the low.").toMatch(unsafeCausality);
    expect("The medication likely contributed to the low.").toMatch(
      unsafeCausality,
    );
    expect("That explains the low.").toMatch(unsafeCausality);
    expect("I recommend reducing your dose.").toMatch(unsafeDoseRecommendation);
    expect(completeReviewText).not.toMatch(unsafeCausality);
    expect(completeReviewText).not.toMatch(unsafeDoseRecommendation);
    expect(completeReviewText).not.toMatch(
      /\b(?:take|taking|skip|skipping|increase|increasing|decrease|decreasing|reduce|reducing|lower|lowering|raise|raising|adjust|adjusting|stop|stopping|start|starting|change|changing)\s+(?:the\s+|your\s+)?(?:dose|medication)\b/i,
    );
  });

  it("reports category-specific current, missing, stale and unavailable context coverage exactly", () => {
    const unavailable = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({ context: [walk] }),
    });
    expect(unavailable.answer.answer).toContain(
      "No sleep record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no sleep occurred.",
    );
    expect(unavailable.answer.answer).toContain(
      "No medication record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no medication occurred.",
    );
    expect(unavailable.answer.answer).toContain(
      "No illness note record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no illness note occurred.",
    );
    expect(unavailable.answer.answer).toContain(
      "No stress note record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no stress note occurred.",
    );
    expect(unavailable.answer.answer).toContain(
      "No hormone note record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no hormone note occurred.",
    );

    const mixedCoverage = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({
        context: [walk],
        sources: [
          {
            id: "sleep-source",
            label: "Sleep",
            detail: "Connected",
            freshness: "current",
            origin: "imported",
            isLive: false,
          },
          {
            id: "medication-source",
            label: "Medication",
            detail: "Permission unavailable",
            freshness: "missing",
            origin: "imported",
            isLive: false,
          },
          {
            id: "stress-source",
            label: "Stress",
            detail: "Last sync was incomplete",
            freshness: "stale",
            origin: "imported",
            isLive: false,
          },
        ],
      }),
    });
    expect(mixedCoverage.answer.answer).toContain(
      "No sleep record was loaded in the review window. The connected source reports current, but an empty result is not proof that no sleep occurred.",
    );
    expect(mixedCoverage.answer.answer).toContain(
      "No medication record was loaded in the review window. Medication was missing, so an absent record may mean the source was not fully synced.",
    );
    expect(mixedCoverage.answer.answer).toContain(
      "No stress note record was loaded in the review window. Stress was stale, so an absent record may mean the source was not fully synced.",
    );
    expect(mixedCoverage.answer.answer).toContain(
      "No illness note record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no illness note occurred.",
    );
    expect(mixedCoverage.answer.answer).toContain(
      "No hormone note record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no hormone note occurred.",
    );

    const unrelated = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({
        context: [walk],
        sources: [
          {
            id: "nightscout",
            label: "Nightscout",
            detail: "Current carbohydrate data",
            freshness: "current",
            origin: "live",
            isLive: true,
            capabilities: [{ kind: "carbohydrates", fidelity: "source-event" }],
          },
        ],
      }),
    });
    expect(unrelated.answer.answer).toContain(
      "No sleep record was loaded in the review window. Its source sync status was unavailable, so that is not proof that no sleep occurred.",
    );
  });

  it("distinguishes missing or stale sources from a confirmed no-record finding", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my walk last night?",
      timeline: timeline({
        context: [walk],
        sources: [
          {
            id: "glucose",
            label: "Glucose",
            detail: "Connected",
            freshness: "current",
            origin: "live",
            isLive: true,
          },
          {
            id: "insulin",
            label: "Insulin",
            detail: "Old import",
            freshness: "stale",
            origin: "imported",
            isLive: false,
          },
          {
            id: "t1arc-context",
            label: "Health context",
            detail: "No synced context",
            freshness: "missing",
            origin: "imported",
            isLive: false,
          },
        ],
      }),
    });

    expect(result.answer.answer).toContain("Health context was missing");
    expect(result.answer.answer).toContain("Insulin was stale");
    expect(result.answer.answer).toContain("not fully synced");
    expect(result.answer.limitations).toContain(
      "Health context reported missing source coverage.",
    );
    expect(result.answer.limitations).toContain(
      "Insulin reported stale source coverage.",
    );
  });

  it("resolves explicit dates and weekdays to the requested UK calendar day", () => {
    const explicit = rangeForRetrospectiveEventQuestion(
      "Why did I go low after my walk on 2nd July 2026?",
      NOW,
    );
    expect(explicit).toEqual({
      start: Date.parse("2026-07-02T00:00:00+01:00"),
      end: Date.parse("2026-07-03T00:00:00+01:00"),
    });

    const weekday = rangeForRetrospectiveEventQuestion(
      "Why did I go low after my walk last Thursday?",
      NOW,
    );
    expect(weekday).toEqual({
      start: Date.parse("2026-08-13T00:00:00+01:00"),
      end: Date.parse("2026-08-14T00:00:00+01:00"),
    });
  });

  it("honours an explicit supported multi-day retrospective period", () => {
    expect(
      rangeForRetrospectiveEventQuestion(
        "Why did my glucose go low during exercise in the last 14 days?",
        NOW,
      ),
    ).toEqual({
      start: Date.parse("2026-08-02T00:00:00+01:00"),
      end: NOW,
    });
  });

  it.each([
    ["this week", "2026-08-10T00:00:00+01:00", NOW],
    [
      "last week",
      "2026-08-03T00:00:00+01:00",
      Date.parse("2026-08-10T00:00:00+01:00"),
    ],
    [
      "previous week",
      "2026-08-03T00:00:00+01:00",
      Date.parse("2026-08-10T00:00:00+01:00"),
    ],
    ["this month", "2026-08-01T00:00:00+01:00", NOW],
    [
      "last month",
      "2026-07-01T00:00:00+01:00",
      Date.parse("2026-08-01T00:00:00+01:00"),
    ],
    [
      "previous month",
      "2026-07-01T00:00:00+01:00",
      Date.parse("2026-08-01T00:00:00+01:00"),
    ],
  ])("uses exact local calendar boundaries for %s", (period, start, end) => {
    expect(
      rangeForRetrospectiveEventQuestion(
        `Why did my glucose fall during exercise ${period}?`,
        NOW,
      ),
    ).toEqual({ start: Date.parse(start as string), end });
  });

  it("uses the regional first weekday for retrospective week ranges", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: "us",
      countryCode: "US",
      languageTag: "en-US",
      analysisTimeZone: "America/New_York",
      followDeviceTimeZone: false,
    });
    const asOf = Date.parse("2026-08-30T12:00:00-04:00");

    expect(
      rangeForRetrospectiveEventQuestion(
        "Why did my glucose fall during exercise this week?",
        asOf,
      ),
    ).toEqual({
      start: Date.parse("2026-08-30T00:00:00-04:00"),
      end: asOf,
    });
  });

  it.each(["this morning", "this afternoon", "this evening"])(
    "limits %s activity searches to today",
    (period) => {
      expect(
        rangeForRetrospectiveEventQuestion(
          `Why did my glucose fall during exercise ${period}?`,
          NOW,
        ),
      ).toEqual({
        start: Date.parse("2026-08-15T00:00:00+01:00"),
        end: NOW,
      });
    },
  );

  it.each([
    ["3 days ago", "2026-08-12T00:00:00+01:00", "2026-08-13T00:00:00+01:00"],
    ["two days ago", "2026-08-13T00:00:00+01:00", "2026-08-14T00:00:00+01:00"],
    ["2 weeks ago", "2026-08-01T00:00:00+01:00", "2026-08-02T00:00:00+01:00"],
    [
      "a fortnight ago",
      "2026-08-01T00:00:00+01:00",
      "2026-08-02T00:00:00+01:00",
    ],
    ["23 hours ago", "2026-08-14T00:00:00+01:00", "2026-08-15T00:00:00+01:00"],
    ["48 hours ago", "2026-08-13T00:00:00+01:00", "2026-08-14T00:00:00+01:00"],
    [
      "1800 minutes ago",
      "2026-08-14T00:00:00+01:00",
      "2026-08-15T00:00:00+01:00",
    ],
  ])("resolves %s to its exact local day", (relative, start, end) => {
    expect(
      rangeForRetrospectiveEventQuestion(
        `Why did my glucose fall during exercise ${relative}?`,
        NOW,
      ),
    ).toEqual({
      start: Date.parse(start as string),
      end: Date.parse(end as string),
    });
  });

  it("loads a full prior-day sleep window when a cross-midnight incident needs a second lookup", async () => {
    const crossMidnightWalk = {
      ...walk,
      id: "late-walk",
      start: Date.parse("2026-08-14T23:45:00+01:00"),
      end: Date.parse("2026-08-15T00:20:00+01:00"),
    };
    const priorSleep = {
      id: "prior-sleep",
      kind: "sleep" as const,
      start: Date.parse("2026-08-13T23:00:00+01:00"),
      end: Date.parse("2026-08-14T06:30:00+01:00"),
      title: "Night sleep",
      durationMinutes: 450,
      sourceId: "health-connect",
      origin: "imported" as const,
    };
    const searchRange = {
      start: Date.parse("2026-08-14T00:00:00+01:00"),
      end: Date.parse("2026-08-15T00:00:00+01:00"),
    };
    const incidentRange = rangeForRetrospectiveActivity(crossMidnightWalk);
    const loadedReviewRange = {
      start: crossMidnightWalk.start - 24 * 60 * 60_000,
      end: incidentRange.end,
    };
    const requestedRanges: { start: number; end: number }[] = [];
    const result = await loadRetrospectiveEventReview({
      question: "Why did I go low during my walk last Friday?",
      searchRange,
      loadTimelineData: async (range) => {
        requestedRanges.push(range);
        const context = [priorSleep, crossMidnightWalk].filter((event) => {
          const eventEnd = event.end ?? event.start;
          return event.start < range.end && eventEnd > range.start;
        });
        return timeline({
          range,
          context,
          glucose:
            requestedRanges.length === 1
              ? []
              : [
                  {
                    ...reading("cross-start", 0, 5.8),
                    timestamp: crossMidnightWalk.start,
                    receivedAt: crossMidnightWalk.start,
                  },
                  {
                    ...reading("cross-low", 0, 3.5),
                    timestamp: Date.parse("2026-08-15T01:30:00+01:00"),
                    receivedAt: Date.parse("2026-08-15T01:30:00+01:00"),
                  },
                ],
        });
      },
    });

    expect(requestedRanges).toEqual([searchRange, loadedReviewRange]);
    expect(incidentRange).toEqual({
      start: Date.parse("2026-08-14T19:45:00+01:00"),
      end: Date.parse("2026-08-15T02:20:00+01:00"),
    });
    expect(loadedReviewRange).toEqual({
      start: Date.parse("2026-08-13T23:45:00+01:00"),
      end: Date.parse("2026-08-15T02:20:00+01:00"),
    });
    expect(result.answer.headline).toContain("Recorded low");
    expect(result.answer.answer).toContain("Sat");
    expect(result.answer.answer).toContain("00:20");
    expect(result.answer.answer).toContain("Night sleep");
    expect(
      result.evidence.find(
        (reference) => reference.label === "Glucose around the activity",
      )?.recordIds,
    ).toContain("cross-low");
    expect(
      result.evidence.find(
        (reference) => reference.label === "Other recorded review context",
      )?.recordIds,
    ).toContain("prior-sleep");
  });
});
