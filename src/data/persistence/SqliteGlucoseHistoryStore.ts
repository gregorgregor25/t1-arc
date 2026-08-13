import { SQLiteDatabase } from 'expo-sqlite';

import {
  GlucoseHistoryBounds,
  GlucoseHistoryStore,
  SourceSyncState,
} from './GlucoseHistoryStore';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from './daymarkDatabase';
import {
  DataQuality,
  GlucoseReading,
  TimeRange,
  TrendDirection,
} from '@/domain/models';

interface GlucoseRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  received_at_ms: number;
  mmol_l: number;
  trend: TrendDirection;
  quality: DataQuality;
  source_factory_timestamp: string | null;
  source_local_timestamp: string | null;
  timestamp_discrepancy_minutes: number | null;
  imported_at_ms: number | null;
  source_file: string | null;
  source_row: number | null;
  source_device_id: string | null;
}

interface SyncRow {
  source_id: string;
  last_attempt_at_ms: number | null;
  last_success_at_ms: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  record_count: number;
}

function readingFromRow(row: GlucoseRow): GlucoseReading {
  return {
    id: row.id,
    timestamp: row.timestamp_ms,
    receivedAt: row.received_at_ms,
    mmolL: row.mmol_l,
    trend: row.trend,
    quality: row.quality,
    sourceId: row.source_id,
    sourceFactoryTimestamp: row.source_factory_timestamp ?? undefined,
    sourceLocalTimestamp: row.source_local_timestamp ?? undefined,
    timestampDiscrepancyMinutes:
      row.timestamp_discrepancy_minutes ?? undefined,
    importedAt: row.imported_at_ms ?? undefined,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
    sourceDeviceId: row.source_device_id || undefined,
  };
}

export class SqliteGlucoseHistoryStore implements GlucoseHistoryStore {
  private database?: SQLiteDatabase;

  private async getDatabase() {
    this.database ??= await openDaymarkDatabase();
    return this.database;
  }

  async initialize() {
    await this.getDatabase();
  }

  async upsertReadings(readings: GlucoseReading[]) {
    if (readings.length === 0) return;
    await this.getDatabase();
    await withDaymarkTransaction(async (transaction) => {
      const readingBatchSize = 40;
      for (
        let offset = 0;
        offset < readings.length;
        offset += readingBatchSize
      ) {
        const batch = readings.slice(offset, offset + readingBatchSize);
        const values = batch.map(
          () => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        const parameters = batch.flatMap((reading) => [
          reading.id,
          reading.sourceId,
          reading.timestamp,
          reading.receivedAt,
          reading.mmolL,
          reading.trend,
          reading.quality,
          reading.sourceFactoryTimestamp ?? null,
          reading.sourceLocalTimestamp ?? null,
          reading.timestampDiscrepancyMinutes ?? null,
          reading.importedAt ?? null,
          reading.sourceFile ?? null,
          reading.sourceRow ?? null,
          reading.sourceDeviceId ?? '',
        ]);
        await transaction.runAsync(
          `INSERT INTO glucose_readings (
             id, source_id, timestamp_ms, received_at_ms, mmol_l, trend, quality,
             source_factory_timestamp, source_local_timestamp,
             timestamp_discrepancy_minutes, imported_at_ms, source_file,
             source_row, source_device_id
           ) VALUES ${values.join(', ')}
           ON CONFLICT(source_id, timestamp_ms, source_device_id) DO UPDATE SET
             received_at_ms = MIN(
               glucose_readings.received_at_ms, excluded.received_at_ms
             ),
             mmol_l = excluded.mmol_l,
             trend = excluded.trend,
             quality = excluded.quality,
             source_factory_timestamp = excluded.source_factory_timestamp,
             source_local_timestamp = excluded.source_local_timestamp,
             timestamp_discrepancy_minutes =
               excluded.timestamp_discrepancy_minutes,
             imported_at_ms = excluded.imported_at_ms,
             source_file = excluded.source_file,
             source_row = excluded.source_row,
             source_device_id = excluded.source_device_id`,
          ...parameters,
        );
      }
    });
  }

  async getReadings(range: TimeRange, sourceId?: string) {
    const database = await this.getDatabase();
    const rows = sourceId
      ? await database.getAllAsync<GlucoseRow>(
          `SELECT * FROM glucose_readings
           WHERE timestamp_ms >= ? AND timestamp_ms < ? AND source_id = ?
           ORDER BY timestamp_ms ASC, source_device_id ASC, id ASC`,
          range.start,
          range.end,
          sourceId,
        )
      : await database.getAllAsync<GlucoseRow>(
          `SELECT * FROM glucose_readings
           WHERE timestamp_ms >= ? AND timestamp_ms < ?
           ORDER BY timestamp_ms ASC, source_device_id ASC, id ASC`,
          range.start,
          range.end,
        );
    return rows.map(readingFromRow);
  }

  async getReadingsByIds(recordIds: readonly string[]) {
    if (!recordIds.length) return [];
    const database = await this.getDatabase();
    const rows: GlucoseRow[] = [];
    for (let offset = 0; offset < recordIds.length; offset += 400) {
      const batch = recordIds.slice(offset, offset + 400);
      const placeholders = batch.map(() => '?').join(',');
      rows.push(
        ...(await database.getAllAsync<GlucoseRow>(
          `SELECT * FROM glucose_readings
           WHERE id IN (${placeholders})
           ORDER BY timestamp_ms ASC`,
          ...batch,
        )),
      );
    }
    return rows.map(readingFromRow).sort((a, b) => a.timestamp - b.timestamp);
  }

  async getLatestReading(sourceId?: string) {
    const database = await this.getDatabase();
    const row = sourceId
      ? await database.getFirstAsync<GlucoseRow>(
          `SELECT * FROM glucose_readings
           WHERE source_id = ?
           ORDER BY timestamp_ms DESC, received_at_ms DESC,
             source_device_id ASC, id ASC LIMIT 1`,
          sourceId,
        )
      : await database.getFirstAsync<GlucoseRow>(
          `SELECT * FROM glucose_readings
           ORDER BY timestamp_ms DESC, received_at_ms DESC,
             source_device_id ASC, id ASC LIMIT 1`,
        );
    return row ? readingFromRow(row) : undefined;
  }

  async getBounds(sourceId?: string): Promise<GlucoseHistoryBounds> {
    const database = await this.getDatabase();
    const row = sourceId
      ? await database.getFirstAsync<{
          earliest: number | null;
          latest: number | null;
          count: number;
        }>(
          `SELECT MIN(timestamp_ms) AS earliest, MAX(timestamp_ms) AS latest,
             COUNT(*) AS count
           FROM glucose_readings WHERE source_id = ?`,
          sourceId,
        )
      : await database.getFirstAsync<{
          earliest: number | null;
          latest: number | null;
          count: number;
        }>(
          `SELECT MIN(timestamp_ms) AS earliest, MAX(timestamp_ms) AS latest,
             COUNT(*) AS count FROM glucose_readings`,
        );
    return {
      earliest: row?.earliest ?? undefined,
      latest: row?.latest ?? undefined,
      count: row?.count ?? 0,
    };
  }

  async getSyncState(sourceId: string) {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<SyncRow>(
      'SELECT * FROM source_sync_state WHERE source_id = ?',
      sourceId,
    );
    if (!row) return undefined;
    return {
      sourceId: row.source_id,
      lastAttemptAt: row.last_attempt_at_ms ?? undefined,
      lastSuccessAt: row.last_success_at_ms ?? undefined,
      lastErrorCode: row.last_error_code ?? undefined,
      lastErrorMessage: row.last_error_message ?? undefined,
      recordCount: row.record_count,
    };
  }

  async saveSyncState(state: SourceSyncState) {
    const database = await this.getDatabase();
    await database.runAsync(
      `INSERT INTO source_sync_state (
         source_id, last_attempt_at_ms, last_success_at_ms, last_error_code,
         last_error_message, record_count
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         last_attempt_at_ms = excluded.last_attempt_at_ms,
         last_success_at_ms = excluded.last_success_at_ms,
         last_error_code = excluded.last_error_code,
         last_error_message = excluded.last_error_message,
         record_count = excluded.record_count`,
      state.sourceId,
      state.lastAttemptAt ?? null,
      state.lastSuccessAt ?? null,
      state.lastErrorCode ?? null,
      state.lastErrorMessage ?? null,
      state.recordCount,
    );
  }

  async clearSource(sourceId: string) {
    const database = await this.getDatabase();
    await withDaymarkTransaction(async (transaction) => {
      await transaction.runAsync(
        'DELETE FROM glucose_readings WHERE source_id = ?',
        sourceId,
      );
      await transaction.runAsync(
        'DELETE FROM source_sync_state WHERE source_id = ?',
        sourceId,
      );
    });
  }
}
