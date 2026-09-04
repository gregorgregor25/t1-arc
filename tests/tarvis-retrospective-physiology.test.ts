import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRetrospectivePhysiology,
  loadRetrospectivePhysiology,
  RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
  RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS,
  RETROSPECTIVE_PHYSIOLOGY_SYNC_STALE_MS,
  type RetrospectivePhysiologyCandidate,
  type RetrospectivePhysiologyCategory,
  type RetrospectivePhysiologyPreference,
  type RetrospectivePhysiologySyncState,
} from "@/data/tarvis/retrospectivePhysiology";
import type { ActivityEvent } from "@/domain/models";

const { database, loadHealthConnectPreferences, openT1ArcDatabase } =
  vi.hoisted(() => {
    const database = {
      getAllAsync: vi.fn(),
    };
    return {
      database,
      loadHealthConnectPreferences: vi.fn(),
      openT1ArcDatabase: vi.fn(async () => database),
    };
  });

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase,
}));
vi.mock("@/data/healthConnect/healthConnectRepository", () => ({
  loadHealthConnectPreferences,
}));

const HOUR = 60 * 60_000;
const AS_OF = Date.parse("2026-08-16T09:00:00+01:00");
const ACTIVITY_START = Date.parse("2026-08-14T23:50:00+01:00");
const ACTIVITY_END = Date.parse("2026-08-15T00:20:00+01:00");
const INCIDENT_RANGE = {
  start: ACTIVITY_START - 4 * HOUR,
  end: ACTIVITY_END + 2 * HOUR,
};

const activity: ActivityEvent = {
  id: "health-connect:workout:com.samsung.health:walk-1",
  kind: "activity",
  start: ACTIVITY_START,
  end: ACTIVITY_END,
  title: "Late walk",
  activityType: "walk",
  durationMinutes: 30,
  intensity: "moderate",
  sourceId: "health-connect:com.samsung.health",
  sourceLabel: "Samsung Health",
  origin: "imported",
};

function candidate(
  id: string,
  kind: RetrospectivePhysiologyCandidate["kind"],
  value: number | undefined,
  unit: string | undefined,
  overrides: Partial<RetrospectivePhysiologyCandidate> = {},
): RetrospectivePhysiologyCandidate {
  return {
    id,
    kind,
    sourcePackage: "com.samsung.health",
    sourceLabel: "Samsung Health",
    start: ACTIVITY_START + 5 * 60_000,
    end: ACTIVITY_START + 10 * 60_000,
    value,
    unit,
    ...overrides,
  };
}

function preferences(
  preferredSourcePackage = "com.samsung.health",
): RetrospectivePhysiologyPreference[] {
  const categories: RetrospectivePhysiologyCategory[] = [
    "steps",
    "distance",
    "active_calories",
    "workouts",
    "heart_rate",
  ];
  return categories.map((category) => ({
    category,
    enabled: true,
    preferredSourcePackage,
  }));
}

function syncStates(
  overrides: Record<
    string,
    Partial<{
      lastAttemptAt: number;
      lastSuccessAt: number;
      lastErrorCode: string;
    }>
  > = {},
): RetrospectivePhysiologySyncState[] {
  const categories: RetrospectivePhysiologyCategory[] = [
    "steps",
    "distance",
    "active_calories",
    "workouts",
    "heart_rate",
  ];
  return categories.map((category) => ({
    category,
    lastAttemptAt: AS_OF - 5 * 60_000,
    lastSuccessAt: AS_OF - 5 * 60_000,
    recordCount: 1,
    ...overrides[category],
  }));
}

describe("Tarv1s retrospective Health Connect physiology contract", () => {
  beforeEach(() => {
    database.getAllAsync.mockReset();
    loadHealthConnectPreferences.mockReset();
    loadHealthConnectPreferences.mockResolvedValue(preferences());
    openT1ArcDatabase.mockClear();
  });

  it("uses an explicit narrow allowlist", () => {
    expect(RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS).toEqual([
      "workout",
      "steps",
      "distance",
      "elevation_gained",
      "active_calories",
      "heart_rate",
      "workout_power",
      "workout_speed",
      "walking_cadence",
      "cycling_cadence",
    ]);
    expect(RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS).not.toContain(
      "blood_glucose" as never,
    );
    expect(RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS).not.toContain(
      "resting_heart_rate" as never,
    );
    expect(RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS).not.toContain(
      "total_calories" as never,
    );
  });

  it("keeps strict cross-midnight activity overlap and rejects unrelated kinds, wrong units, nonfinite values and the half-open end boundary", () => {
    const result = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: preferences(),
      syncStates: syncStates(),
      candidates: [
        candidate("workout", "workout", undefined, undefined, {
          id: activity.id,
          start: ACTIVITY_START,
          end: ACTIVITY_END,
          workoutTitle: "Late walk from Samsung",
          perceivedExertion: 6,
        }),
        candidate("steps-cross-midnight", "steps", 640, "count", {
          start: Date.parse("2026-08-14T23:55:00+01:00"),
          end: Date.parse("2026-08-15T00:05:00+01:00"),
        }),
        candidate("heart-start", "heart_rate", 92, "bpm", {
          start: ACTIVITY_START,
          end: ACTIVITY_START,
        }),
        candidate("heart-last", "heart_rate", 141, "bpm", {
          start: ACTIVITY_END - 1,
          end: ACTIVITY_END - 1,
        }),
        candidate("heart-at-end", "heart_rate", 130, "bpm", {
          start: ACTIVITY_END,
          end: ACTIVITY_END,
        }),
        candidate("heart-negative", "heart_rate", -1, "bpm"),
        candidate("heart-nan", "heart_rate", Number.NaN, "bpm"),
        candidate("heart-wrong-unit", "heart_rate", 110, "count"),
        candidate("zero-power", "workout_power", 0, "w"),
        candidate("wrong-source", "heart_rate", 115, "bpm", {
          sourcePackage: "com.fitbit.FitbitMobile",
          sourceLabel: "Fitbit",
        }),
        candidate(
          "unrelated-vital",
          "oxygen_saturation" as RetrospectivePhysiologyCandidate["kind"],
          98,
          "percent",
        ),
      ],
    });

    expect(result.records.map(({ id }) => id)).toEqual([
      activity.id,
      "heart-start",
      "steps-cross-midnight",
      "zero-power",
      "heart-last",
    ]);
    expect(result.records.find(({ id }) => id === activity.id)).toMatchObject({
      workoutTitle: "Late walk from Samsung",
      perceivedExertion: 6,
    });
    expect(
      result.records.every((record) => !("rawPayloadJson" in record)),
    ).toBe(true);
  });

  it("honours one preferred package, reports excluded alternates, and refuses ambiguous duplicate sources", () => {
    const candidates = [
      candidate("samsung-heart", "heart_rate", 100, "bpm"),
      candidate("fitbit-heart-1", "heart_rate", 105, "bpm", {
        sourcePackage: "com.fitbit.FitbitMobile",
        sourceLabel: "Fitbit",
      }),
      candidate("fitbit-heart-2", "heart_rate", 110, "bpm", {
        sourcePackage: "com.fitbit.FitbitMobile",
        sourceLabel: "Fitbit",
      }),
    ];
    const preferred = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: preferences("com.samsung.health"),
      syncStates: syncStates(),
      candidates,
    });
    expect(preferred.records.map(({ id }) => id)).toEqual(["samsung-heart"]);
    expect(
      preferred.coverage.find(({ category }) => category === "heart_rate"),
    ).toMatchObject({
      status: "current",
      selectedSourcePackage: "com.samsung.health",
      alternateSources: [
        {
          sourcePackage: "com.fitbit.FitbitMobile",
          sourceLabel: "Fitbit",
          recordCount: 2,
        },
      ],
    });

    const ambiguousPreferences = preferences().map((preference) =>
      preference.category === "heart_rate"
        ? { ...preference, preferredSourcePackage: undefined }
        : preference,
    );
    const ambiguous = buildRetrospectivePhysiology({
      activity: { ...activity, sourceId: "hevy", corroboratingSourceIds: [] },
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: ambiguousPreferences,
      syncStates: syncStates(),
      candidates,
    });
    expect(
      ambiguous.coverage.find(({ category }) => category === "heart_rate"),
    ).toMatchObject({ status: "unavailable", reason: "needs-source" });
    expect(ambiguous.records).toEqual([]);

    const ambiguousDespiteActivitySource = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: ambiguousPreferences,
      syncStates: syncStates(),
      candidates,
    });
    expect(
      ambiguousDespiteActivitySource.coverage.find(
        ({ category }) => category === "heart_rate",
      ),
    ).toMatchObject({ status: "unavailable", reason: "needs-source" });
  });

  it("distinguishes current, missing, stale, unsynced and unavailable coverage from preference and sync evidence", () => {
    const result = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      candidates: [candidate("heart", "heart_rate", 101, "bpm")],
      preferences: preferences().map((preference) =>
        preference.category === "active_calories"
          ? { ...preference, enabled: false }
          : preference,
      ),
      syncStates: syncStates({
        distance: {
          lastAttemptAt: AS_OF - 60_000,
          lastSuccessAt: AS_OF - RETROSPECTIVE_PHYSIOLOGY_SYNC_STALE_MS - 1,
          lastErrorCode: "read_failed",
        },
        workouts: {
          lastAttemptAt: AS_OF - 60_000,
          lastSuccessAt: undefined,
        },
      }),
    });
    expect(
      Object.fromEntries(
        result.coverage.map(({ category, status }) => [category, status]),
      ),
    ).toEqual({
      steps: "missing",
      distance: "stale",
      active_calories: "disabled",
      workouts: "unsynced",
      heart_rate: "current",
    });

    const missingPreference = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      candidates: [candidate("heart", "heart_rate", 101, "bpm")],
      preferences: preferences().filter(
        ({ category }) => category !== "heart_rate",
      ),
      syncStates: syncStates(),
    });
    expect(
      missingPreference.coverage.find(
        ({ category }) => category === "heart_rate",
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "preference-unavailable",
    });
  });

  it("retains the incident range as provenance but queries only the strict activity window with a max-plus-one safety bound", async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM health_connect_records")) return [];
      if (sql.includes("FROM health_connect_preferences")) return preferences();
      if (sql.includes("FROM health_connect_sync_state")) return syncStates();
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    const recordCall = database.getAllAsync.mock.calls.find(([sql]) =>
      String(sql).includes("FROM health_connect_records"),
    );
    expect(recordCall?.slice(1)).toEqual([
      ACTIVITY_END,
      ACTIVITY_START,
      ACTIVITY_START,
    ]);
    expect(String(recordCall?.[0])).toContain(
      `LIMIT ${RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT + 1}`,
    );
    expect(String(recordCall?.[0])).not.toMatch(/OFFSET/i);
    expect(String(recordCall?.[0])).not.toContain("notes");
    expect(result.range).toEqual(INCIDENT_RANGE);

    database.getAllAsync.mockRejectedValueOnce(new Error("database offline"));
    const unavailable = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    expect(unavailable.records).toEqual([]);
    expect(
      unavailable.coverage.every(({ status }) => status === "unavailable"),
    ).toBe(true);
    expect(
      unavailable.coverage.every(({ reason }) => reason === "load-failed"),
    ).toBe(true);
  });

  it("validates loaded rows and preserves valid zeroes before returning the safe contract", async () => {
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM health_connect_preferences")) return preferences();
      if (sql.includes("FROM health_connect_sync_state")) return syncStates();
      if (sql.includes("FROM health_connect_records")) {
        return [
          {
            id: "zero-power",
            kind: "workout_power",
            source_package: "com.samsung.health",
            display_name: "Samsung Health",
            start_ms: ACTIVITY_START + 60_000,
            end_ms: ACTIVITY_START + 60_000,
            value: 0,
            unit: "w",
            workout_title: null,
            workout_rpe: null,
            notes: "not returned",
          },
          {
            id: "invalid-heart",
            kind: "heart_rate",
            source_package: "com.samsung.health",
            display_name: "Samsung Health",
            start_ms: ACTIVITY_START + 2 * 60_000,
            end_ms: ACTIVITY_START + 2 * 60_000,
            value: -4,
            unit: "bpm",
          },
          {
            id: "wrong-unit",
            kind: "distance",
            source_package: "com.samsung.health",
            display_name: "Samsung Health",
            start_ms: ACTIVITY_START + 3 * 60_000,
            end_ms: ACTIVITY_START + 4 * 60_000,
            value: 500,
            unit: "kcal",
          },
          {
            id: "unrelated",
            kind: "total_calories",
            source_package: "com.samsung.health",
            display_name: "Samsung Health",
            start_ms: ACTIVITY_START,
            end_ms: ACTIVITY_END,
            value: 500,
            unit: "kcal",
          },
        ];
      }
      return [];
    });

    const result = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    expect(result.records).toEqual([
      {
        id: "zero-power",
        kind: "workout_power",
        sourcePackage: "com.samsung.health",
        sourceLabel: "Samsung Health",
        start: ACTIVITY_START + 60_000,
        end: ACTIVITY_START + 60_000,
        value: 0,
        unit: "w",
      },
    ]);
  });

  it("reuses the repository starter-category defaults when no preferences have been persisted", async () => {
    loadHealthConnectPreferences.mockResolvedValue(
      preferences().map((preference) => ({
        ...preference,
        preferredSourcePackage: undefined,
      })),
    );
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM health_connect_sync_state")) return syncStates();
      if (sql.includes("FROM health_connect_records")) {
        return [
          {
            id: "starter-heart",
            kind: "heart_rate",
            source_package: "com.samsung.health",
            display_name: "Samsung Health",
            start_ms: ACTIVITY_START + 60_000,
            end_ms: ACTIVITY_START + 60_000,
            value: 101,
            unit: "bpm",
            workout_title: null,
            workout_rpe: null,
          },
        ];
      }
      return [];
    });

    const result = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    expect(loadHealthConnectPreferences).toHaveBeenCalledTimes(1);
    expect(result.records.map(({ id }) => id)).toEqual(["starter-heart"]);
    expect(
      result.coverage.find(({ category }) => category === "heart_rate"),
    ).toMatchObject({ status: "current" });
  });

  it("does not truncate ordinary high-cardinality samples above a UI page size", () => {
    const heart = Array.from({ length: 240 }, (_, index) =>
      candidate(`heart-${index}`, "heart_rate", 80 + (index % 40), "bpm", {
        start: ACTIVITY_START + index * 1_000,
        end: ACTIVITY_START + index * 1_000,
      }),
    );
    const result = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: preferences(),
      syncStates: syncStates(),
      candidates: heart,
    });
    expect(result.truncated).toBe(false);
    expect(result.records).toHaveLength(240);
    expect(result.records.map(({ id }) => id)).toEqual(
      heart.map(({ id }) => id),
    );
  });

  it("does not infer a source from a truncated candidate set without an explicit preference", () => {
    const noHeartPreference = preferences().map((preference) =>
      preference.category === "heart_rate"
        ? { ...preference, preferredSourcePackage: undefined }
        : preference,
    );
    const result = buildRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
      preferences: noHeartPreference,
      syncStates: syncStates(),
      candidates: [candidate("heart", "heart_rate", 100, "bpm")],
      truncated: true,
      loadedCandidateCount: RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    });
    expect(result.records).toEqual([]);
    expect(
      result.coverage.find(({ category }) => category === "heart_rate"),
    ).toMatchObject({
      status: "unavailable",
      reason: "candidate-limit",
    });
  });

  it("returns only the bounded allowlisted row contract and declares max-plus-one truncation", async () => {
    const rows = Array.from(
      { length: RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT + 1 },
      (_, index) => ({
        id:
          index === 0
            ? activity.id
            : `health-connect:heart_rate:com.samsung.health:${index}`,
        kind: index === 0 ? "workout" : "heart_rate",
        source_package: "com.samsung.health",
        display_name: "Samsung Health",
        start_ms: index === 0 ? ACTIVITY_START : ACTIVITY_START + index,
        end_ms: index === 0 ? ACTIVITY_END : ACTIVITY_START + index,
        value: index === 0 ? null : 100,
        unit: index === 0 ? null : "bpm",
        workout_title: index === 0 ? "Late walk from storage" : null,
        workout_rpe: index === 0 ? 0 : null,
        notes: "must never leave storage",
        raw_payload_json: '{"secret":"must never leave storage"}',
        device_model: "must never leave storage",
      }),
    );
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM health_connect_records")) return rows;
      if (sql.includes("FROM health_connect_preferences")) return preferences();
      if (sql.includes("FROM health_connect_sync_state")) return syncStates();
      return [];
    });

    const result = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    const recordSql = String(
      database.getAllAsync.mock.calls.find(([sql]) =>
        String(sql).includes("FROM health_connect_records"),
      )?.[0],
    );
    for (const kind of RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS) {
      expect(recordSql).toContain(`'${kind}'`);
    }
    expect(recordSql).toContain("json_extract(r.payload_json, '$.title')");
    expect(recordSql).toContain(
      "json_extract(r.payload_json, '$.rateOfPerceivedExertion')",
    );
    expect(recordSql).not.toMatch(
      /\$\.notes|device_model|device_manufacturer/i,
    );
    expect(result.truncated).toBe(true);
    expect(result.loadedCandidateCount).toBe(
      RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    );
    expect(result.records).toHaveLength(
      RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    );
    expect(result.records[0]).toMatchObject({
      id: activity.id,
      workoutTitle: "Late walk from storage",
      perceivedExertion: 0,
    });
    expect(Object.keys(result.records[0]!)).not.toEqual(
      expect.arrayContaining(["notes", "rawPayloadJson", "deviceModel"]),
    );
  });

  it("never reports a later enabled category as missing when the global candidate bound was reached", async () => {
    const rows = [
      ...Array.from(
        { length: RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT },
        (_, index) => ({
          id: `health-connect:heart_rate:com.samsung.health:${index}`,
          kind: "heart_rate",
          source_package: "com.samsung.health",
          display_name: "Samsung Health",
          start_ms: ACTIVITY_START + index,
          end_ms: ACTIVITY_START + index,
          value: 100,
          unit: "bpm",
          workout_title: null,
          workout_rpe: null,
        }),
      ),
      {
        id: "health-connect:steps:com.samsung.health:after-bound",
        kind: "steps",
        source_package: "com.samsung.health",
        display_name: "Samsung Health",
        start_ms: ACTIVITY_START + 10 * 60_000,
        end_ms: ACTIVITY_START + 11 * 60_000,
        value: 250,
        unit: "count",
        workout_title: null,
        workout_rpe: null,
      },
    ];
    database.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM health_connect_records")) return rows;
      if (sql.includes("FROM health_connect_sync_state")) return syncStates();
      return [];
    });

    const result = await loadRetrospectivePhysiology({
      activity,
      range: INCIDENT_RANGE,
      asOf: AS_OF,
    });
    expect(result.truncated).toBe(true);
    expect(result.records).toHaveLength(
      RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    );
    expect(result.records.some(({ kind }) => kind === "steps")).toBe(false);
    expect(
      result.coverage.find(({ category }) => category === "steps"),
    ).toMatchObject({
      status: "unavailable",
      reason: "candidate-limit",
      recordCount: 0,
      selectedSourcePackage: "com.samsung.health",
    });
    expect(
      result.coverage.find(({ category }) => category === "heart_rate"),
    ).toMatchObject({
      status: "unavailable",
      reason: "candidate-limit",
      recordCount: RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    });
  });
});
