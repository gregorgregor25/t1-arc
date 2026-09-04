import { describe, expect, it, vi } from "vitest";

import { TarvisDirectLocalToolExecutor } from "../../../services/tarvis-lab/client/directLocalTools";
import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
} from "@/data/healthConnect/dailyHealthMetrics";
import {
  TARVIS_LAB_TABLE_COLUMNS,
  type TarvisLabSnapshot,
  type TarvisLabTableName,
} from "../../../services/tarvis-lab/client/experimentalDataset";
import type { TimelineData } from "@/domain/models";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from "@/domain/regionalProfileRuntime";
import { zonedDateTimeToTimestamp } from "@/domain/time";

vi.mock("@/data/healthConnect/dailyHealthMetrics", () => ({
  getDailyHealthMetricSnapshot: vi.fn(),
  getHealthTrendSnapshot: vi.fn(),
}));

vi.mock("@/data/tarvis/treatmentProfile", () => ({
  loadTarvisTreatmentProfile: vi.fn(async () => ({
    confirmedAt: 1_100,
    carbRatioSchedule: [
      { id: "ratio-afternoon", startMinute: 13 * 60 + 5, gramsPerUnit: 10 },
    ],
  })),
}));

function timeline(): TimelineData {
  return {
    range: { start: 1_000, end: 2_000 },
    glucose: [
      {
        id: "g1",
        timestamp: 1_100,
        receivedAt: 1_101,
        mmolL: 6.2,
        trend: "flat",
        quality: "measured",
        sourceId: "libre",
        importedAt: 1_102,
      },
      {
        id: "g2",
        timestamp: 1_200,
        receivedAt: 1_201,
        mmolL: 17.5,
        trend: "up",
        quality: "measured",
        sourceId: "libre",
        importedAt: 1_202,
      },
      {
        id: "g3",
        timestamp: 1_500,
        receivedAt: 1_501,
        mmolL: 7,
        trend: "flat",
        quality: "measured",
        sourceId: "libre",
      },
      {
        id: "g4",
        timestamp: 1_750,
        receivedAt: 1_751,
        mmolL: 6,
        trend: "down",
        quality: "measured",
        sourceId: "libre",
      },
      {
        id: "g5",
        timestamp: 1_850,
        receivedAt: 1_851,
        mmolL: 5.5,
        trend: "down",
        quality: "measured",
        sourceId: "libre",
      },
    ],
    basal: [],
    boluses: [
      { id: "bolus-1", timestamp: 1_180, units: 4.5, sourceId: "glooko" },
    ],
    context: [
      {
        id: "meal-1",
        kind: "meal",
        start: 1_150,
        title: "Lunch",
        mealType: "lunch",
        carbsGrams: 42,
        sourceId: "manual",
        origin: "manual",
      },
      {
        id: "activity-1",
        kind: "activity",
        start: 1_300,
        end: 1_600,
        title: "Legs",
        activityType: "strength",
        durationMinutes: 5,
        intensity: "moderate",
        sourceId: "hevy",
        sourceLabel: "Hevy",
        origin: "imported",
        strengthWorkout: {
          provider: "hevy",
          workoutId: "workout-1",
          exercises: [
            {
              index: 0,
              title: "Squat",
              sets: [
                { index: 0, type: "normal", weightKilograms: 40, reps: 8 },
              ],
            },
          ],
        },
      },
      {
        id: "activity-2",
        kind: "activity",
        start: 1_700,
        end: 1_800,
        title: "Afternoon walk",
        activityType: "walk",
        durationMinutes: 2,
        intensity: "light",
        sourceId: "health-connect",
        sourceLabel: "Health Connect",
        origin: "imported",
      },
      {
        id: "activity-3",
        kind: "activity",
        start: 1_650,
        end: 1_690,
        title: "Strength training",
        activityType: "strength",
        durationMinutes: 1,
        intensity: "moderate",
        sourceId: "health-connect:health-sync",
        sourceLabel: "Health Sync",
        origin: "imported",
      },
      {
        id: "sleep-1",
        kind: "sleep",
        start: 1_010,
        end: 1_090,
        title: "Sleep",
        durationMinutes: 8,
        qualityPercent: 91.2345,
        sourceId: "health-connect:samsung",
        sourceLabel: "Samsung Health",
        origin: "imported",
      },
      {
        id: "medication-1",
        kind: "medication",
        start: 1_125,
        title: "Medication",
        amount: 10.555,
        unit: "mg",
        medicationType: "Other",
        sourceId: "manual",
        sourceLabel: "T1 Arc",
        origin: "manual",
      },
      {
        id: "ketone-1",
        kind: "note",
        start: 1_190,
        title: "Blood ketones",
        category: "other",
        detail: 't1arc:ketone:v1:{"ketoneType":"blood","value":1.2345}',
        sourceId: "manual",
        sourceLabel: "T1 Arc",
        origin: "manual",
      },
    ],
    sources: [],
  };
}

function snapshot(): TarvisLabSnapshot {
  const tables = Object.fromEntries(
    (Object.keys(TARVIS_LAB_TABLE_COLUMNS) as TarvisLabTableName[]).map(
      (table) => [table, []],
    ),
  ) as unknown as TarvisLabSnapshot["tables"];
  tables.glucose_readings = [
    {
      id: "g1",
      timestamp_ms: 1_100,
      received_at_ms: 1_101,
      mmol_l: 6.2,
      trend: "steady",
      quality: "fresh",
      source_id: "libre",
      imported_at_ms: 1_102,
      local_date: "1970-01-01",
      local_time: "00:00",
      local_weekday: "Thursday",
    },
    {
      id: "g2",
      timestamp_ms: 1_200,
      received_at_ms: 1_201,
      mmol_l: 17.5,
      trend: "rising",
      quality: "fresh",
      source_id: "libre",
      imported_at_ms: 1_202,
      local_date: "1970-01-01",
      local_time: "00:00",
      local_weekday: "Thursday",
    },
  ];
  tables.context_events = [
    {
      id: "meal-1",
      kind: "meal",
      start_ms: 1_150,
      title: "Lunch",
      carbs_grams: 42,
      source_id: "manual",
      local_date: "1970-01-01",
    },
    {
      id: "activity-1",
      kind: "activity",
      start_ms: 1_300,
      end_ms: 1_600,
      title: "Legs",
      source_id: "hevy",
      source_label: "Hevy",
      local_date: "1970-01-01",
    },
  ];
  tables.bolus_deliveries = [
    {
      id: "bolus-1",
      timestamp_ms: 1_180,
      units: 4.5,
      source_id: "glooko",
      local_date: "1970-01-01",
    },
  ];
  tables.strength_workouts = [
    {
      workout_id: "workout-1",
      context_event_id: "activity-1",
      title: "Legs",
      start_ms: 1_300,
      end_ms: 1_600,
      source_id: "hevy",
      source_label: "Hevy",
    },
  ];
  tables.strength_exercises = [
    {
      workout_id: "workout-1",
      context_event_id: "activity-1",
      exercise_index: 0,
      title: "Squat",
    },
  ];
  tables.strength_sets = [
    {
      workout_id: "workout-1",
      context_event_id: "activity-1",
      exercise_index: 0,
      set_index: 0,
      set_type: "normal",
    },
  ];
  return {
    schemaVersion: 1,
    timezone: "Europe/London",
    generatedAtMs: 2_000,
    range: { startMs: 1_000, endMs: 2_000 },
    tables,
  };
}

function executor(question?: string) {
  return new TarvisDirectLocalToolExecutor({
    allowedRange: { start: 1_000, end: 2_000 },
    loadTimelineData: async () => timeline(),
    now: () => 2_000,
    question,
    snapshotBuilder: async () => snapshot(),
  });
}

describe("TarvisDirectLocalToolExecutor", () => {
  it("keeps canonical tool dates while returning en-US answer labels and clocks", async () => {
    const previousProfile = getRuntimeRegionalProfile();
    setRuntimeRegionalProfile({
      ...previousProfile,
      languageTag: "en-US",
    });
    try {
      const result = JSON.parse(
        await executor().execute(
          "get_latest_workout",
          JSON.stringify({
            beforeMs: 1_900,
            lookbackDays: 1,
            workoutKind: "any",
            sourcePreference: "hevy",
          }),
        ),
      );

      expect(result.workout.startLocalDate).toBe("1970-01-01");
      expect(result.workout.startLocalDateLabel).toBe("Thu, Jan 1");
      expect(result.workout.startLocalTime).toBe("01:00 AM");

      const ratio = JSON.parse(
        await executor().execute("get_configured_carb_ratio", "{}"),
      );
      expect(ratio.schedule[0]).toMatchObject({
        startLocalTime: "01:05 PM",
        gramsPerUnit: 10,
      });
    } finally {
      setRuntimeRegionalProfile(previousProfile);
    }
  });

  it("lets the model request an exact aggregate over local evidence", async () => {
    const result = JSON.parse(
      await executor().execute(
        "query_local_health_data",
        JSON.stringify({
          table: "glucose_readings",
          startMs: 1_000,
          endMs: 2_000,
          columns: ["mmol_l"],
          aggregates: [
            { function: "max", column: "mmol_l", alias: "maximum_mmol_l" },
            { function: "count", column: null, alias: "reading_count" },
          ],
        }),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ maximum_mmol_l: 17.5, reading_count: 2 }]);
    expect(result.matchedSourceRows).toBe(2);
    expect(result.evidenceId).toMatch(/^direct:/);
  });

  it("localises insulin and carbohydrate evidence previews", async () => {
    const previousProfile = getRuntimeRegionalProfile();
    setRuntimeRegionalProfile({
      ...previousProfile,
      languageTag: "ar-EG",
    });
    try {
      const local = executor();
      await local.execute(
        "query_local_health_data",
        JSON.stringify({
          table: "bolus_deliveries",
          startMs: 1_000,
          endMs: 2_000,
          columns: ["units"],
        }),
      );
      await local.execute(
        "query_local_health_data",
        JSON.stringify({
          table: "context_events",
          startMs: 1_000,
          endMs: 2_000,
          columns: ["carbs_grams"],
          filters: [{ column: "kind", operator: "eq", value: "meal" }],
        }),
      );

      const references = local.evidenceReferences();
      expect(
        references.find(
          (reference) => reference.label === "Bolus insulin records used",
        )?.examples[0]?.primary,
      ).toBe("٤٫٥ U");
      expect(
        references.find(
          (reference) => reference.label === "Recorded context used",
        )?.examples[0]?.primary,
      ).toBe("٤٢ g carbohydrate");
    } finally {
      setRuntimeRegionalProfile(previousProfile);
    }
  });

  it("rejects whole-day snapshot rows for a partial authorised day", async () => {
    const start = Date.parse("2026-08-27T09:00:00+01:00");
    const end = Date.parse("2026-08-27T10:00:00+01:00");
    const unsafeSnapshot = snapshot();
    unsafeSnapshot.generatedAtMs = end;
    unsafeSnapshot.range = { startMs: start, endMs: end };
    unsafeSnapshot.tables.daily_health_metrics = [
      {
        local_date: "2026-08-27",
        local_weekday: "Thursday",
        steps: 25_000,
      },
    ];
    const localExecutor = new TarvisDirectLocalToolExecutor({
      allowedRange: { start, end },
      loadTimelineData: async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [],
        context: [],
        sources: [],
      }),
      now: () => end,
      snapshotBuilder: async () => unsafeSnapshot,
    });

    const result = JSON.parse(
      await localExecutor.execute(
        "query_local_health_data",
        JSON.stringify({
          table: "daily_health_metrics",
          startMs: start,
          endMs: end,
          columns: ["local_date", "steps"],
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      matchedSourceRows: 0,
      returnedRows: 0,
      rows: [],
      dailySummaryCoverage: {
        policy: "whole-local-days-only",
        includedLocalDates: [],
        omittedPartialLocalDates: ["2026-08-27"],
        excludedSnapshotRows: 1,
      },
    });
  });

  it("queries seven local daily summaries across the 25-hour fall-DST week", async () => {
    const previousProfile = getRuntimeRegionalProfile();
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: "us",
      countryCode: "US",
      languageTag: "en-US",
      analysisTimeZone: "America/New_York",
      followDeviceTimeZone: false,
    });
    try {
      const start = zonedDateTimeToTimestamp(
        "2026-10-29",
        0,
        0,
        0,
        "America/New_York",
      );
      const end = zonedDateTimeToTimestamp(
        "2026-11-05",
        0,
        0,
        0,
        "America/New_York",
      );
      vi.mocked(getDailyHealthMetricSnapshot).mockResolvedValueOnce({
        metrics: {
          sourceLabels: [],
          needsSource: [],
          recordCount: 0,
          selectedRecordIds: [],
        },
        records: [],
        contextNeedsSource: [],
      });
      vi.mocked(getHealthTrendSnapshot).mockResolvedValueOnce([]);
      const localExecutor = new TarvisDirectLocalToolExecutor({
        allowedRange: { start, end },
        loadTimelineData: async (range) => ({
          range,
          glucose: [],
          basal: [],
          boluses: [],
          context: [],
          sources: [],
        }),
        now: () => end,
      });

      const result = JSON.parse(
        await localExecutor.execute(
          "get_daily_health_summary",
          JSON.stringify({
            startLocalDate: "2026-10-29",
            endLocalDate: "2026-11-04",
            metric: "steps",
          }),
        ),
      );

      expect(result.ok).toBe(true);
      expect(result.dailySummaryCoverage.includedLocalDates).toHaveLength(7);
      expect((end - start) / 3_600_000).toBe(169);
      expect(getHealthTrendSnapshot).toHaveBeenLastCalledWith(
        "2026-11-04",
        7,
        end,
      );
    } finally {
      setRuntimeRegionalProfile(previousProfile);
    }
  });

  it("uses fast verified capabilities for common questions", async () => {
    const local = executor();
    const glucose = JSON.parse(
      await local.execute(
        "get_glucose_summary",
        JSON.stringify({
          startLocalDate: "1970-01-01",
          endLocalDate: "1970-01-01",
          sourceId: null,
        }),
      ),
    );
    expect(glucose.ok).toBe(true);
    expect(glucose.averageMmolL).toBe(8.44);
    expect(glucose.maximumMmolL).toBe(17.5);
    expect(glucose).toMatchObject({
      medianMmolL: 6.2,
      maximumAtLocalDate: "1970-01-01",
      timeInRangePercent: expect.any(Number),
      glucoseManagementIndicatorPercent: expect.any(Number),
    });

    const ambiguousWorkout = JSON.parse(
      await executor(
        "When was my last gym workout and what exercises did I complete?",
      ).execute(
        "get_latest_workout",
        JSON.stringify({
          beforeMs: 1_900,
          lookbackDays: 1,
          workoutKind: "strength",
          sourcePreference: "hevy",
        }),
      ),
    );
    expect(ambiguousWorkout.needsClarification).toBe(true);
    expect(ambiguousWorkout.workout).toBeNull();
    expect(
      ambiguousWorkout.candidates.map(({ title }: { title: string }) => title),
    ).toEqual(["Afternoon walk", "Strength training", "Legs"]);

    const workout = JSON.parse(
      await executor("I meant my last Hevy workout.").execute(
        "get_latest_workout",
        JSON.stringify({
          beforeMs: 1_900,
          lookbackDays: 1,
          workoutKind: "any",
          sourcePreference: "any",
        }),
      ),
    );
    expect(workout.workout.title).toBe("Legs");
    expect(workout.workout.activityType).toBe("strength");
    expect(workout.workout.startLocalDate).toBe("1970-01-01");
    expect(workout.workout.exercises[0]).toMatchObject({
      title: "Squat",
      setCount: 1,
      sets: [{ setNumber: 1, weightKilograms: 40, reps: 8 }],
    });
    expect(workout.requestedSourcePreference).toBe("hevy");

    const genericWorkout = JSON.parse(
      await local.execute(
        "get_latest_workout",
        JSON.stringify({
          beforeMs: 1_900,
          lookbackDays: 1,
          workoutKind: "any",
          sourcePreference: "any",
        }),
      ),
    );
    expect(genericWorkout.workout.title).toBe("Afternoon walk");
    expect(genericWorkout.workout.activityType).toBe("walk");

    const totals = JSON.parse(
      await local.execute(
        "get_daily_carbs_and_bolus",
        JSON.stringify({
          startLocalDate: "1970-01-01",
          endLocalDate: "1970-01-01",
        }),
      ),
    );
    expect(totals.recordedCarbsGrams).toBe(42);
    expect(totals.deliveredBolusUnits).toBe(4.5);
    expect(local.evidenceReferences().length).toBeGreaterThanOrEqual(3);
  });

  it("returns detailed activity context and preserves source-specific records", async () => {
    const local = executor("How did my glucose behave around my latest walk?");
    const workout = JSON.parse(
      await local.execute(
        "get_latest_workout",
        JSON.stringify({
          beforeMs: 1_900,
          lookbackDays: 1,
          workoutKind: "walk",
          sourcePreference: "any",
        }),
      ),
    );
    expect(workout.workout.id).toBe("activity-2");

    const context = JSON.parse(
      await local.execute(
        "get_activity_glucose_context",
        JSON.stringify({
          activityId: workout.workout.id,
          beforeMinutes: 30,
          afterMinutes: 30,
        }),
      ),
    );
    expect(context.ok).toBe(true);
    expect(context.activity).toMatchObject({
      id: "activity-2",
      activityType: "walk",
      sourceLabel: "Health Connect",
    });
    expect(
      context.glucoseWindows.map(({ label }: { label: string }) => label),
    ).toEqual(["Before activity", "During activity", "After activity"]);
    expect(context.nearbyMeals[0]).toMatchObject({
      title: "Lunch",
      carbsGrams: 42,
    });
    expect(context.nearbyBoluses[0]).toMatchObject({ units: 4.5 });
    expect(context.evidenceIds.length).toBeGreaterThanOrEqual(2);
  });

  it("returns rich context detail and caps all numeric precision at two places", async () => {
    const result = JSON.parse(
      await executor().execute(
        "get_context_records",
        JSON.stringify({
          startLocalDate: "1970-01-01",
          endLocalDate: "1970-01-01",
          kind: "ketone",
          limit: 10,
        }),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: "ketone-1",
      sourceLabel: "T1 Arc",
      ketone: { type: "blood", value: 1.23, unit: "mmol/L" },
    });

    const all = JSON.parse(
      await executor().execute(
        "get_context_records",
        JSON.stringify({
          startLocalDate: "1970-01-01",
          endLocalDate: "1970-01-01",
          kind: "any",
          limit: 20,
        }),
      ),
    );
    expect(
      all.records.find(({ id }: { id: string }) => id === "medication-1"),
    ).toMatchObject({
      amount: 10.56,
      unit: "mg",
    });
    expect(
      all.records.find(({ id }: { id: string }) => id === "sleep-1"),
    ).toMatchObject({
      qualityPercent: 91.23,
      sourceLabel: "Samsung Health",
    });
  });

  it("treats an empty bounded context search as verified negative-search evidence", async () => {
    const local = executor();
    const execution = await local.executeDetailed(
      "get_context_records",
      JSON.stringify({
        startLocalDate: "1970-01-01",
        endLocalDate: "1970-01-01",
        kind: "weight",
        limit: 10,
      }),
    );
    const result = JSON.parse(execution.resultJson);

    expect(result).toMatchObject({
      ok: true,
      matchedRecords: 0,
      returnedRecords: 0,
      records: [],
    });
    expect(execution.evidenceIds).toHaveLength(1);
    expect(result.evidenceId).toBe(execution.evidenceIds[0]);
    expect(local.hasVerifiedEvidence()).toBe(true);
    expect(local.evidenceReferences()[0]).toMatchObject({
      recordIds: [],
      examples: [],
    });
  });

  it("rejects unapproved fields and out-of-window access", async () => {
    const field = JSON.parse(
      await executor().execute(
        "query_local_health_data",
        JSON.stringify({
          table: "glucose_readings",
          startMs: 1_000,
          endMs: 2_000,
          columns: ["password"],
        }),
      ),
    );
    expect(field.ok).toBe(false);
    expect(field.error).toContain("not available");

    const range = JSON.parse(
      await executor().execute(
        "query_local_health_data",
        JSON.stringify({
          table: "glucose_readings",
          startMs: 0,
          endMs: 2_000,
          columns: ["mmol_l"],
        }),
      ),
    );
    expect(range.ok).toBe(false);
    expect(range.error).toContain("authorised");
  });

  it("describes only the approved schema", async () => {
    const result = JSON.parse(
      await executor().execute(
        "describe_local_health_data",
        JSON.stringify({ tables: ["bolus_deliveries"] }),
      ),
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.tables)).toEqual(["bolus_deliveries"]);
    expect(result.tables.bolus_deliveries.columns).toContain("units");
  });

  it("resolves local dates and clips an in-progress day to the authorised window", async () => {
    const now = Date.parse("2026-08-27T09:30:00+01:00");
    const start = Date.parse("2026-08-26T00:00:00+01:00");
    const localExecutor = new TarvisDirectLocalToolExecutor({
      allowedRange: { start, end: now },
      loadTimelineData: async () => {
        throw new Error("No snapshot should be loaded for date resolution.");
      },
      now: () => now,
      snapshotBuilder: async () => snapshot(),
    });
    const result = JSON.parse(
      await localExecutor.execute(
        "resolve_local_date_range",
        JSON.stringify({
          startLocalDate: "2026-08-27",
          endLocalDate: "2026-08-27",
        }),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.startMs).toBe(Date.parse("2026-08-27T00:00:00+01:00"));
    expect(result.endMs).toBe(now);
    expect(result.clippedToAuthorisedEvidenceWindow).toBe(true);
  });

  it("uses the latest source daily insulin snapshot when timed basal rows are unavailable", async () => {
    const start = Date.parse("2026-08-25T00:00:00+01:00");
    const end = Date.parse("2026-08-26T00:00:00+01:00");
    const localExecutor = new TarvisDirectLocalToolExecutor({
      allowedRange: { start, end },
      loadTimelineData: async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [
          {
            id: "bolus:morning",
            timestamp: start + 8 * 60 * 60_000,
            units: 12,
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
          },
          {
            id: "bolus:evening",
            timestamp: start + 18 * 60 * 60_000,
            units: 21.2,
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
          },
        ],
        dailyInsulinTotals: [
          {
            id: "total:early",
            timestamp: start + 12 * 60 * 60_000,
            dateKey: "2026-08-25",
            basalUnits: 10,
            bolusUnits: 12,
            totalUnits: 22,
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
          },
          {
            id: "total:final",
            timestamp: end - 60_000,
            dateKey: "2026-08-25",
            basalUnits: 23.65,
            bolusUnits: 33.2,
            totalUnits: 56.85,
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
          },
        ],
        context: [],
        sources: [],
      }),
      now: () => end,
      snapshotBuilder: async () => snapshot(),
    });

    const result = JSON.parse(
      await localExecutor.execute(
        "get_insulin_summary",
        JSON.stringify({
          startLocalDate: "2026-08-25",
          endLocalDate: "2026-08-25",
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      basalUnits: 23.65,
      bolusUnits: 33.2,
      totalUnits: 56.85,
      basalPercent: 41.6,
      bolusPercent: 58.4,
      basalRecords: 0,
      bolusRecords: 2,
      dailyTotalRecords: 1,
      sourceCoversEveryDay: true,
      sourceProvidesBasalEveryDay: true,
      sourceProvidesBolusEveryDay: true,
      daily: [
        {
          localDate: "2026-08-25",
          basalUnits: 23.65,
          bolusUnits: 33.2,
          totalUnits: 56.85,
          source: "complete-source-daily-total",
          partial: false,
        },
      ],
      dataCompleteness: {
        sourceDailyTotalsCompleteForRequestedRange: true,
        partialDates: [],
        datesWithoutSourceDailyTotal: [],
      },
    });
    expect(result.semantics.join(" ")).toContain("never summed");
  });

  it("marks today's insulin as recorded so far and exposes the source as-of time", async () => {
    const start = Date.parse("2026-08-27T00:00:00+01:00");
    const now = Date.parse("2026-08-27T12:00:00+01:00");
    const sourceAsOf = Date.parse("2026-08-27T10:00:00+01:00");
    const localExecutor = new TarvisDirectLocalToolExecutor({
      allowedRange: { start, end: now },
      loadTimelineData: async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [],
        dailyInsulinTotals: [
          {
            id: "total:today-so-far",
            timestamp: sourceAsOf,
            importedAt: sourceAsOf + 30_000,
            dateKey: "2026-08-27",
            basalUnits: 8,
            bolusUnits: 4,
            totalUnits: 12,
            sourceId: "glooko-export",
          },
        ],
        context: [],
        sources: [],
      }),
      now: () => now,
      snapshotBuilder: async () => snapshot(),
    });

    const result = JSON.parse(
      await localExecutor.execute(
        "get_insulin_summary",
        JSON.stringify({
          startLocalDate: "2026-08-27",
          endLocalDate: "2026-08-27",
        }),
      ),
    );

    expect(result).toMatchObject({
      basalUnits: 8,
      bolusUnits: 4,
      totalUnits: 12,
      partial: true,
      dataCompleteness: {
        sourceDailyTotalsCompleteForRequestedRange: false,
        requestedRangeIncludesToday: true,
        partialDates: ["2026-08-27"],
        datesWithoutSourceDailyTotal: [],
        latestSourceAsOfMs: sourceAsOf,
        latestSourceAsOfLocalDate: "2026-08-27",
        latestSourceAsOfLocalTime: "10:00",
      },
      daily: [
        {
          source: "partial-source-daily-total",
          partial: true,
          sourceAsOfLocalTime: "10:00",
        },
      ],
    });
    expect(result.dataCompleteness.userFacingRequirement).toContain(
      "recorded so far",
    );
  });

  it("does not turn absent daily basal data into zero", async () => {
    const start = Date.parse("2026-08-27T00:00:00+01:00");
    const now = Date.parse("2026-08-27T12:00:00+01:00");
    const localExecutor = new TarvisDirectLocalToolExecutor({
      allowedRange: { start, end: now },
      loadTimelineData: async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [
          {
            id: "bolus:visible-before-import",
            timestamp: start + 8 * 60 * 60_000,
            units: 4,
            sourceId: "glooko-export",
          },
        ],
        dailyInsulinTotals: [],
        context: [],
        sources: [],
      }),
      now: () => now,
      snapshotBuilder: async () => snapshot(),
    });

    const result = JSON.parse(
      await localExecutor.execute(
        "get_insulin_summary",
        JSON.stringify({
          startLocalDate: "2026-08-27",
          endLocalDate: "2026-08-27",
        }),
      ),
    );

    expect(result).toMatchObject({
      basalUnits: null,
      bolusUnits: 4,
      totalUnits: null,
      basalPercent: null,
      bolusPercent: null,
      dataCompleteness: {
        sourceDailyTotalsCompleteForRequestedRange: false,
        datesWithoutSourceDailyTotal: ["2026-08-27"],
      },
      daily: [
        {
          basalUnits: null,
          bolusUnits: 4,
          totalUnits: null,
          source: "detailed-events-only",
        },
      ],
    });
  });
});
