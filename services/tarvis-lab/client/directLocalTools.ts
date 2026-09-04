import {
  buildTarvisLabSnapshot,
  getTarvisLocalDayCoverage,
  TARVIS_LAB_TABLE_COLUMNS,
  type TarvisLabRow,
  type TarvisLabSnapshot,
  type TarvisLabTableName,
} from "./experimentalDataset";
import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
  type HealthTrendDay,
} from "@/data/healthConnect/dailyHealthMetrics";
import { decodeManualKetoneDetail } from "@/data/manualKetones";
import { contextNoteDisplayTitle } from "@/domain/contextNotes";
import { calculateGlucoseStatistics } from "@/data/tarvis/query/glucoseStatistics";
import { selectTarvisReviewedKnowledge } from "@/data/tarvis/reviewedKnowledge";
import type { TarvisGuidanceReference } from "@/data/tarvis/types";
import type { EvidenceReference } from "@/domain/insights";
import {
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type HealthContextEvent,
  type TimelineData,
  type TimeRange,
} from "@/domain/models";
import { formatGlucose, formatRegionalNumber } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import {
  addDays,
  formatShortDate,
  formatTime,
  isDateKey,
  toDateKey,
  zonedDateTimeToTimestamp,
} from "@/domain/time";
import { formatRegionalWallClockMinute } from "@/domain/regionalWallClock";
import {
  summarizeInsulinByDay,
  summarizeInsulinRange,
} from "@/domain/timelineInsulinSummary";

type Scalar = string | number | null;
type FilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "is_null"
  | "not_null";
type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";
type DailyHealthMetric =
  | "steps"
  | "distance_kilometres"
  | "elevation_gained_metres"
  | "floors_climbed"
  | "active_calories_kcal"
  | "total_calories_kcal"
  | "average_workout_power_watts"
  | "maximum_workout_power_watts"
  | "average_workout_speed_km_per_hour"
  | "maximum_workout_speed_km_per_hour"
  | "average_walking_cadence_per_minute"
  | "average_cycling_cadence_rpm"
  | "average_heart_rate_bpm"
  | "resting_heart_rate_bpm"
  | "minimum_heart_rate_bpm"
  | "maximum_heart_rate_bpm"
  | "weight_kilograms"
  | "body_fat_percent"
  | "lean_body_mass_kilograms"
  | "body_water_mass_kilograms"
  | "bone_mass_kilograms"
  | "height_centimetres"
  | "basal_metabolic_rate_kcal_per_day"
  | "health_connect_glucose_mmol_l"
  | "blood_pressure_systolic_mmhg"
  | "blood_pressure_diastolic_mmhg"
  | "oxygen_saturation_percent"
  | "respiratory_rate_per_minute"
  | "heart_rate_variability_rmssd_ms"
  | "vo2_max_ml_per_kg_min"
  | "body_temperature_celsius"
  | "hydration_litres"
  | "sleep_minutes";
type WorkoutKind = "any" | "walk" | "run" | "cycle" | "strength" | "other";
type WorkoutSource = "any" | "hevy" | "health_connect" | "strava";
type ContextKind =
  | "any"
  | "meal"
  | "activity"
  | "sleep"
  | "weight"
  | "medication"
  | "note"
  | "ketone";

export type TarvisDirectControlAction = "out_of_scope" | "t1arc_help";

interface DirectToolExecution {
  controlAction?: TarvisDirectControlAction;
  durationMs: number;
  evidenceIds: string[];
  resultJson: string;
}

interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value?: Scalar | Scalar[];
}

interface QueryAggregate {
  function: AggregateFunction;
  column?: string | null;
  alias: string;
}

interface QueryOrder {
  column: string;
  direction: "asc" | "desc";
}

interface QueryArguments {
  table: TarvisLabTableName;
  startMs: number;
  endMs: number;
  columns: string[];
  filters?: QueryFilter[];
  aggregates?: QueryAggregate[];
  groupBy?: string[];
  orderBy?: QueryOrder[];
  limit?: number;
}

const MAX_RANGE_MS = 120 * 86_400_000;
const MAX_RESULT_CHARACTERS = 60_000;
const MAX_CACHE_ENTRIES = 3;
const TABLE_NAMES = Object.keys(
  TARVIS_LAB_TABLE_COLUMNS,
) as TarvisLabTableName[];

const TABLE_GUIDANCE: Record<
  TarvisLabTableName,
  { grain: string; useFor: string; detailColumns: string[] }
> = {
  glucose_readings: {
    grain:
      "One imported glucose record; duplicate timestamps may represent the same physiological sample.",
    useFor: "Exact readings, trends, local times and source provenance.",
    detailColumns: [
      "id",
      "local_date",
      "local_time",
      "mmol_l",
      "trend",
      "quality",
      "source_id",
    ],
  },
  glucose_observation_intervals: {
    grain:
      "One duration-weighted observed glucose interval capped at 12 minutes.",
    useFor: "Time below, within or above range and observed sensor coverage.",
    detailColumns: [
      "id",
      "local_date",
      "start_ms",
      "end_ms",
      "observed_minutes",
      "mmol_l",
      "range_band",
      "source_id",
    ],
  },
  basal_deliveries: {
    grain: "One imported basal delivery interval clipped to the query range.",
    useFor:
      "Basal rates, delivered units, temporary percentages and exact local start/end times.",
    detailColumns: [
      "id",
      "local_start_date",
      "local_start_time",
      "local_end_date",
      "local_end_time",
      "rate_units_per_hour",
      "units",
      "delivery_type",
      "source_id",
    ],
  },
  basal_daily_segments: {
    grain:
      "One basal delivery segment contained within one local calendar day.",
    useFor:
      "Correct daily basal totals, including deliveries crossing midnight.",
    detailColumns: [
      "id",
      "local_date",
      "duration_minutes",
      "units",
      "rate_units_per_hour",
      "source_id",
    ],
  },
  bolus_deliveries: {
    grain: "One delivered bolus record.",
    useFor:
      "Bolus timing, units, type and any source-supplied glucose/carbohydrate/ratio inputs.",
    detailColumns: [
      "id",
      "local_date",
      "local_time",
      "units",
      "delivery_type",
      "blood_glucose_input_mmol_l",
      "carbs_input_grams",
      "carb_ratio_grams_per_unit",
      "source_id",
    ],
  },
  insulin_daily_totals: {
    grain:
      "One cumulative source snapshot for one local day; a day may contain several snapshots.",
    useFor:
      "Inspecting source snapshots. Never sum snapshots from the same day; select the latest timestamp for each source/device, or preferably use get_insulin_summary.",
    detailColumns: [
      "id",
      "date_key",
      "basal_units",
      "bolus_units",
      "total_units",
      "source_id",
    ],
  },
  pump_states: {
    grain: "One recorded pump-state interval.",
    useFor:
      "Suspensions, automated pauses and other pump states with exact times.",
    detailColumns: [
      "id",
      "kind",
      "local_start_date",
      "local_start_time",
      "local_end_date",
      "local_end_time",
      "source_id",
    ],
  },
  context_events: {
    grain: "One meal, activity, sleep, weight, medication or note event.",
    useFor:
      "Cross-domain timing and summary fields; use meal_items or strength tables for item/set detail.",
    detailColumns: [
      "id",
      "kind",
      "local_date",
      "local_time",
      "title",
      "source_id",
      "source_label",
      "origin",
    ],
  },
  meal_items: {
    grain: "One named food item belonging to a context meal.",
    useFor:
      "Exact foods, brands, quantities and nutrient detail recorded for a meal.",
    detailColumns: [
      "id",
      "context_event_id",
      "name",
      "brand",
      "amount",
      "unit",
      "carbohydrate_grams",
      "energy_kcal",
      "source_label",
    ],
  },
  strength_workouts: {
    grain:
      "One detailed strength workout, currently sourced from Hevy when available.",
    useFor: "Workout identity, exact date/time, source and description.",
    detailColumns: [
      "workout_id",
      "context_event_id",
      "local_date",
      "local_time",
      "title",
      "description",
      "source_id",
      "source_label",
    ],
  },
  strength_exercises: {
    grain: "One exercise within a detailed strength workout.",
    useFor: "Exercise names, notes, ordering and supersets.",
    detailColumns: [
      "workout_id",
      "context_event_id",
      "exercise_index",
      "title",
      "notes",
      "superset_id",
    ],
  },
  strength_sets: {
    grain: "One completed set within a strength exercise.",
    useFor: "Weights, reps, distance, duration and perceived exertion.",
    detailColumns: [
      "workout_id",
      "context_event_id",
      "exercise_index",
      "set_index",
      "set_type",
      "weight_kilograms",
      "reps",
      "distance_metres",
      "duration_seconds",
      "rpe",
    ],
  },
  health_metrics: {
    grain:
      "One selected Health Connect metric component with original source and unit.",
    useFor:
      "Exact Health Connect measurements such as steps, heart rate, body composition, blood pressure, oxygen saturation, HRV, temperature and hydration.",
    detailColumns: [
      "id",
      "kind",
      "local_date",
      "local_time",
      "value",
      "unit",
      "source_package",
      "source_label",
    ],
  },
  daily_health_metrics: {
    grain:
      "One complete local-day roll-up across selected Health Connect records and recorded context; partial boundary days are omitted.",
    useFor:
      "Daily comparisons and trends for fully authorised local days; use exact timestamped tables for partial days. Null is missing, not zero.",
    detailColumns: [
      "local_date",
      "local_weekday",
      "source_labels_json",
      "needs_source_json",
    ],
  },
  source_statuses: {
    grain: "One configured data source status.",
    useFor:
      "Freshness, data-through time, record count and live/imported capabilities.",
    detailColumns: [
      "id",
      "label",
      "freshness",
      "origin",
      "data_through_ms",
      "record_count",
      "is_live",
    ],
  },
};

export const TARVIS_DIRECT_LOCAL_TOOLS = [
  {
    type: "function",
    name: "answer_out_of_scope",
    description:
      "Use when the request is not about the user's T1 Arc records, Type 1 diabetes, reviewed diabetes guidance, or help using T1 Arc. Never answer the unrelated question.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 160 },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "answer_t1arc_help",
    description:
      "Use for questions about T1 Arc itself, privacy, connection, security, credentials, or app capabilities. Never reveal or request a secret.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["security", "privacy", "connection", "features"],
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lookup_reviewed_guidance",
    description:
      "Load locally reviewed UK Type 1 diabetes guidance for a general education question. This is the only allowed source for guidance claims. It does not provide an individual treatment plan.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", maxLength: 1000 },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_glucose_summary",
    description:
      `Fast verified glucose summary for an exact inclusive local calendar-date range. Prefer this over raw queries for average, minimum, maximum, coverage, count, GMI or time-in-range questions.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: { type: "string", description: "YYYY-MM-DD." },
        endLocalDate: { type: "string", description: "Inclusive YYYY-MM-DD." },
        sourceId: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description:
            "Exact source ID only when the user explicitly names a source; otherwise null.",
        },
      },
      required: ["startLocalDate", "endLocalDate", "sourceId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_latest_workout",
    description:
      "Fast verified lookup for recent recorded workouts before a given time. Preserve an activity type or source only when the user states it. Gym is a location, not a workout type: for an otherwise ambiguous gym question use workoutKind any and sourcePreference any so the result can present dated candidates instead of guessing between Hevy, Samsung/Health Connect, walking, running or other activity.",
    parameters: {
      type: "object",
      properties: {
        beforeMs: { type: "number" },
        lookbackDays: { type: "integer", minimum: 1, maximum: 120 },
        workoutKind: {
          type: "string",
          enum: ["any", "walk", "run", "cycle", "strength", "other"],
        },
        sourcePreference: {
          type: "string",
          enum: ["any", "hevy", "health_connect", "strava"],
        },
      },
      required: ["beforeMs", "lookbackDays", "workoutKind", "sourcePreference"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_activity_glucose_context",
    description:
      "Analyse recorded glucose immediately before, during and after a specific activity returned by get_latest_workout, together with nearby recorded meals and bolus insulin. Use this for questions about what happened around a walk, run, cycle or workout. It describes association and timing, never proven cause.",
    parameters: {
      type: "object",
      properties: {
        activityId: {
          type: "string",
          description: "Exact activity ID returned by get_latest_workout.",
          maxLength: 240,
        },
        beforeMinutes: { type: "integer", minimum: 30, maximum: 360 },
        afterMinutes: { type: "integer", minimum: 30, maximum: 720 },
      },
      required: ["activityId", "beforeMinutes", "afterMinutes"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_daily_carbs_and_bolus",
    description:
      `Fast verified totals for recorded meal carbohydrate and delivered bolus insulin over an exact inclusive local calendar-date range. The arithmetic does not establish a prescribed insulin-to-carb ratio.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: { type: "string", description: "YYYY-MM-DD." },
        endLocalDate: { type: "string", description: "Inclusive YYYY-MM-DD." },
      },
      required: ["startLocalDate", "endLocalDate"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_insulin_summary",
    description:
      `Fast verified basal, bolus and total insulin summary for an exact inclusive local calendar-date range. Prefer this for basal-versus-bolus totals and split questions.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: { type: "string", description: "YYYY-MM-DD." },
        endLocalDate: { type: "string", description: "Inclusive YYYY-MM-DD." },
      },
      required: ["startLocalDate", "endLocalDate"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_daily_health_summary",
    description:
      `Fast verified daily summary for steps, distance, activity calories, heart rate, resting heart rate, weight, hydration or sleep over exact local calendar dates.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: { type: "string", description: "YYYY-MM-DD." },
        endLocalDate: { type: "string", description: "Inclusive YYYY-MM-DD." },
        metric: {
          type: "string",
          enum: [
            "steps",
            "distance_kilometres",
            "elevation_gained_metres",
            "floors_climbed",
            "active_calories_kcal",
            "total_calories_kcal",
            "average_workout_power_watts",
            "maximum_workout_power_watts",
            "average_workout_speed_km_per_hour",
            "maximum_workout_speed_km_per_hour",
            "average_walking_cadence_per_minute",
            "average_cycling_cadence_rpm",
            "average_heart_rate_bpm",
            "resting_heart_rate_bpm",
            "minimum_heart_rate_bpm",
            "maximum_heart_rate_bpm",
            "weight_kilograms",
            "body_fat_percent",
            "lean_body_mass_kilograms",
            "body_water_mass_kilograms",
            "bone_mass_kilograms",
            "height_centimetres",
            "basal_metabolic_rate_kcal_per_day",
            "health_connect_glucose_mmol_l",
            "blood_pressure_systolic_mmhg",
            "blood_pressure_diastolic_mmhg",
            "oxygen_saturation_percent",
            "respiratory_rate_per_minute",
            "heart_rate_variability_rmssd_ms",
            "vo2_max_ml_per_kg_min",
            "body_temperature_celsius",
            "hydration_litres",
            "sleep_minutes",
          ],
        },
      },
      required: ["startLocalDate", "endLocalDate", "metric"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_context_records",
    description:
      `Load richly detailed recorded meals, activities, sleep, weight, medication, notes or ketones for exact local calendar dates. Prefer this for what/when/detail questions so titles, times, source, nutrition items, medication amounts, ketone values and workout sets are retained.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: { type: "string", description: "YYYY-MM-DD." },
        endLocalDate: { type: "string", description: "Inclusive YYYY-MM-DD." },
        kind: {
          type: "string",
          enum: [
            "any",
            "meal",
            "activity",
            "sleep",
            "weight",
            "medication",
            "note",
            "ketone",
          ],
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["startLocalDate", "endLocalDate", "kind", "limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_configured_carb_ratio",
    description:
      "Read the insulin-to-carbohydrate ratio schedule the user manually confirmed in T1 Arc. Use only as recorded context; never use it to calculate or recommend a dose.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "resolve_local_date_range",
    description:
      `Convert one or more configured-local-time calendar dates into the exact authorised Unix-millisecond range needed by local health-data queries. endLocalDate is inclusive.`,
    parameters: {
      type: "object",
      properties: {
        startLocalDate: {
          type: "string",
          description: `YYYY-MM-DD in the user's configured timezone.`,
        },
        endLocalDate: {
          type: "string",
          description: `Inclusive YYYY-MM-DD in the user's configured timezone.`,
        },
      },
      required: ["startLocalDate", "endLocalDate"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "describe_local_health_data",
    description:
      "Describe the read-only datasets and exact fields available inside T1 Arc on this phone. Call this when you need to discover which table contains the evidence for the user question.",
    parameters: {
      type: "object",
      properties: {
        tables: {
          type: "array",
          items: { type: "string", enum: TABLE_NAMES },
          maxItems: TABLE_NAMES.length,
          description:
            "Optional subset. Omit to describe every available table.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "query_local_health_data",
    description:
      `Run one bounded read-only query against approved local T1 Arc health fields. Use absolute Unix epoch milliseconds in configured-timezone-aware ranges. Make more than one call when evidence spans tables. Missing rows mean only that T1 Arc has no matching recorded data.`,
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", enum: TABLE_NAMES },
        startMs: { type: "number" },
        endMs: { type: "number" },
        columns: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 24,
        },
        filters: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              operator: {
                type: "string",
                enum: [
                  "eq",
                  "ne",
                  "gt",
                  "gte",
                  "lt",
                  "lte",
                  "in",
                  "contains",
                  "is_null",
                  "not_null",
                ],
              },
              value: {
                anyOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "null" },
                  {
                    type: "array",
                    items: {
                      anyOf: [
                        { type: "string" },
                        { type: "number" },
                        { type: "null" },
                      ],
                    },
                    maxItems: 50,
                  },
                ],
              },
            },
            required: ["column", "operator"],
            additionalProperties: false,
          },
        },
        aggregates: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              function: {
                type: "string",
                enum: ["count", "sum", "avg", "min", "max"],
              },
              column: { type: ["string", "null"] },
              alias: { type: "string" },
            },
            required: ["function", "alias"],
            additionalProperties: false,
          },
        },
        groupBy: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
        },
        orderBy: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["column", "direction"],
            additionalProperties: false,
          },
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["table", "startMs", "endMs", "columns"],
      additionalProperties: false,
    },
  },
] as const;

export interface TarvisDirectLocalToolExecutorOptions {
  allowedRange: TimeRange;
  loadTimelineData(range: TimeRange): Promise<TimelineData>;
  question?: string;
  now?: () => number;
  snapshotBuilder?: typeof buildTarvisLabSnapshot;
}

export class TarvisDirectLocalToolExecutor {
  private readonly cache = new Map<string, Promise<TarvisLabSnapshot>>();
  private readonly timelineCache = new Map<string, Promise<TimelineData>>();
  private readonly evidence = new Map<string, EvidenceReference>();
  private readonly guidance = new Map<string, TarvisGuidanceReference>();
  private readonly activityById = new Map<
    string,
    Extract<HealthContextEvent, { kind: "activity" }>
  >();
  private readonly now: () => number;
  private readonly snapshotBuilder: typeof buildTarvisLabSnapshot;

  constructor(private readonly options: TarvisDirectLocalToolExecutorOptions) {
    this.now = options.now ?? Date.now;
    this.snapshotBuilder = options.snapshotBuilder ?? buildTarvisLabSnapshot;
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    return (await this.executeDetailed(name, argumentsJson)).resultJson;
  }

  async executeDetailed(
    name: string,
    argumentsJson: string,
  ): Promise<DirectToolExecution> {
    const startedAt = this.now();
    const evidenceBefore = new Set(this.evidence.keys());
    try {
      const parsed = parseObject(argumentsJson);
      const value =
        name === "answer_out_of_scope"
          ? this.controlOutOfScope(parsed)
          : name === "answer_t1arc_help"
            ? this.controlT1ArcHelp(parsed)
            : name === "lookup_reviewed_guidance"
              ? this.reviewedGuidance(parsed)
              : name === "get_glucose_summary"
                ? await this.glucoseSummary(parsed)
                : name === "get_latest_workout"
                  ? await this.latestWorkout(parsed)
                  : name === "get_activity_glucose_context"
                    ? await this.activityGlucoseContext(parsed)
                    : name === "get_daily_carbs_and_bolus"
                      ? await this.dailyCarbsAndBolus(parsed)
                      : name === "get_insulin_summary"
                        ? await this.insulinSummary(parsed)
                        : name === "get_daily_health_summary"
                          ? await this.dailyHealthSummary(parsed)
                          : name === "get_context_records"
                            ? await this.contextRecords(parsed)
                            : name === "get_configured_carb_ratio"
                              ? await this.configuredCarbRatio(parsed)
                              : name === "resolve_local_date_range"
                                ? this.resolveDateRange(parsed)
                                : name === "describe_local_health_data"
                                  ? this.describe(parsed)
                                  : name === "query_local_health_data"
                                    ? await this.query(
                                        parsed as unknown as QueryArguments,
                                      )
                                    : fail(`Unknown local tool: ${name}.`);
      const resultJson = boundedJson(
        limitToolNumberPrecision(
          addRegionalDatePresentation({ ok: true, ...value }),
        ),
      );
      return {
        controlAction:
          name === "answer_out_of_scope"
            ? "out_of_scope"
            : name === "answer_t1arc_help"
              ? "t1arc_help"
              : undefined,
        durationMs: Math.max(0, this.now() - startedAt),
        evidenceIds: [...this.evidence.keys()].filter(
          (id) => !evidenceBefore.has(id),
        ),
        resultJson,
      };
    } catch (error) {
      return {
        durationMs: Math.max(0, this.now() - startedAt),
        evidenceIds: [],
        resultJson: boundedJson({
          ok: false,
          error:
            error instanceof Error ? error.message : "The local query failed.",
        }),
      };
    }
  }

  evidenceReferences() {
    return [...this.evidence.values()].map(cloneEvidenceReference);
  }

  guidanceReferences() {
    return [...this.guidance.values()].map((reference) => ({
      ...reference,
      recommendationRefs: [...reference.recommendationRefs],
    }));
  }

  hasVerifiedEvidence() {
    return this.evidence.size > 0 || this.guidance.size > 0;
  }

  private controlOutOfScope(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["reason"]);
    requireShortString(argumentsValue.reason, "reason", 160);
    return {
      action: "out_of_scope",
      instruction:
        "TARV1S must decline briefly and invite a question about Type 1 diabetes, T1 Arc, or the records stored in T1 Arc.",
    };
  }

  private controlT1ArcHelp(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["topic"]);
    const topic = argumentsValue.topic;
    require(["security", "privacy", "connection", "features"].includes(
      String(topic),
    ), "The T1 Arc help topic is invalid.");
    return {
      action: "t1arc_help",
      topic,
      instruction:
        "Answer only about T1 Arc. Secrets and credentials are app-managed and must never be displayed, copied into chat, or recovered through TARV1S.",
    };
  }

  private reviewedGuidance(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["question"]);
    requireShortString(argumentsValue.question, "question", 1_000);
    const question =
      this.options.question?.trim() || String(argumentsValue.question);
    const items = selectTarvisReviewedKnowledge(question);
    require(items.length >
      0, "No locally reviewed guidance matched this question.");
    items.forEach((item) => {
      this.guidance.set(item.id, {
        knowledgeId: item.id,
        jurisdiction: item.jurisdiction,
        sourceTitle: item.sourceTitle,
        sourceUrl: item.sourceUrl,
        recommendationRefs: [...item.recommendationRefs],
        reviewedAt: item.reviewedAt,
      });
    });
    return {
      timezone: getRuntimeRegionalDefaults().timeZone,
      evidenceIds: items.map(({ id }) => `guidance:${id}`),
      guidance: items,
      semantics: [
        "Summarise only the reviewed text returned here.",
        "Do not turn general guidance into an individual insulin dose or treatment plan.",
      ],
    };
  }

  private async glucoseSummary(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["startLocalDate", "endLocalDate", "sourceId"]);
    const range = this.dateRange(
      argumentsValue.startLocalDate,
      argumentsValue.endLocalDate,
    );
    const sourceId = argumentsValue.sourceId;
    require(sourceId === null ||
      (typeof sourceId === "string" &&
        sourceId.trim().length > 0 &&
        sourceId.length <= 120), "sourceId is invalid.");
    const timeline = await this.timeline(range);
    const readings = timeline.glucose.filter(
      (reading) => sourceId === null || reading.sourceId === sourceId,
    );
    const rows = readings.map<TarvisLabRow>((reading) => ({
      id: reading.id,
      timestamp_ms: reading.timestamp,
      received_at_ms: reading.receivedAt,
      mmol_l: reading.mmolL,
      trend: reading.trend,
      quality: reading.quality,
      source_id: reading.sourceId,
      imported_at_ms: reading.importedAt ?? null,
      local_date: toDateKey(reading.timestamp),
      local_time: formatTime(reading.timestamp),
    }));
    const statistics = calculateGlucoseStatistics({
      readings,
      range,
      thresholds: {
        lowerMmolL: TARGET_LOW_MMOL_L,
        upperMmolL: TARGET_HIGH_MMOL_L,
      },
    });
    const byTimestamp = new Map<number, { values: number[]; ids: string[] }>();
    rows.forEach((row) => {
      if (
        typeof row.timestamp_ms !== "number" ||
        typeof row.mmol_l !== "number"
      )
        return;
      const entry = byTimestamp.get(row.timestamp_ms) ?? {
        values: [],
        ids: [],
      };
      entry.values.push(row.mmol_l);
      if (typeof row.id === "string") entry.ids.push(row.id);
      byTimestamp.set(row.timestamp_ms, entry);
    });
    const samples = [...byTimestamp.entries()]
      .sort(([left], [right]) => left - right)
      .map(([timestamp, entry]) => ({
        timestamp,
        mmolL:
          entry.values.reduce((sum, value) => sum + value, 0) /
          entry.values.length,
        ids: entry.ids,
      }));
    const minimum = samples.length
      ? samples.reduce((selected, sample) =>
          sample.mmolL < selected.mmolL ? sample : selected,
        )
      : null;
    const maximum = samples.length
      ? samples.reduce((selected, sample) =>
          sample.mmolL > selected.mmolL ? sample : selected,
        )
      : null;
    const minimumOccurrences = minimum
      ? samples.filter((sample) => sample.mmolL === minimum.mmolL)
      : [];
    const maximumOccurrences = maximum
      ? samples.filter((sample) => sample.mmolL === maximum.mmolL)
      : [];
    const evidenceId = this.addEvidence({
      description: "Recorded glucose readings used for the verified summary.",
      kind: "glucose",
      label: "Glucose readings for the requested period",
      range,
      rows,
    });
    return {
      evidenceId,
      requestedRange: range,
      startLocalDate: toDateKey(range.start),
      endLocalDate: toDateKey(Math.max(range.start, range.end - 1)),
      sourceId,
      readingRows: rows.length,
      uniqueSamples: samples.length,
      averageMmolL:
        statistics.arithmeticMeanMmolL === null
          ? null
          : roundNumber(statistics.arithmeticMeanMmolL, 2),
      medianMmolL:
        statistics.medianMmolL === null
          ? null
          : roundNumber(statistics.medianMmolL, 2),
      minimumMmolL: statistics.minimumMmolL,
      minimumAtLocalDate: minimum ? toDateKey(minimum.timestamp) : null,
      minimumAtLocalTime: minimum ? formatTime(minimum.timestamp) : null,
      minimumOccurrenceCount: minimumOccurrences.length,
      minimumMostRecentLocalDate: minimumOccurrences.length
        ? toDateKey(minimumOccurrences.at(-1)!.timestamp)
        : null,
      minimumMostRecentLocalTime: minimumOccurrences.length
        ? formatTime(minimumOccurrences.at(-1)!.timestamp)
        : null,
      maximumMmolL: statistics.maximumMmolL,
      maximumAtLocalDate: maximum ? toDateKey(maximum.timestamp) : null,
      maximumAtLocalTime: maximum ? formatTime(maximum.timestamp) : null,
      maximumOccurrenceCount: maximumOccurrences.length,
      maximumMostRecentLocalDate: maximumOccurrences.length
        ? toDateKey(maximumOccurrences.at(-1)!.timestamp)
        : null,
      maximumMostRecentLocalTime: maximumOccurrences.length
        ? formatTime(maximumOccurrences.at(-1)!.timestamp)
        : null,
      standardDeviationMmolL:
        statistics.populationStandardDeviationMmolL === null
          ? null
          : roundNumber(statistics.populationStandardDeviationMmolL, 2),
      coefficientOfVariationPercent: statistics.coefficientOfVariationPercent,
      glucoseManagementIndicatorPercent:
        statistics.glucoseManagementIndicatorPercent,
      gmiEvidenceLimited:
        range.end - range.start < 14 * 86_400_000 ||
        statistics.coveragePercent < 70,
      timeBelowRangePercent: statistics.distribution?.belowPercent ?? null,
      timeInRangePercent: statistics.distribution?.inRangePercent ?? null,
      timeAboveRangePercent: statistics.distribution?.abovePercent ?? null,
      targetRangeMmolL: {
        lower: TARGET_LOW_MMOL_L,
        upper: TARGET_HIGH_MMOL_L,
      },
      coveragePercent: statistics.coveragePercent,
      observedHours: roundNumber(
        statistics.observedMilliseconds / 3_600_000,
        2,
      ),
      firstReadingAtMs: samples[0]?.timestamp ?? null,
      firstReadingLocalDate: samples[0]
        ? toDateKey(samples[0].timestamp)
        : null,
      firstReadingLocalTime: samples[0]
        ? formatTime(samples[0].timestamp)
        : null,
      lastReadingAtMs: samples.at(-1)?.timestamp ?? null,
      lastReadingLocalDate: samples.at(-1)
        ? toDateKey(samples.at(-1)!.timestamp)
        : null,
      lastReadingLocalTime: samples.at(-1)
        ? formatTime(samples.at(-1)!.timestamp)
        : null,
      semantics: [
        "Duplicate readings at the same timestamp are combined into one physiological sample.",
        "Average, minimum and maximum use recorded samples; missing time is not treated as zero.",
        "Time-in-range percentages are duration-weighted across observed sensor time, capped at 12 minutes per reading.",
        "GMI is an estimate from mean sensor glucose, not a laboratory HbA1c result; treat it as limited for periods under 14 days or below 70% coverage.",
      ],
    };
  }

  private async latestWorkout(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, [
      "beforeMs",
      "lookbackDays",
      "workoutKind",
      "sourcePreference",
    ]);
    const beforeMs = finiteNumber(argumentsValue.beforeMs, "beforeMs");
    const lookbackDays = integer(
      argumentsValue.lookbackDays,
      "lookbackDays",
      1,
      120,
    );
    const requestedKind = requireWorkoutKind(argumentsValue.workoutKind);
    const requestedSource = requireWorkoutSource(
      argumentsValue.sourcePreference,
    );
    const explicitKind = explicitWorkoutKind(this.options.question);
    const explicitSource = explicitWorkoutSource(this.options.question);
    const needsClarification = isAmbiguousGymWorkoutQuestion(
      this.options.question,
      explicitKind,
      explicitSource,
    );
    const workoutKind =
      explicitKind ?? (needsClarification ? "any" : requestedKind);
    const sourcePreference =
      explicitSource ?? (needsClarification ? "any" : requestedSource);
    const range = this.requireRange(
      Math.max(
        this.options.allowedRange.start,
        beforeMs - lookbackDays * 86_400_000,
      ),
      Math.min(beforeMs + 1, this.options.allowedRange.end),
    );
    const timeline = await this.timeline(range);
    const activities = timeline.context
      .filter(
        (
          event,
        ): event is Extract<
          TimelineData["context"][number],
          { kind: "activity" }
        > => event.kind === "activity" && event.start <= beforeMs,
      )
      .sort((left, right) => right.start - left.start);
    activities.forEach((activity) =>
      this.activityById.set(activity.id, activity),
    );
    const matching = activities.filter(
      (event) =>
        (workoutKind === "any" || event.activityType === workoutKind) &&
        workoutMatchesSource(event, sourcePreference),
    );
    if (!matching.length) {
      return {
        evidenceId: null,
        requestedRange: range,
        requestedWorkoutKind: workoutKind,
        requestedSourcePreference: sourcePreference,
        workout: null,
        semantics: [
          `No matching recorded ${workoutKind === "any" ? "workout" : `${workoutKind} workout`} was found; this does not prove one did not happen.`,
          "A workout of another activity type or source is not substituted for an explicitly requested one.",
        ],
      };
    }
    const candidates = needsClarification
      ? representativeWorkoutCandidates(activities)
      : matching.slice(0, 1);
    const selected = needsClarification ? undefined : matching[0];
    const evidenceRows: TarvisLabRow[] = candidates.map((event) => ({
      id: event.id,
      kind: event.kind,
      activity_type: event.activityType,
      start_ms: event.start,
      end_ms: event.end ?? null,
      title: event.title,
      source_id: event.sourceId,
      source_label: event.sourceLabel ?? null,
      local_date: toDateKey(event.start),
    }));
    const evidenceStart = Math.min(...candidates.map((event) => event.start));
    const evidenceEnd = Math.max(
      ...candidates.map((event) => event.end ?? event.start),
    );
    const evidenceId = this.addEvidence({
      description: needsClarification
        ? "Distinct recent workout candidates retained by source and activity type."
        : "The latest matching recorded workout and its locally stored detail.",
      kind: "activity",
      label: needsClarification
        ? "Recent workout candidates"
        : "Latest matching workout",
      range: {
        start: evidenceStart,
        end: Math.max(evidenceStart + 1, evidenceEnd + 1),
      },
      rows: evidenceRows,
      recordIds: candidates.map((event) => event.id),
    });
    return {
      evidenceId,
      requestedRange: range,
      requestedWorkoutKind: workoutKind,
      requestedSourcePreference: sourcePreference,
      needsClarification,
      clarificationReason: needsClarification
        ? "Gym describes a place, while the records contain several workout types and sources without verified location."
        : null,
      candidates: candidates.map(workoutSummary),
      workout: selected ? workoutSummary(selected) : null,
    };
  }

  private async activityGlucoseContext(
    argumentsValue: Record<string, unknown>,
  ) {
    exactKeys(argumentsValue, ["activityId", "beforeMinutes", "afterMinutes"]);
    const activityId = requireShortString(
      argumentsValue.activityId,
      "activityId",
      240,
    );
    const beforeMinutes = integer(
      argumentsValue.beforeMinutes,
      "beforeMinutes",
      30,
      360,
    );
    const afterMinutes = integer(
      argumentsValue.afterMinutes,
      "afterMinutes",
      30,
      720,
    );
    let activity = this.activityById.get(activityId);
    if (!activity) {
      const available = await this.timeline(this.options.allowedRange);
      activity = available.context.find(
        (event): event is Extract<HealthContextEvent, { kind: "activity" }> =>
          event.kind === "activity" && event.id === activityId,
      );
    }
    require(activity, "The requested activity was not found in the authorised records.");
    const activityEnd = Math.max(
      activity.start + 1,
      activity.end ?? activity.start + activity.durationMinutes * 60_000,
    );
    const range = this.requireRange(
      Math.max(
        this.options.allowedRange.start,
        activity.start - beforeMinutes * 60_000,
      ),
      Math.min(
        this.options.allowedRange.end,
        activityEnd + afterMinutes * 60_000,
      ),
    );
    const timeline = await this.timeline(range);
    const windows = [
      {
        label: "Before activity",
        range: {
          start: range.start,
          end: Math.min(activity.start, range.end),
        },
      },
      {
        label: "During activity",
        range: {
          start: Math.max(activity.start, range.start),
          end: Math.min(activityEnd, range.end),
        },
      },
      {
        label: "After activity",
        range: {
          start: Math.max(activityEnd, range.start),
          end: range.end,
        },
      },
    ].filter(({ range: window }) => window.end > window.start);
    const glucoseWindows = windows.map(({ label, range: window }) =>
      glucoseWindowSummary(timeline.glucose, window, label),
    );
    const glucoseRows = timeline.glucose.map<TarvisLabRow>((reading) => ({
      id: reading.id,
      timestamp_ms: reading.timestamp,
      mmol_l: reading.mmolL,
      trend: reading.trend,
      source_id: reading.sourceId,
      local_date: toDateKey(reading.timestamp),
      local_time: formatTime(reading.timestamp),
    }));
    const activityEvidenceId = this.addEvidence({
      description:
        "The exact recorded activity selected for contextual review.",
      kind: "activity",
      label: `Selected activity: ${activity.title}`,
      range: {
        start: activity.start,
        end: Math.max(activity.start + 1, activityEnd),
      },
      rows: [contextEvidenceRow(activity)],
      recordIds: [activity.id],
    });
    const glucoseEvidenceId = glucoseRows.length
      ? this.addEvidence({
          description:
            "Recorded glucose readings before, during and after the selected activity.",
          kind: "glucose",
          label: `Glucose around ${activity.title}`,
          range,
          rows: glucoseRows,
        })
      : null;
    const nearbyMeals = timeline.context
      .filter(
        (event): event is Extract<HealthContextEvent, { kind: "meal" }> =>
          event.kind === "meal",
      )
      .map((event) => contextEventSummary(event));
    const nearbyBoluses = timeline.boluses.map((delivery) => ({
      id: delivery.id,
      localDate: toDateKey(delivery.timestamp),
      localTime: formatTime(delivery.timestamp),
      units: delivery.units,
      deliveryType: delivery.deliveryType ?? null,
      sourceId: delivery.sourceId,
    }));
    const contextualRows: TarvisLabRow[] = [
      ...timeline.context
        .filter((event) => event.kind === "meal")
        .map(contextEvidenceRow),
      ...timeline.boluses.map((delivery) => ({
        id: delivery.id,
        timestamp_ms: delivery.timestamp,
        units: delivery.units,
        source_id: delivery.sourceId,
        local_date: toDateKey(delivery.timestamp),
        local_time: formatTime(delivery.timestamp),
      })),
    ];
    const contextEvidenceId = contextualRows.length
      ? this.addEvidence({
          description:
            "Recorded meals and bolus insulin near the selected activity.",
          kind: "mixed",
          label: `Recorded context around ${activity.title}`,
          range,
          rows: contextualRows,
        })
      : null;
    return {
      evidenceIds: [
        activityEvidenceId,
        glucoseEvidenceId,
        contextEvidenceId,
      ].filter(Boolean),
      requestedRange: range,
      activity: contextEventSummary(activity),
      glucoseWindows,
      nearbyMeals,
      nearbyBoluses,
      semantics: [
        "Before, during and after windows use recorded sensor observations capped at 12 minutes per reading.",
        "Nearby meals and boluses are timing context, not proof that they caused the glucose response.",
        "Missing records are unknown and are never treated as zero or as proof that an event did not happen.",
      ],
    };
  }

  private async dailyCarbsAndBolus(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["startLocalDate", "endLocalDate"]);
    const range = this.dateRange(
      argumentsValue.startLocalDate,
      argumentsValue.endLocalDate,
    );
    const timeline = await this.timeline(range);
    const mealEvents = timeline.context.filter(
      (event): event is Extract<HealthContextEvent, { kind: "meal" }> =>
        event.kind === "meal" && typeof event.carbsGrams === "number",
    );
    const meals = mealEvents.flatMap<TarvisLabRow>((event) =>
      event.kind === "meal" && typeof event.carbsGrams === "number"
        ? [
            {
              id: event.id,
              kind: event.kind,
              start_ms: event.start,
              title: event.title,
              carbs_grams: event.carbsGrams,
              source_id: event.sourceId,
              local_date: toDateKey(event.start),
            },
          ]
        : [],
    );
    const boluses = timeline.boluses.map<TarvisLabRow>((delivery) => ({
      id: delivery.id,
      timestamp_ms: delivery.timestamp,
      units: delivery.units,
      source_id: delivery.sourceId,
      local_date: toDateKey(delivery.timestamp),
    }));
    const rows = [...meals, ...boluses];
    const evidenceId = this.addEvidence({
      description:
        "Recorded meal carbohydrate and delivered bolus insulin used for these totals.",
      kind: "mixed",
      label: "Meals and bolus insulin for the requested period",
      range,
      rows,
    });
    const daily = [
      ...new Set([
        ...meals.map((row) => String(row.local_date)),
        ...boluses.map((row) => String(row.local_date)),
      ]),
    ]
      .sort()
      .map((localDate) => ({
        localDate,
        recordedCarbsGrams: roundNumber(
          meals
            .filter((row) => row.local_date === localDate)
            .reduce((total, row) => total + Number(row.carbs_grams), 0),
          1,
        ),
        deliveredBolusUnits: roundNumber(
          boluses
            .filter((row) => row.local_date === localDate)
            .reduce((total, row) => total + Number(row.units), 0),
          2,
        ),
      }));
    return {
      evidenceId,
      requestedRange: range,
      startLocalDate: toDateKey(range.start),
      endLocalDate: toDateKey(Math.max(range.start, range.end - 1)),
      recordedCarbsGrams: roundNumber(
        meals.reduce((total, row) => total + Number(row.carbs_grams), 0),
        1,
      ),
      deliveredBolusUnits: roundNumber(
        boluses.reduce((total, row) => total + Number(row.units), 0),
        2,
      ),
      mealRecordsWithCarbs: meals.length,
      bolusRecords: boluses.length,
      daily,
      meals: mealEvents.slice(-30).map(contextEventSummary),
      boluses: timeline.boluses.slice(-30).map((delivery) => ({
        id: delivery.id,
        localDate: toDateKey(delivery.timestamp),
        localTime: formatTime(delivery.timestamp),
        units: delivery.units,
        deliveryType: delivery.deliveryType ?? null,
        bloodGlucoseInputMmolL: delivery.bloodGlucoseInputMmolL ?? null,
        carbsInputGrams: delivery.carbsInputGrams ?? null,
        carbRatioGramsPerUnit: delivery.carbRatioGramsPerUnit ?? null,
        sourceId: delivery.sourceId,
      })),
      detailTruncated: meals.length > 30 || boluses.length > 30,
      semantics: [
        "These are recorded meal carbohydrates and delivered bolus insulin, not proof of everything consumed or dosed.",
        "Do not present their quotient as the user's prescribed insulin-to-carbohydrate ratio.",
      ],
    };
  }

  private async insulinSummary(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["startLocalDate", "endLocalDate"]);
    const range = this.dateRange(
      argumentsValue.startLocalDate,
      argumentsValue.endLocalDate,
    );
    const timeline = await this.timeline(range);
    const basalRows = timeline.basal.flatMap<TarvisLabRow>((delivery) => {
      const start = Math.max(range.start, delivery.start);
      const end = Math.min(range.end, delivery.end);
      if (end <= start) return [];
      const originalDuration = Math.max(1, delivery.end - delivery.start);
      return [
        {
          id: delivery.id,
          start_ms: start,
          end_ms: end,
          units: delivery.units * ((end - start) / originalDuration),
          source_id: delivery.sourceId,
        },
      ];
    });
    const bolusRows = timeline.boluses.map<TarvisLabRow>((delivery) => ({
      id: delivery.id,
      timestamp_ms: delivery.timestamp,
      units: delivery.units,
      source_id: delivery.sourceId,
    }));
    const insulinSummary = summarizeInsulinRange(
      timeline.basal,
      timeline.boluses,
      range,
      timeline.dailyInsulinTotals ?? [],
    );
    const dailySummaries = summarizeInsulinByDay(
      timeline.basal,
      timeline.boluses,
      range,
      timeline.dailyInsulinTotals ?? [],
    );
    const dailyTotalRows = dailySummaries.flatMap<TarvisLabRow>((day) =>
      day.sourceTotal
        ? [
            {
              id: day.sourceTotal.id,
              timestamp_ms: day.sourceTotal.timestamp,
              date_key: day.sourceTotal.dateKey,
              basal_units: day.sourceTotal.basalUnits ?? null,
              bolus_units: day.sourceTotal.bolusUnits ?? null,
              total_units: day.sourceTotal.totalUnits,
              source_id: day.sourceTotal.sourceId,
            },
          ]
        : [],
    );
    const daily = dailySummaries.map((day) => {
      const basalRecordCount = timeline.basal.filter(
        (delivery) => delivery.start < day.end && delivery.end > day.start,
      ).length;
      const bolusRecordCount = timeline.boluses.filter(
        (delivery) =>
          delivery.timestamp >= day.start && delivery.timestamp < day.end,
      ).length;
      const basalKnown = Boolean(day.sourceTotal) || basalRecordCount > 0;
      return {
        localDate: day.dateKey,
        basalUnits: basalKnown ? roundNumber(day.basalUnits, 2) : null,
        bolusUnits: roundNumber(day.bolusUnits, 2),
        totalUnits: basalKnown ? roundNumber(day.totalUnits, 2) : null,
        source: day.sourceTotal
          ? day.partial
            ? "partial-source-daily-total"
            : "complete-source-daily-total"
          : basalRecordCount || bolusRecordCount
            ? "detailed-events-only"
            : "no-records",
        partial: day.partial,
        sourceAsOfMs: day.sourceAsOf ?? null,
        sourceAsOfLocalDate:
          day.sourceAsOf === undefined ? null : toDateKey(day.sourceAsOf),
        sourceAsOfLocalTime:
          day.sourceAsOf === undefined ? null : formatTime(day.sourceAsOf),
        basalRecordCount,
        bolusRecordCount,
      };
    });
    const basalComplete = daily.every((day) => day.basalUnits !== null);
    const basalUnits = basalComplete
      ? roundNumber(
          daily.reduce((total, day) => total + Number(day.basalUnits), 0),
          2,
        )
      : null;
    const bolusUnits = roundNumber(
      daily.reduce((total, day) => total + day.bolusUnits, 0),
      2,
    );
    const totalUnits = basalComplete
      ? roundNumber(
          daily.reduce((total, day) => total + Number(day.totalUnits), 0),
          2,
        )
      : null;
    const partialDates = daily
      .filter((day) => day.partial)
      .map((day) => day.localDate);
    const datesWithoutSourceDailyTotal = daily
      .filter(
        (day) =>
          day.source !== "complete-source-daily-total" &&
          day.source !== "partial-source-daily-total",
      )
      .map((day) => day.localDate);
    const sourceDailyTotalsCompleteForRequestedRange =
      partialDates.length === 0 && datesWithoutSourceDailyTotal.length === 0;
    const evidenceId = this.addEvidence({
      description:
        "Latest source-reported daily insulin totals where available, with detailed delivery rows used only when a daily total was unavailable.",
      kind: "insulin",
      label: "Basal and bolus insulin for the requested period",
      range,
      rows: [...dailyTotalRows, ...basalRows, ...bolusRows],
    });
    return {
      evidenceId,
      requestedRange: range,
      startLocalDate: toDateKey(range.start),
      endLocalDate: toDateKey(Math.max(range.start, range.end - 1)),
      basalUnits,
      bolusUnits: roundNumber(bolusUnits, 2),
      totalUnits,
      basalPercent:
        basalUnits !== null && totalUnits !== null && totalUnits > 0
          ? roundNumber((basalUnits / totalUnits) * 100, 1)
          : null,
      bolusPercent:
        totalUnits !== null && totalUnits > 0
          ? roundNumber((bolusUnits / totalUnits) * 100, 1)
          : null,
      basalRecords: basalRows.length,
      bolusRecords: bolusRows.length,
      dailyTotalRecords: dailyTotalRows.length,
      sourceCoversEveryDay: insulinSummary.sourceCoversEveryDay,
      sourceProvidesBasalEveryDay: insulinSummary.sourceProvidesBasalEveryDay,
      sourceProvidesBolusEveryDay: insulinSummary.sourceProvidesBolusEveryDay,
      partial: insulinSummary.partial,
      dataCompleteness: {
        sourceDailyTotalsCompleteForRequestedRange,
        requestedRangeIncludesToday: daily.some(
          (day) => day.localDate === toDateKey(this.now()),
        ),
        partialDates,
        partialDateLabels: partialDates.map((date) => formatShortDate(date)),
        datesWithoutSourceDailyTotal,
        datesWithoutSourceDailyTotalLabels: datesWithoutSourceDailyTotal.map(
          (date) => formatShortDate(date),
        ),
        latestSourceAsOfMs: insulinSummary.sourceAsOf ?? null,
        latestSourceAsOfLocalDate:
          insulinSummary.sourceAsOf === undefined
            ? null
            : toDateKey(insulinSummary.sourceAsOf),
        latestSourceAsOfLocalTime:
          insulinSummary.sourceAsOf === undefined
            ? null
            : formatTime(insulinSummary.sourceAsOf),
        userFacingRequirement: sourceDailyTotalsCompleteForRequestedRange
          ? "The source daily totals cover the full requested period."
          : "Tell the user these insulin values are incomplete or recorded so far, name the affected dates, include the source as-of time when available, and do not present missing basal as zero or the result as a final full-day total.",
      },
      sourceIds: [
        ...new Set(
          [...dailyTotalRows, ...basalRows, ...bolusRows]
            .map((row) => row.source_id)
            .filter((value): value is string => typeof value === "string"),
        ),
      ],
      daily,
      recentBoluses: timeline.boluses.slice(-30).map((delivery) => ({
        id: delivery.id,
        localDate: toDateKey(delivery.timestamp),
        localTime: formatTime(delivery.timestamp),
        units: delivery.units,
        deliveryType: delivery.deliveryType ?? null,
        bloodGlucoseInputMmolL: delivery.bloodGlucoseInputMmolL ?? null,
        carbsInputGrams: delivery.carbsInputGrams ?? null,
        carbRatioGramsPerUnit: delivery.carbRatioGramsPerUnit ?? null,
        sourceId: delivery.sourceId,
      })),
      bolusDetailTruncated: bolusRows.length > 30,
      semantics: [
        "The latest source-reported daily total is authoritative for a day when available; cumulative snapshots from the same day are never summed.",
        "Timed basal intervals and boluses are used only for days without a source daily total.",
        "Missing insulin history is not treated as zero delivery.",
        "If dataCompleteness.sourceDailyTotalsCompleteForRequestedRange is false, the answer must explicitly say that the values are incomplete or recorded so far and include the source as-of time when available.",
      ],
    };
  }

  private async dailyHealthSummary(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["startLocalDate", "endLocalDate", "metric"]);
    const startLocalDate = requireDateKey(
      argumentsValue.startLocalDate,
      "startLocalDate",
    );
    const endLocalDate = requireDateKey(
      argumentsValue.endLocalDate,
      "endLocalDate",
    );
    const range = this.dateRange(startLocalDate, endLocalDate);
    const metric = requireDailyHealthMetric(argumentsValue.metric);
    const coverage = getTarvisLocalDayCoverage(range);
    const completeLocalDates = new Set(coverage.completeLocalDates);
    const dayCount = Math.max(
      1,
      Math.min(90, coverage.touchedLocalDates.length),
    );
    const [trend, snapshot, timeline] = await Promise.all([
      getHealthTrendSnapshot(
        coverage.touchedLocalDates.at(-1) ?? endLocalDate,
        dayCount,
        this.now(),
      ),
      getDailyHealthMetricSnapshot(range),
      this.timeline(range),
    ]);
    const days = trend.flatMap((day) => {
      if (!completeLocalDates.has(day.date)) return [];
      const value = dailyHealthMetricValue(day, metric);
      return typeof value === "number" &&
        (metric !== "sleep_minutes" || value > 0)
        ? [{ localDate: day.date, value }]
        : [];
    });
    const values = days.map(({ value }) => value);
    const matchingKinds = new Set(healthRecordKindsForMetric(metric));
    const evidenceRows =
      metric === "sleep_minutes"
        ? timeline.context.flatMap<TarvisLabRow>((event) =>
            event.kind === "sleep"
              ? [
                  {
                    id: event.id,
                    kind: event.kind,
                    start_ms: event.start,
                    end_ms: event.end,
                    value: event.durationMinutes,
                    unit: "minutes",
                    source_id: event.sourceId,
                    source_label: event.sourceLabel ?? event.sourceId,
                    local_date: toDateKey(event.start),
                  },
                ]
              : [],
          )
        : snapshot.records
            .filter((record) => matchingKinds.has(record.kind))
            .map<TarvisLabRow>((record) => ({
              id: record.id,
              kind: record.kind,
              start_ms: record.start,
              end_ms: record.end,
              value: record.value,
              unit: record.unit,
              source_id: record.sourcePackage,
              source_label: record.sourceLabel,
              local_date: toDateKey(record.start),
            }));
    const sourceLabelsByDate = new Map<string, Set<string>>();
    evidenceRows.forEach((row) => {
      if (
        typeof row.local_date !== "string" ||
        typeof row.source_label !== "string"
      ) {
        return;
      }
      const labels =
        sourceLabelsByDate.get(row.local_date) ?? new Set<string>();
      labels.add(row.source_label);
      sourceLabelsByDate.set(row.local_date, labels);
    });
    const minimumDay = days.length
      ? days.reduce((selected, day) =>
          day.value < selected.value ? day : selected,
        )
      : null;
    const maximumDay = days.length
      ? days.reduce((selected, day) =>
          day.value > selected.value ? day : selected,
        )
      : null;
    const evidenceId = this.addEvidence({
      description: `Recorded health data used for the ${metric.replace(/_/g, " ")} summary.`,
      kind: "health-metric",
      label: `${dailyHealthMetricLabel(metric)} records for the requested period`,
      range,
      rows: evidenceRows,
    });
    return {
      evidenceId,
      requestedRange: range,
      startLocalDate,
      endLocalDate,
      metric,
      unit: dailyHealthMetricUnit(metric),
      observedDays: days.length,
      average: values.length ? roundNumber(mean(values), 2) : null,
      total: values.length
        ? roundNumber(
            values.reduce((sum, value) => sum + value, 0),
            2,
          )
        : null,
      minimum: values.length ? Math.min(...values) : null,
      minimumLocalDate: minimumDay?.localDate ?? null,
      maximum: values.length ? Math.max(...values) : null,
      maximumLocalDate: maximumDay?.localDate ?? null,
      sourceLabels: [
        ...new Set(
          evidenceRows
            .map((row) => row.source_label)
            .filter((value): value is string => typeof value === "string"),
        ),
      ],
      days: days.map((day) => ({
        ...day,
        sourceLabels: [...(sourceLabelsByDate.get(day.localDate) ?? [])],
      })),
      dailySummaryCoverage: {
        policy: "whole-local-days-only",
        includedLocalDates: coverage.completeLocalDates,
        includedLocalDateLabels: coverage.completeLocalDates.map((date) =>
          formatShortDate(date),
        ),
        omittedPartialLocalDates: coverage.partialLocalDates,
        omittedPartialLocalDateLabels: coverage.partialLocalDates.map((date) =>
          formatShortDate(date),
        ),
      },
      semantics: [
        "Only days with a recorded value are included in averages.",
        "A missing day is unknown and is not counted as zero.",
        "Whole-day summaries are omitted for partial boundary days because they cannot be clipped without including evidence outside the authorised time range; use exact timestamped records for those days.",
      ],
    };
  }

  private async contextRecords(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, [
      "startLocalDate",
      "endLocalDate",
      "kind",
      "limit",
    ]);
    const range = this.dateRange(
      argumentsValue.startLocalDate,
      argumentsValue.endLocalDate,
    );
    const kind = requireContextKind(argumentsValue.kind);
    const limit = integer(argumentsValue.limit, "limit", 1, 50);
    const timeline = await this.timeline(range);
    const matching = timeline.context
      .filter((event) => contextMatchesKind(event, kind))
      .sort((left, right) => right.start - left.start);
    const selected = matching.slice(0, limit);
    // A completed bounded search is itself verifiable evidence, even when it
    // returns no rows. Register it so TARV1S can accurately say that no matching
    // record was found without confusing that with proof the event never happened.
    const evidenceId = this.addEvidence({
      description: matching.length
        ? "Exact locally recorded context details retained with time and provenance."
        : "A completed search of the authorised local period found no matching recorded context.",
      kind: kind === "activity" ? "activity" : "context",
      label: `${contextKindLabel(kind)} records for the requested period`,
      range,
      rows: matching.map(contextEvidenceRow),
      recordIds: matching.map(({ id }) => id),
    });
    return {
      evidenceId,
      requestedRange: range,
      startLocalDate: toDateKey(range.start),
      endLocalDate: toDateKey(Math.max(range.start, range.end - 1)),
      requestedKind: kind,
      matchedRecords: matching.length,
      returnedRecords: selected.length,
      truncated: matching.length > selected.length,
      records: selected.map(contextEventSummary),
      semantics: [
        "Records retain their exact source label, local date and local time.",
        "Null detail means the source did not provide that field; it never means zero.",
        "A missing record does not prove that an event did not happen.",
      ],
    };
  }

  private async configuredCarbRatio(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, []);
    const { loadTarvisTreatmentProfile } =
      await import("@/data/tarvis/treatmentProfile");
    const profile = await loadTarvisTreatmentProfile();
    if (!profile?.carbRatioSchedule.length) {
      return {
        evidenceId: null,
        configured: false,
        semantics: [
          "No insulin-to-carbohydrate ratio has been manually confirmed in T1 Arc.",
        ],
      };
    }
    const range = {
      start: Math.max(this.options.allowedRange.start, profile.confirmedAt),
      end: Math.max(
        Math.max(this.options.allowedRange.start, profile.confirmedAt) + 1,
        this.options.allowedRange.end,
      ),
    };
    const boundedRange = {
      start: Math.min(range.start, this.options.allowedRange.end - 1),
      end: this.options.allowedRange.end,
    };
    const evidenceId = this.addEvidence({
      description:
        "The insulin-to-carbohydrate schedule manually confirmed in T1 Arc.",
      kind: "context",
      label: "Configured insulin-to-carb ratio",
      range: boundedRange,
      rows: profile.carbRatioSchedule.map((segment) => ({
        id: segment.id,
        start_minute: segment.startMinute,
        grams_per_unit: segment.gramsPerUnit,
        recorded_at_ms: profile.confirmedAt,
        source_id: "t1arc-manual-treatment-profile",
      })),
      recordIds: [],
    });
    return {
      evidenceId,
      configured: true,
      confirmedAtMs: profile.confirmedAt,
      timezone: getRuntimeRegionalDefaults().timeZone,
      schedule: profile.carbRatioSchedule.map((segment) => ({
        startLocalTime: formatRegionalWallClockMinute(
          segment.startMinute,
          getRuntimeRegionalDefaults().locale,
        ),
        gramsPerUnit: segment.gramsPerUnit,
      })),
      semantics: [
        "This is user-entered context, not a dose recommendation.",
        "Never calculate insulin from this schedule.",
      ],
    };
  }

  private dateRange(startValue: unknown, endValue: unknown): TimeRange {
    const startLocalDate = requireDateKey(startValue, "startLocalDate");
    const endLocalDate = requireDateKey(endValue, "endLocalDate");
    require(startLocalDate <=
      endLocalDate, "The local date range is reversed.");
    return this.requireRange(
      Math.max(
        zonedDateTimeToTimestamp(startLocalDate),
        this.options.allowedRange.start,
      ),
      Math.min(
        zonedDateTimeToTimestamp(addDays(endLocalDate, 1)),
        this.options.allowedRange.end,
      ),
    );
  }

  private addEvidence({
    description,
    kind,
    label,
    range,
    recordIds,
    rows,
  }: {
    description: string;
    kind: string;
    label: string;
    range: TimeRange;
    recordIds?: string[];
    rows: TarvisLabRow[];
  }) {
    const ids = [...new Set(recordIds ?? rows.flatMap(recordIdsForRow))].filter(
      Boolean,
    );
    const id = `direct:${stableEvidencePart(label)}:${range.start}:${range.end}`;
    const idSet = new Set(ids);
    const examples = rows
      .map((row, index) => evidenceExample(row, kind, index))
      .filter(
        (example) =>
          idSet.has(example.id) &&
          example.timestamp >= range.start &&
          example.timestamp < range.end,
      )
      .slice(0, 6);
    this.evidence.set(id, {
      id,
      label,
      description,
      range: { ...range },
      recordIds: ids,
      examples,
    });
    return id;
  }

  private describe(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["tables"]);
    const requested = argumentsValue.tables;
    const tables =
      requested === undefined
        ? TABLE_NAMES
        : requireArray(requested, "tables").map(requireTableName);
    return {
      timezone: getRuntimeRegionalDefaults().timeZone,
      units: { glucose: "mmol/L", insulin: "U", carbohydrates: "g" },
      allowedRange: this.options.allowedRange,
      generatedAtMs: this.now(),
      currentLocalDate: toDateKey(this.now()),
      semantics: [
        "All results are recorded local evidence, not proof of cause or complete coverage.",
        "Null means the source did not supply that field; it does not mean zero.",
        "Use source_statuses and observation intervals when coverage or freshness matters.",
      ],
      tables: Object.fromEntries(
        [...new Set(tables)].map((table) => [
          table,
          {
            columns: TARVIS_LAB_TABLE_COLUMNS[table],
            grain: TABLE_GUIDANCE[table].grain,
            useFor: TABLE_GUIDANCE[table].useFor,
            automaticallyReturnedDetail: TABLE_GUIDANCE[table].detailColumns,
          },
        ]),
      ),
    };
  }

  private resolveDateRange(argumentsValue: Record<string, unknown>) {
    exactKeys(argumentsValue, ["startLocalDate", "endLocalDate"]);
    const startLocalDate = requireDateKey(
      argumentsValue.startLocalDate,
      "startLocalDate",
    );
    const endLocalDate = requireDateKey(
      argumentsValue.endLocalDate,
      "endLocalDate",
    );
    require(startLocalDate <=
      endLocalDate, "The local date range is reversed.");
    const calendarStartMs = zonedDateTimeToTimestamp(startLocalDate);
    const calendarEndMs = zonedDateTimeToTimestamp(addDays(endLocalDate, 1));
    const startMs = Math.max(calendarStartMs, this.options.allowedRange.start);
    const endMs = Math.min(calendarEndMs, this.options.allowedRange.end);
    this.requireRange(startMs, endMs);
    return {
      timezone: getRuntimeRegionalDefaults().timeZone,
      startLocalDate,
      endLocalDate,
      startMs,
      endMs,
      clippedToAuthorisedEvidenceWindow:
        startMs !== calendarStartMs || endMs !== calendarEndMs,
    };
  }

  private async query(raw: QueryArguments) {
    const value = raw as unknown as Record<string, unknown>;
    exactKeys(value, [
      "table",
      "startMs",
      "endMs",
      "columns",
      "filters",
      "aggregates",
      "groupBy",
      "orderBy",
      "limit",
    ]);
    const table = requireTableName(raw.table);
    const range = this.requireRange(raw.startMs, raw.endMs);
    const allowedColumns = new Set<string>(TARVIS_LAB_TABLE_COLUMNS[table]);
    const columns = requireColumns(raw.columns, allowedColumns, "columns", 24);
    const filters = this.requireFilters(raw.filters ?? [], allowedColumns);
    const aggregates = this.requireAggregates(
      raw.aggregates ?? [],
      allowedColumns,
    );
    const groupBy = requireColumns(
      raw.groupBy ?? [],
      allowedColumns,
      "groupBy",
      4,
      true,
    );
    require(aggregates.length > 0 ||
      groupBy.length === 0, "groupBy requires aggregates.");
    const limit = integer(raw.limit ?? 100, "limit", 1, 200);
    const snapshot = await this.snapshot(range);
    const dailyCoverage =
      table === "daily_health_metrics"
        ? getTarvisLocalDayCoverage(range, snapshot.timezone)
        : null;
    const completeLocalDates = new Set(
      dailyCoverage?.completeLocalDates ?? [],
    );
    const boundarySafeRows =
      table === "daily_health_metrics"
        ? snapshot.tables[table].filter(
            (row) =>
              typeof row.local_date === "string" &&
              isDateKey(row.local_date) &&
              completeLocalDates.has(row.local_date),
          )
        : snapshot.tables[table];
    const matchingRows = boundarySafeRows.filter((row) =>
      filters.every((filter) => matches(row[filter.column] ?? null, filter)),
    );
    const returnedColumns = aggregates.length
      ? columns
      : [
          ...new Set([
            ...columns,
            ...TABLE_GUIDANCE[table].detailColumns.filter((column) =>
              allowedColumns.has(column),
            ),
          ]),
        ].slice(0, 24);
    let rows = aggregates.length
      ? aggregateRows(matchingRows, groupBy, aggregates)
      : matchingRows.map((row) => selectColumns(row, returnedColumns));
    const outputColumns = new Set([
      ...returnedColumns,
      ...groupBy,
      ...aggregates.map(({ alias }) => alias),
    ]);
    const orderBy = this.requireOrder(raw.orderBy ?? [], outputColumns);
    if (orderBy.length)
      rows = [...rows].sort((left, right) => compareRows(left, right, orderBy));
    const totalRows = rows.length;
    rows = rows.slice(0, limit);
    const evidenceId = this.addEvidence({
      description: `Approved local ${table.replace(/_/g, " ")} rows used by this calculation.`,
      kind: evidenceKindForTable(table),
      label: evidenceLabelForTable(table),
      range,
      rows: matchingRows,
      recordIds: recordIdsForTable(table, matchingRows, snapshot),
    });
    return fitRows({
      evidenceId,
      table,
      timezone: snapshot.timezone,
      generatedAtMs: snapshot.generatedAtMs,
      requestedRange: range,
      dailySummaryCoverage: dailyCoverage
        ? {
            policy: "whole-local-days-only",
            includedLocalDates: dailyCoverage.completeLocalDates,
            omittedPartialLocalDates: dailyCoverage.partialLocalDates,
            excludedSnapshotRows:
              snapshot.tables.daily_health_metrics.length -
              boundarySafeRows.length,
          }
        : undefined,
      matchedSourceRows: matchingRows.length,
      automaticallyIncludedDetailColumns: aggregates.length
        ? []
        : returnedColumns.filter((column) => !columns.includes(column)),
      totalRows,
      returnedRows: rows.length,
      truncated: totalRows > rows.length,
      rows,
    });
  }

  private requireRange(startMs: number, endMs: number): TimeRange {
    require(Number.isSafeInteger(startMs) &&
      Number.isSafeInteger(endMs), "The query range is invalid.");
    require(startMs < endMs, "The query range must have a positive duration.");
    require(endMs - startMs <=
      MAX_RANGE_MS, "One local query cannot exceed 120 days.");
    require(startMs >= this.options.allowedRange.start &&
      endMs <=
        this.options.allowedRange
          .end, "The query range is outside the authorised TARV1S analysis window.");
    return { start: startMs, end: endMs };
  }

  private requireFilters(filters: QueryFilter[], columns: Set<string>) {
    require(Array.isArray(filters) &&
      filters.length <= 16, "filters is invalid.");
    return filters.map((filter) => {
      requireObject(filter, "filter");
      exactKeys(filter as unknown as Record<string, unknown>, [
        "column",
        "operator",
        "value",
      ]);
      requireColumn(filter.column, columns);
      require([
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "contains",
        "is_null",
        "not_null",
      ].includes(filter.operator), "A filter operator is invalid.");
      if (filter.operator === "in") {
        require(Array.isArray(filter.value) &&
          filter.value.length <= 50, "An in filter requires an array.");
      } else if (
        filter.operator !== "is_null" &&
        filter.operator !== "not_null"
      ) {
        requireScalar(filter.value, "filter value");
      }
      return filter;
    });
  }

  private requireAggregates(
    aggregates: QueryAggregate[],
    columns: Set<string>,
  ) {
    require(Array.isArray(aggregates) &&
      aggregates.length <= 12, "aggregates is invalid.");
    const aliases = new Set<string>();
    return aggregates.map((aggregate) => {
      requireObject(aggregate, "aggregate");
      exactKeys(aggregate as unknown as Record<string, unknown>, [
        "function",
        "column",
        "alias",
      ]);
      require(["count", "sum", "avg", "min", "max"].includes(
        aggregate.function,
      ), "An aggregate function is invalid.");
      require(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(
        aggregate.alias,
      ), "An aggregate alias is invalid.");
      require(!aliases.has(
        aggregate.alias,
      ), "Aggregate aliases must be unique.");
      aliases.add(aggregate.alias);
      if (aggregate.function !== "count" || aggregate.column != null) {
        requireColumn(aggregate.column, columns);
      }
      return aggregate;
    });
  }

  private requireOrder(order: QueryOrder[], outputColumns: Set<string>) {
    require(Array.isArray(order) && order.length <= 4, "orderBy is invalid.");
    return order.map((entry) => {
      requireObject(entry, "orderBy entry");
      exactKeys(entry as unknown as Record<string, unknown>, [
        "column",
        "direction",
      ]);
      requireColumn(entry.column, outputColumns);
      require(entry.direction === "asc" ||
        entry.direction === "desc", "An order direction is invalid.");
      return entry;
    });
  }

  private snapshot(range: TimeRange) {
    const key = `${range.start}:${range.end}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const created = this.snapshotBuilder(
      range,
      this.options.loadTimelineData,
      this.now(),
    );
    this.cache.set(key, created);
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return created;
  }

  private timeline(range: TimeRange) {
    const key = `${range.start}:${range.end}`;
    const existing = this.timelineCache.get(key);
    if (existing) return existing;
    const created = this.options.loadTimelineData(range);
    this.timelineCache.set(key, created);
    if (this.timelineCache.size > MAX_CACHE_ENTRIES) {
      this.timelineCache.delete(
        this.timelineCache.keys().next().value as string,
      );
    }
    return created;
  }
}

function parseObject(json: string): Record<string, unknown> {
  require(json.length <= 64_000, "Tool arguments are too large.");
  const parsed: unknown = JSON.parse(json);
  requireObject(parsed, "tool arguments");
  return parsed;
}

function requireShortString(value: unknown, label: string, maximum: number) {
  require(typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum, `${label} is invalid.`);
  return value;
}

const DAILY_HEALTH_METRICS: DailyHealthMetric[] = [
  "steps",
  "distance_kilometres",
  "elevation_gained_metres",
  "floors_climbed",
  "active_calories_kcal",
  "total_calories_kcal",
  "average_workout_power_watts",
  "maximum_workout_power_watts",
  "average_workout_speed_km_per_hour",
  "maximum_workout_speed_km_per_hour",
  "average_walking_cadence_per_minute",
  "average_cycling_cadence_rpm",
  "average_heart_rate_bpm",
  "resting_heart_rate_bpm",
  "minimum_heart_rate_bpm",
  "maximum_heart_rate_bpm",
  "weight_kilograms",
  "body_fat_percent",
  "lean_body_mass_kilograms",
  "body_water_mass_kilograms",
  "bone_mass_kilograms",
  "height_centimetres",
  "basal_metabolic_rate_kcal_per_day",
  "health_connect_glucose_mmol_l",
  "blood_pressure_systolic_mmhg",
  "blood_pressure_diastolic_mmhg",
  "oxygen_saturation_percent",
  "respiratory_rate_per_minute",
  "heart_rate_variability_rmssd_ms",
  "vo2_max_ml_per_kg_min",
  "body_temperature_celsius",
  "hydration_litres",
  "sleep_minutes",
];

function requireDailyHealthMetric(value: unknown): DailyHealthMetric {
  require(typeof value === "string" &&
    DAILY_HEALTH_METRICS.includes(
      value as DailyHealthMetric,
    ), "The daily health metric is invalid.");
  return value as DailyHealthMetric;
}

const WORKOUT_KINDS: WorkoutKind[] = [
  "any",
  "walk",
  "run",
  "cycle",
  "strength",
  "other",
];

function requireWorkoutKind(value: unknown): WorkoutKind {
  require(typeof value === "string" &&
    WORKOUT_KINDS.includes(
      value as WorkoutKind,
    ), "The workout kind is invalid.");
  return value as WorkoutKind;
}

const WORKOUT_SOURCES: WorkoutSource[] = [
  "any",
  "hevy",
  "health_connect",
  "strava",
];

function requireWorkoutSource(value: unknown): WorkoutSource {
  require(typeof value === "string" &&
    WORKOUT_SOURCES.includes(
      value as WorkoutSource,
    ), "The workout source is invalid.");
  return value as WorkoutSource;
}

function explicitWorkoutKind(
  question?: string,
): Exclude<WorkoutKind, "any"> | undefined {
  if (!question) return undefined;
  if (
    /\b(?:strength|weightlifting|weights?|lifting|resistance)\b/i.test(question)
  ) {
    return "strength";
  }
  if (/\b(?:walk|walking|hike|hiking)\b/i.test(question)) return "walk";
  if (/\b(?:run|running|jog|jogging)\b/i.test(question)) return "run";
  if (/\b(?:cycle|cycling|bike|biking)\b/i.test(question)) return "cycle";
  return undefined;
}

function explicitWorkoutSource(
  question?: string,
): Exclude<WorkoutSource, "any"> | undefined {
  if (!question) return undefined;
  if (/\bhevy\b/i.test(question)) return "hevy";
  if (/\bstrava\b/i.test(question)) return "strava";
  if (/\b(?:samsung health|health connect)\b/i.test(question))
    return "health_connect";
  return undefined;
}

function isAmbiguousGymWorkoutQuestion(
  question: string | undefined,
  explicitKind: Exclude<WorkoutKind, "any"> | undefined,
  explicitSource: Exclude<WorkoutSource, "any"> | undefined,
) {
  if (!question || explicitKind || explicitSource) return false;
  return /\bgym\b/i.test(question) || /\bexercises?\b/i.test(question);
}

function workoutMatchesSource(
  event: Extract<TimelineData["context"][number], { kind: "activity" }>,
  source: WorkoutSource,
) {
  if (source === "any") return true;
  if (source === "hevy") {
    return (
      event.strengthWorkout?.provider === "hevy" || event.sourceId === "hevy"
    );
  }
  if (source === "strava") {
    return /strava/i.test(`${event.sourceId} ${event.sourceLabel ?? ""}`);
  }
  return (
    event.sourceId === "health-connect" ||
    event.sourceId.startsWith("health-connect:")
  );
}

function representativeWorkoutCandidates(
  activities: Extract<TimelineData["context"][number], { kind: "activity" }>[],
) {
  const candidates: typeof activities = [];
  const add = (event: (typeof activities)[number] | undefined) => {
    if (event && !candidates.some(({ id }) => id === event.id))
      candidates.push(event);
  };
  add(activities[0]);
  for (const kind of ["walk", "run", "cycle", "strength", "other"] as const) {
    add(activities.find((event) => event.activityType === kind));
  }
  add(activities.find((event) => event.strengthWorkout?.provider === "hevy"));
  return candidates.sort((left, right) => right.start - left.start).slice(0, 8);
}

function workoutSummary(
  event: Extract<TimelineData["context"][number], { kind: "activity" }>,
) {
  return {
    id: event.id,
    title: event.title,
    activityType: event.activityType,
    durationMinutes: event.durationMinutes,
    intensity: event.intensity,
    caloriesBurned: event.caloriesBurned ?? null,
    startMs: event.start,
    startLocalDate: toDateKey(event.start),
    startLocalTime: formatTime(event.start),
    endMs: event.end ?? null,
    endLocalDate: event.end === undefined ? null : toDateKey(event.end),
    endLocalTime: event.end === undefined ? null : formatTime(event.end),
    sourceId: event.sourceId,
    sourceLabel: event.sourceLabel ?? null,
    origin: event.origin,
    exercises: (event.strengthWorkout?.exercises ?? []).map((exercise) => ({
      title: exercise.title,
      notes: exercise.notes ?? null,
      setCount: exercise.sets.length,
      sets: exercise.sets.map((set) => ({
        setNumber: set.index + 1,
        type: set.type,
        weightKilograms: set.weightKilograms ?? null,
        reps: set.reps ?? null,
        distanceMetres: set.distanceMetres ?? null,
        durationSeconds: set.durationSeconds ?? null,
        rpe: set.rpe ?? null,
        customMetric: set.customMetric ?? null,
      })),
    })),
  };
}

function dailyHealthMetricValue(
  day: HealthTrendDay,
  metric: DailyHealthMetric,
) {
  switch (metric) {
    case "steps":
      return day.metrics.steps;
    case "distance_kilometres":
      return day.metrics.distanceKilometres;
    case "elevation_gained_metres":
      return day.metrics.elevationGainedMetres;
    case "floors_climbed":
      return day.metrics.floorsClimbed;
    case "active_calories_kcal":
      return day.metrics.activeCaloriesKcal;
    case "total_calories_kcal":
      return day.metrics.totalCaloriesKcal;
    case "average_workout_power_watts":
      return day.metrics.averageWorkoutPowerWatts;
    case "maximum_workout_power_watts":
      return day.metrics.maximumWorkoutPowerWatts;
    case "average_workout_speed_km_per_hour":
      return day.metrics.averageWorkoutSpeedMetresPerSecond === undefined
        ? undefined
        : day.metrics.averageWorkoutSpeedMetresPerSecond * 3.6;
    case "maximum_workout_speed_km_per_hour":
      return day.metrics.maximumWorkoutSpeedMetresPerSecond === undefined
        ? undefined
        : day.metrics.maximumWorkoutSpeedMetresPerSecond * 3.6;
    case "average_walking_cadence_per_minute":
      return day.metrics.averageWalkingCadencePerMinute;
    case "average_cycling_cadence_rpm":
      return day.metrics.averageCyclingCadenceRpm;
    case "average_heart_rate_bpm":
      return day.metrics.averageHeartRateBpm;
    case "resting_heart_rate_bpm":
      return day.metrics.restingHeartRateBpm;
    case "minimum_heart_rate_bpm":
      return day.metrics.minimumHeartRateBpm;
    case "maximum_heart_rate_bpm":
      return day.metrics.maximumHeartRateBpm;
    case "weight_kilograms":
      return day.metrics.weightKilograms;
    case "body_fat_percent":
      return day.metrics.bodyFatPercent;
    case "lean_body_mass_kilograms":
      return day.metrics.leanBodyMassKilograms;
    case "body_water_mass_kilograms":
      return day.metrics.bodyWaterMassKilograms;
    case "bone_mass_kilograms":
      return day.metrics.boneMassKilograms;
    case "height_centimetres":
      return day.metrics.heightMetres === undefined
        ? undefined
        : day.metrics.heightMetres * 100;
    case "basal_metabolic_rate_kcal_per_day":
      return day.metrics.basalMetabolicRateKcalPerDay;
    case "health_connect_glucose_mmol_l":
      return day.metrics.bloodGlucoseMmolL;
    case "blood_pressure_systolic_mmhg":
      return day.metrics.bloodPressureSystolic;
    case "blood_pressure_diastolic_mmhg":
      return day.metrics.bloodPressureDiastolic;
    case "oxygen_saturation_percent":
      return day.metrics.oxygenSaturationPercent;
    case "respiratory_rate_per_minute":
      return day.metrics.respiratoryRatePerMinute;
    case "heart_rate_variability_rmssd_ms":
      return day.metrics.heartRateVariabilityRmssdMs;
    case "vo2_max_ml_per_kg_min":
      return day.metrics.vo2MaxMillilitresPerKilogramMinute;
    case "body_temperature_celsius":
      return day.metrics.bodyTemperatureCelsius;
    case "hydration_litres":
      return day.metrics.hydrationLitres;
    case "sleep_minutes":
      return day.sleepMinutes;
  }
}

function healthRecordKindsForMetric(metric: DailyHealthMetric) {
  switch (metric) {
    case "steps":
      return ["steps"];
    case "distance_kilometres":
      return ["distance"];
    case "elevation_gained_metres":
      return ["elevation_gained"];
    case "floors_climbed":
      return ["floors_climbed"];
    case "active_calories_kcal":
      return ["active_calories"];
    case "total_calories_kcal":
      return ["total_calories"];
    case "average_workout_power_watts":
    case "maximum_workout_power_watts":
      return ["workout_power"];
    case "average_workout_speed_km_per_hour":
    case "maximum_workout_speed_km_per_hour":
      return ["workout_speed"];
    case "average_walking_cadence_per_minute":
      return ["walking_cadence"];
    case "average_cycling_cadence_rpm":
      return ["cycling_cadence"];
    case "average_heart_rate_bpm":
      return ["heart_rate"];
    case "resting_heart_rate_bpm":
      return ["resting_heart_rate"];
    case "minimum_heart_rate_bpm":
    case "maximum_heart_rate_bpm":
      return ["heart_rate"];
    case "weight_kilograms":
      return ["weight"];
    case "body_fat_percent":
      return ["body_fat"];
    case "lean_body_mass_kilograms":
      return ["lean_body_mass"];
    case "body_water_mass_kilograms":
      return ["body_water_mass"];
    case "bone_mass_kilograms":
      return ["bone_mass"];
    case "height_centimetres":
      return ["height"];
    case "basal_metabolic_rate_kcal_per_day":
      return ["basal_metabolic_rate"];
    case "health_connect_glucose_mmol_l":
      return ["blood_glucose"];
    case "blood_pressure_systolic_mmhg":
      return ["blood_pressure_systolic"];
    case "blood_pressure_diastolic_mmhg":
      return ["blood_pressure_diastolic"];
    case "oxygen_saturation_percent":
      return ["oxygen_saturation"];
    case "respiratory_rate_per_minute":
      return ["respiratory_rate"];
    case "heart_rate_variability_rmssd_ms":
      return ["heart_rate_variability_rmssd"];
    case "vo2_max_ml_per_kg_min":
      return ["vo2_max"];
    case "body_temperature_celsius":
      return ["body_temperature"];
    case "hydration_litres":
      return ["hydration"];
    case "sleep_minutes":
      return [];
  }
}

function dailyHealthMetricLabel(metric: DailyHealthMetric) {
  const labels: Record<DailyHealthMetric, string> = {
    steps: "Step count",
    distance_kilometres: "Distance",
    elevation_gained_metres: "Elevation gained",
    floors_climbed: "Floors climbed",
    active_calories_kcal: "Active calories",
    total_calories_kcal: "Total calories",
    average_workout_power_watts: "Average workout power",
    maximum_workout_power_watts: "Maximum workout power",
    average_workout_speed_km_per_hour: "Average workout speed",
    maximum_workout_speed_km_per_hour: "Maximum workout speed",
    average_walking_cadence_per_minute: "Average walking cadence",
    average_cycling_cadence_rpm: "Average cycling cadence",
    average_heart_rate_bpm: "Heart rate",
    resting_heart_rate_bpm: "Resting heart rate",
    minimum_heart_rate_bpm: "Minimum heart rate",
    maximum_heart_rate_bpm: "Maximum heart rate",
    weight_kilograms: "Weight",
    body_fat_percent: "Body fat",
    lean_body_mass_kilograms: "Lean body mass",
    body_water_mass_kilograms: "Body water mass",
    bone_mass_kilograms: "Bone mass",
    height_centimetres: "Height",
    basal_metabolic_rate_kcal_per_day: "Basal metabolic rate",
    health_connect_glucose_mmol_l: "Health Connect blood glucose",
    blood_pressure_systolic_mmhg: "Systolic blood pressure",
    blood_pressure_diastolic_mmhg: "Diastolic blood pressure",
    oxygen_saturation_percent: "Oxygen saturation",
    respiratory_rate_per_minute: "Respiratory rate",
    heart_rate_variability_rmssd_ms: "Heart-rate variability",
    vo2_max_ml_per_kg_min: "VO₂ max",
    body_temperature_celsius: "Body temperature",
    hydration_litres: "Hydration",
    sleep_minutes: "Sleep",
  };
  return labels[metric];
}

function dailyHealthMetricUnit(metric: DailyHealthMetric) {
  const units: Record<DailyHealthMetric, string> = {
    steps: "steps",
    distance_kilometres: "km",
    elevation_gained_metres: "m",
    floors_climbed: "floors",
    active_calories_kcal: "kcal",
    total_calories_kcal: "kcal",
    average_workout_power_watts: "W",
    maximum_workout_power_watts: "W",
    average_workout_speed_km_per_hour: "km/h",
    maximum_workout_speed_km_per_hour: "km/h",
    average_walking_cadence_per_minute: "steps/min",
    average_cycling_cadence_rpm: "rpm",
    average_heart_rate_bpm: "bpm",
    resting_heart_rate_bpm: "bpm",
    minimum_heart_rate_bpm: "bpm",
    maximum_heart_rate_bpm: "bpm",
    weight_kilograms: "kg",
    body_fat_percent: "%",
    lean_body_mass_kilograms: "kg",
    body_water_mass_kilograms: "kg",
    bone_mass_kilograms: "kg",
    height_centimetres: "cm",
    basal_metabolic_rate_kcal_per_day: "kcal/day",
    health_connect_glucose_mmol_l: "mmol/L",
    blood_pressure_systolic_mmhg: "mmHg",
    blood_pressure_diastolic_mmhg: "mmHg",
    oxygen_saturation_percent: "%",
    respiratory_rate_per_minute: "breaths/min",
    heart_rate_variability_rmssd_ms: "ms",
    vo2_max_ml_per_kg_min: "ml/kg/min",
    body_temperature_celsius: "°C",
    hydration_litres: "L",
    sleep_minutes: "minutes",
  };
  return units[metric];
}

const CONTEXT_KINDS: ContextKind[] = [
  "any",
  "meal",
  "activity",
  "sleep",
  "weight",
  "medication",
  "note",
  "ketone",
];

function requireContextKind(value: unknown): ContextKind {
  require(typeof value === "string" &&
    CONTEXT_KINDS.includes(
      value as ContextKind,
    ), "The context kind is invalid.");
  return value as ContextKind;
}

function contextMatchesKind(event: HealthContextEvent, kind: ContextKind) {
  if (kind === "any") return true;
  if (kind === "ketone") {
    return (
      event.kind === "note" && Boolean(decodeManualKetoneDetail(event.detail))
    );
  }
  return event.kind === kind;
}

function contextKindLabel(kind: ContextKind) {
  const labels: Record<ContextKind, string> = {
    any: "Health context",
    meal: "Meal",
    activity: "Activity",
    sleep: "Sleep",
    weight: "Weight",
    medication: "Medication",
    note: "Note",
    ketone: "Ketone",
  };
  return labels[kind];
}

function contextEventEnd(event: HealthContextEvent) {
  if (event.end !== undefined) return event.end;
  if ("durationMinutes" in event) {
    return event.start + event.durationMinutes * 60_000;
  }
  return undefined;
}

function contextEventDisplayTitle(event: HealthContextEvent) {
  return event.kind === "note"
    ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
    : event.title;
}

function contextEvidenceRow(event: HealthContextEvent): TarvisLabRow {
  const end = contextEventEnd(event);
  return {
    id: event.id,
    kind: event.kind,
    title: contextEventDisplayTitle(event),
    start_ms: event.start,
    end_ms: end ?? null,
    source_id: event.sourceId,
    source_label: event.sourceLabel ?? null,
    local_date: toDateKey(event.start),
    local_time: formatTime(event.start),
  };
}

function contextEventSummary(event: HealthContextEvent) {
  const end = contextEventEnd(event);
  const base = {
    id: event.id,
    kind: event.kind,
    title: contextEventDisplayTitle(event),
    startMs: event.start,
    startLocalDate: toDateKey(event.start),
    startLocalTime: formatTime(event.start),
    endMs: end ?? null,
    endLocalDate: end === undefined ? null : toDateKey(end),
    endLocalTime: end === undefined ? null : formatTime(end),
    sourceId: event.sourceId,
    sourceLabel: event.sourceLabel ?? null,
    origin: event.origin,
  };
  switch (event.kind) {
    case "meal":
      return {
        ...base,
        mealType: event.mealType,
        carbsGrams: event.carbsGrams ?? null,
        energyKcal: event.energyKcal ?? null,
        proteinGrams: event.proteinGrams ?? null,
        fatGrams: event.fatGrams ?? null,
        fibreGrams: event.fibreGrams ?? null,
        sugarsGrams: event.sugarsGrams ?? null,
        saturatedFatGrams: event.saturatedFatGrams ?? null,
        nutritionDetail: event.nutritionDetail ?? null,
        items: (event.items ?? []).slice(0, 30).map((item) => ({
          name: item.name,
          brand: item.brand ?? null,
          amount: item.amount,
          unit: item.unit,
          carbohydrateGrams: item.carbohydrateGrams ?? null,
          energyKcal: item.energyKcal ?? null,
          proteinGrams: item.proteinGrams ?? null,
          fatGrams: item.fatGrams ?? null,
          fibreGrams: item.fibreGrams ?? null,
          sugarsGrams: item.sugarsGrams ?? null,
          saturatedFatGrams: item.saturatedFatGrams ?? null,
          sourceLabel: item.sourceLabel ?? null,
        })),
        itemsTruncated: (event.items?.length ?? 0) > 30,
      };
    case "activity":
      return workoutSummary(event);
    case "sleep":
      return {
        ...base,
        durationMinutes: event.durationMinutes,
        qualityPercent: event.qualityPercent ?? null,
      };
    case "weight":
      return { ...base, kilograms: event.kilograms };
    case "medication":
      return {
        ...base,
        amount: event.amount ?? null,
        unit: event.unit ?? null,
        medicationType: event.medicationType ?? null,
      };
    case "note": {
      const ketone = decodeManualKetoneDetail(event.detail);
      return {
        ...base,
        glucoseMmolL: event.glucoseMmolL ?? null,
        category: event.category,
        detail: ketone ? null : (event.detail ?? null),
        ketone:
          ketone?.ketoneType === "blood"
            ? { type: "blood", value: ketone.value, unit: "mmol/L" }
            : ketone?.ketoneType === "urine"
              ? { type: "urine", value: ketone.value, unit: null }
              : null,
      };
    }
  }
}

function glucoseWindowSummary(
  readings: TimelineData["glucose"],
  range: TimeRange,
  label: string,
) {
  const inRange = readings.filter(
    (reading) =>
      reading.timestamp >= range.start && reading.timestamp < range.end,
  );
  const statistics = calculateGlucoseStatistics({
    readings: inRange,
    range,
    thresholds: {
      lowerMmolL: TARGET_LOW_MMOL_L,
      upperMmolL: TARGET_HIGH_MMOL_L,
    },
  });
  const ordered = [...inRange].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  return {
    label,
    startMs: range.start,
    endMs: range.end,
    startLocalDate: toDateKey(range.start),
    startLocalTime: formatTime(range.start),
    endLocalDate: toDateKey(Math.max(range.start, range.end - 1)),
    endLocalTime: formatTime(range.end),
    sampleCount: statistics.sampleCount,
    coveragePercent: statistics.coveragePercent,
    averageMmolL: statistics.arithmeticMeanMmolL,
    minimumMmolL: statistics.minimumMmolL,
    maximumMmolL: statistics.maximumMmolL,
    firstMmolL: ordered[0]?.mmolL ?? null,
    lastMmolL: ordered.at(-1)?.mmolL ?? null,
    observedChangeMmolL:
      ordered.length > 1 ? ordered.at(-1)!.mmolL - ordered[0]!.mmolL : null,
    timeBelowRangePercent: statistics.distribution?.belowPercent ?? null,
    timeInRangePercent: statistics.distribution?.inRangePercent ?? null,
    timeAboveRangePercent: statistics.distribution?.abovePercent ?? null,
  };
}

function limitToolNumberPrecision(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : roundNumber(value, 2);
  }
  if (Array.isArray(value)) return value.map(limitToolNumberPrecision);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        limitToolNumberPrecision(entry),
      ]),
    );
  }
  return value;
}

function finiteNumber(value: unknown, label: string) {
  require(typeof value === "number" &&
    Number.isFinite(value), `${label} is invalid.`);
  return value;
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundNumber(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function stableEvidencePart(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function recordIdsForRow(row: TarvisLabRow) {
  return ["id", "reading_id", "delivery_id", "context_event_id"].flatMap(
    (key) => (typeof row[key] === "string" ? [String(row[key])] : []),
  );
}

function recordIdsForTable(
  table: TarvisLabTableName,
  rows: TarvisLabRow[],
  snapshot: TarvisLabSnapshot,
) {
  const preferredKey: Partial<Record<TarvisLabTableName, string>> = {
    glucose_observation_intervals: "reading_id",
    basal_daily_segments: "delivery_id",
    meal_items: "context_event_id",
    strength_workouts: "context_event_id",
    strength_exercises: "context_event_id",
    strength_sets: "context_event_id",
  };
  const key = preferredKey[table];
  if (key) {
    return [
      ...new Set(
        rows.flatMap((row) =>
          typeof row[key] === "string" ? [String(row[key])] : [],
        ),
      ),
    ];
  }
  if (table !== "daily_health_metrics") {
    return [...new Set(rows.flatMap(recordIdsForRow))];
  }
  const dates = new Set(
    rows.flatMap((row) =>
      typeof row.local_date === "string" ? [row.local_date] : [],
    ),
  );
  return snapshot.tables.health_metrics.flatMap((row) =>
    dates.has(String(row.local_date)) && typeof row.id === "string"
      ? [row.id]
      : [],
  );
}

function evidenceKindForTable(table: TarvisLabTableName) {
  if (table.startsWith("glucose_")) return "glucose";
  if (
    table.includes("insulin") ||
    table.includes("bolus") ||
    table.includes("basal")
  )
    return "insulin";
  if (
    table.includes("workout") ||
    table.includes("exercise") ||
    table.includes("sets")
  )
    return "activity";
  if (table.includes("meal")) return "meal";
  if (table.includes("health")) return "health-metric";
  return table;
}

function evidenceLabelForTable(table: TarvisLabTableName) {
  const labels: Partial<Record<TarvisLabTableName, string>> = {
    glucose_readings: "Glucose readings used",
    glucose_observation_intervals: "Observed glucose time used",
    basal_deliveries: "Basal insulin records used",
    basal_daily_segments: "Basal insulin intervals used",
    bolus_deliveries: "Bolus insulin records used",
    insulin_daily_totals: "Daily insulin totals used",
    context_events: "Recorded context used",
    health_metrics: "Health records used",
    daily_health_metrics: "Daily health summaries used",
    strength_workouts: "Workout records used",
    strength_exercises: "Workout exercises used",
    strength_sets: "Workout sets used",
    meal_items: "Meal items used",
  };
  return labels[table] ?? table.replace(/_/g, " ");
}

function evidenceExample(row: TarvisLabRow, kind: string, index: number) {
  const regional = getRuntimeRegionalDefaults();
  const timestamp =
    ["timestamp_ms", "start_ms", "recorded_at_ms"]
      .map((key) => row[key])
      .find((value): value is number => typeof value === "number") ?? 0;
  const value =
    typeof row.mmol_l === "number"
      ? formatGlucose(row.mmol_l, regional)
      : typeof row.units === "number"
        ? `${formatRegionalNumber(row.units, regional.locale, { maximumFractionDigits: 2 })} U`
        : typeof row.carbs_grams === "number"
          ? `${formatRegionalNumber(row.carbs_grams, regional.locale, { maximumFractionDigits: 1 })} g carbohydrate`
          : String(row.title ?? row.kind ?? "Recorded evidence");
  return {
    id: String(row.id ?? row.context_event_id ?? `example-${index}`),
    kind:
      kind === "glucose"
        ? ("glucose" as const)
        : kind === "health-metric"
          ? ("health-metric" as const)
          : kind === "insulin"
            ? ("bolus" as const)
            : ("context" as const),
    timestamp,
    primary: value,
    secondary: String(row.local_date ?? row.local_time ?? ""),
    sourceId: String(row.source_id ?? row.source_package ?? "t1arc"),
  };
}

function cloneEvidenceReference(
  reference: EvidenceReference,
): EvidenceReference {
  return {
    ...reference,
    range: { ...reference.range },
    recordIds: [...reference.recordIds],
    examples: reference.examples.map((example) => ({ ...example })),
  };
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  const permitted = new Set(allowed);
  require(Object.keys(value).every((key) =>
    permitted.has(key),
  ), "Tool arguments contain unexpected fields.");
}

function requireObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  require(Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value), `${label} must be an object.`);
}

function requireArray(value: unknown, label: string): unknown[] {
  require(Array.isArray(value), `${label} must be an array.`);
  return value;
}

function requireTableName(value: unknown): TarvisLabTableName {
  require(typeof value === "string" &&
    TABLE_NAMES.includes(
      value as TarvisLabTableName,
    ), "The table is not available.");
  return value as TarvisLabTableName;
}

function requireDateKey(value: unknown, label: string) {
  require(isDateKey(value) &&
    toDateKey(zonedDateTimeToTimestamp(value)) ===
      value, `${label} must be a valid YYYY-MM-DD date.`);
  return value;
}

function requireColumns(
  values: unknown,
  allowed: Set<string>,
  label: string,
  maximum: number,
  emptyAllowed = false,
) {
  require(Array.isArray(values), `${label} must be an array.`);
  require(values.length <= maximum &&
    (emptyAllowed || values.length > 0), `${label} has an invalid length.`);
  const result = values.map((value) => {
    requireColumn(value, allowed);
    return value;
  });
  require(new Set(result).size ===
    result.length, `${label} contains duplicates.`);
  return result;
}

function requireColumn(
  value: unknown,
  allowed: Set<string>,
): asserts value is string {
  require(typeof value === "string" &&
    allowed.has(
      value,
    ), `The requested field ${String(value)} is not available.`);
}

function requireScalar(value: unknown, label: string): asserts value is Scalar {
  require(value === null ||
    typeof value === "string" ||
    (typeof value === "number" &&
      Number.isFinite(value)), `${label} is invalid.`);
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  require(Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum, `${label} is invalid.`);
  return Number(value);
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fail(message: string): never {
  throw new Error(message);
}

function matches(actual: Scalar, filter: QueryFilter) {
  switch (filter.operator) {
    case "is_null":
      return actual === null;
    case "not_null":
      return actual !== null;
    case "eq":
      return actual === filter.value;
    case "ne":
      return actual !== filter.value;
    case "in":
      return (filter.value as Scalar[]).includes(actual);
    case "contains":
      return (
        typeof actual === "string" &&
        typeof filter.value === "string" &&
        actual
          .toLocaleLowerCase("en-GB")
          .includes(filter.value.toLocaleLowerCase("en-GB"))
      );
    case "gt":
      return comparable(actual, filter.value) > 0;
    case "gte":
      return comparable(actual, filter.value) >= 0;
    case "lt":
      return comparable(actual, filter.value) < 0;
    case "lte":
      return comparable(actual, filter.value) <= 0;
  }
}

function comparable(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  if (typeof left === "string" && typeof right === "string")
    return left.localeCompare(right, "en-GB");
  return Number.NaN;
}

function selectColumns(row: TarvisLabRow, columns: string[]): TarvisLabRow {
  return Object.fromEntries(
    columns.map((column) => [column, row[column] ?? null]),
  );
}

function aggregateRows(
  rows: TarvisLabRow[],
  groupBy: string[],
  aggregates: QueryAggregate[],
) {
  const groups = new Map<string, TarvisLabRow[]>();
  rows.forEach((row) => {
    const key = JSON.stringify(groupBy.map((column) => row[column]));
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  });
  if (!groupBy.length && !groups.size) groups.set("[]", []);
  return [...groups.values()].map<TarvisLabRow>((group) => {
    const output: TarvisLabRow = {};
    groupBy.forEach((column) => {
      output[column] = group[0]?.[column] ?? null;
    });
    aggregates.forEach((aggregate) => {
      const values =
        aggregate.column == null
          ? []
          : group
              .map((row) => row[aggregate.column!])
              .filter(
                (value): value is string | number =>
                  value !== null && value !== undefined,
              );
      const numeric = values.filter(
        (value): value is number => typeof value === "number",
      );
      switch (aggregate.function) {
        case "count":
          output[aggregate.alias] =
            aggregate.column == null ? group.length : values.length;
          break;
        case "sum":
          output[aggregate.alias] = numeric.length
            ? numeric.reduce((sum, value) => sum + value, 0)
            : null;
          break;
        case "avg":
          output[aggregate.alias] = numeric.length
            ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length
            : null;
          break;
        case "min":
          output[aggregate.alias] = values.length
            ? values.reduce((minimum, value) =>
                comparable(value, minimum) < 0 ? value : minimum,
              )
            : null;
          break;
        case "max":
          output[aggregate.alias] = values.length
            ? values.reduce((maximum, value) =>
                comparable(value, maximum) > 0 ? value : maximum,
              )
            : null;
          break;
      }
    });
    return output;
  });
}

function compareRows(
  left: TarvisLabRow,
  right: TarvisLabRow,
  order: QueryOrder[],
) {
  for (const entry of order) {
    const leftValue = left[entry.column];
    const rightValue = right[entry.column];
    const comparison =
      leftValue === null
        ? rightValue === null
          ? 0
          : 1
        : rightValue === null
          ? -1
          : comparable(leftValue, rightValue);
    if (comparison) return entry.direction === "asc" ? comparison : -comparison;
  }
  return 0;
}

function fitRows<
  T extends { rows: TarvisLabRow[]; returnedRows: number; truncated: boolean },
>(result: T): T {
  while (
    result.rows.length &&
    JSON.stringify(result).length > MAX_RESULT_CHARACTERS
  ) {
    result.rows.pop();
    result.returnedRows = result.rows.length;
    result.truncated = true;
  }
  return result;
}

/**
 * Keeps ISO date keys intact for follow-up tool calls while giving TARV1S a
 * locale-aware field to quote in an answer. Local-time fields are already
 * produced by formatTime/formatRegionalWallClockMinute.
 */
function addRegionalDatePresentation(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(addRegionalDatePresentation);
  }
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = addRegionalDatePresentation(entry);
    if (typeof entry !== "string" || !isDateKey(entry)) continue;
    if (/(?:^date|Date)$/.test(key)) {
      result[`${key}Label`] = formatShortDate(entry);
    } else if (/(?:^date|_date)$/.test(key)) {
      result[`${key}_label`] = formatShortDate(entry);
    }
  }
  return result;
}

function boundedJson(value: unknown) {
  const encoded = JSON.stringify(value);
  return encoded.length <= MAX_RESULT_CHARACTERS
    ? encoded
    : JSON.stringify({
        ok: false,
        error: "The local tool result exceeded the safety limit.",
      });
}
