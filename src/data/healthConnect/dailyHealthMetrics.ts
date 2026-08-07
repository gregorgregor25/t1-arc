import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';
import {
  aggregateDailyHealthMetrics,
  DailyHealthMetrics,
  DailyMetricCategory,
  DailyMetricRecord,
} from '@/domain/dailyHealthMetrics';
import type { HealthContextEvent, TimeRange } from '@/domain/models';
import { summarizeHealthTrendContext } from '@/domain/healthTrendContext';
import {
  addDays,
  DateKey,
  dayRange,
  multiDayRange,
} from '@/domain/time';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import {
  getHealthConnectContextSourceConflicts,
} from './healthConnectContextConflicts';
import type {
  HealthConnectContextCategory,
} from './healthConnectContextSelection';

interface MetricRow {
  id: string;
  kind: DailyMetricRecord['kind'];
  source_package: string;
  display_name: string | null;
  start_ms: number;
  end_ms: number;
  value: number | null;
  unit: DailyMetricRecord['unit'];
  payload_json: string;
}

interface PreferenceRow {
  category: DailyMetricCategory;
  preferred_source_package: string | null;
}

function metricPayloadDetails(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const optionalInteger = (value: unknown) =>
      typeof value === 'number' && Number.isInteger(value)
        ? value
        : undefined;
    return {
      mealType: optionalInteger(payload.mealType),
      relationToMeal: optionalInteger(payload.relationToMeal),
      specimenSource: optionalInteger(payload.specimenSource),
    };
  } catch {
    return {};
  }
}

async function loadHealthMetricRecords(range: TimeRange) {
  const database = await openDaymarkDatabase();
  const [rows, preferences] = await Promise.all([
    database.getAllAsync<MetricRow>(
      `SELECT r.id, r.kind, r.source_package, s.display_name,
         r.start_ms, r.end_ms, r.value, r.unit, r.payload_json
       FROM health_connect_records r
       LEFT JOIN health_connect_sources s
         ON s.package_name = r.source_package
       WHERE r.kind IN (
         'steps', 'distance', 'elevation_gained', 'floors_climbed',
         'active_calories', 'total_calories',
         'workout_power', 'workout_speed',
         'walking_cadence', 'cycling_cadence',
         'heart_rate', 'resting_heart_rate', 'weight',
         'body_fat', 'lean_body_mass', 'body_water_mass',
         'bone_mass', 'height', 'basal_metabolic_rate',
         'blood_glucose', 'blood_pressure_systolic',
         'blood_pressure_diastolic', 'oxygen_saturation',
         'respiratory_rate', 'heart_rate_variability_rmssd',
         'vo2_max', 'body_temperature', 'hydration'
       )
         AND r.start_ms < ?
         AND (
           r.end_ms > ?
           OR (r.end_ms = r.start_ms AND r.start_ms >= ?)
         )
         AND r.value IS NOT NULL
       ORDER BY r.start_ms ASC`,
      range.end,
      range.start,
      range.start,
    ),
    database.getAllAsync<PreferenceRow>(
      `SELECT category, preferred_source_package
       FROM health_connect_preferences
       WHERE category IN (
         'steps', 'distance', 'active_calories', 'workouts', 'heart_rate',
         'weight', 'body_composition', 'blood_glucose', 'vitals', 'hydration'
       )`,
    ),
  ]);
  const preferredSources = Object.fromEntries(
    preferences.flatMap((preference) =>
      preference.preferred_source_package
        ? [[preference.category, preference.preferred_source_package]]
        : [],
    ),
  ) as Partial<Record<DailyMetricCategory, string>>;
  const records: DailyMetricRecord[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      sourcePackage: row.source_package,
      sourceLabel: row.display_name ?? row.source_package,
      start: row.start_ms,
      end: row.end_ms,
      value: row.value!,
      unit: row.unit,
      ...metricPayloadDetails(row.payload_json),
    }));
  return { preferredSources, records };
}

export async function getDailyHealthMetricSnapshot(range: TimeRange) {
  const [{ preferredSources, records }, contextNeedsSource] =
    await Promise.all([
      loadHealthMetricRecords(range),
      getHealthConnectContextSourceConflicts(range),
    ]);
  return {
    metrics: aggregateDailyHealthMetrics(records, range, preferredSources),
    records,
    contextNeedsSource,
  };
}

export async function getHealthMetricRecordsByIds(
  recordIds: readonly string[],
) {
  if (!recordIds.length) return [];
  const database = await openDaymarkDatabase();
  const records: DailyMetricRecord[] = [];
  for (let offset = 0; offset < recordIds.length; offset += 400) {
    const batch = recordIds.slice(offset, offset + 400);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<MetricRow>(
      `SELECT r.id, r.kind, r.source_package, s.display_name,
         r.start_ms, r.end_ms, r.value, r.unit, r.payload_json
       FROM health_connect_records r
       LEFT JOIN health_connect_sources s
         ON s.package_name = r.source_package
       WHERE r.id IN (${placeholders})
         AND r.value IS NOT NULL
       ORDER BY r.start_ms ASC`,
      ...batch,
    );
    records.push(
      ...rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        sourcePackage: row.source_package,
        sourceLabel: row.display_name ?? row.source_package,
        start: row.start_ms,
        end: row.end_ms,
        value: row.value!,
        unit: row.unit,
        ...metricPayloadDetails(row.payload_json),
      })),
    );
  }
  return records.sort((a, b) => a.start - b.start);
}

export async function getDailyHealthMetrics(range: TimeRange) {
  return (await getDailyHealthMetricSnapshot(range)).metrics;
}

export interface HealthTrendDay {
  date: DateKey;
  metrics: DailyHealthMetrics;
  sleepMinutes: number;
  workoutMinutes: number;
  mealCount: number;
  mealCarbsGrams: number;
  medicationCount: number;
  hormoneRecordCount: number;
  contextNeedsSource: HealthConnectContextCategory[];
}

function overlapMinutes(event: HealthContextEvent, range: TimeRange) {
  const end = contextEventEnd(event);
  return Math.max(
    0,
    (Math.min(end, range.end) - Math.max(event.start, range.start)) /
      60_000,
  );
}

function contextEventEnd(event: HealthContextEvent) {
  return (
    event.end ??
    ('durationMinutes' in event
      ? event.start + event.durationMinutes * 60_000
      : event.start)
  );
}

export async function getHealthTrendSnapshot(
  endDate: DateKey,
  days: number,
  now = Date.now(),
): Promise<HealthTrendDay[]> {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  const overallRange = multiDayRange(endDate, safeDays, now);
  const [
    { preferredSources, records },
    context,
    contextNeedsSource,
  ] = await Promise.all([
    loadHealthMetricRecords(overallRange),
    new SqliteHealthRecordStore().getContextEvents(overallRange),
    getHealthConnectContextSourceConflicts(overallRange),
  ]);
  const dates = Array.from(
    { length: safeDays },
    (_, index) => addDays(endDate, index - (safeDays - 1)),
  );

  return dates.map((date) => {
    const range = dayRange(date, now);
    const dailyContext = context.filter(
      (event) =>
        event.start < range.end &&
        contextEventEnd(event) >= range.start,
    );
    const contextSummary = summarizeHealthTrendContext(
      dailyContext,
      range,
    );
    return {
      date,
      metrics: aggregateDailyHealthMetrics(
        records,
        range,
        preferredSources,
      ),
      sleepMinutes: dailyContext
        .filter((event) => event.kind === 'sleep')
        .reduce(
          (total, event) => total + overlapMinutes(event, range),
          0,
        ),
      workoutMinutes: dailyContext
        .filter((event) => event.kind === 'activity')
        .reduce(
          (total, event) => total + overlapMinutes(event, range),
          0,
        ),
      contextNeedsSource,
      ...contextSummary,
    };
  });
}
