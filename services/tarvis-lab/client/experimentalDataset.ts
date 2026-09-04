// Archived Analyst Lab client contract; excluded from the app import graph.
import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
  type HealthTrendDay,
} from "@/data/healthConnect/dailyHealthMetrics";
import { decodeManualKetoneDetail } from "@/data/manualKetones";
import { contextNoteDisplayTitle } from "@/domain/contextNotes";
import type { DailyMetricRecord } from "@/domain/dailyHealthMetrics";
import {
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type HealthContextEvent,
  type TimelineData,
  type TimeRange,
} from "@/domain/models";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import {
  addDays,
  type DateKey,
  formatTime,
  toDateKey,
  zonedDateTimeToTimestamp,
} from "@/domain/time";

export type TarvisLabScalar = string | number | null;
export type TarvisLabRow = Record<string, TarvisLabScalar>;

export const TARVIS_LAB_TABLE_COLUMNS = {
  glucose_readings: [
    "id",
    "timestamp_ms",
    "received_at_ms",
    "mmol_l",
    "trend",
    "quality",
    "source_id",
    "imported_at_ms",
    "local_date",
    "local_time",
    "local_weekday",
  ],
  glucose_observation_intervals: [
    "id",
    "reading_id",
    "start_ms",
    "end_ms",
    "observed_minutes",
    "mmol_l",
    "range_band",
    "source_id",
    "local_date",
    "local_weekday",
  ],
  basal_deliveries: [
    "id",
    "start_ms",
    "end_ms",
    "rate_units_per_hour",
    "units",
    "delivery_type",
    "percentage",
    "units_estimated",
    "source_id",
    "local_start_date",
    "local_start_time",
    "local_start_weekday",
    "local_end_date",
    "local_end_time",
  ],
  basal_daily_segments: [
    "id",
    "delivery_id",
    "start_ms",
    "end_ms",
    "duration_minutes",
    "units",
    "rate_units_per_hour",
    "source_id",
    "local_date",
    "local_weekday",
  ],
  bolus_deliveries: [
    "id",
    "timestamp_ms",
    "units",
    "delivery_type",
    "blood_glucose_input_mmol_l",
    "carbs_input_grams",
    "carb_ratio_grams_per_unit",
    "initial_units",
    "extended_units",
    "source_id",
    "local_date",
    "local_time",
    "local_weekday",
  ],
  insulin_daily_totals: [
    "id",
    "timestamp_ms",
    "date_key",
    "basal_units",
    "bolus_units",
    "total_units",
    "source_id",
    "local_weekday",
  ],
  pump_states: [
    "id",
    "start_ms",
    "end_ms",
    "kind",
    "source_id",
    "local_start_date",
    "local_start_time",
    "local_start_weekday",
    "local_end_date",
    "local_end_time",
  ],
  context_events: [
    "id",
    "kind",
    "start_ms",
    "end_ms",
    "title",
    "source_id",
    "source_label",
    "origin",
    "recorded_at_ms",
    "local_date",
    "local_time",
    "local_weekday",
    "meal_type",
    "carbs_grams",
    "energy_kcal",
    "protein_grams",
    "fat_grams",
    "fibre_grams",
    "sugars_grams",
    "saturated_fat_grams",
    "serving_quantity",
    "serving_count",
    "nutrition_detail",
    "activity_type",
    "duration_minutes",
    "intensity",
    "calories_burned",
    "quality_percent",
    "weight_kilograms",
    "medication_amount",
    "medication_unit",
    "medication_type",
    "note_category",
    "note_detail",
    "glucose_mmol_l",
    "ketone_type",
    "ketone_value_numeric",
    "ketone_value_text",
    "ketone_unit",
  ],
  meal_items: [
    "id",
    "context_event_id",
    "name",
    "brand",
    "amount",
    "unit",
    "carbohydrate_grams",
    "energy_kcal",
    "protein_grams",
    "fat_grams",
    "fibre_grams",
    "sugars_grams",
    "saturated_fat_grams",
    "source_label",
  ],
  strength_workouts: [
    "workout_id",
    "context_event_id",
    "title",
    "description",
    "start_ms",
    "end_ms",
    "source_id",
    "source_label",
    "local_date",
    "local_time",
    "local_weekday",
  ],
  strength_exercises: [
    "workout_id",
    "context_event_id",
    "exercise_index",
    "title",
    "notes",
    "exercise_template_id",
    "superset_id",
  ],
  strength_sets: [
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
    "custom_metric",
  ],
  health_metrics: [
    "id",
    "measurement_id",
    "kind",
    "source_package",
    "source_label",
    "start_ms",
    "end_ms",
    "value",
    "unit",
    "meal_type_code",
    "relation_to_meal_code",
    "specimen_source_code",
    "local_date",
    "local_time",
    "local_weekday",
  ],
  daily_health_metrics: [
    "local_date",
    "local_weekday",
    "steps",
    "distance_kilometres",
    "elevation_gained_metres",
    "floors_climbed",
    "active_calories_kcal",
    "total_calories_kcal",
    "average_workout_power_watts",
    "maximum_workout_power_watts",
    "average_workout_speed_metres_per_second",
    "maximum_workout_speed_metres_per_second",
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
    "height_metres",
    "basal_metabolic_rate_kcal_per_day",
    "health_connect_glucose_mmol_l",
    "blood_pressure_systolic",
    "blood_pressure_diastolic",
    "oxygen_saturation_percent",
    "respiratory_rate_per_minute",
    "heart_rate_variability_rmssd_ms",
    "vo2_max_ml_per_kg_min",
    "body_temperature_celsius",
    "hydration_litres",
    "sleep_minutes",
    "workout_minutes",
    "meal_count",
    "meal_carbs_grams",
    "meal_energy_kcal",
    "meal_protein_grams",
    "meal_fat_grams",
    "meal_fibre_grams",
    "meal_sugars_grams",
    "meal_saturated_fat_grams",
    "nutrition_source_labels_json",
    "nutrition_possible_duplicate_pairs",
    "medication_count",
    "hormone_record_count",
    "record_count",
    "source_labels_json",
    "needs_source_json",
  ],
  source_statuses: [
    "id",
    "label",
    "freshness",
    "origin",
    "last_updated_at_ms",
    "data_through_ms",
    "record_count",
    "is_live",
    "capabilities_json",
  ],
} as const;

export type TarvisLabTableName = keyof typeof TARVIS_LAB_TABLE_COLUMNS;

export interface TarvisLabSnapshot {
  schemaVersion: 1;
  timezone: string;
  generatedAtMs: number;
  range: { startMs: number; endMs: number };
  tables: Record<TarvisLabTableName, TarvisLabRow[]>;
}

export interface TarvisLocalDayCoverage {
  touchedLocalDates: DateKey[];
  completeLocalDates: DateKey[];
  partialLocalDates: DateKey[];
}

interface SnapshotInputs {
  generatedAtMs: number;
  healthMetricRecords: DailyMetricRecord[];
  healthTrend: HealthTrendDay[];
  range: TimeRange;
  timeline: TimelineData;
}

/**
 * Describes the local calendar days touched by an exact evidence range.
 * Day-level roll-ups are safe only for completeLocalDates: unlike timestamped
 * source rows, a roll-up cannot be clipped without changing its meaning.
 */
export function getTarvisLocalDayCoverage(
  range: TimeRange,
  timeZone = getRuntimeRegionalDefaults().timeZone,
): TarvisLocalDayCoverage {
  if (range.end <= range.start) {
    return {
      touchedLocalDates: [],
      completeLocalDates: [],
      partialLocalDates: [],
    };
  }
  const touchedLocalDates: DateKey[] = [];
  const completeLocalDates: DateKey[] = [];
  const partialLocalDates: DateKey[] = [];
  let date = toDateKey(range.start, timeZone);
  const lastDate = toDateKey(range.end - 1, timeZone);
  while (date <= lastDate) {
    touchedLocalDates.push(date);
    const dayStart = zonedDateTimeToTimestamp(date, 0, 0, 0, timeZone);
    const dayEnd = zonedDateTimeToTimestamp(
      addDays(date, 1),
      0,
      0,
      0,
      timeZone,
    );
    if (range.start <= dayStart && range.end >= dayEnd) {
      completeLocalDates.push(date);
    } else {
      partialLocalDates.push(date);
    }
    date = addDays(date, 1);
  }
  return { touchedLocalDates, completeLocalDates, partialLocalDates };
}

function formatLocalWeekday(timestamp: number) {
  const regional = getRuntimeRegionalDefaults();
  return new Intl.DateTimeFormat(regional.locale, {
    timeZone: regional.timeZone,
    weekday: "long",
  }).format(timestamp);
}

function optionalNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: string | undefined): string | null {
  return value?.trim() || null;
}

function localFields(timestamp: number) {
  return {
    date: toDateKey(timestamp),
    time: formatTime(timestamp),
    weekday: formatLocalWeekday(timestamp),
  };
}

function intervalSegments(start: number, end: number) {
  const segments: { start: number; end: number; date: string }[] = [];
  let cursor = start;
  while (cursor < end) {
    const date = toDateKey(cursor);
    const nextMidnight = zonedDateTimeToTimestamp(addDays(date, 1));
    const segmentEnd = Math.min(end, nextMidnight);
    if (segmentEnd <= cursor) break;
    segments.push({ start: cursor, end: segmentEnd, date });
    cursor = segmentEnd;
  }
  return segments;
}

function glucoseTables(timeline: TimelineData, range: TimeRange) {
  const readings = [...timeline.glucose].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const glucose_readings = readings.map<TarvisLabRow>((reading) => {
    const local = localFields(reading.timestamp);
    return {
      id: reading.id,
      timestamp_ms: reading.timestamp,
      received_at_ms: reading.receivedAt,
      mmol_l: reading.mmolL,
      trend: reading.trend,
      quality: reading.quality,
      source_id: reading.sourceId,
      imported_at_ms: optionalNumber(reading.importedAt),
      local_date: local.date,
      local_time: local.time,
      local_weekday: local.weekday,
    };
  });
  const glucose_observation_intervals: TarvisLabRow[] = [];
  readings.forEach((reading, index) => {
    const next = readings[index + 1];
    const naturalEnd = Math.min(
      range.end,
      reading.timestamp + 12 * 60_000,
      next && next.timestamp > reading.timestamp
        ? next.timestamp
        : Number.POSITIVE_INFINITY,
    );
    if (naturalEnd <= reading.timestamp) return;
    for (const segment of intervalSegments(reading.timestamp, naturalEnd)) {
      glucose_observation_intervals.push({
        id: `${reading.id}:${segment.start}`,
        reading_id: reading.id,
        start_ms: segment.start,
        end_ms: segment.end,
        observed_minutes: (segment.end - segment.start) / 60_000,
        mmol_l: reading.mmolL,
        range_band:
          reading.mmolL < TARGET_LOW_MMOL_L
            ? "low"
            : reading.mmolL > TARGET_HIGH_MMOL_L
              ? "high"
              : "in_range",
        source_id: reading.sourceId,
        local_date: segment.date,
        local_weekday: formatLocalWeekday(segment.start),
      });
    }
  });
  return { glucose_observation_intervals, glucose_readings };
}

function insulinTables(timeline: TimelineData, range: TimeRange) {
  const clippedBasal = timeline.basal.flatMap((delivery) => {
    const start = Math.max(delivery.start, range.start);
    const end = Math.min(delivery.end, range.end);
    if (end <= start) return [];
    const originalDuration = Math.max(1, delivery.end - delivery.start);
    const clipped = start !== delivery.start || end !== delivery.end;
    return [
      {
        delivery,
        start,
        end,
        units: delivery.units * ((end - start) / originalDuration),
        unitsEstimated: delivery.unitsEstimated || clipped,
      },
    ];
  });
  const basal_deliveries = clippedBasal.map<TarvisLabRow>((entry) => {
    const { delivery } = entry;
    const start = localFields(entry.start);
    const end = localFields(entry.end);
    return {
      id: delivery.id,
      start_ms: entry.start,
      end_ms: entry.end,
      rate_units_per_hour: delivery.rateUnitsPerHour,
      units: entry.units,
      delivery_type: optionalString(delivery.deliveryType),
      percentage: optionalNumber(delivery.percentage),
      units_estimated: entry.unitsEstimated ? 1 : 0,
      source_id: delivery.sourceId,
      local_start_date: start.date,
      local_start_time: start.time,
      local_start_weekday: start.weekday,
      local_end_date: end.date,
      local_end_time: end.time,
    };
  });
  const basal_daily_segments: TarvisLabRow[] = [];
  clippedBasal.forEach((entry) => {
    const { delivery } = entry;
    const totalDuration = Math.max(1, entry.end - entry.start);
    for (const segment of intervalSegments(entry.start, entry.end)) {
      const fraction = (segment.end - segment.start) / totalDuration;
      basal_daily_segments.push({
        id: `${delivery.id}:${segment.start}`,
        delivery_id: delivery.id,
        start_ms: segment.start,
        end_ms: segment.end,
        duration_minutes: (segment.end - segment.start) / 60_000,
        units: entry.units * fraction,
        rate_units_per_hour: delivery.rateUnitsPerHour,
        source_id: delivery.sourceId,
        local_date: segment.date,
        local_weekday: formatLocalWeekday(segment.start),
      });
    }
  });
  const bolus_deliveries = timeline.boluses.map<TarvisLabRow>((delivery) => {
    const local = localFields(delivery.timestamp);
    return {
      id: delivery.id,
      timestamp_ms: delivery.timestamp,
      units: delivery.units,
      delivery_type: optionalString(delivery.deliveryType),
      blood_glucose_input_mmol_l: optionalNumber(
        delivery.bloodGlucoseInputMmolL,
      ),
      carbs_input_grams: optionalNumber(delivery.carbsInputGrams),
      carb_ratio_grams_per_unit: optionalNumber(
        delivery.carbRatioGramsPerUnit,
      ),
      initial_units: optionalNumber(delivery.initialUnits),
      extended_units: optionalNumber(delivery.extendedUnits),
      source_id: delivery.sourceId,
      local_date: local.date,
      local_time: local.time,
      local_weekday: local.weekday,
    };
  });
  const insulin_daily_totals = (timeline.dailyInsulinTotals ?? []).map<TarvisLabRow>(
    (total) => ({
      id: total.id,
      timestamp_ms: total.timestamp,
      date_key: total.dateKey,
      basal_units: optionalNumber(total.basalUnits),
      bolus_units: optionalNumber(total.bolusUnits),
      total_units: total.totalUnits,
      source_id: total.sourceId,
      local_weekday: formatLocalWeekday(total.timestamp),
    }),
  );
  const pump_states = (timeline.pumpStates ?? []).map<TarvisLabRow>((state) => {
    const start = localFields(state.start);
    const end = localFields(state.end);
    return {
      id: state.id,
      start_ms: state.start,
      end_ms: state.end,
      kind: state.kind,
      source_id: state.sourceId,
      local_start_date: start.date,
      local_start_time: start.time,
      local_start_weekday: start.weekday,
      local_end_date: end.date,
      local_end_time: end.time,
    };
  });
  return {
    basal_daily_segments,
    basal_deliveries,
    bolus_deliveries,
    insulin_daily_totals,
    pump_states,
  };
}

function contextRow(event: HealthContextEvent): TarvisLabRow {
  const local = localFields(event.start);
  const ketone = event.kind === "note" ? decodeManualKetoneDetail(event.detail) : undefined;
  return {
    id: event.id,
    kind: event.kind,
    start_ms: event.start,
    end_ms: optionalNumber(event.end),
    title:
      event.kind === "note"
        ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
        : event.title,
    source_id: event.sourceId,
    source_label: optionalString(event.sourceLabel),
    origin: event.origin,
    recorded_at_ms: optionalNumber(event.recordedAt),
    local_date: local.date,
    local_time: local.time,
    local_weekday: local.weekday,
    meal_type: event.kind === "meal" ? event.mealType : null,
    carbs_grams: event.kind === "meal" ? optionalNumber(event.carbsGrams) : null,
    energy_kcal: event.kind === "meal" ? optionalNumber(event.energyKcal) : null,
    protein_grams:
      event.kind === "meal" ? optionalNumber(event.proteinGrams) : null,
    fat_grams: event.kind === "meal" ? optionalNumber(event.fatGrams) : null,
    fibre_grams:
      event.kind === "meal" ? optionalNumber(event.fibreGrams) : null,
    sugars_grams:
      event.kind === "meal" ? optionalNumber(event.sugarsGrams) : null,
    saturated_fat_grams:
      event.kind === "meal" ? optionalNumber(event.saturatedFatGrams) : null,
    serving_quantity:
      event.kind === "meal" ? optionalNumber(event.servingQuantity) : null,
    serving_count:
      event.kind === "meal" ? optionalNumber(event.servingCount) : null,
    nutrition_detail: event.kind === "meal" ? optionalString(event.nutritionDetail) : null,
    activity_type: event.kind === "activity" ? event.activityType : null,
    duration_minutes:
      event.kind === "activity" || event.kind === "sleep"
        ? event.durationMinutes
        : null,
    intensity: event.kind === "activity" ? event.intensity : null,
    calories_burned:
      event.kind === "activity" ? optionalNumber(event.caloriesBurned) : null,
    quality_percent:
      event.kind === "sleep" ? optionalNumber(event.qualityPercent) : null,
    weight_kilograms: event.kind === "weight" ? event.kilograms : null,
    medication_amount:
      event.kind === "medication" ? optionalNumber(event.amount) : null,
    medication_unit:
      event.kind === "medication" ? optionalString(event.unit) : null,
    medication_type:
      event.kind === "medication" ? optionalString(event.medicationType) : null,
    note_category: event.kind === "note" ? event.category : null,
    note_detail:
      event.kind === "note" && !ketone ? optionalString(event.detail) : null,
    glucose_mmol_l:
      event.kind === "note" ? optionalNumber(event.glucoseMmolL) : null,
    ketone_type: ketone?.ketoneType ?? null,
    ketone_value_numeric:
      ketone?.ketoneType === "blood" ? ketone.value : null,
    ketone_value_text:
      ketone?.ketoneType === "urine" ? ketone.value : null,
    ketone_unit: ketone?.ketoneType === "blood" ? "mmol/L" : null,
  };
}

function contextTables(events: HealthContextEvent[]) {
  const context_events = events.map(contextRow);
  const meal_items: TarvisLabRow[] = [];
  const strength_workouts: TarvisLabRow[] = [];
  const strength_exercises: TarvisLabRow[] = [];
  const strength_sets: TarvisLabRow[] = [];
  events.forEach((event) => {
    if (event.kind === "meal") {
      event.items?.forEach((item) => {
        meal_items.push({
          id: item.id,
          context_event_id: event.id,
          name: item.name,
          brand: optionalString(item.brand),
          amount: item.amount,
          unit: item.unit,
          carbohydrate_grams: optionalNumber(item.carbohydrateGrams),
          energy_kcal: optionalNumber(item.energyKcal),
          protein_grams: optionalNumber(item.proteinGrams),
          fat_grams: optionalNumber(item.fatGrams),
          fibre_grams: optionalNumber(item.fibreGrams),
          sugars_grams: optionalNumber(item.sugarsGrams),
          saturated_fat_grams: optionalNumber(item.saturatedFatGrams),
          source_label: optionalString(item.sourceLabel),
        });
      });
    }
    if (event.kind !== "activity" || !event.strengthWorkout) return;
    const workout = event.strengthWorkout;
    const local = localFields(event.start);
    strength_workouts.push({
      workout_id: workout.workoutId,
      context_event_id: event.id,
      title: event.title,
      description: optionalString(workout.description),
      start_ms: event.start,
      end_ms: optionalNumber(event.end),
      source_id: event.sourceId,
      source_label: optionalString(event.sourceLabel),
      local_date: local.date,
      local_time: local.time,
      local_weekday: local.weekday,
    });
    workout.exercises.forEach((exercise) => {
      strength_exercises.push({
        workout_id: workout.workoutId,
        context_event_id: event.id,
        exercise_index: exercise.index,
        title: exercise.title,
        notes: optionalString(exercise.notes),
        exercise_template_id: optionalString(exercise.exerciseTemplateId),
        superset_id: optionalNumber(exercise.supersetId),
      });
      exercise.sets.forEach((set) => {
        strength_sets.push({
          workout_id: workout.workoutId,
          context_event_id: event.id,
          exercise_index: exercise.index,
          set_index: set.index,
          set_type: set.type,
          weight_kilograms: optionalNumber(set.weightKilograms),
          reps: optionalNumber(set.reps),
          distance_metres: optionalNumber(set.distanceMetres),
          duration_seconds: optionalNumber(set.durationSeconds),
          rpe: optionalNumber(set.rpe),
          custom_metric: optionalNumber(set.customMetric),
        });
      });
    });
  });
  return {
    context_events,
    meal_items,
    strength_exercises,
    strength_sets,
    strength_workouts,
  };
}

function healthMetricRows(records: DailyMetricRecord[]) {
  return records.map<TarvisLabRow>((record) => {
    const local = localFields(record.start);
    return {
      id: record.id,
      measurement_id: optionalString(record.measurementId),
      kind: record.kind,
      source_package: record.sourcePackage,
      source_label: record.sourceLabel,
      start_ms: record.start,
      end_ms: record.end,
      value: record.value,
      unit: record.unit,
      meal_type_code: optionalNumber(record.mealType),
      relation_to_meal_code: optionalNumber(record.relationToMeal),
      specimen_source_code: optionalNumber(record.specimenSource),
      local_date: local.date,
      local_time: local.time,
      local_weekday: local.weekday,
    };
  });
}

function dailyHealthRows(days: HealthTrendDay[]) {
  return days.map<TarvisLabRow>((day) => ({
    local_date: day.date,
    local_weekday: formatLocalWeekday(
      zonedDateTimeToTimestamp(day.date, 12),
    ),
    steps: optionalNumber(day.metrics.steps),
    distance_kilometres: optionalNumber(day.metrics.distanceKilometres),
    elevation_gained_metres: optionalNumber(day.metrics.elevationGainedMetres),
    floors_climbed: optionalNumber(day.metrics.floorsClimbed),
    active_calories_kcal: optionalNumber(day.metrics.activeCaloriesKcal),
    total_calories_kcal: optionalNumber(day.metrics.totalCaloriesKcal),
    average_workout_power_watts: optionalNumber(
      day.metrics.averageWorkoutPowerWatts,
    ),
    maximum_workout_power_watts: optionalNumber(
      day.metrics.maximumWorkoutPowerWatts,
    ),
    average_workout_speed_metres_per_second: optionalNumber(
      day.metrics.averageWorkoutSpeedMetresPerSecond,
    ),
    maximum_workout_speed_metres_per_second: optionalNumber(
      day.metrics.maximumWorkoutSpeedMetresPerSecond,
    ),
    average_walking_cadence_per_minute: optionalNumber(
      day.metrics.averageWalkingCadencePerMinute,
    ),
    average_cycling_cadence_rpm: optionalNumber(
      day.metrics.averageCyclingCadenceRpm,
    ),
    average_heart_rate_bpm: optionalNumber(day.metrics.averageHeartRateBpm),
    resting_heart_rate_bpm: optionalNumber(day.metrics.restingHeartRateBpm),
    minimum_heart_rate_bpm: optionalNumber(day.metrics.minimumHeartRateBpm),
    maximum_heart_rate_bpm: optionalNumber(day.metrics.maximumHeartRateBpm),
    weight_kilograms: optionalNumber(day.metrics.weightKilograms),
    body_fat_percent: optionalNumber(day.metrics.bodyFatPercent),
    lean_body_mass_kilograms: optionalNumber(day.metrics.leanBodyMassKilograms),
    body_water_mass_kilograms: optionalNumber(
      day.metrics.bodyWaterMassKilograms,
    ),
    bone_mass_kilograms: optionalNumber(day.metrics.boneMassKilograms),
    height_metres: optionalNumber(day.metrics.heightMetres),
    basal_metabolic_rate_kcal_per_day: optionalNumber(
      day.metrics.basalMetabolicRateKcalPerDay,
    ),
    health_connect_glucose_mmol_l: optionalNumber(
      day.metrics.bloodGlucoseMmolL,
    ),
    blood_pressure_systolic: optionalNumber(
      day.metrics.bloodPressureSystolic,
    ),
    blood_pressure_diastolic: optionalNumber(
      day.metrics.bloodPressureDiastolic,
    ),
    oxygen_saturation_percent: optionalNumber(
      day.metrics.oxygenSaturationPercent,
    ),
    respiratory_rate_per_minute: optionalNumber(
      day.metrics.respiratoryRatePerMinute,
    ),
    heart_rate_variability_rmssd_ms: optionalNumber(
      day.metrics.heartRateVariabilityRmssdMs,
    ),
    vo2_max_ml_per_kg_min: optionalNumber(
      day.metrics.vo2MaxMillilitresPerKilogramMinute,
    ),
    body_temperature_celsius: optionalNumber(
      day.metrics.bodyTemperatureCelsius,
    ),
    hydration_litres: optionalNumber(day.metrics.hydrationLitres),
    sleep_minutes: day.sleepMinutes,
    workout_minutes: day.workoutMinutes,
    meal_count: day.mealCount,
    meal_carbs_grams: optionalNumber(day.mealCarbsGrams),
    meal_energy_kcal: optionalNumber(day.mealEnergyKcal),
    meal_protein_grams: optionalNumber(day.mealProteinGrams),
    meal_fat_grams: optionalNumber(day.mealFatGrams),
    meal_fibre_grams: optionalNumber(day.mealFibreGrams),
    meal_sugars_grams: optionalNumber(day.mealSugarsGrams),
    meal_saturated_fat_grams: optionalNumber(day.mealSaturatedFatGrams),
    nutrition_source_labels_json: JSON.stringify(day.nutritionSourceLabels),
    nutrition_possible_duplicate_pairs: day.nutritionPossibleDuplicatePairs,
    medication_count: day.medicationCount,
    hormone_record_count: day.hormoneRecordCount,
    record_count: day.metrics.recordCount,
    source_labels_json: JSON.stringify(day.metrics.sourceLabels),
    needs_source_json: JSON.stringify(day.metrics.needsSource),
  }));
}

export function buildTarvisLabSnapshotFromInputs({
  generatedAtMs,
  healthMetricRecords,
  healthTrend,
  range,
  timeline,
}: SnapshotInputs): TarvisLabSnapshot {
  const timeZone = getRuntimeRegionalDefaults().timeZone;
  const completeLocalDates = new Set(
    getTarvisLocalDayCoverage(range, timeZone).completeLocalDates,
  );
  const glucose = glucoseTables(timeline, range);
  const insulin = insulinTables(timeline, range);
  const context = contextTables(timeline.context);
  return {
    schemaVersion: 1,
    timezone: timeZone,
    generatedAtMs,
    range: { startMs: range.start, endMs: range.end },
    tables: {
      ...glucose,
      ...insulin,
      ...context,
      health_metrics: healthMetricRows(healthMetricRecords),
      // A whole-day aggregate cannot be clipped safely. Omit partial boundary
      // days; their exact health_metrics rows remain bounded and queryable.
      daily_health_metrics: dailyHealthRows(
        healthTrend.filter((day) => completeLocalDates.has(day.date)),
      ),
      source_statuses: timeline.sources.map<TarvisLabRow>((status) => ({
        id: status.id,
        label: status.label,
        freshness: status.freshness,
        origin: status.origin,
        last_updated_at_ms: optionalNumber(status.lastUpdatedAt),
        data_through_ms: optionalNumber(status.dataThrough),
        record_count: optionalNumber(status.recordCount),
        is_live: status.isLive ? 1 : 0,
        capabilities_json: JSON.stringify(status.capabilities ?? []),
      })),
    },
  };
}

export async function buildTarvisLabSnapshot(
  range: TimeRange,
  loadTimelineData: (range: TimeRange) => Promise<TimelineData>,
  generatedAtMs = Date.now(),
) {
  const timeZone = getRuntimeRegionalDefaults().timeZone;
  const coverage = getTarvisLocalDayCoverage(range, timeZone);
  const endDate = coverage.touchedLocalDates.at(-1) ??
    toDateKey(Math.max(range.start, range.end - 1), timeZone);
  const dayCount = Math.min(
    90,
    Math.max(1, coverage.touchedLocalDates.length),
  );
  const [timeline, healthMetricSnapshot, healthTrend] = await Promise.all([
    loadTimelineData(range),
    getDailyHealthMetricSnapshot(range),
    getHealthTrendSnapshot(endDate, dayCount, generatedAtMs),
  ]);
  return buildTarvisLabSnapshotFromInputs({
    generatedAtMs,
    healthMetricRecords: healthMetricSnapshot.records,
    healthTrend,
    range,
    timeline,
  });
}
