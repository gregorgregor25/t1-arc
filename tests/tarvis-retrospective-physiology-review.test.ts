import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildRetrospectiveEventReview,
  loadRetrospectiveEventReview,
  rangeForRetrospectiveActivity,
} from "@/data/tarvis/retrospectiveEventReview";
import type {
  RetrospectivePhysiology,
  RetrospectivePhysiologyRecord,
} from "@/data/tarvis/retrospectivePhysiology";
import type { ActivityEvent, TimelineData } from "@/domain/models";

const NOW = Date.parse("2026-08-15T09:00:00+01:00");
const START = Date.parse("2026-08-14T23:45:00+01:00");
const END = Date.parse("2026-08-15T00:20:00+01:00");
const walk: ActivityEvent = {
  id: "health-connect:workout:com.samsung.health:walk",
  kind: "activity",
  start: START,
  end: END,
  title: "Late walk",
  activityType: "walk",
  durationMinutes: 35,
  intensity: "moderate",
  sourceId: "health-connect:com.samsung.health",
  origin: "imported",
};

function timeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    range: { start: START - 24 * 60 * 60_000, end: END + 2 * 60 * 60_000 },
    glucose: [],
    basal: [],
    boluses: [],
    pumpStates: [],
    dailyInsulinTotals: [],
    context: [walk],
    sources: [],
    ...overrides,
  };
}

function record(
  id: string,
  kind: RetrospectivePhysiologyRecord["kind"],
  value: number | undefined,
  unit: string | undefined,
  minute: number,
): RetrospectivePhysiologyRecord {
  return {
    id,
    kind,
    sourcePackage: "com.samsung.health",
    sourceLabel: "Samsung Health",
    start: START + minute * 60_000,
    end: START + minute * 60_000,
    value,
    unit,
  };
}

function physiology(
  records: RetrospectivePhysiologyRecord[],
): RetrospectivePhysiology {
  return {
    activityId: walk.id,
    range: rangeForRetrospectiveActivity(walk),
    records,
    coverage: [
      { category: "steps", status: "current", recordCount: 1 },
      { category: "distance", status: "missing", recordCount: 0 },
      {
        category: "active_calories",
        status: "disabled",
        recordCount: 0,
        lastSuccessAt: NOW - 2 * 24 * 60 * 60_000,
      },
      { category: "workouts", status: "unsynced", recordCount: 0 },
      { category: "heart_rate", status: "current", recordCount: 12 },
    ],
  };
}

describe("Tarv1s retrospective physiology review integration", () => {
  it("never wires real Health Connect physiology into a synthetic demo review", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/screens/InsightsScreen.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /loadPhysiologyData=\{\s*tarvisContext\.liveData\s*\?\s*loadTarvisPhysiology\s*:\s*undefined\s*\}/,
    );
  });

  it("adds bounded source-distinct evidence while retaining every supporting ID and avoiding causality or advice", () => {
    const heart = Array.from({ length: 240 }, (_, index) =>
      record(
        `heart-${index}`,
        "heart_rate",
        90 + (index % 23),
        "bpm",
        index / 10,
      ),
    );
    const records = [
      {
        ...record("workout", "workout", undefined, undefined, 0),
        start: START,
        end: END,
        workoutTitle: "Late walk from Samsung",
        perceivedExertion: 6,
      },
      {
        ...record("steps", "steps", 720, "count", 2),
        end: START + 30 * 60_000,
      },
      {
        ...record("partial-distance", "distance", 2_000, "m", -10),
        end: START + 10 * 60_000,
      },
      ...heart,
      record("power", "workout_power", 180, "w", 12),
      record("speed", "workout_speed", 2.8, "m/s", 14),
      record("walk-cadence", "walking_cadence", 111, "rpm", 16),
    ];
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: physiology(records),
    });

    expect(result.answer.answer).toContain("Samsung Health");
    expect(result.answer.answer).toContain("Late walk from Samsung");
    expect(result.answer.answer).toContain("perceived exertion 6/10");
    expect(result.answer.answer).toContain("720 steps");
    expect(result.answer.answer).toContain("240 heart-rate samples");
    expect(result.answer.answer).toContain("90–112 bpm");
    expect(result.answer.answer).toContain("180 W");
    expect(result.answer.answer).toContain("2.8 m/s");
    expect(result.answer.answer).toContain("111 steps/min");
    expect(result.answer.answer).toContain("Distance coverage was missing");
    expect(result.answer.answer).toContain(
      "Active energy coverage was disabled",
    );
    expect(result.answer.answer).toContain(
      "Workout-metric coverage was unsynced",
    );
    const evidence = result.evidence.find(
      ({ label }) => label === "Physiology recorded around the activity",
    );
    expect(evidence?.recordIds).toEqual(records.map(({ id }) => id));
    expect(evidence?.examples).toHaveLength(5);
    expect(evidence?.description).toContain("shows 5 of 246");
    expect(evidence?.description).toContain("all 246 record IDs");
    expect(result.answer.limitations.join(" ")).toContain(
      "partly overlapped the activity and was not totalled",
    );
    const text = [result.answer.answer, ...result.answer.limitations].join(" ");
    expect(text).not.toMatch(
      /\b(?:because of|caused by|led to|triggered|contributed to|explains?)\b/i,
    );
    expect(text).not.toMatch(
      /\b(?:you should|i recommend|consider)\s+(?:take|skip|increase|decrease|reduce|adjust|stop|start|change)\b/i,
    );
  });

  it("uses explicit unavailable language and keeps the previous result exactly unchanged when physiology is omitted", () => {
    const base = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
    });
    const explicitUndefined = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: undefined,
    });
    expect(explicitUndefined).toEqual(base);

    const unavailable = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        activityId: walk.id,
        range: rangeForRetrospectiveActivity(walk),
        records: [],
        coverage: [
          {
            category: "heart_rate",
            status: "unavailable",
            reason: "load-failed",
            recordCount: 0,
          },
        ],
      },
    });
    expect(unavailable.answer.answer).toContain(
      "Physiology coverage was unavailable",
    );
  });

  it("invokes physiology only after one activity resolves and passes the incident range, never the prior-sleep range", async () => {
    const uniqueLoader = vi.fn(async () => physiology([]));
    const loadTimelineData = vi.fn(async (range) => timeline({ range }));
    await loadRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      searchRange: { start: START - 2 * 60 * 60_000, end: END },
      loadTimelineData,
      loadPhysiologyData: uniqueLoader,
    });
    expect(uniqueLoader).toHaveBeenCalledTimes(1);
    expect(uniqueLoader).toHaveBeenCalledWith({
      activity: walk,
      range: rangeForRetrospectiveActivity(walk),
    });
    expect(rangeForRetrospectiveActivity(walk)).toEqual({
      start: Date.parse("2026-08-14T19:45:00+01:00"),
      end: Date.parse("2026-08-15T02:20:00+01:00"),
    });

    const ambiguousLoader = vi.fn(async () => physiology([]));
    await loadRetrospectiveEventReview({
      question: "What happened to my glucose during a walk last week?",
      searchRange: { start: START - 24 * 60 * 60_000, end: END },
      loadTimelineData: async (range) =>
        timeline({
          range,
          context: [
            walk,
            {
              ...walk,
              id: "second-walk",
              start: START - 12 * 60 * 60_000,
              end: END - 12 * 60 * 60_000,
            },
          ],
        }),
      loadPhysiologyData: ambiguousLoader,
    });
    expect(ambiguousLoader).not.toHaveBeenCalled();
  });

  it("degrades a physiology loader failure without failing the existing retrospective answer", async () => {
    const result = await loadRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      searchRange: { start: START - 2 * 60 * 60_000, end: END },
      loadTimelineData: async (range) => timeline({ range }),
      loadPhysiologyData: async () => {
        throw new Error("Health Connect unavailable");
      },
    });
    expect(result.answer.headline).toContain("Late walk");
    expect(result.answer.answer).toContain(
      "Physiology coverage was unavailable",
    );
  });

  it("fails closed when a loader returns physiology for a different activity", async () => {
    const result = await loadRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      searchRange: { start: START - 2 * 60 * 60_000, end: END },
      loadTimelineData: async (range) => timeline({ range }),
      loadPhysiologyData: async () => ({
        ...physiology([record("wrong-heart", "heart_rate", 120, "bpm", 1)]),
        activityId: "another-activity",
      }),
    });
    expect(result.answer.answer).toContain(
      "Physiology coverage was unavailable",
    );
    expect(result.answer.answer).not.toContain("120 bpm");
    expect(
      result.evidence.some(
        ({ label }) => label === "Physiology recorded around the activity",
      ),
    ).toBe(false);
  });

  it("states a safety-limit truncation and suppresses incomplete numerical summaries", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        ...physiology([
          record("heart-low", "heart_rate", 80, "bpm", 1),
          record("heart-high", "heart_rate", 160, "bpm", 2),
          record("steps", "steps", 2_000, "count", 3),
        ]),
        truncated: true,
        loadedCandidateCount: 5_000,
      },
    });
    expect(result.answer.answer).toContain("5,000-record safety limit");
    expect(result.answer.answer).not.toContain("80–160 bpm");
    expect(result.answer.answer).not.toContain("2,000 steps");
    expect(result.answer.limitations.join(" ")).toContain(
      "numerical summaries were suppressed",
    );
    expect(result.answer.limitations.join(" ")).toContain(
      "the evidence retains IDs only for sanitized selected-source records actually used",
    );
    expect(result.answer.limitations.join(" ")).not.toContain(
      "records and their IDs were retained",
    );
  });

  it("keeps overlapping additive intervals as evidence without double-counting them", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: physiology([
        {
          ...record("steps-one", "steps", 1_000, "count", 1),
          end: START + 15 * 60_000,
        },
        {
          ...record("steps-two", "steps", 2_000, "count", 10),
          end: START + 25 * 60_000,
        },
      ]),
    });
    expect(result.answer.answer).not.toContain("3,000 steps");
    expect(result.answer.limitations.join(" ")).toContain(
      "overlapping step intervals from Samsung Health were kept as evidence and not totalled",
    );
    expect(
      result.evidence.find(
        ({ label }) => label === "Physiology recorded around the activity",
      )?.recordIds,
    ).toEqual(["steps-one", "steps-two"]);
  });

  it("does not claim an ambiguous alternate source was selected or used", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        activityId: walk.id,
        range: rangeForRetrospectiveActivity(walk),
        records: [],
        coverage: [
          {
            category: "heart_rate",
            status: "unavailable",
            reason: "needs-source",
            recordCount: 0,
            alternateSources: [
              {
                sourcePackage: "com.samsung.health",
                sourceLabel: "Samsung Health",
                recordCount: 2,
              },
              {
                sourcePackage: "com.fitbit.FitbitMobile",
                sourceLabel: "Fitbit",
                recordCount: 3,
              },
            ],
          },
        ],
      },
    });
    const limitations = result.answer.limitations.join(" ");
    expect(limitations).toContain(
      "Heart-rate coverage had no selected source; 5 overlapping candidate records from Fitbit, Samsung Health were kept separate and not used.",
    );
    expect(limitations).not.toMatch(/Heart-rate coverage used/i);
  });

  it("says disabled alternate candidates were not used", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        activityId: walk.id,
        range: rangeForRetrospectiveActivity(walk),
        records: [],
        coverage: [
          {
            category: "steps",
            status: "disabled",
            reason: "category-disabled",
            recordCount: 0,
            selectedSourcePackage: "com.samsung.health",
            selectedSourceLabel: "Samsung Health",
            alternateSources: [
              {
                sourcePackage: "com.fitbit.FitbitMobile",
                sourceLabel: "Fitbit",
                recordCount: 1,
              },
            ],
          },
        ],
      },
    });
    const limitations = result.answer.limitations.join(" ");
    expect(limitations).toContain(
      "Step coverage was disabled; 1 overlapping candidate record from Fitbit was not used.",
    );
    expect(limitations).not.toContain("Step coverage used Samsung Health");
  });

  it("distinguishes a preferred source with no matching record from an actually used source", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        activityId: walk.id,
        range: rangeForRetrospectiveActivity(walk),
        records: [],
        coverage: [
          {
            category: "distance",
            status: "missing",
            reason: "no-overlapping-records",
            recordCount: 0,
            selectedSourcePackage: "com.samsung.health",
            selectedSourceLabel: "Samsung Health",
            alternateSources: [
              {
                sourcePackage: "com.fitbit.FitbitMobile",
                sourceLabel: "Fitbit",
                recordCount: 2,
              },
            ],
          },
        ],
      },
    });
    const limitations = result.answer.limitations.join(" ");
    expect(limitations).toContain(
      "Distance coverage selected Samsung Health, but no matching record was used; 2 overlapping candidate records from Fitbit were kept separate and not combined.",
    );
    expect(limitations).not.toContain("Distance coverage used Samsung Health");
  });

  it("describes truncated mixed-source provenance without claiming excluded IDs were retained", () => {
    const result = buildRetrospectiveEventReview({
      question: "What happened to my glucose during my late walk last night?",
      timeline: timeline(),
      physiology: {
        activityId: walk.id,
        range: rangeForRetrospectiveActivity(walk),
        records: [record("selected-heart", "heart_rate", 100, "bpm", 1)],
        coverage: [
          {
            category: "heart_rate",
            status: "unavailable",
            reason: "candidate-limit",
            recordCount: 1,
            selectedSourcePackage: "com.samsung.health",
            selectedSourceLabel: "Samsung Health",
            alternateSources: [
              {
                sourcePackage: "com.fitbit.FitbitMobile",
                sourceLabel: "Fitbit",
                recordCount: 4_999,
              },
            ],
          },
        ],
        loadedCandidateCount: 5_000,
        truncated: true,
      },
    });
    const physiologyEvidence = result.evidence.find(
      ({ label }) => label === "Physiology recorded around the activity",
    );
    expect(physiologyEvidence?.recordIds).toEqual(["selected-heart"]);
    const limitations = result.answer.limitations.join(" ");
    expect(limitations).toContain(
      "only the first 5,000 candidates were examined",
    );
    expect(limitations).toContain(
      "the evidence retains IDs only for sanitized selected-source records actually used",
    );
    expect(limitations).toContain(
      "Heart-rate coverage used Samsung Health; 4,999 overlapping candidate records from Fitbit were kept separate and not combined.",
    );
  });
});
