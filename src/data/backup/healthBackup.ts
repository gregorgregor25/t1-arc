import { File, FileMode, Paths } from 'expo-file-system';

import {
  withDaymarkReadSnapshot,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { APP_TIME_ZONE } from '@/domain/models';

export const HEALTH_BACKUP_FORMAT = 'daymark-health-backup';
export const HEALTH_BACKUP_VERSION = 1;
export const HEALTH_BACKUP_MIME = 'application/vnd.daymark.health-backup';
export const HEALTH_BACKUP_EXTENSION = '.daymark';

type SqlValue = string | number | null;
type BackupRow = Record<string, SqlValue>;

const BACKUP_TABLE_DEFINITIONS = {
  glucose_readings: [
    'id',
    'source_id',
    'timestamp_ms',
    'received_at_ms',
    'mmol_l',
    'trend',
    'quality',
    'source_factory_timestamp',
    'source_local_timestamp',
    'timestamp_discrepancy_minutes',
  ],
  source_sync_state: [
    'source_id',
    'last_attempt_at_ms',
    'last_success_at_ms',
    'last_error_code',
    'last_error_message',
    'record_count',
  ],
  insulin_basal: [
    'id',
    'source_id',
    'start_ms',
    'end_ms',
    'rate_units_per_hour',
    'units',
    'imported_at_ms',
    'source_file',
    'source_row',
  ],
  insulin_bolus: [
    'id',
    'source_id',
    'timestamp_ms',
    'units',
    'imported_at_ms',
    'source_file',
    'source_row',
  ],
  context_events: [
    'id',
    'source_id',
    'origin',
    'kind',
    'start_ms',
    'end_ms',
    'title',
    'meal_type',
    'carbs_grams',
    'activity_type',
    'duration_minutes',
    'intensity',
    'quality_percent',
    'kilograms',
    'amount',
    'unit',
    'recorded_at_ms',
    'source_file',
    'source_row',
  ],
  health_connect_records: [
    'id',
    'external_id',
    'parent_external_id',
    'kind',
    'source_package',
    'start_ms',
    'end_ms',
    'last_modified_ms',
    'recording_method',
    'value',
    'unit',
    'payload_json',
    'imported_at_ms',
  ],
  health_connect_sources: [
    'package_name',
    'display_name',
    'first_seen_at_ms',
    'last_seen_at_ms',
  ],
  health_connect_preferences: [
    'category',
    'enabled',
    'preferred_source_package',
    'updated_at_ms',
  ],
  health_connect_sync_state: [
    'category',
    'last_attempt_at_ms',
    'last_success_at_ms',
    'data_start_ms',
    'data_through_ms',
    'record_count',
    'last_error_code',
    'last_error_message',
  ],
  food_catalog_cache: [
    'id',
    'provider',
    'external_id',
    'barcode',
    'name',
    'brand',
    'image_url',
    'basis_amount',
    'basis_unit',
    'carbohydrate_grams',
    'energy_kcal',
    'protein_grams',
    'fat_grams',
    'fibre_grams',
    'sugars_grams',
    'saturated_fat_grams',
    'nutrition_quality_json',
    'source_label',
    'source_url',
    'raw_payload_json',
    'cached_at_ms',
    'expires_at_ms',
    'is_favorite',
    'use_count',
    'last_used_at_ms',
  ],
  food_logs: [
    'id',
    'context_event_id',
    'timestamp_ms',
    'meal_type',
    'title',
    'carbohydrate_grams',
    'energy_kcal',
    'protein_grams',
    'fat_grams',
    'fibre_grams',
    'sugars_grams',
    'saturated_fat_grams',
    'created_at_ms',
    'updated_at_ms',
  ],
  food_log_items: [
    'id',
    'food_log_id',
    'ordinal',
    'catalog_id',
    'provider',
    'external_id',
    'name_snapshot',
    'brand_snapshot',
    'barcode_snapshot',
    'amount',
    'unit',
    'carbohydrate_grams',
    'energy_kcal',
    'protein_grams',
    'fat_grams',
    'fibre_grams',
    'sugars_grams',
    'saturated_fat_grams',
    'source_label',
    'source_url',
  ],
  import_batches: [
    'id',
    'source_id',
    'file_name',
    'file_sha256',
    'imported_at_ms',
    'data_start_ms',
    'data_through_ms',
    'basal_count',
    'bolus_count',
    'context_count',
    'duplicate_count',
    'skipped_count',
    'warnings_json',
  ],
} as const;

export type BackupTableName = keyof typeof BACKUP_TABLE_DEFINITIONS;

const BACKUP_TABLE_NAMES = Object.keys(
  BACKUP_TABLE_DEFINITIONS,
) as BackupTableName[];

export interface HealthBackupManifest {
  format: typeof HEALTH_BACKUP_FORMAT;
  version: typeof HEALTH_BACKUP_VERSION;
  createdAt: number;
  timeZone: typeof APP_TIME_ZONE;
  counts: Record<BackupTableName, number>;
  totalRecords: number;
  excludes: ['credentials', 'session tokens', 'Glooko web cookies'];
}

export interface HealthBackupDocument {
  manifest: HealthBackupManifest;
  tables: Record<BackupTableName, BackupRow[]>;
}

export interface HealthBackupSummary {
  createdAt: number;
  counts: Record<BackupTableName, number>;
  totalRecords: number;
}

export interface PreparedHealthBackup {
  file: File;
  summary: HealthBackupSummary;
}

export interface HealthBackupMergeResult {
  attempted: number;
  inserted: number;
  duplicates: number;
  byTable: Record<
    BackupTableName,
    { attempted: number; inserted: number; duplicates: number }
  >;
}

function emptyCounts() {
  return Object.fromEntries(
    BACKUP_TABLE_NAMES.map((name) => [name, 0]),
  ) as Record<BackupTableName, number>;
}

function isSqlValue(value: unknown): value is SqlValue {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateRow(
  table: BackupTableName,
  value: unknown,
  rowIndex: number,
): asserts value is BackupRow {
  if (!isPlainObject(value)) {
    throw new Error(`${table} row ${rowIndex + 1} is not a record.`);
  }
  const expected = BACKUP_TABLE_DEFINITIONS[table] as readonly string[];
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expectedSet.has(key)) ||
    expected.some((key) => !(key in value))
  ) {
    throw new Error(`${table} row ${rowIndex + 1} has an unsupported shape.`);
  }
  for (const column of expected) {
    if (!isSqlValue(value[column])) {
      throw new Error(
        `${table} row ${rowIndex + 1} contains an invalid ${column} value.`,
      );
    }
  }
}

export function validateHealthBackupDocument(
  value: unknown,
): HealthBackupDocument {
  if (!isPlainObject(value) || !isPlainObject(value.manifest)) {
    throw new Error('This file does not contain a Daymark health backup.');
  }
  const manifest = value.manifest;
  if (
    manifest.format !== HEALTH_BACKUP_FORMAT ||
    manifest.version !== HEALTH_BACKUP_VERSION
  ) {
    throw new Error('This health backup version is not supported.');
  }
  if (
    typeof manifest.createdAt !== 'number' ||
    !Number.isFinite(manifest.createdAt) ||
    manifest.createdAt <= 0 ||
    manifest.createdAt > Date.now() + 24 * 60 * 60 * 1000
  ) {
    throw new Error('The backup creation time is invalid.');
  }
  if (manifest.timeZone !== APP_TIME_ZONE) {
    throw new Error('The backup does not use the Europe/London time basis.');
  }
  if (!isPlainObject(manifest.counts) || !isPlainObject(value.tables)) {
    throw new Error('The health backup manifest is incomplete.');
  }

  const tables = value.tables;
  const counts = emptyCounts();
  let totalRecords = 0;
  for (const table of BACKUP_TABLE_NAMES) {
    const rows = tables[table];
    const expectedCount = manifest.counts[table];
    if (
      !Array.isArray(rows) ||
      typeof expectedCount !== 'number' ||
      !Number.isSafeInteger(expectedCount) ||
      expectedCount < 0 ||
      expectedCount !== rows.length
    ) {
      throw new Error(`The ${table} record count does not match its manifest.`);
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new Error(`The ${table} section exceeds the restore safety limit.`);
    }
    rows.forEach((row, index) => validateRow(table, row, index));
    counts[table] = rows.length;
    totalRecords += rows.length;
    if (totalRecords > MAX_TOTAL_ROWS) {
      throw new Error('The health backup exceeds the restore safety limit.');
    }
  }
  if (
    typeof manifest.totalRecords !== 'number' ||
    !Number.isSafeInteger(manifest.totalRecords) ||
    manifest.totalRecords !== totalRecords
  ) {
    throw new Error('The total backup record count is inconsistent.');
  }

  return {
    manifest: {
      format: HEALTH_BACKUP_FORMAT,
      version: HEALTH_BACKUP_VERSION,
      createdAt: manifest.createdAt,
      timeZone: APP_TIME_ZONE,
      counts,
      totalRecords,
      excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
    },
    tables: Object.fromEntries(
      BACKUP_TABLE_NAMES.map((table) => [table, tables[table] as BackupRow[]]),
    ) as Record<BackupTableName, BackupRow[]>,
  };
}

async function countRows(
  database: Awaited<ReturnType<typeof import('expo-sqlite').openDatabaseAsync>>,
) {
  const counts = emptyCounts();
  for (const table of BACKUP_TABLE_NAMES) {
    const row = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM "${table}"`,
    );
    counts[table] = row?.count ?? 0;
  }
  return counts;
}

export async function createHealthBackupJson(): Promise<PreparedHealthBackup> {
  const createdAt = Date.now();
  const file = new File(
    Paths.cache,
    `health-backup-${createdAt}-${Math.random().toString(36).slice(2)}.json`,
  );
  file.create({ overwrite: true });
  const handle = file.open(FileMode.Truncate);
  const encoder = new TextEncoder();
  let handleClosed = false;
  let pending = '';

  function flush(force = false) {
    if (!force && pending.length < WRITE_BUFFER_CHARACTERS) return;
    if (pending) handle.writeBytes(encoder.encode(pending));
    pending = '';
  }

  function write(value: string) {
    pending += value;
    flush();
  }

  try {
    const summary = await withDaymarkReadSnapshot(async (database) => {
      const counts = await countRows(database);
      const totalRecords = Object.values(counts).reduce(
        (total, count) => total + count,
        0,
      );
      const manifest: HealthBackupManifest = {
        format: HEALTH_BACKUP_FORMAT,
        version: HEALTH_BACKUP_VERSION,
        createdAt,
        timeZone: APP_TIME_ZONE,
        counts,
        totalRecords,
        excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
      };
      write(`{"manifest":${JSON.stringify(manifest)},"tables":{`);

      for (let tableIndex = 0; tableIndex < BACKUP_TABLE_NAMES.length; tableIndex += 1) {
        const table = BACKUP_TABLE_NAMES[tableIndex]!;
        if (tableIndex) write(',');
        write(`${JSON.stringify(table)}:[`);
        let rowIndex = 0;
        for await (const row of database.getEachAsync<BackupRow>(
          `SELECT ${BACKUP_TABLE_DEFINITIONS[table]
            .map((column) => `"${column}"`)
            .join(', ')} FROM "${table}"`,
        )) {
          if (rowIndex) write(',');
          write(JSON.stringify(row));
          rowIndex += 1;
        }
        if (rowIndex !== counts[table]) {
          throw new Error(
            `The ${table} snapshot changed while the backup was being made.`,
          );
        }
        write(']');
      }
      write('}}');
      flush(true);
      return { createdAt, counts, totalRecords };
    });
    return { file, summary };
  } catch (error) {
    handle.close();
    handleClosed = true;
    if (file.exists) {
      try {
        file.delete();
      } catch {
        // A later cache sweep can remove a file held by an interrupted OS call.
      }
    }
    throw error;
  } finally {
    if (!handleClosed) handle.close();
  }
}

export async function readHealthBackupJson(
  uri: string,
): Promise<HealthBackupDocument> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0) {
    throw new Error('The unlocked health backup is empty.');
  }
  if (file.size > MAX_JSON_BYTES) {
    throw new Error('The unlocked health backup exceeds the 512 MB safety limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('The unlocked health backup contains invalid data.');
  }
  return validateHealthBackupDocument(parsed);
}

export async function mergeHealthBackup(
  backup: HealthBackupDocument,
): Promise<HealthBackupMergeResult> {
  const byTable = Object.fromEntries(
    BACKUP_TABLE_NAMES.map((table) => [
      table,
      { attempted: 0, inserted: 0, duplicates: 0 },
    ]),
  ) as HealthBackupMergeResult['byTable'];

  await withDaymarkTransaction(async (database) => {
    for (const table of BACKUP_TABLE_NAMES) {
      const columns = BACKUP_TABLE_DEFINITIONS[table] as readonly string[];
      const rows = backup.tables[table];
      const rowsPerBatch = Math.max(
        1,
        Math.floor(MAX_SQL_PARAMETERS / columns.length),
      );
      for (let offset = 0; offset < rows.length; offset += rowsPerBatch) {
        const batch = rows.slice(offset, offset + rowsPerBatch);
        const placeholders = batch
          .map(() => `(${columns.map(() => '?').join(',')})`)
          .join(',');
        const values = batch.flatMap((row) =>
          columns.map((column) => row[column] ?? null),
        );
        const result = await database.runAsync(
          `INSERT OR IGNORE INTO "${table}" (
             ${columns.map((column) => `"${column}"`).join(',')}
           ) VALUES ${placeholders}`,
          ...values,
        );
        byTable[table].attempted += batch.length;
        byTable[table].inserted += result.changes;
      }
      byTable[table].duplicates =
        byTable[table].attempted - byTable[table].inserted;
    }
  });

  const attempted = Object.values(byTable).reduce(
    (total, result) => total + result.attempted,
    0,
  );
  const inserted = Object.values(byTable).reduce(
    (total, result) => total + result.inserted,
    0,
  );
  return {
    attempted,
    inserted,
    duplicates: attempted - inserted,
    byTable,
  };
}

export function healthBackupFileName(createdAt = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(createdAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return `Daymark-health-${part('year')}-${part('month')}-${part('day')}-${part(
    'hour',
  )}${part('minute')}${HEALTH_BACKUP_EXTENSION}`;
}

export function isFilePickerCancellation(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('picker was cancelled')
  );
}

const WRITE_BUFFER_CHARACTERS = 256 * 1024;
const MAX_SQL_PARAMETERS = 900;
const MAX_ROWS_PER_TABLE = 3_000_000;
const MAX_TOTAL_ROWS = 4_000_000;
const MAX_JSON_BYTES = 512 * 1024 * 1024;
