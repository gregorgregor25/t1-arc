import type {
  HealthConnectCategoryId,
  HealthConnectRecord,
} from '../../../modules/t1arc-health-connect';

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
      AND reconciliation_scope = 'current'
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

interface HealthConnectReconciliationDatabase {
  runAsync(
    sql: string,
    ...parameters: (string | number | null)[]
  ): Promise<{ changes: number }>;
}

/**
 * Reconcile only rows observed from this device's current Health Connect
 * store. Restored rows are archival evidence from another phone until the
 * current store returns the same external record and promotes it to current.
 */
export async function reconcileHealthConnectWindowInTransaction(
  database: HealthConnectReconciliationDatabase,
  category: HealthConnectCategoryId,
  startTimeMs: number,
  endTimeMs: number,
  importedAt: number,
  preferredSourcePackage?: string,
) {
  const { whereSql, parameters } =
    buildHealthConnectReconciliationFilter(
      category,
      startTimeMs,
      endTimeMs,
      importedAt,
      preferredSourcePackage,
    );
  const contextEventsResult = await database.runAsync(
    `DELETE FROM context_events
     WHERE id IN (
       SELECT id FROM health_connect_records WHERE ${whereSql}
     )`,
    ...parameters,
  );
  const contextNotesResult = await database.runAsync(
    `DELETE FROM context_notes
     WHERE id IN (
       SELECT id FROM health_connect_records WHERE ${whereSql}
     )`,
    ...parameters,
  );
  const recordResult = await database.runAsync(
    `DELETE FROM health_connect_records WHERE ${whereSql}`,
    ...parameters,
  );
  return {
    recordsRemoved: recordResult.changes,
    contextRemoved:
      contextEventsResult.changes + contextNotesResult.changes,
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

interface HealthConnectIdentityRow {
  id: string;
  external_id: string;
  parent_external_id: string | null;
  start_ms: number;
  end_ms: number;
}

interface HealthConnectIdentityDatabase {
  getAllAsync<T>(
    sql: string,
    ...parameters: (string | number | null)[]
  ): Promise<T[]>;
  runAsync(
    sql: string,
    ...parameters: (string | number | null)[]
  ): Promise<{ changes: number }>;
}

function childRecordDiscriminator(record: {
  externalId: string;
  parentExternalId?: string | null;
  startTimeMs: number;
  endTimeMs: number;
}) {
  const parent = record.parentExternalId?.trim();
  if (!parent) return '';
  const prefix = `${parent}:`;
  return record.externalId.startsWith(prefix)
    ? record.externalId.slice(prefix.length)
    : `time:${record.startTimeMs}:${record.endTimeMs}`;
}

/**
 * Resolve a portable Health Connect identity before the normal row upsert.
 * Metadata.id is local to a Health Connect store; a provider-supplied
 * clientRecordId is stable across phones. Ambiguous provider identities abort
 * instead of guessing and silently combining clinical context.
 */
export async function resolveAndPromoteHealthConnectRecordId(
  database: HealthConnectIdentityDatabase,
  record: HealthConnectRecord,
  generatedId: string,
) {
  const clientRecordId = record.clientRecordId?.trim();
  let candidates: HealthConnectIdentityRow[];
  if (clientRecordId) {
    candidates = await database.getAllAsync<HealthConnectIdentityRow>(
      `SELECT id, external_id, parent_external_id, start_ms, end_ms
         FROM health_connect_records
        WHERE kind = ? AND source_package = ?
          AND CASE WHEN json_valid(payload_json)
            THEN TRIM(json_extract(payload_json, '$.clientRecordId'))
            ELSE NULL
          END = ?`,
      record.kind,
      record.sourcePackage,
      clientRecordId,
    );
    const discriminator = childRecordDiscriminator(record);
    candidates = candidates.filter(
      (candidate) =>
        childRecordDiscriminator({
          externalId: candidate.external_id,
          parentExternalId: candidate.parent_external_id,
          startTimeMs: candidate.start_ms,
          endTimeMs: candidate.end_ms,
        }) === discriminator,
    );
  } else {
    candidates = await database.getAllAsync<HealthConnectIdentityRow>(
      `SELECT id, external_id, parent_external_id, start_ms, end_ms
         FROM health_connect_records
        WHERE kind = ? AND source_package = ? AND external_id = ?`,
      record.kind,
      record.sourcePackage,
      record.externalId,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      'Health Connect returned an ambiguous provider record identity. No records were changed.',
    );
  }
  const id = candidates[0]?.id ?? generatedId;
  if (candidates.length === 1) {
    await database.runAsync(
      `UPDATE health_connect_records
          SET external_id = ?, parent_external_id = ?,
              reconciliation_scope = 'current'
        WHERE id = ?`,
      record.externalId,
      record.parentExternalId ?? null,
      id,
    );
  }
  return id;
}
