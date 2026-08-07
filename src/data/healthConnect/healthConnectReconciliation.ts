import type {
  HealthConnectCategoryId,
  HealthConnectRecord,
} from '../../../modules/daymark-health-connect';

export const HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY: Record<
  HealthConnectCategoryId,
  HealthConnectRecord['kind'][]
> = {
  steps: ['steps'],
  distance: ['distance', 'elevation_gained', 'floors_climbed'],
  active_calories: ['active_calories', 'total_calories'],
  workouts: [
    'workout',
    'workout_power',
    'workout_speed',
    'walking_cadence',
    'cycling_cadence',
  ],
  heart_rate: ['heart_rate', 'resting_heart_rate'],
  sleep: ['sleep'],
  weight: ['weight'],
  body_composition: [
    'body_fat',
    'lean_body_mass',
    'body_water_mass',
    'bone_mass',
    'height',
    'basal_metabolic_rate',
  ],
  blood_glucose: ['blood_glucose'],
  vitals: [
    'blood_pressure_systolic',
    'blood_pressure_diastolic',
    'oxygen_saturation',
    'respiratory_rate',
    'heart_rate_variability_rmssd',
    'vo2_max',
    'body_temperature',
  ],
  cycle: [
    'menstruation_period',
    'menstruation_flow',
    'ovulation_test',
    'basal_body_temperature',
    'cervical_mucus',
    'intermenstrual_bleeding',
  ],
  hydration: ['hydration'],
  nutrition: ['nutrition'],
};

export function buildHealthConnectReconciliationFilter(
  category: HealthConnectCategoryId,
  startTimeMs: number,
  endTimeMs: number,
  importedAt: number,
  preferredSourcePackage?: string,
) {
  const kinds = HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY[category];
  const kindPlaceholders = kinds.map(() => '?').join(', ');
  const sourceFilter = preferredSourcePackage
    ? ' AND source_package = ?'
    : '';
  return {
    whereSql: `
      kind IN (${kindPlaceholders})
      AND start_ms < ?
      AND end_ms >= ?
      AND imported_at_ms <> ?
      ${sourceFilter}
    `,
    parameters: [
      ...kinds,
      endTimeMs,
      startTimeMs,
      importedAt,
      ...(preferredSourcePackage ? [preferredSourcePackage] : []),
    ],
  };
}

export function healthConnectParentRecordIds(
  records: HealthConnectRecord[],
) {
  return [
    ...new Set(
      records.map(
        (record) => record.parentExternalId ?? record.externalId,
      ),
    ),
  ].filter(Boolean);
}

export function buildHealthConnectExternalIdFilter(recordIds: string[]) {
  const unique = [...new Set(recordIds.filter(Boolean))];
  if (!unique.length) return undefined;
  const placeholders = unique.map(() => '?').join(', ');
  return {
    whereSql: `(external_id IN (${placeholders})
      OR parent_external_id IN (${placeholders}))`,
    parameters: [...unique, ...unique],
  };
}
