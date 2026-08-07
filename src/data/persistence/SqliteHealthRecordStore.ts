import { SQLiteDatabase } from 'expo-sqlite';

import {
  ActivityEvent,
  BasalDelivery,
  BolusDelivery,
  ContextNoteEvent,
  HealthContextEvent,
  InsulinDailyTotal,
  MealEvent,
  MedicationEvent,
  SleepEvent,
  TimeRange,
  WeightEvent,
} from '@/domain/models';

import {
  HealthRecordStore,
  ImportBatch,
  ImportRawRecord,
  ImportSourcePayload,
  ImportedSourceDeleteResult,
  ImportWriteResult,
  pumpStateIntervalFromRawRecord,
  StoredImportBatch,
  StoredImportSourcePayload,
  StoredImportSourceReference,
  StoredImportSourceSummary,
  StoredRecordBounds,
} from './HealthRecordStore';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from './daymarkDatabase';
import {
  HealthConnectContextPreference,
  selectHealthConnectContext,
} from '@/data/healthConnect/healthConnectContextSelection';

interface BasalRow {
  id: string;
  source_id: string;
  start_ms: number;
  end_ms: number;
  rate_units_per_hour: number;
  units: number;
  delivery_type: string | null;
  percentage: number | null;
  units_estimated: number;
  imported_at_ms: number;
  source_file: string | null;
  source_row: number | null;
  source_device_id: string | null;
}

interface BolusRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  units: number;
  delivery_type: string | null;
  blood_glucose_input_mmol_l: number | null;
  carbs_input_grams: number | null;
  carb_ratio_grams_per_unit: number | null;
  initial_units: number | null;
  extended_units: number | null;
  imported_at_ms: number;
  source_file: string | null;
  source_row: number | null;
  source_device_id: string | null;
}

interface DailyInsulinTotalRow {
  id: string;
  source_id: string;
  timestamp_ms: number;
  date_key: string;
  basal_units: number | null;
  bolus_units: number | null;
  total_units: number;
  imported_at_ms: number;
  source_file: string | null;
  source_row: number | null;
  source_device_id: string | null;
}

interface ContextRow {
  id: string;
  source_id: string;
  origin: 'manual' | 'imported' | 'synthetic';
  kind: Exclude<HealthContextEvent['kind'], 'note'>;
  start_ms: number;
  end_ms: number | null;
  title: string;
  meal_type: MealEvent['mealType'] | null;
  carbs_grams: number | null;
  energy_kcal: number | null;
  protein_grams: number | null;
  fat_grams: number | null;
  serving_quantity: number | null;
  serving_count: number | null;
  activity_type: ActivityEvent['activityType'] | null;
  duration_minutes: number | null;
  intensity: ActivityEvent['intensity'] | null;
  calories_burned: number | null;
  quality_percent: number | null;
  kilograms: number | null;
  amount: number | null;
  unit: string | null;
  medication_type: string | null;
  recorded_at_ms: number;
  source_file: string | null;
  source_row: number | null;
}

interface ContextNoteRow {
  id: string;
  source_id: string;
  origin: 'manual' | 'imported' | 'synthetic';
  start_ms: number;
  end_ms: number | null;
  title: string;
  category: ContextNoteEvent['category'];
  detail: string | null;
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
  daily_total_count: number;
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
    deliveryType: row.delivery_type ?? undefined,
    percentage: row.percentage ?? undefined,
    unitsEstimated: row.units_estimated === 1,
    importedAt: row.imported_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
    sourceDeviceId: row.source_device_id ?? undefined,
  };
}

function bolusFromRow(row: BolusRow): BolusDelivery {
  return {
    id: row.id,
    sourceId: row.source_id,
    timestamp: row.timestamp_ms,
    units: row.units,
    deliveryType: row.delivery_type ?? undefined,
    bloodGlucoseInputMmolL:
      row.blood_glucose_input_mmol_l ?? undefined,
    carbsInputGrams: row.carbs_input_grams ?? undefined,
    carbRatioGramsPerUnit:
      row.carb_ratio_grams_per_unit ?? undefined,
    initialUnits: row.initial_units ?? undefined,
    extendedUnits: row.extended_units ?? undefined,
    importedAt: row.imported_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
    sourceDeviceId: row.source_device_id ?? undefined,
  };
}

function dailyInsulinTotalFromRow(
  row: DailyInsulinTotalRow,
): InsulinDailyTotal {
  return {
    id: row.id,
    sourceId: row.source_id,
    timestamp: row.timestamp_ms,
    dateKey: row.date_key,
    basalUnits: row.basal_units ?? undefined,
    bolusUnits: row.bolus_units ?? undefined,
    totalUnits: row.total_units,
    importedAt: row.imported_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
    sourceDeviceId: row.source_device_id ?? undefined,
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
        energyKcal: row.energy_kcal ?? undefined,
        proteinGrams: row.protein_grams ?? undefined,
        fatGrams: row.fat_grams ?? undefined,
        servingQuantity: row.serving_quantity ?? undefined,
        servingCount: row.serving_count ?? undefined,
      };
    case 'activity':
      return {
        ...base,
        kind: 'activity',
        activityType: row.activity_type ?? 'other',
        durationMinutes: row.duration_minutes ?? 0,
        intensity: row.intensity ?? 'moderate',
        caloriesBurned: row.calories_burned ?? undefined,
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
        medicationType: row.medication_type ?? undefined,
      };
  }
}

function noteFromRow(row: ContextNoteRow): ContextNoteEvent {
  return {
    id: row.id,
    sourceId: row.source_id,
    origin: row.origin,
    kind: 'note',
    start: row.start_ms,
    end: row.end_ms ?? undefined,
    title: row.title,
    category: row.category,
    detail: row.detail ?? undefined,
    recordedAt: row.recorded_at_ms,
    sourceFile: row.source_file ?? undefined,
    sourceRow: row.source_row ?? undefined,
  };
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
    dailyTotalCount: row.daily_total_count,
    duplicateCount: row.duplicate_count,
    skippedCount: row.skipped_count,
    warnings: parseWarnings(row.warnings_json),
  };
}

function contextColumns(event: HealthContextEvent) {
  return {
    mealType: event.kind === 'meal' ? event.mealType : null,
    carbsGrams: event.kind === 'meal' ? event.carbsGrams : null,
    energyKcal: event.kind === 'meal' ? event.energyKcal ?? null : null,
    proteinGrams:
      event.kind === 'meal' ? event.proteinGrams ?? null : null,
    fatGrams: event.kind === 'meal' ? event.fatGrams ?? null : null,
    servingQuantity:
      event.kind === 'meal' ? event.servingQuantity ?? null : null,
    servingCount:
      event.kind === 'meal' ? event.servingCount ?? null : null,
    activityType: event.kind === 'activity' ? event.activityType : null,
    durationMinutes:
      event.kind === 'activity' || event.kind === 'sleep'
        ? event.durationMinutes
        : null,
    intensity: event.kind === 'activity' ? event.intensity : null,
    caloriesBurned:
      event.kind === 'activity' ? event.caloriesBurned ?? null : null,
    qualityPercent:
      event.kind === 'sleep' ? event.qualityPercent ?? null : null,
    kilograms: event.kind === 'weight' ? event.kilograms : null,
    amount: event.kind === 'medication' ? event.amount ?? null : null,
    unit: event.kind === 'medication' ? event.unit ?? null : null,
    medicationType:
      event.kind === 'medication' ? event.medicationType ?? null : null,
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

  async getPumpStateIntervals(range: TimeRange) {
    const records = (
      await Promise.all(
        ['glooko-export', 'nightscout'].map((sourceId) =>
          this.getRawSourceRecords(
            sourceId,
            {
              start: range.start - 24 * 60 * 60 * 1000,
              end: range.end,
            },
            ['pump-state-interval'],
          ),
        ),
      )
    ).flat();
    return records
      .flatMap((record) => {
        const interval = pumpStateIntervalFromRawRecord(record);
        return interval &&
          interval.start < range.end &&
          interval.end > range.start
          ? [interval]
          : [];
      })
      .sort((left, right) => left.start - right.start);
  }

  async getDailyInsulinTotals(range: TimeRange) {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<DailyInsulinTotalRow>(
      `SELECT * FROM insulin_daily_totals
       WHERE timestamp_ms >= ? AND timestamp_ms < ?
       ORDER BY timestamp_ms ASC`,
      range.start,
      range.end,
    );
    return rows.map(dailyInsulinTotalFromRow);
  }

  async getContextEvents(range: TimeRange) {
    const database = await this.getDatabase();
    const [rows, notes, preferences] = await Promise.all([
      database.getAllAsync<ContextRow>(
        `SELECT * FROM context_events
         WHERE start_ms < ? AND COALESCE(end_ms, start_ms) >= ?
         ORDER BY start_ms ASC`,
        range.end,
        range.start,
      ),
      database.getAllAsync<ContextNoteRow>(
        `SELECT * FROM context_notes
         WHERE start_ms < ? AND COALESCE(end_ms, start_ms) >= ?
         ORDER BY start_ms ASC`,
        range.end,
        range.start,
      ),
      database.getAllAsync<{
        category: HealthConnectContextPreference['category'];
        preferred_source_package: string | null;
      }>(
        `SELECT category, preferred_source_package
         FROM health_connect_preferences
         WHERE category IN (
           'workouts', 'sleep', 'weight', 'nutrition', 'cycle'
         )`,
      ),
    ]);
    const context = [
      ...rows.map(contextFromRow),
      ...notes.map(noteFromRow),
    ].sort((a, b) => a.start - b.start);
    return selectHealthConnectContext(
      context,
      preferences.map((preference) => ({
        category: preference.category,
        preferredSourcePackage:
          preference.preferred_source_package ?? undefined,
      })),
    ).events;
  }

  async getRawSourceRecords(
    sourceId: string,
    range?: TimeRange,
    recordKinds?: string[],
  ): Promise<ImportRawRecord[]> {
    const database = await this.getDatabase();
    const clauses = ['source_id = ?'];
    const values: Array<string | number> = [sourceId];
    if (range) {
      clauses.push(
        '(timestamp_ms IS NULL OR (timestamp_ms >= ? AND timestamp_ms < ?))',
      );
      values.push(range.start, range.end);
    }
    if (recordKinds?.length) {
      clauses.push(
        `record_kind IN (${recordKinds.map(() => '?').join(', ')})`,
      );
      values.push(...recordKinds);
    }
    const rows = await database.getAllAsync<{
      id: string;
      source_id: string;
      record_kind: string;
      timestamp_ms: number | null;
      source_file: string;
      source_row: number;
      payload_json: string;
      last_seen_at_ms: number;
    }>(
      `SELECT id, source_id, record_kind, timestamp_ms, source_file,
              source_row, payload_json, last_seen_at_ms
         FROM import_raw_records
        WHERE ${clauses.join(' AND ')}
        ORDER BY COALESCE(timestamp_ms, last_seen_at_ms) ASC`,
      ...values,
    );
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      recordKind: row.record_kind,
      timestamp: row.timestamp_ms ?? undefined,
      sourceFile: row.source_file,
      sourceRow: row.source_row,
      payloadJson: row.payload_json,
      importedAt: row.last_seen_at_ms,
    }));
  }

  async getRawSourceRecordsByIds(
    recordIds: readonly string[],
  ): Promise<ImportRawRecord[]> {
    const records: ImportRawRecord[] = [];
    if (!recordIds.length) return records;
    const database = await this.getDatabase();
    for (let offset = 0; offset < recordIds.length; offset += 400) {
      const batch = recordIds.slice(offset, offset + 400);
      const placeholders = batch.map(() => '?').join(',');
      const rows = await database.getAllAsync<{
        id: string;
        source_id: string;
        record_kind: string;
        timestamp_ms: number | null;
        source_file: string;
        source_row: number;
        payload_json: string;
        last_seen_at_ms: number;
      }>(
        `SELECT id, source_id, record_kind, timestamp_ms, source_file,
                source_row, payload_json, last_seen_at_ms
           FROM import_raw_records
          WHERE id IN (${placeholders})`,
        ...batch,
      );
      records.push(
        ...rows.map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          recordKind: row.record_kind,
          timestamp: row.timestamp_ms ?? undefined,
          sourceFile: row.source_file,
          sourceRow: row.source_row,
          payloadJson: row.payload_json,
          importedAt: row.last_seen_at_ms,
        })),
      );
    }
    return records.sort(
      (left, right) =>
        (left.timestamp ?? left.importedAt) -
        (right.timestamp ?? right.importedAt),
    );
  }

  async getRecordsByIds(recordIds: readonly string[]) {
    const basal: BasalDelivery[] = [];
    const boluses: BolusDelivery[] = [];
    const dailyInsulinTotals: InsulinDailyTotal[] = [];
    const context: HealthContextEvent[] = [];
    if (!recordIds.length) {
      return { basal, boluses, dailyInsulinTotals, context };
    }
    const database = await this.getDatabase();
    for (let offset = 0; offset < recordIds.length; offset += 400) {
      const batch = recordIds.slice(offset, offset + 400);
      const placeholders = batch.map(() => '?').join(',');
      const [basalRows, bolusRows, dailyRows, contextRows, noteRows] =
        await Promise.all([
          database.getAllAsync<BasalRow>(
            `SELECT * FROM insulin_basal WHERE id IN (${placeholders})`,
            ...batch,
          ),
          database.getAllAsync<BolusRow>(
            `SELECT * FROM insulin_bolus WHERE id IN (${placeholders})`,
            ...batch,
          ),
          database.getAllAsync<DailyInsulinTotalRow>(
            `SELECT * FROM insulin_daily_totals WHERE id IN (${placeholders})`,
            ...batch,
          ),
          database.getAllAsync<ContextRow>(
            `SELECT * FROM context_events WHERE id IN (${placeholders})`,
            ...batch,
          ),
          database.getAllAsync<ContextNoteRow>(
            `SELECT * FROM context_notes WHERE id IN (${placeholders})`,
            ...batch,
          ),
        ]);
      basal.push(...basalRows.map(basalFromRow));
      boluses.push(...bolusRows.map(bolusFromRow));
      dailyInsulinTotals.push(...dailyRows.map(dailyInsulinTotalFromRow));
      context.push(
        ...contextRows.map(contextFromRow),
        ...noteRows.map(noteFromRow),
      );
    }
    basal.sort((a, b) => a.start - b.start);
    boluses.sort((a, b) => a.timestamp - b.timestamp);
    dailyInsulinTotals.sort((a, b) => a.timestamp - b.timestamp);
    context.sort((a, b) => a.start - b.start);
    return { basal, boluses, dailyInsulinTotals, context };
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
        UNION ALL
        SELECT MIN(timestamp_ms) AS earliest, MAX(timestamp_ms) AS latest,
          COUNT(*) AS record_count, MAX(imported_at_ms) AS last_recorded_at
        FROM insulin_daily_totals
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
      `SELECT MIN(earliest) AS earliest,
         MAX(latest) AS latest,
         SUM(record_count) AS count,
         MAX(last_recorded_at) AS last_recorded_at
       FROM (
         SELECT MIN(start_ms) AS earliest,
           MAX(COALESCE(end_ms, start_ms)) AS latest,
           COUNT(*) AS record_count,
           MAX(recorded_at_ms) AS last_recorded_at
         FROM context_events
         UNION ALL
         SELECT MIN(start_ms) AS earliest,
           MAX(COALESCE(end_ms, start_ms)) AS latest,
           COUNT(*) AS record_count,
           MAX(recorded_at_ms) AS last_recorded_at
         FROM context_notes
       )`,
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

  async getImportSourcePayloadReferences(
    sourceId: string,
  ): Promise<StoredImportSourceReference[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<{
      batch_id: string;
      stored_at_ms: number;
    }>(
      `SELECT import_batch_id AS batch_id, stored_at_ms
       FROM import_source_payloads
       WHERE source_id = ?
       ORDER BY stored_at_ms ASC`,
      sourceId,
    );
    return rows.map((row) => ({
      batchId: row.batch_id,
      storedAt: row.stored_at_ms,
    }));
  }

  async getImportSourcePayload(
    batchId: string,
  ): Promise<StoredImportSourcePayload | undefined> {
    const database = await this.getDatabase();
    const batchRow = await database.getFirstAsync<ImportRow>(
      `SELECT * FROM import_batches WHERE id = ?`,
      batchId,
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
      batchId,
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
      // The encrypted source bytes remain valid without old diagnostics.
    }
    return {
      batch: importFromRow(batchRow),
      payload: {
        format: sourceRow.format,
        bytes:
          sourceRow.payload_bytes instanceof Uint8Array
            ? sourceRow.payload_bytes.slice()
            : new Uint8Array(sourceRow.payload_bytes.slice(0)),
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

  async getImportSourceSummary(
    sourceId: string,
  ): Promise<StoredImportSourceSummary> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<{
      byte_length: number;
      manifest_json: string;
      stored_at_ms: number;
      data_start_ms: number | null;
      data_through_ms: number | null;
    }>(
      `SELECT p.byte_length, p.manifest_json, p.stored_at_ms,
         b.data_start_ms, b.data_through_ms
       FROM import_source_payloads p
       INNER JOIN import_batches b ON b.id = p.import_batch_id
       WHERE p.source_id = ?
       ORDER BY p.stored_at_ms ASC`,
      sourceId,
    );
    const summary: StoredImportSourceSummary = {
      archiveCount: rows.length,
      totalBytes: 0,
      loadedEntryCount: 0,
      retainedEntryCount: 0,
    };
    for (const row of rows) {
      summary.totalBytes += row.byte_length;
      summary.earliestStoredAt =
        summary.earliestStoredAt === undefined
          ? row.stored_at_ms
          : Math.min(summary.earliestStoredAt, row.stored_at_ms);
      summary.latestStoredAt =
        summary.latestStoredAt === undefined
          ? row.stored_at_ms
          : Math.max(summary.latestStoredAt, row.stored_at_ms);
      if (row.data_start_ms !== null) {
        summary.dataStart =
          summary.dataStart === undefined
            ? row.data_start_ms
            : Math.min(summary.dataStart, row.data_start_ms);
      }
      if (row.data_through_ms !== null) {
        summary.dataThrough =
          summary.dataThrough === undefined
            ? row.data_through_ms
            : Math.max(summary.dataThrough, row.data_through_ms);
      }
      try {
        const entries: unknown = JSON.parse(row.manifest_json);
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (
            typeof entry !== 'object' ||
            entry === null ||
            !('handling' in entry)
          ) {
            continue;
          }
          if (entry.handling === 'loaded') summary.loadedEntryCount += 1;
          if (entry.handling === 'retained') summary.retainedEntryCount += 1;
        }
      } catch {
        // Old optional manifest diagnostics must not hide retained archive data.
      }
    }
    summary.indexedRecordCount =
      (
        await database.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count
             FROM import_raw_records
            WHERE source_id = ?`,
          sourceId,
        )
      )?.count ?? 0;
    return summary;
  }

  async writeImport(
    batch: ImportBatch,
    basal: BasalDelivery[],
    boluses: BolusDelivery[],
    context: HealthContextEvent[],
    sourcePayload?: ImportSourcePayload,
    dailyTotals: InsulinDailyTotal[] = [],
    rawRecords: ImportRawRecord[] = [],
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
      let insertedDailyTotals = 0;

      for (const delivery of basal) {
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO insulin_basal (
             id, source_id, start_ms, end_ms, rate_units_per_hour, units,
             delivery_type, percentage, units_estimated, imported_at_ms,
             source_file, source_row, source_device_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          delivery.id,
          delivery.sourceId,
          delivery.start,
          delivery.end,
          delivery.rateUnitsPerHour,
          delivery.units,
          delivery.deliveryType ?? null,
          delivery.percentage ?? null,
          delivery.unitsEstimated ? 1 : 0,
          delivery.importedAt ?? batch.importedAt,
          delivery.sourceFile ?? null,
          delivery.sourceRow ?? null,
          delivery.sourceDeviceId ?? null,
        );
        insertedBasal += write.changes;
      }

      for (const delivery of boluses) {
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO insulin_bolus (
             id, source_id, timestamp_ms, units, delivery_type,
             blood_glucose_input_mmol_l, carbs_input_grams,
             carb_ratio_grams_per_unit, initial_units, extended_units,
             imported_at_ms, source_file, source_row, source_device_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          delivery.id,
          delivery.sourceId,
          delivery.timestamp,
          delivery.units,
          delivery.deliveryType ?? null,
          delivery.bloodGlucoseInputMmolL ?? null,
          delivery.carbsInputGrams ?? null,
          delivery.carbRatioGramsPerUnit ?? null,
          delivery.initialUnits ?? null,
          delivery.extendedUnits ?? null,
          delivery.importedAt ?? batch.importedAt,
          delivery.sourceFile ?? null,
          delivery.sourceRow ?? null,
          delivery.sourceDeviceId ?? null,
        );
        insertedBoluses += write.changes;
      }

      for (const event of context) {
        if (event.kind === 'note') {
          const write = await transaction.runAsync(
            `INSERT OR IGNORE INTO context_notes (
               id, source_id, origin, start_ms, end_ms, title, category, detail,
               recorded_at_ms, source_file, source_row
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            event.id,
            event.sourceId,
            event.origin,
            event.start,
            event.end ?? null,
            event.title,
            event.category,
            event.detail ?? null,
            event.recordedAt ?? batch.importedAt,
            event.sourceFile ?? null,
            event.sourceRow ?? null,
          );
          insertedContext += write.changes;
          continue;
        }
        const values = contextColumns(event);
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO context_events (
             id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
             carbs_grams, energy_kcal, protein_grams, fat_grams,
             serving_quantity, serving_count, activity_type, duration_minutes,
             intensity, calories_burned, quality_percent, kilograms, amount,
             unit, medication_type, recorded_at_ms, source_file, source_row
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.id,
          event.sourceId,
          event.origin,
          event.kind,
          event.start,
          event.end ?? null,
          event.title,
          values.mealType,
          values.carbsGrams,
          values.energyKcal,
          values.proteinGrams,
          values.fatGrams,
          values.servingQuantity,
          values.servingCount,
          values.activityType,
          values.durationMinutes,
          values.intensity,
          values.caloriesBurned,
          values.qualityPercent,
          values.kilograms,
          values.amount,
          values.unit,
          values.medicationType,
          event.recordedAt ?? batch.importedAt,
          event.sourceFile ?? null,
          event.sourceRow ?? null,
        );
        insertedContext += write.changes;
      }

      for (const total of dailyTotals) {
        const write = await transaction.runAsync(
          `INSERT OR IGNORE INTO insulin_daily_totals (
             id, source_id, timestamp_ms, date_key, basal_units, bolus_units,
             total_units, imported_at_ms, source_file, source_row,
             source_device_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          total.id,
          total.sourceId,
          total.timestamp,
          total.dateKey,
          total.basalUnits ?? null,
          total.bolusUnits ?? null,
          total.totalUnits,
          total.importedAt ?? batch.importedAt,
          total.sourceFile ?? null,
          total.sourceRow ?? null,
          total.sourceDeviceId ?? null,
        );
        insertedDailyTotals += write.changes;
      }

      for (const record of rawRecords) {
        await transaction.runAsync(
          `INSERT INTO import_raw_records (
             id, source_id, record_kind, timestamp_ms, source_file, source_row,
             payload_json, first_import_batch_id, first_seen_at_ms,
             last_import_batch_id, last_seen_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             last_import_batch_id = excluded.last_import_batch_id,
             last_seen_at_ms = MAX(
               import_raw_records.last_seen_at_ms,
               excluded.last_seen_at_ms
             )`,
          record.id,
          record.sourceId,
          record.recordKind,
          record.timestamp ?? null,
          record.sourceFile,
          record.sourceRow,
          record.payloadJson,
          existing?.id ?? batch.id,
          record.importedAt,
          existing?.id ?? batch.id,
          record.importedAt,
        );
      }

      const duplicateCount =
        basal.length +
        boluses.length +
        context.length +
        dailyTotals.length -
        insertedBasal -
        insertedBoluses -
        insertedContext -
        insertedDailyTotals;
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
          dailyTotalCount:
            previous.dailyTotalCount + insertedDailyTotals,
          duplicateCount: previous.duplicateCount + duplicateCount,
          skippedCount: batch.skippedCount,
          warnings: [...batch.warnings],
        };
        await transaction.runAsync(
          `UPDATE import_batches SET
             data_start_ms = ?, data_through_ms = ?,
             basal_count = ?, bolus_count = ?, context_count = ?,
             daily_total_count = ?,
             duplicate_count = ?, skipped_count = ?, warnings_json = ?
           WHERE id = ?`,
          stored.dataStart ?? null,
          stored.dataThrough ?? null,
          stored.basalCount,
          stored.bolusCount,
          stored.contextCount,
          stored.dailyTotalCount,
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
          dailyTotalCount: insertedDailyTotals,
          duplicateCount,
        };
        await transaction.runAsync(
          `INSERT INTO import_batches (
             id, source_id, file_name, file_sha256, imported_at_ms,
             data_start_ms, data_through_ms, basal_count, bolus_count,
             context_count, daily_total_count, duplicate_count, skipped_count,
             warnings_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          insertedDailyTotals,
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
        insertedGlucose: 0,
        insertedBasal,
        insertedBoluses,
        insertedContext,
        insertedDailyTotals,
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
    if (event.kind === 'note') {
      await database.runAsync(
        `INSERT INTO context_notes (
           id, source_id, origin, start_ms, end_ms, title, category, detail,
           recorded_at_ms, source_file, source_row
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           title = excluded.title,
           category = excluded.category,
           detail = excluded.detail,
           recorded_at_ms = excluded.recorded_at_ms`,
        event.id,
        event.sourceId,
        event.origin,
        event.start,
        event.end ?? null,
        event.title,
        event.category,
        event.detail ?? null,
        event.recordedAt ?? Date.now(),
        event.sourceFile ?? null,
        event.sourceRow ?? null,
      );
      return;
    }
    const values = contextColumns(event);
    await database.runAsync(
      `INSERT INTO context_events (
         id, source_id, origin, kind, start_ms, end_ms, title, meal_type,
         carbs_grams, energy_kcal, protein_grams, fat_grams,
         serving_quantity, serving_count, activity_type, duration_minutes,
         intensity, calories_burned, quality_percent, kilograms, amount,
         unit, medication_type, recorded_at_ms, source_file, source_row
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_ms = excluded.start_ms,
         end_ms = excluded.end_ms,
         title = excluded.title,
         meal_type = excluded.meal_type,
         carbs_grams = excluded.carbs_grams,
         energy_kcal = excluded.energy_kcal,
         protein_grams = excluded.protein_grams,
         fat_grams = excluded.fat_grams,
         serving_quantity = excluded.serving_quantity,
         serving_count = excluded.serving_count,
         activity_type = excluded.activity_type,
         duration_minutes = excluded.duration_minutes,
         intensity = excluded.intensity,
         calories_burned = excluded.calories_burned,
         quality_percent = excluded.quality_percent,
         kilograms = excluded.kilograms,
         amount = excluded.amount,
         unit = excluded.unit,
         medication_type = excluded.medication_type,
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
      values.energyKcal,
      values.proteinGrams,
      values.fatGrams,
      values.servingQuantity,
      values.servingCount,
      values.activityType,
      values.durationMinutes,
      values.intensity,
      values.caloriesBurned,
      values.qualityPercent,
      values.kilograms,
      values.amount,
      values.unit,
      values.medicationType,
      event.recordedAt ?? Date.now(),
      event.sourceFile ?? null,
      event.sourceRow ?? null,
    );
  }

  async deleteManualContext(id: string) {
    const database = await this.getDatabase();
    const eventResult = await database.runAsync(
      `DELETE FROM context_events WHERE id = ? AND origin = 'manual'`,
      id,
    );
    const noteResult = await database.runAsync(
      `DELETE FROM context_notes WHERE id = ? AND origin = 'manual'`,
      id,
    );
    return eventResult.changes + noteResult.changes > 0;
  }

  async clearImportedSource(
    sourceId: string,
  ): Promise<ImportedSourceDeleteResult> {
    const database = await this.getDatabase();
    const removed: ImportedSourceDeleteResult = {
      glucose: 0,
      basal: 0,
      boluses: 0,
      context: 0,
      dailyTotals: 0,
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
      removed.dailyTotals = (
        await transaction.runAsync(
          'DELETE FROM insulin_daily_totals WHERE source_id = ?',
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
      removed.context += (
        await transaction.runAsync(
          `DELETE FROM context_notes
           WHERE source_id = ? AND origin = 'imported'`,
          sourceId,
        )
      ).changes;
      await transaction.runAsync(
        'DELETE FROM import_raw_records WHERE source_id = ?',
        sourceId,
      );
      await transaction.runAsync(
        'DELETE FROM glooko_report_payloads WHERE source_id = ?',
        sourceId,
      );
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
