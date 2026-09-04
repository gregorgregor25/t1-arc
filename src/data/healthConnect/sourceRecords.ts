import type {
  HealthConnectRecord,
} from '../../../modules/t1arc-health-connect';

import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';
import type { TimeRange } from '@/domain/models';

interface SourceRecordRow {
  id: string;
  external_id: string;
  parent_external_id: string | null;
  kind: HealthConnectRecord['kind'];
  source_package: string;
  display_name: string | null;
  start_ms: number;
  end_ms: number;
  last_modified_ms: number;
  recording_method: number;
  value: number | null;
  unit: HealthConnectRecord['unit'] | null;
  payload_json: string;
  imported_at_ms: number;
}

export interface StoredHealthConnectRecord extends HealthConnectRecord {
  id: string;
  sourceLabel: string;
  importedAt: number;
  rawPayloadJson: string;
}

function parsedPayload(payloadJson: string) {
  try {
    const value = JSON.parse(payloadJson) as unknown;
    return value && typeof value === 'object'
      ? (value as Partial<HealthConnectRecord>)
      : {};
  } catch {
    return {};
  }
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function fromRow(row: SourceRecordRow): StoredHealthConnectRecord {
  const payload = parsedPayload(row.payload_json);
  return {
    ...payload,
    id: row.id,
    externalId: row.external_id,
    parentExternalId: row.parent_external_id,
    kind: row.kind,
    sourcePackage: row.source_package,
    sourceLabel: row.display_name ?? row.source_package,
    startTimeMs: row.start_ms,
    endTimeMs: row.end_ms,
    lastModifiedTimeMs: row.last_modified_ms,
    recordingMethod: row.recording_method,
    clientRecordVersion: payload.clientRecordVersion ?? 0,
    value: row.value ?? undefined,
    unit: row.unit ?? undefined,
    ...(row.kind === 'nutrition'
      ? {
          energyKcal: optionalFiniteNumber(payload.energyKcal),
          proteinGrams: optionalFiniteNumber(payload.proteinGrams),
          fatGrams: optionalFiniteNumber(payload.fatGrams),
          fibreGrams: optionalFiniteNumber(payload.fibreGrams),
          sugarGrams: optionalFiniteNumber(payload.sugarGrams),
          saturatedFatGrams: optionalFiniteNumber(
            payload.saturatedFatGrams,
          ),
        }
      : {}),
    importedAt: row.imported_at_ms,
    rawPayloadJson: row.payload_json,
  };
}

export interface HealthConnectSourceRecordPage {
  records: StoredHealthConnectRecord[];
  totalRecords: number;
}

export async function getHealthConnectSourceRecordPage(
  range: TimeRange,
  limit = 80,
  offset = 0,
): Promise<HealthConnectSourceRecordPage> {
  const database = await openT1ArcDatabase();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const [count, rows] = await Promise.all([
    database.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM health_connect_records r
       WHERE r.start_ms < ?
         AND (
           r.end_ms > ?
           OR (r.end_ms = r.start_ms AND r.start_ms >= ?)
         )`,
      range.end,
      range.start,
      range.start,
    ),
    database.getAllAsync<SourceRecordRow>(
      `SELECT r.id, r.external_id, r.parent_external_id, r.kind,
         r.source_package, s.display_name, r.start_ms, r.end_ms,
         r.last_modified_ms, r.recording_method, r.value, r.unit,
         r.payload_json, r.imported_at_ms
       FROM health_connect_records r
       LEFT JOIN health_connect_sources s
         ON s.package_name = r.source_package
       WHERE r.start_ms < ?
         AND (
           r.end_ms > ?
           OR (r.end_ms = r.start_ms AND r.start_ms >= ?)
         )
       ORDER BY r.start_ms DESC, r.id ASC
       LIMIT ? OFFSET ?`,
      range.end,
      range.start,
      range.start,
      safeLimit,
      safeOffset,
    ),
  ]);
  return {
    records: rows.map(fromRow),
    totalRecords: Math.max(0, count?.total ?? 0),
  };
}
