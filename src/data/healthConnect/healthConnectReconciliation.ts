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
  const safePayload =
    "CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END";
  const parentStart =
    `json_extract(${safePayload}, '$.parentStartTimeMs')`;
  const parentEnd =
    `json_extract(${safePayload}, '$.parentEndTimeMs')`;
  // A paged read cannot prove absence for intervals crossing either bound.
  // Sample rows carry their sample time, not their parent interval bounds;
  // legacy samples without parent bounds stay until an explicit change-feed
  // deletion, while new bounded samples can be reconciled on a full scan.
  return {
    whereSql: `
      kind IN (${kindPlaceholders})
      AND reconciliation_scope = 'current'
      AND (
        (parent_external_id IS NULL
         AND start_ms >= ?
         AND start_ms < ?
         AND (end_ms IS NULL OR end_ms <= ?))
        OR
        (parent_external_id IS NOT NULL
         AND typeof(${parentStart}) IN ('integer', 'real')
         AND typeof(${parentEnd}) IN ('integer', 'real')
         AND ${parentStart} >= ?
         AND ${parentStart} < ?
         AND ${parentEnd} <= ?
         AND ${parentEnd} >= ${parentStart})
      )
      AND imported_at_ms <> ?
      ${sourceFilter}
    `,
    parameters: [
      ...kinds,
      startTimeMs,
      endTimeMs,
      endTimeMs,
      startTimeMs,
      endTimeMs,
      endTimeMs,
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

const CLIENT_RECORD_ID_SQL = `CASE WHEN json_valid(payload_json)
            THEN TRIM(json_extract(payload_json, '$.clientRecordId'))
            ELSE NULL
          END`;

// Keep each statement under SQLite's historical 999 bound-variable limit.
const IDENTITY_LOOKUP_CHUNK = 400;

interface StoredHealthConnectIdentityRow extends HealthConnectIdentityRow {
  last_modified_ms: number;
  reconciliation_scope: string | null;
  client_record_id?: string | null;
}

export interface StoredHealthConnectIdentity {
  id: string;
  externalId: string;
  parentExternalId?: string;
  lastModifiedMs: number;
  current: boolean;
}

export interface ResolvedHealthConnectIdentity {
  id: string;
  stored?: StoredHealthConnectIdentity;
}

function storedIdentity(
  row: StoredHealthConnectIdentityRow,
): StoredHealthConnectIdentity {
  return {
    id: row.id,
    externalId: row.external_id,
    parentExternalId: row.parent_external_id ?? undefined,
    lastModifiedMs: row.last_modified_ms,
    current: (row.reconciliation_scope ?? 'current') === 'current',
  };
}

function chunked<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

function groupKey(record: HealthConnectRecord) {
  return `${record.kind}\u0000${record.sourcePackage}`;
}

/**
 * Page-level equivalent of resolveAndPromoteHealthConnectRecordId. It reads
 * every identity a batch needs with one indexed query per kind/source group
 * instead of one query per record, and keeps the same rules: a stable
 * clientRecordId wins over the store-local id, and an ambiguous provider
 * identity aborts the batch instead of guessing.
 *
 * Records that resolve to the same identity inside one batch share the first
 * id, exactly as the sequential resolver would after its first insert.
 * No rows are promoted here; the caller's upsert rewrites identity columns and
 * the reconciliation scope for every record it writes.
 */
export async function resolveHealthConnectRecordIdentities(
  database: HealthConnectIdentityDatabase,
  records: HealthConnectRecord[],
  generatedId: (record: HealthConnectRecord) => string,
): Promise<ResolvedHealthConnectIdentity[]> {
  const byClientId = new Map<string, HealthConnectRecord[]>();
  const byExternalId = new Map<string, HealthConnectRecord[]>();
  for (const record of records) {
    const target = record.clientRecordId?.trim() ? byClientId : byExternalId;
    const key = groupKey(record);
    const group = target.get(key) ?? [];
    group.push(record);
    target.set(key, group);
  }

  const storedByClientId = new Map<string, StoredHealthConnectIdentityRow[]>();
  for (const group of byClientId.values()) {
    const first = group[0]!;
    const clientIds = [
      ...new Set(group.map((record) => record.clientRecordId!.trim())),
    ];
    for (const chunk of chunked(clientIds, IDENTITY_LOOKUP_CHUNK)) {
      const rows = await database.getAllAsync<StoredHealthConnectIdentityRow>(
        `SELECT id, external_id, parent_external_id, start_ms, end_ms,
            last_modified_ms, reconciliation_scope,
            ${CLIENT_RECORD_ID_SQL} AS client_record_id
           FROM health_connect_records
          WHERE kind = ? AND source_package = ?
            AND ${CLIENT_RECORD_ID_SQL} IN (${chunk.map(() => '?').join(', ')})`,
        first.kind,
        first.sourcePackage,
        ...chunk,
      );
      for (const row of rows) {
        const key = `${groupKey(first)}\u0000${row.client_record_id ?? ''}`;
        const existing = storedByClientId.get(key) ?? [];
        existing.push(row);
        storedByClientId.set(key, existing);
      }
    }
  }

  const storedByExternalId = new Map<string, StoredHealthConnectIdentityRow>();
  for (const group of byExternalId.values()) {
    const first = group[0]!;
    const externalIds = [...new Set(group.map((record) => record.externalId))];
    for (const chunk of chunked(externalIds, IDENTITY_LOOKUP_CHUNK)) {
      const rows = await database.getAllAsync<StoredHealthConnectIdentityRow>(
        `SELECT id, external_id, parent_external_id, start_ms, end_ms,
            last_modified_ms, reconciliation_scope
           FROM health_connect_records
          WHERE kind = ? AND source_package = ?
            AND external_id IN (${chunk.map(() => '?').join(', ')})`,
        first.kind,
        first.sourcePackage,
        ...chunk,
      );
      for (const row of rows) {
        storedByExternalId.set(
          `${groupKey(first)}\u0000${row.external_id}`,
          row,
        );
      }
    }
  }

  // Identities assigned earlier in this batch, so a repeated provider identity
  // resolves to the row the sequential resolver would have just inserted.
  const assignedInBatch = new Map<string, string>();
  return records.map((record) => {
    const clientRecordId = record.clientRecordId?.trim();
    if (clientRecordId) {
      const discriminator = childRecordDiscriminator(record);
      const identityKey = `${groupKey(record)}\u0000${clientRecordId}`;
      const candidates = (storedByClientId.get(identityKey) ?? []).filter(
        (candidate) =>
          childRecordDiscriminator({
            externalId: candidate.external_id,
            parentExternalId: candidate.parent_external_id,
            startTimeMs: candidate.start_ms,
            endTimeMs: candidate.end_ms,
          }) === discriminator,
      );
      if (candidates.length > 1) {
        throw new Error(
          'Health Connect returned an ambiguous provider record identity. No records were changed.',
        );
      }
      const candidate = candidates[0];
      if (candidate) {
        return { id: candidate.id, stored: storedIdentity(candidate) };
      }
      const batchKey = `${identityKey}\u0000${discriminator}`;
      const id = assignedInBatch.get(batchKey) ?? generatedId(record);
      assignedInBatch.set(batchKey, id);
      return { id };
    }
    const candidate = storedByExternalId.get(
      `${groupKey(record)}\u0000${record.externalId}`,
    );
    return candidate
      ? { id: candidate.id, stored: storedIdentity(candidate) }
      : { id: generatedId(record) };
  });
}

/** True when the stored row already holds this exact provider version. */
export function healthConnectRecordUnchanged(
  record: HealthConnectRecord,
  stored: StoredHealthConnectIdentity | undefined,
) {
  return Boolean(
    stored &&
      stored.current &&
      stored.externalId === record.externalId &&
      (stored.parentExternalId ?? null) === (record.parentExternalId ?? null) &&
      Number.isFinite(record.lastModifiedTimeMs) &&
      stored.lastModifiedMs === record.lastModifiedTimeMs,
  );
}

/**
 * Same deletion rule as reconcileHealthConnectWindowInTransaction, but rows
 * that this read confirmed unchanged (and therefore did not rewrite) are kept.
 * Candidate ids are read once and deleted by primary key in bounded chunks.
 */
export async function reconcileHealthConnectWindowRetainingInTransaction(
  database: HealthConnectIdentityDatabase,
  category: HealthConnectCategoryId,
  startTimeMs: number,
  endTimeMs: number,
  importedAt: number,
  retainedIds: ReadonlySet<string>,
  preferredSourcePackage?: string,
) {
  if (!retainedIds.size) {
    return reconcileHealthConnectWindowInTransaction(
      database,
      category,
      startTimeMs,
      endTimeMs,
      importedAt,
      preferredSourcePackage,
    );
  }
  const { whereSql, parameters } = buildHealthConnectReconciliationFilter(
    category,
    startTimeMs,
    endTimeMs,
    importedAt,
    preferredSourcePackage,
  );
  const candidates = await database.getAllAsync<{ id: string }>(
    `SELECT id FROM health_connect_records WHERE ${whereSql}`,
    ...parameters,
  );
  const removable = candidates
    .map((row) => row.id)
    .filter((id) => !retainedIds.has(id));
  let recordsRemoved = 0;
  let contextRemoved = 0;
  for (const chunk of chunked(removable, IDENTITY_LOOKUP_CHUNK)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const events = await database.runAsync(
      `DELETE FROM context_events WHERE id IN (${placeholders})`,
      ...chunk,
    );
    const notes = await database.runAsync(
      `DELETE FROM context_notes WHERE id IN (${placeholders})`,
      ...chunk,
    );
    const removed = await database.runAsync(
      `DELETE FROM health_connect_records WHERE id IN (${placeholders})`,
      ...chunk,
    );
    recordsRemoved += removed.changes;
    contextRemoved += events.changes + notes.changes;
  }
  return { recordsRemoved, contextRemoved };
}
