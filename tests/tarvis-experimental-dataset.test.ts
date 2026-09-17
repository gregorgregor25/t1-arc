import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTarvisLabSnapshot,
  buildTarvisLabSnapshotFromInputs,
  TARVIS_LAB_TABLE_COLUMNS,
} from "../services/tarvis-lab/client/experimentalDataset";
import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
} from "@/data/healthConnect/dailyHealthMetrics";
import { encodeManualKetoneDetail } from "@/data/manualKetones";
import type { HealthTrendDay } from "@/data/healthConnect/dailyHealthMetrics";
import type { DailyMetricRecord } from "@/domain/dailyHealthMetrics";
import type { TimelineData } from "@/domain/models";
import {
  DEFAULT_REGIONAL_PROFILE,
  type T1ArcRegionalProfile,
} from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";
import { zonedDateTimeToTimestamp } from "@/domain/time";

vi.mock("@/data/healthConnect/dailyHealthMetrics", () => ({
  getDailyHealthMetricSnapshot: vi.fn(),
  getHealthTrendSnapshot: vi.fn(),
}));

const MINUTE = 60_000;
const RANGE_START = Date.parse("2026-08-25T23:45:00+01:00");
const RANGE_END = Date.parse("2026-08-26T00:27:00+01:00");
const GLUCOSE_START = Date.parse("2026-08-25T23:55:00+01:00");
const SECOND_GLUCOSE = Date.parse("2026-08-26T00:15:00+01:00");

const LONDON_PROFILE: T1ArcRegionalProfile = {
  ...DEFAULT_REGIONAL_PROFILE,
  region: "europe",
  countryCode: "GB",
  languageTag: "en-GB",
  analysisTimeZone: "Europe/London",
  followDeviceTimeZone: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  setRuntimeRegionalProfile(LONDON_PROFILE);
});

afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

function healthTrendDay(): HealthTrendDay {
  return {
    date: "2026-08-26",
    metrics: {
      steps: 12_345,
      distanceKilometres: 8.2,
      averageHeartRateBpm: 72,
      hydrationLitres: 1.75,
      sourceLabels: ["Samsung Health", "T1 Arc"],
      needsSource: ["weight"],
      recordCount: 4,
      selectedRecordIds: ["steps:1", "distance:1", "heart:1", "water:1"],
    },
    sleepMinutes: 435,
    workoutMinutes: 52,
    mealCount: 3,
    mealCarbsGrams: 148,
    mealNutrientCoverage: {
      carbsGrams: { knownCount: 3, recordCount: 3 },
      energyKcal: { knownCount: 3, recordCount: 3 },
      proteinGrams: { knownCount: 3, recordCount: 3 },
      fatGrams: { knownCount: 3, recordCount: 3 },
      fibreGrams: { knownCount: 2, recordCount: 3 },
      sugarsGrams: { knownCount: 2, recordCount: 3 },
      saturatedFatGrams: { knownCount: 2, recordCount: 3 },
    },
    nutritionSourceLabels: ["T1 Arc"],
    nutritionPossibleDuplicatePairs: 0,
    medicationCount: 1,
    hormoneRecordCount: 0,
    contextNeedsSource: [],
  };
}

function healthMetricRecord(): DailyMetricRecord {
  const start = Date.parse("2026-08-26T00:10:00+01:00");
  return {
    id: "health:steps:1",
    measurementId: "measurement:1",
    kind: "steps",
    sourcePackage: "com.samsung.android.app.healthdata",
    sourceLabel: "Samsung Health",
    start,
    end: start + 5 * MINUTE,
    value: 321,
    unit: "count",
  };
}

function timeline(): TimelineData {
  const mealStart = Date.parse("2026-08-25T23:48:00+01:00");
  const workoutStart = Date.parse("2026-08-26T00:02:00+01:00");
  return {
    range: { start: RANGE_START, end: RANGE_END },
    glucose: [
      {
        id: "glucose:1",
        timestamp: GLUCOSE_START,
        receivedAt: GLUCOSE_START + MINUTE,
        mmolL: 3.7,
        trend: "slightDown",
        quality: "measured",
        sourceId: "libre",
        importedAt: GLUCOSE_START + 2 * MINUTE,
      },
      {
        id: "glucose:2",
        timestamp: SECOND_GLUCOSE,
        receivedAt: SECOND_GLUCOSE,
        mmolL: 10.4,
        trend: "up",
        quality: "measured",
        sourceId: "libre",
      },
    ],
    basal: [
      {
        id: "basal:1",
        start: Date.parse("2026-08-25T23:50:00+01:00"),
        end: Date.parse("2026-08-26T00:20:00+01:00"),
        rateUnitsPerHour: 6,
        units: 3,
        deliveryType: "Scheduled",
        percentage: 100,
        unitsEstimated: true,
        sourceId: "glooko",
      },
    ],
    boluses: [
      {
        id: "bolus:1",
        timestamp: Date.parse("2026-08-25T23:49:00+01:00"),
        units: 4.5,
        deliveryType: "Standard",
        bloodGlucoseInputMmolL: 7.2,
        carbsInputGrams: 45,
        carbRatioGramsPerUnit: 10,
        initialUnits: 4.5,
        sourceId: "glooko",
      },
    ],
    dailyInsulinTotals: [
      {
        id: "daily-insulin:1",
        timestamp: Date.parse("2026-08-25T12:00:00+01:00"),
        dateKey: "2026-08-25",
        basalUnits: 18,
        bolusUnits: 21,
        totalUnits: 39,
        sourceId: "glooko",
      },
    ],
    pumpStates: [
      {
        id: "pump:1",
        start: Date.parse("2026-08-26T00:05:00+01:00"),
        end: Date.parse("2026-08-26T00:10:00+01:00"),
        kind: "automated-pause",
        sourceId: "glooko",
      },
    ],
    context: [
      {
        id: "meal:1",
        kind: "meal",
        start: mealStart,
        sourceId: "t1arc-food",
        sourceLabel: "T1 Arc",
        origin: "manual",
        title: "Late dinner",
        mealType: "dinner",
        carbsGrams: 45,
        energyKcal: 610,
        proteinGrams: 32,
        fatGrams: 21,
        fibreGrams: 7,
        sugarsGrams: 8,
        saturatedFatGrams: 5,
        servingQuantity: 350,
        servingCount: 1,
        nutritionDetail: "itemized",
        items: [
          {
            id: "meal-item:1",
            name: "Pasta",
            brand: "Kitchen",
            amount: 250,
            unit: "g",
            carbohydrateGrams: 45,
            energyKcal: 610,
            proteinGrams: 32,
            fatGrams: 21,
            fibreGrams: 7,
            sugarsGrams: 8,
            saturatedFatGrams: 5,
            sourceLabel: "T1 Arc",
          },
        ],
      },
      {
        id: "activity:1",
        kind: "activity",
        start: workoutStart,
        end: workoutStart + 30 * MINUTE,
        sourceId: "hevy",
        sourceLabel: "Hevy",
        origin: "imported",
        title: "Upper body",
        activityType: "strength",
        durationMinutes: 30,
        intensity: "vigorous",
        caloriesBurned: 220,
        strengthWorkout: {
          provider: "hevy",
          workoutId: "hevy-workout:1",
          description: "Push session",
          exercises: [
            {
              index: 0,
              title: "Bench press",
              notes: "Paused reps",
              exerciseTemplateId: "bench-template",
              supersetId: 2,
              sets: [
                {
                  index: 0,
                  type: "warmup",
                  weightKilograms: 40,
                  reps: 10,
                  rpe: 5,
                },
                {
                  index: 1,
                  type: "normal",
                  weightKilograms: 70,
                  reps: 6,
                  rpe: 8,
                },
              ],
            },
          ],
        },
      },
      {
        id: "ketone:blood",
        kind: "note",
        start: Date.parse("2026-08-26T00:12:00+01:00"),
        sourceId: "manual-context",
        origin: "manual",
        title: "Blood ketones",
        category: "illness",
        detail: encodeManualKetoneDetail({ ketoneType: "blood", value: 1.2 }),
      },
      {
        id: "ketone:urine",
        kind: "note",
        start: Date.parse("2026-08-26T00:13:00+01:00"),
        sourceId: "manual-context",
        origin: "manual",
        title: "Urine ketones",
        category: "illness",
        detail: encodeManualKetoneDetail({ ketoneType: "urine", value: "++" }),
      },
    ],
    sources: [
      {
        id: "libre",
        label: "LibreLinkUp",
        detail: "Current",
        freshness: "current",
        origin: "live",
        lastUpdatedAt: SECOND_GLUCOSE,
        dataThrough: SECOND_GLUCOSE,
        recordCount: 2,
        capabilities: [{ kind: "glucose", fidelity: "source-event" }],
        isLive: true,
      },
    ],
  };
}

function snapshot() {
  return buildTarvisLabSnapshotFromInputs({
    generatedAtMs: RANGE_END,
    healthMetricRecords: [healthMetricRecord()],
    healthTrend: [healthTrendDay()],
    range: { start: RANGE_START, end: RANGE_END },
    timeline: timeline(),
  });
}

describe("Tarv1s Analyst Lab experimental dataset", () => {
  it("emits only the declared columns for every table", () => {
    const tables = snapshot().tables;

    expect(Object.keys(tables).sort()).toEqual(
      Object.keys(TARVIS_LAB_TABLE_COLUMNS).sort(),
    );
    for (const [tableName, columns] of Object.entries(
      TARVIS_LAB_TABLE_COLUMNS,
    )) {
      const rows = tables[tableName as keyof typeof tables];
      if (tableName !== "daily_health_metrics") {
        expect(
          rows,
          `${tableName} should be represented by the fixture`,
        ).not.toHaveLength(0);
      }
      for (const row of rows) {
        expect(Object.keys(row), `${tableName} contains an undeclared column`).toEqual(
          [...columns],
        );
      }
    }
  });

  it("caps glucose observation at 12 minutes and splits it at London midnight", () => {
    const intervals = snapshot().tables.glucose_observation_intervals.filter(
      (row) => row.reading_id === "glucose:1",
    );

    expect(intervals).toEqual([
      expect.objectContaining({
        start_ms: GLUCOSE_START,
        end_ms: Date.parse("2026-08-26T00:00:00+01:00"),
        observed_minutes: 5,
        local_date: "2026-08-25",
        local_weekday: "Tuesday",
        range_band: "low",
      }),
      expect.objectContaining({
        start_ms: Date.parse("2026-08-26T00:00:00+01:00"),
        end_ms: Date.parse("2026-08-26T00:07:00+01:00"),
        observed_minutes: 7,
        local_date: "2026-08-26",
        local_weekday: "Wednesday",
        range_band: "low",
      }),
    ]);
    expect(
      intervals.reduce((total, row) => total + Number(row.observed_minutes), 0),
    ).toBe(12);
  });

  it("allocates a cross-midnight basal delivery proportionally per local day", () => {
    const segments = snapshot().tables.basal_daily_segments;

    expect(segments).toEqual([
      expect.objectContaining({
        local_date: "2026-08-25",
        duration_minutes: 10,
        units: 1,
      }),
      expect.objectContaining({
        local_date: "2026-08-26",
        duration_minutes: 20,
        units: 2,
      }),
    ]);
    expect(segments.reduce((total, row) => total + Number(row.units), 0)).toBe(3);
  });

  it("clips overlapping basal delivery and units to the requested range", () => {
    const input = timeline();
    input.basal = [
      {
        ...input.basal[0]!,
        id: "basal:boundary",
        start: RANGE_START - 10 * MINUTE,
        end: RANGE_START + 10 * MINUTE,
        units: 2,
      },
    ];
    const result = buildTarvisLabSnapshotFromInputs({
      generatedAtMs: RANGE_END,
      healthMetricRecords: [healthMetricRecord()],
      healthTrend: [healthTrendDay()],
      range: { start: RANGE_START, end: RANGE_END },
      timeline: input,
    });

    expect(result.tables.basal_deliveries).toEqual([
      expect.objectContaining({
        id: "basal:boundary",
        start_ms: RANGE_START,
        end_ms: RANGE_START + 10 * MINUTE,
        units: 1,
        units_estimated: 1,
      }),
    ]);
    expect(result.tables.basal_daily_segments).toEqual([
      expect.objectContaining({
        start_ms: RANGE_START,
        end_ms: RANGE_START + 10 * MINUTE,
        units: 1,
      }),
    ]);
  });

  it("flattens meal items and Hevy exercises and sets without losing their joins", () => {
    const tables = snapshot().tables;

    expect(tables.meal_items).toEqual([
      expect.objectContaining({
        id: "meal-item:1",
        context_event_id: "meal:1",
        name: "Pasta",
        carbohydrate_grams: 45,
      }),
    ]);
    expect(tables.strength_workouts).toEqual([
      expect.objectContaining({
        workout_id: "hevy-workout:1",
        context_event_id: "activity:1",
        title: "Upper body",
      }),
    ]);
    expect(tables.strength_exercises).toEqual([
      expect.objectContaining({
        workout_id: "hevy-workout:1",
        context_event_id: "activity:1",
        exercise_index: 0,
        title: "Bench press",
      }),
    ]);
    expect(tables.strength_sets).toEqual([
      expect.objectContaining({
        workout_id: "hevy-workout:1",
        exercise_index: 0,
        set_index: 0,
        set_type: "warmup",
        weight_kilograms: 40,
        reps: 10,
      }),
      expect.objectContaining({
        workout_id: "hevy-workout:1",
        exercise_index: 0,
        set_index: 1,
        set_type: "normal",
        weight_kilograms: 70,
        reps: 6,
      }),
    ]);
  });

  it("decodes canonical blood and urine ketone notes into queryable fields", () => {
    const rows = snapshot().tables.context_events;
    const blood = rows.find((row) => row.id === "ketone:blood");
    const urine = rows.find((row) => row.id === "ketone:urine");

    expect(blood).toMatchObject({
      note_detail: null,
      ketone_type: "blood",
      ketone_value_numeric: 1.2,
      ketone_value_text: null,
      ketone_unit: "mmol/L",
    });
    expect(urine).toMatchObject({
      note_detail: null,
      ketone_type: "urine",
      ketone_value_numeric: null,
      ketone_value_text: "++",
      ketone_unit: null,
    });
  });

  it("normalizes raw health metrics and daily health summaries", () => {
    const start = zonedDateTimeToTimestamp(
      "2026-08-26",
      0,
      0,
      0,
      "Europe/London",
    );
    const end = zonedDateTimeToTimestamp(
      "2026-08-27",
      0,
      0,
      0,
      "Europe/London",
    );
    const tables = buildTarvisLabSnapshotFromInputs({
      generatedAtMs: end,
      healthMetricRecords: [healthMetricRecord()],
      healthTrend: [healthTrendDay()],
      range: { start, end },
      timeline: timeline(),
    }).tables;

    expect(tables.health_metrics).toEqual([
      expect.objectContaining({
        id: "health:steps:1",
        measurement_id: "measurement:1",
        kind: "steps",
        value: 321,
        unit: "count",
        local_date: "2026-08-26",
        local_weekday: "Wednesday",
        meal_type_code: null,
      }),
    ]);
    expect(tables.daily_health_metrics).toEqual([
      expect.objectContaining({
        local_date: "2026-08-26",
        local_weekday: "Wednesday",
        steps: 12_345,
        distance_kilometres: 8.2,
        average_heart_rate_bpm: 72,
        hydration_litres: 1.75,
        sleep_minutes: 435,
        workout_minutes: 52,
        meal_count: 3,
        meal_carbs_grams: 148,
        record_count: 4,
        source_labels_json: '["Samsung Health","T1 Arc"]',
        needs_source_json: '["weight"]',
      }),
    ]);
  });

  it("omits whole-day aggregates when an async snapshot covers only part of that day", async () => {
    const start = Date.parse("2026-08-26T09:00:00+01:00");
    const end = Date.parse("2026-08-26T10:00:00+01:00");
    vi.mocked(getDailyHealthMetricSnapshot).mockResolvedValue({
      context: [],
      metrics: {
        sourceLabels: [],
        needsSource: [],
        recordCount: 0,
        selectedRecordIds: [],
      },
      records: [],
      contextNeedsSource: [],
    });
    vi.mocked(getHealthTrendSnapshot).mockResolvedValue([healthTrendDay()]);

    const result = await buildTarvisLabSnapshot(
      { start, end },
      async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [],
        context: [],
        sources: [],
      }),
      end,
    );

    expect(getHealthTrendSnapshot).toHaveBeenCalledWith(
      "2026-08-26",
      1,
      end,
    );
    expect(result.tables.daily_health_metrics).toEqual([]);
  });

  it("counts local calendar dates instead of elapsed 24-hour blocks across fall DST", async () => {
    setRuntimeRegionalProfile({
      ...LONDON_PROFILE,
      region: "us",
      countryCode: "US",
      languageTag: "en-US",
      analysisTimeZone: "America/New_York",
    });
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
    vi.mocked(getDailyHealthMetricSnapshot).mockResolvedValue({
      context: [],
      metrics: {
        sourceLabels: [],
        needsSource: [],
        recordCount: 0,
        selectedRecordIds: [],
      },
      records: [],
      contextNeedsSource: [],
    });
    vi.mocked(getHealthTrendSnapshot).mockResolvedValue([]);

    await buildTarvisLabSnapshot(
      { start, end },
      async (range) => ({
        range,
        glucose: [],
        basal: [],
        boluses: [],
        context: [],
        sources: [],
      }),
      end,
    );

    expect((end - start) / 3_600_000).toBe(169);
    expect(getHealthTrendSnapshot).toHaveBeenCalledWith(
      "2026-11-04",
      7,
      end,
    );
  });
});
