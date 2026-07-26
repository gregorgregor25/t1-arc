import { SQLiteDatabase } from 'expo-sqlite';

import {
  ActivityEvent,
  BasalDelivery,
  BolusDelivery,
  HealthContextEvent,
  MealEvent,
  MedicationEvent,
  SleepEvent,
  TimeRange,
  WeightEvent,
} from '@/domain/models';

import {
  HealthRecordStore,
  ImportBatch,
  ImportSourcePayload,
  ImportedSourceDeleteResult,
  ImportWriteResult,
  StoredImportBatch,
  StoredImportSourcePayload,
  StoredRecordBounds,
} from './HealthRecordStore';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from './daymarkDatabase';

interface BasalRow {
  id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  rate_units_per_hour: number;
  units: number;
  imported_at_ms: number;
  source_file: string | null;
  source_row: number | null;
}

interface BolusRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  units: number;
  imported_at_ms: number;
  source_file: string | null;
  source_row: number | null;
}

interface ContextRow {
  id: string;
  source_id: string;
  origin: 'manual' | 'imported' | 'synthetic';
  kind: HealthContextEvent['kind'];
  start_ms: number;
  end_ms: number | null;
  title: string;
  meal_type: MealEvent['mealType'] | null;
  carbs_grams: number | null;
  activity_type: ActivityEvent['activityType'] | null;
  duration_minutes: number | null;
  intensity: ActivityEvent['intensity'] | null;
  quality_percent: number | null;
  kilograms: number | null;
  amount: number | null;
  unit: string | null;
  recorded_at_ms: number;
  source_file: string | null;
  source_row: number | null;
}

interface ImportRow {
  id: string;
  source_id: string;
  file_name: string;
  file_sha256: string;
  imported_at_ms: number;
  data_start_ms: number | null;
  data_through_ms: number | null;
  basal_count: number;
  bolus_count: number;
  context_count: number;
  duplicate_count: number;
  skipped_count: number;
  warnings_json: string;
}

function basalFromRow(row: BasalRow): BasalDelivery {
  return {
    id: row.id,
    sourceId: row.source_id,
    start: row.start_ms,
    end: row.end_ms,
    rateUnitsPerHour: row.rate_units_per_hour,
    units: row.units,
    importedAt: row.imported_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
  };
}

function bolusFromRow(row: BolusRow): BolusDelivery {
  return {
    id: row.id,
    sourceId: row.source_id,
    timestamp: row.timestamp_ms,
    units: row.units,
    importedAt: row.imported_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
  };
}

function contextBase(row: ContextRow) {
  return {
    id: row.id,
    sourceId: row.source_id,
    origin: row.origin,
    start: row.start_ms,
    end: row.end_ms ?? undefined,
    title: row.title,
    recordedAt: row.recorded_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
  };
}

function contextFromRow(row: ContextRow): HealthContextEvent {
  const base = contextBase(row);
  switch (row.kind) {
    case 'meal':
      return {
        ...base,
        kind: 'meal',
        mealType: row.meal_type ?? 'snack',
        carbsGrams: row.carbs_grams ?? 0,
      };
    case 'activity':
      return {
        ...base,
        kind: 'activity',
        activityType: row.activity_type ?? 'other',
        durationMinutes: row.duration_minutes ?? 0,
        intensity: row.intensity ?? 'moderate',
      };
    case 'sleep':
      return {
        ...base,
        kind: 'sleep',
        end: row.end_ms ?? row.start_ms,
        durationMinutes: row.duration_minutes ?? 0,
        qualityPercent: row.quality_percent ?? undefined,
      };
    case 'weight':
      return {
        ...base,
        kind: 'weight',
        kilograms: row.kilograms ?? 0,
      };
    case 'medication':
      return {
        ...base,
        kind: 'medication',
        amount: row.amount ?? undefined,
        unit: row.unit ?? undefined,
      };
  }
}

function parseWarnings(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function importFromRow(row: ImportRow): StoredImportBatch {
  return {
    id: row.id,
    sourceId: row.source_id,
    fileName: row.file_name,
    fileSha256: row.file_sha256,
    importedAt: row.imported_at_ms,
    dataStart: row.data_start_ms ?? undefined,
    dataThrough: row.data_through_ms ?? undefined,
    basalCount: row.basal_count,
    bolusCount: row.bolus_count,
    contextCount: row.context_count,
    duplicateCount: row.duplicate_count,
    skippedCount: row.skipped_count,
    warnings: parseWarnings(row.warnings_json),
  };
}

function contextColumns(event: HealthContextEvent) {
  return {
    mealType: event.kind === 'meal' ? event.mealType : null,
    carbsGrams: event.kind === 'meal' ? event.carbsGrams : null,
    activityType: event.kind === 'activity' ? event.activityType : null,
    durationMinutes:
      event.kind === 'activity' || event.kind === 'sleep'
        ? event.durationMinutes
        : null,
    intensity: event.kind === 'activity' ? event.intensity : null,
    qualityPercent:
      event.kind === 'sleep' ? event.qualityPercent ?? null : null,
    kilograms: event.kind === 'weight' ? event.kilograms : null,
    amount: event.kind === 'medication' ? event.amount ?? null : null,
    unit: event.kind === 'medication' ? event.unit ?? null : null,
  };
}

export class SqliteHealthRecordStore implements HealthRecordStore {
  private database?: SQLiteDatabase;

  private async getDatabase() {
    this.database ??= await openDaymarkDatabase();
    return this.database;
  }

  async initialize() {
    await this.getDatabase();
  }

  async getBasalDeliveries(range: TimeRange) {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<BasalRow>(
      `SELECT * FROM insulin_basal
       WHERE start_ms < ? AND end_ms > ?
       ORDER BY start_ms ASC`,
      range.end,
      range.start,
    );
    return rows.map(basalFromRow);
  }

  async getBolusDeliveries(range: TimeRange) {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<BolusRow>(
      `SELECT * FROM insulin_bolus
       WHERE timestamp_ms >= ? AND timestamp_ms < ?
       ORDER BY timestamp_ms ASC`,
      range.start,
      range.end,
    );
    return rows.map(bolusFromRow);
  }

  async getContextEvents(range: TimeRange) {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<ContextRow>(
      `SELECT e.* FROM context_events e
       WHERE e.start_ms < ? AND COALESCE(e.end_ms, e.start_ms) >= ?
         AND (
           e.source_id NOT LIKE 'health-connect:%'
           OR NOT EXISTS (
             SELECT 1 FROM health_connect_preferences p
             WHERE p.category = CASE e.kind
               WHEN 'activity' THEN 'workouts'
               WHEN 'sleep' THEN 'sleep'
               WHEN 'weight' THEN 'weight'
               ELSE ''
             END
               AND p.preferred_source_package IS NOT NULL
               AND e.source_id !=
                 'health-connect:' || p.preferred_source_package
           )
         )
       ORDER BY e.start_ms ASC`,
      range.end,
      range.start,
    );
    return rows.map(contextFromRow);
  }

  async getInsulinBounds(): Promise<StoredRecordBounds> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<{
      earliest: number | null;
      latest: number | null;
      count: number;
      last_recorded_at: number | null;
    }>(`
      SELECT
        MIN(earliest) AS earliest,
        MAX(latest) AS latest,
        SUM(record_count) AS count,
        MAX(last_recorded_at) AS last_recorded_at
      FROM (
        SELECT MIN(start_ms) AS earliest, MAX(end_ms) AS latest,
          COUNT(*) AS record_count, MAX(imported_at_ms) AS last_recorded_at
        FROM insulin_basal
        UNION ALL
        SELECT MIN(timestamp_ms) AS earliest, MAX(timestamp_ms) AS latest,
          COUNT(*) AS record_count, MAX(imported_at_ms) AS last_recorded_at
        FROM insulin_bolus
      )
    `);
    return {
      earliest: row?.earliest ?? undefined,
      latest: row?.latest ?? undefined,
      lastRecordedAt: row?.last_recorded_at ?? undefined,
      count: row?.count ?? 0,
    };
  }

  async getContextBounds(): Promise<StoredRecordBounds> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<{
      earliest: number | null;
      latest: number | null;
      count: number;
      last_recorded_at: number | null;
    }>(
      `SELECT MIN(start_ms) AS earliest,
         MAX(COALESCE(end_ms, start_ms)) AS latest,
         COUNT(*) AS count,
         MAX(recorded_at_ms) AS last_recorded_at
       FROM context_events`,
    );
    return {
      earliest: row?.earliest ?? undefined,
      latest: row?.latest ?? undefined,
      lastRecordedAt: row?.last_recorded_at ?? undefined,
      count: row?.count ?? 0,
    };
  }

  async getLatestImport(sourceId: string) {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<ImportRow>(
      `SELECT * FROM import_batches
       WHERE source_id = ?
       ORDER BY imported_at_ms DESC LIMIT 1`,
      sourceId,
    );
    return row ? importFromRow(row) : undefined;
  }

  async getLatestImportSourcePayload(
    sourceId: string,
  ): Promise<StoredImportSourcePayload | undefined> {
    const database = await this.getDatabase();
    const batchRow = await database.getFirstAsync<ImportRow>(
      `SELECT b.* FROM import_batches b
       INNER JOIN import_source_payloads p ON p.import_batch_id = b.id
       WHERE b.source_id = ?
       ORDER BY p.stored_at_ms DESC LIMIT 1`,
      sourceId,
    );
    if (!batchRow) return undefined;
    const sourceRow = await database.getFirstAsync<{
      format: 'zip' | 'csv';
      manifest_json: string;
      payload_bytes: Uint8Array | ArrayBuffer;
    }>(
      `SELECT format, manifest_json, payload_bytes
       FROM import_source_payloads
       WHERE import_batch_id = ?`,
      batchRow.id,
    );
    if (!sourceRow) return undefined;
    let entries: ImportSourcePayload['entries'] = [];
    try {
      const parsed: unknown = JSON.parse(sourceRow.manifest_json);
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (entry): entry is ImportSourcePayload['entries'][number] =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { name?: unknown }).name === 'string' &&
            ((entry as { handling?: unknown }).handling === 'loaded' ||
              (entry as { handling?: unknown }).handling === 'retained'),
        );
      }
    } catch {
      // The exact payload remains usable even if old optional diagnostics do not.
    }
    const payloadBytes =
      sourceRow.payload_bytes instanceof Uint8Array
        ? sourceRow.payload_bytes.slice()
        : new Uint8Array(sourceRow.payload_bytes.slice(0));
    return {
      batch: importFromRow(batchRow),
      payload: {
        format: sourceRow.format,
        bytes: payloadBytes,
        entries,
      },
    };
  }

  async hasImportSourcePayload(sourceId: string) {
    const database = await this.getDatabase();
    return Boolean(
      await database.getFirstAsync<{ source_id: string }>(
        `SELECT source_id FROM import_source_payloads
         WHERE source_id = ? LIMIT 1`,
        sourceId,
      ),
    );
  }

  async writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
  ): Promise<ImportWriteResult> {
    const database = await this.getDatabase();
    let result: ImportWriteResult | undefined;

    await withDaymarkTransaction(async (transaction) => {
      const existing = await transaction.getFirstAsync<ImportRow>(
        `SELECT * FROM import_batches
         WHERE source_id = ? AND file_sha256 = ?`,
        batch.sourceId,
        batch.fileSha256,
      );
      let insertedBasal = 0;
      let insertedBoluses = 0;
      let insertedContext = 0;

      for (const delivery of basal) {
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO insulin_basal (
             id, source_id, start_ms, end_ms, rate_units_per_hour, units,
             imported_at_ms, source_file, source_row
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          delivery.id,
          delivery.sourceId,
          delivery.start,
          delivery.end,
          delivery.rateUnitsPerHour,
          delivery.units,
          delivery.importedAt ?? batch.importedAt,
          delivery.sourceFile ?? null,
          delivery.sourceRow ?? null,
        );
        insertedBasal += write.changes;
      }

      for (const delivery of boluses) {
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO insulin_bolus (
             id, source_id, timestamp_ms, units, imported_at_ms, source_file,
             source_row
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          delivery.id,
          delivery.sourceId,
          delivery.timestamp,
          delivery.units,
          delivery.importedAt ?? batch.importedAt,
          delivery.sourceFile ?? null,
          delivery.sourceRow ?? null,
        );
        insertedBoluses += write.changes;
      }

      for (const event of context) {
        const values = contextColumns(event);
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO context_events (
             id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
             carbs_grams, activity_type, duration_minutes, intensity,
             quality_percent, kilograms, amount, unit, recorded_at_ms,
             source_file, source_row
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.sourceId,
          event.origin,
          event.kind,
          event.start,
          event.end ?? null,
          event.title,
          values.mealType,
          values.carbsGrams,
          values.activityType,
          values.durationMinutes,
          values.intensity,
          values.qualityPercent,
          values.kilograms,
          values.amount,
          values.unit,
          event.recordedAt ?? batch.importedAt,
          event.sourceFile ?? null,
          event.sourceRow ?? null,
        );
        insertedContext += write.changes;
      }

      const duplicateCount =
        basal.length +
        boluses.length +
        context.length -
        insertedBasal -
        insertedBoluses -
        insertedContext;
      let stored: StoredImportBatch;
      if (existing) {
        const previous = importFromRow(existing);
        stored = {
          ...previous,
          dataStart:
            batch.dataStart === undefined
              ? previous.dataStart
              : previous.dataStart === undefined
                ? batch.dataStart
                : Math.min(previous.dataStart, batch.dataStart),
          dataThrough:
            batch.dataThrough === undefined
              ? previous.dataThrough
              : previous.dataThrough === undefined
                ? batch.dataThrough
                : Math.max(previous.dataThrough, batch.dataThrough),
          basalCount: previous.basalCount + insertedBasal,
          bolusCount: previous.bolusCount + insertedBoluses,
          contextCount: previous.contextCount + insertedContext,
          duplicateCount: previous.duplicateCount + duplicateCount,
          skippedCount: batch.skippedCount,
          warnings: [...batch.warnings],
        };
        await transaction.runAsync(
          `UPDATE import_batches SET
             data_start_ms = ?, data_through_ms = ?,
             basal_count = ?, bolus_count = ?, context_count = ?,
             duplicate_count = ?, skipped_count = ?, warnings_json = ?
           WHERE id = ?`,
          stored.dataStart ?? null,
          stored.dataThrough ?? null,
          stored.basalCount,
          stored.bolusCount,
          stored.contextCount,
          stored.duplicateCount,
          stored.skippedCount,
          JSON.stringify(stored.warnings),
          existing.id,
        );
      } else {
        stored = {
          ...batch,
          basalCount: insertedBasal,
          bolusCount: insertedBoluses,
          contextCount: insertedContext,
          duplicateCount,
        };
        await transaction.runAsync(
          `INSERT INTO import_batches (
             id, source_id, file_name, file_sha256, imported_at_ms,
             data_start_ms, data_through_ms, basal_count, bolus_count,
             context_count, duplicate_count, skipped_count, warnings_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          batch.id,
          batch.sourceId,
          batch.fileName,
          batch.fileSha256,
          batch.importedAt,
          batch.dataStart ?? null,
          batch.dataThrough ?? null,
          insertedBasal,
          insertedBoluses,
          insertedContext,
          duplicateCount,
          batch.skippedCount,
          JSON.stringify(batch.warnings),
        );
      }
      let sourcePayloadStored = false;
      if (sourcePayload) {
        await transaction.runAsync(
          `INSERT OR IGNORE INTO import_source_payloads (
             import_batch_id, source_id, file_name, file_sha256, format,
             byte_length, manifest_json, payload_bytes, stored_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          existing?.id ?? batch.id,
          batch.sourceId,
          batch.fileName,
          batch.fileSha256,
          sourcePayload.format,
          sourcePayload.bytes.length,
          JSON.stringify(sourcePayload.entries),
          sourcePayload.bytes,
          batch.importedAt,
        );
        sourcePayloadStored = true;
      } else {
        sourcePayloadStored = Boolean(
          await transaction.getFirstAsync<{ import_batch_id: string }>(
            `SELECT import_batch_id FROM import_source_payloads
             WHERE import_batch_id = ?`,
            existing?.id ?? batch.id,
          ),
        );
      }
      result = {
        alreadyImported: Boolean(existing),
        insertedBasal,
        insertedBoluses,
        insertedContext,
        duplicateCount,
        sourcePayloadStored,
        batch: stored,
      };
    });

    if (!result) throw new Error('The import transaction did not complete.');
    return result;
  }

  async saveManualContext(event: HealthContextEvent) {
    if (event.origin !== 'manual') {
      throw new Error('Only manual context can be saved through this method.');
    }
    const database = await this.getDatabase();
    const values = contextColumns(event);
    await database.runAsync(
      `INSERT INTO context_events (
         id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
         carbs_grams, activity_type, duration_minutes, intensity,
         quality_percent, kilograms, amount, unit, recorded_at_ms,
         source_file, source_row
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_ms = excluded.start_ms,
         end_ms = excluded.end_ms,
         title = excluded.title,
         meal_type = excluded.meal_type,
         carbs_grams = excluded.carbs_grams,
         activity_type = excluded.activity_type,
         duration_minutes = excluded.duration_minutes,
         intensity = excluded.intensity,
         quality_percent = excluded.quality_percent,
         kilograms = excluded.kilograms,
         amount = excluded.amount,
         unit = excluded.unit,
         recorded_at_ms = excluded.recorded_at_ms`,
      event.id,
      event.sourceId,
      event.origin,
      event.kind,
      event.start,
      event.end ?? null,
      event.title,
      values.mealType,
      values.carbsGrams,
      values.activityType,
      values.durationMinutes,
      values.intensity,
      values.qualityPercent,
      values.kilograms,
      values.amount,
      values.unit,
      event.recordedAt ?? Date.now(),
      event.sourceFile ?? null,
      event.sourceRow ?? null,
    );
  }

  async deleteManualContext(id: string) {
    const database = await this.getDatabase();
    const result = await database.runAsync(
      `DELETE FROM context_events WHERE id = ? AND origin = 'manual'`,
      id,
    );
    return result.changes > 0;
  }

  async clearImportedSource(
    sourceId: string,
  ): Promise<ImportedSourceDeleteResult> {
    const database = await this.getDatabase();
    const removed: ImportedSourceDeleteResult = {
      basal: 0,
      boluses: 0,
      context: 0,
      batches: 0,
    };
    await withDaymarkTransaction(async (transaction) => {
      removed.basal = (
        await transaction.runAsync(
          'DELETE FROM insulin_basal WHERE source_id = ?',
          sourceId,
        )
      ).changes;
      removed.boluses = (
        await transaction.runAsync(
          'DELETE FROM insulin_bolus WHERE source_id = ?',
          sourceId,
        )
      ).changes;
      removed.context = (
        await transaction.runAsync(
          `DELETE FROM context_events
           WHERE source_id = ? AND origin = 'imported'`,
          sourceId,
        )
      ).changes;
      removed.batches = (
        await transaction.runAsync(
          'DELETE FROM import_batches WHERE source_id = ?',
          sourceId,
        )
      ).changes;
    });
    return removed;
  }
}
