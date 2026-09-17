import type { AutomationConnector } from './automationRunLog';
import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';

export interface AutomationDataEvidence {
  dataThrough?: number;
  lastStoredAt?: number;
  recordCount: number;
}

type AutomationEvidence = Record<AutomationConnector, AutomationDataEvidence>;

interface EvidenceRow {
  glucose_data_through_ms: number | null;
  glucose_last_stored_at_ms: number | null;
  glucose_record_count: number;
  glooko_data_through_ms: number | null;
  glooko_last_stored_at_ms: number | null;
  glooko_record_count: number;
  health_data_through_ms: number | null;
  health_last_stored_at_ms: number | null;
  health_record_count: number;
  hevy_data_through_ms: number | null;
  hevy_last_stored_at_ms: number | null;
  hevy_record_count: number;
  review_data_through_ms: number | null;
  review_last_stored_at_ms: number | null;
  review_record_count: number;
}

function timestamp(value: number | null | undefined) {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}

function count(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function evidence(
  dataThrough: number | null | undefined,
  lastStoredAt: number | null | undefined,
  recordCount: number | null | undefined,
): AutomationDataEvidence {
  return {
    dataThrough: timestamp(dataThrough),
    lastStoredAt: timestamp(lastStoredAt),
    recordCount: count(recordCount),
  };
}

export async function loadAutomationDataEvidence(): Promise<AutomationEvidence> {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<EvidenceRow>(
    `SELECT
       (
         SELECT MAX(timestamp_ms)
         FROM glucose_readings
         WHERE source_file IS NULL
       ) AS glucose_data_through_ms,
       (
         SELECT MAX(COALESCE(imported_at_ms, received_at_ms))
         FROM glucose_readings
         WHERE source_file IS NULL
       ) AS glucose_last_stored_at_ms,
       (
         SELECT COUNT(*)
         FROM glucose_readings
         WHERE source_file IS NULL
       ) AS glucose_record_count,
       (
         SELECT MAX(data_through_ms)
         FROM import_batches
         WHERE source_id = 'glooko-export'
       ) AS glooko_data_through_ms,
       (
         SELECT MAX(imported_at_ms)
         FROM import_batches
         WHERE source_id = 'glooko-export'
       ) AS glooko_last_stored_at_ms,
       (
         (SELECT COUNT(*) FROM glucose_readings
            WHERE source_id = 'glooko-cgm') +
         (SELECT COUNT(*) FROM insulin_basal
            WHERE source_id = 'glooko-export') +
         (SELECT COUNT(*) FROM insulin_bolus
            WHERE source_id = 'glooko-export') +
         (SELECT COUNT(*) FROM insulin_daily_totals
            WHERE source_id = 'glooko-export') +
         (SELECT COUNT(*) FROM context_events
            WHERE source_id = 'glooko-export') +
         (SELECT COUNT(*) FROM context_notes
            WHERE source_id = 'glooko-export')
       ) AS glooko_record_count,
       (
         SELECT MAX(end_ms)
         FROM health_connect_records
       ) AS health_data_through_ms,
       (
         SELECT MAX(imported_at_ms)
         FROM health_connect_records
       ) AS health_last_stored_at_ms,
       (
         SELECT COUNT(*)
         FROM health_connect_records
       ) AS health_record_count,
       (
         SELECT MAX(end_ms)
         FROM hevy_workouts
       ) AS hevy_data_through_ms,
       (
         SELECT MAX(imported_at_ms)
         FROM hevy_workouts
       ) AS hevy_last_stored_at_ms,
       (
         SELECT COUNT(*)
         FROM hevy_workouts
       ) AS hevy_record_count,
       (
         SELECT MAX(period_end_ms)
         FROM insight_reports
         WHERE ready = 1
       ) AS review_data_through_ms,
       (
         SELECT MAX(updated_at_ms)
         FROM insight_reports
         WHERE ready = 1
       ) AS review_last_stored_at_ms,
       (
         SELECT COUNT(*)
         FROM insight_reports
         WHERE ready = 1
       ) AS review_record_count`,
  );

  return {
    glucose: evidence(
      row?.glucose_data_through_ms,
      row?.glucose_last_stored_at_ms,
      row?.glucose_record_count,
    ),
    glooko: evidence(
      row?.glooko_data_through_ms,
      row?.glooko_last_stored_at_ms,
      row?.glooko_record_count,
    ),
    'health-connect': evidence(
      row?.health_data_through_ms,
      row?.health_last_stored_at_ms,
      row?.health_record_count,
    ),
    hevy: evidence(
      row?.hevy_data_through_ms,
      row?.hevy_last_stored_at_ms,
      row?.hevy_record_count,
    ),
    'insight-review': evidence(
      row?.review_data_through_ms,
      row?.review_last_stored_at_ms,
      row?.review_record_count,
    ),
  };
}
