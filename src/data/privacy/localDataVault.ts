import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { DEFAULT_HEALTH_CONNECT_CATEGORIES } from '@/data/healthConnect/healthConnectRecords';
import { LocalDataSummary } from '@/domain/localDataSummary';

interface LocalDataSummaryRow {
  glucose_readings: number;
  insulin_records: number;
  context_records: number;
  food_logs: number;
  food_recipes: number;
  health_connect_records: number;
  retained_source_exports: number;
  notification_source_events: number;
  saved_insight_reports: number;
}

function fromRow(row: LocalDataSummaryRow): LocalDataSummary {
  return {
    glucoseReadings: row.glucose_readings,
    insulinRecords: row.insulin_records,
    contextRecords: row.context_records,
    foodLogs: row.food_logs,
    foodRecipes: row.food_recipes,
    healthConnectRecords: row.health_connect_records,
    retainedSourceExports: row.retained_source_exports,
    notificationSourceEvents: row.notification_source_events,
    savedInsightReports: row.saved_insight_reports,
  };
}

export async function getLocalDataSummary(): Promise<LocalDataSummary> {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<LocalDataSummaryRow>(
    `SELECT
       (SELECT COUNT(*) FROM glucose_readings) AS glucose_readings,
       (
         (SELECT COUNT(*) FROM insulin_basal) +
         (SELECT COUNT(*) FROM insulin_bolus) +
         (SELECT COUNT(*) FROM insulin_daily_totals)
       ) AS insulin_records,
       (
         (SELECT COUNT(*) FROM context_events) +
         (SELECT COUNT(*) FROM context_notes)
       ) AS context_records,
       (SELECT COUNT(*) FROM food_logs) AS food_logs,
       (SELECT COUNT(*) FROM food_recipes) AS food_recipes,
       (SELECT COUNT(*) FROM health_connect_records)
         AS health_connect_records,
       (
         (SELECT COUNT(*) FROM import_source_payloads) +
         (SELECT COUNT(*) FROM glooko_report_payloads)
       ) AS retained_source_exports,
       (SELECT COUNT(*) FROM notification_source_events)
         AS notification_source_events,
       (SELECT COUNT(*) FROM insight_reports) AS saved_insight_reports`,
  );
  return fromRow(
    row ?? {
      glucose_readings: 0,
      insulin_records: 0,
      context_records: 0,
      food_logs: 0,
      food_recipes: 0,
      health_connect_records: 0,
      retained_source_exports: 0,
      notification_source_events: 0,
      saved_insight_reports: 0,
    },
  );
}

/**
 * Removes health records and raw source evidence while retaining the encrypted
 * database itself and non-health visual preferences. Source credentials and
 * native caches are deliberately cleared by DataProvider before this runs.
 */
export async function eraseLocalHealthData(): Promise<LocalDataSummary> {
  const before = await getLocalDataSummary();
  await openDaymarkDatabase();
  await withDaymarkTransaction(async (transaction) => {
    // Delete dependent rows explicitly so the result is deterministic even if
    // an OEM SQLite build changes foreign-key defaults.
    for (const statement of [
      'DELETE FROM food_recipe_items',
      'DELETE FROM food_recipes',
      'DELETE FROM food_log_items',
      'DELETE FROM food_logs',
      'DELETE FROM context_notes',
      'DELETE FROM context_events',
      'DELETE FROM insulin_daily_totals',
      'DELETE FROM insulin_bolus',
      'DELETE FROM insulin_basal',
      'DELETE FROM glucose_readings',
      'DELETE FROM source_sync_state',
      'DELETE FROM health_connect_records',
      'DELETE FROM health_connect_sources',
      'DELETE FROM health_connect_sync_state',
      'DELETE FROM health_connect_preferences',
      'DELETE FROM import_raw_records',
      'DELETE FROM glooko_report_payloads',
      'DELETE FROM import_source_payloads',
      'DELETE FROM import_batches',
      'DELETE FROM notification_source_events',
      'DELETE FROM insight_reports',
      'DELETE FROM automation_runs',
      'DELETE FROM food_catalog_cache',
      `DELETE FROM app_metadata WHERE key = 'glooko-sync-state-v1'`,
      `DELETE FROM app_metadata WHERE key = 'health-connect-background-state-v1'`,
      `DELETE FROM app_metadata WHERE key = 'tarvis-conversation-v1'`,
    ]) {
      await transaction.runAsync(statement);
    }
    const disabledAt = Date.now();
    for (const category of DEFAULT_HEALTH_CONNECT_CATEGORIES) {
      await transaction.runAsync(
        `INSERT INTO health_connect_preferences (
           category, enabled, preferred_source_package,
           preferred_source_mode, updated_at_ms
         ) VALUES (?, 0, NULL, NULL, ?)`,
        category,
        disabledAt,
      );
    }
  });
  return before;
}

export type { LocalDataSummary } from '@/domain/localDataSummary';
