import {
  File,
  FileMode,
  Paths,
  type FileHandle,
} from 'expo-file-system';

import {
  withDaymarkReadSnapshot,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { APP_TIME_ZONE } from '@/domain/models';
import {
  PortablePreferences,
  validatePortablePreferences,
} from '@/domain/portablePreferences';

export const HEALTH_BACKUP_FORMAT = 'daymark-health-backup';
export const HEALTH_BACKUP_VERSION = 12;
export const HEALTH_BACKUP_MIME = 'application/vnd.t1arc.health-backup';
export const HEALTH_BACKUP_EXTENSION = '.t1arc';

type SqlValue = string | number | null;
export type BackupRow = Record<string, SqlValue>;
type RestoreValue = SqlValue | Uint8Array;

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
    'imported_at_ms',
    'source_file',
    'source_row',
    'source_device_id',
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
    'delivery_type',
    'percentage',
    'units_estimated',
    'imported_at_ms',
    'source_file',
    'source_row',
    'source_device_id',
  ],
  insulin_bolus: [
    'id',
    'source_id',
    'timestamp_ms',
    'units',
    'delivery_type',
    'blood_glucose_input_mmol_l',
    'carbs_input_grams',
    'carb_ratio_grams_per_unit',
    'initial_units',
    'extended_units',
    'imported_at_ms',
    'source_file',
    'source_row',
    'source_device_id',
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
    'energy_kcal',
    'protein_grams',
    'fat_grams',
    'serving_quantity',
    'serving_count',
    'activity_type',
    'duration_minutes',
    'intensity',
    'calories_burned',
    'quality_percent',
    'kilograms',
    'amount',
    'unit',
    'medication_type',
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
    'preferred_source_mode',
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
    'default_serving_amount',
    'default_serving_unit',
    'last_portion_amount',
    'last_portion_unit',
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
    'is_favorite',
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
    'daily_total_count',
    'duplicate_count',
    'skipped_count',
    'warnings_json',
  ],
  import_source_payloads: [
    'import_batch_id',
    'source_id',
    'file_name',
    'file_sha256',
    'format',
    'byte_length',
    'manifest_json',
    'payload_base64',
    'stored_at_ms',
  ],
  notification_source_events: [
    'id',
    'package_name',
    'posted_at_ms',
    'notification_when_ms',
    'received_at_ms',
    'is_ongoing',
    'payload_json',
    'parser_version',
    'parsed_glucose_id',
    'parsed_iob_units',
    'parsed_pump_mode',
    'imported_at_ms',
  ],
  insight_reports: [
    'id',
    'kind',
    'period_start_ms',
    'period_end_ms',
    'comparison_start_ms',
    'comparison_end_ms',
    'generated_at_ms',
    'updated_at_ms',
    'schema_version',
    'input_fingerprint',
    'ready',
    'headline',
    'summary',
    'evidence_record_count',
    'report_json',
    'viewed_at_ms',
  ],
  context_notes: [
    'id',
    'source_id',
    'origin',
    'start_ms',
    'end_ms',
    'title',
    'category',
    'detail',
    'recorded_at_ms',
    'source_file',
    'source_row',
  ],
  // Keep newly introduced tables at the end. Streamed backups identify
  // tables by index, so appending preserves every older frame index.
  insulin_daily_totals: [
    'id',
    'source_id',
    'timestamp_ms',
    'date_key',
    'basal_units',
    'bolus_units',
    'total_units',
    'imported_at_ms',
    'source_file',
    'source_row',
    'source_device_id',
  ],
  food_recipes: [
    'id',
    'name',
    'meal_type',
    'servings',
    'carbohydrate_grams',
    'energy_kcal',
    'protein_grams',
    'fat_grams',
    'fibre_grams',
    'sugars_grams',
    'saturated_fat_grams',
    'created_at_ms',
    'updated_at_ms',
    'is_favorite',
  ],
  food_recipe_items: [
    'id',
    'recipe_id',
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
  import_raw_records: [
    'id',
    'source_id',
    'record_kind',
    'timestamp_ms',
    'source_file',
    'source_row',
    'payload_json',
    'first_import_batch_id',
    'first_seen_at_ms',
    'last_import_batch_id',
    'last_seen_at_ms',
  ],
  glooko_report_payloads: [
    'id',
    'source_id',
    'file_name',
    'file_sha256',
    'byte_length',
    'payload_base64',
    'extracted_text',
    'preview_json',
    'report_start_ms',
    'report_end_ms',
    'imported_at_ms',
  ],
} as const;

export type BackupTableName = keyof typeof BACKUP_TABLE_DEFINITIONS;

export const BACKUP_TABLE_NAMES = Object.keys(
  BACKUP_TABLE_DEFINITIONS,
) as BackupTableName[];

/**
 * Every application table must be either portable or named here. Restoring
 * device-specific scheduler history on another phone would make the Sources
 * diagnostics misleading, while app_metadata is internal migration state.
 */
export const HEALTH_BACKUP_EXCLUDED_TABLES = {
  app_metadata: 'internal database and migration state',
  automation_runs: 'device-specific background execution diagnostics',
} as const;

/**
 * Health Connect change tokens are issued for the current Android data store.
 * They cannot safely be resumed after a backup is moved to another phone, so a
 * restored category deliberately performs a normal bounded reconciliation.
 */
const HEALTH_BACKUP_EXCLUDED_COLUMNS: Partial<
  Record<BackupTableName, readonly string[]>
> = {
  health_connect_sync_state: [
    'changes_token',
    'changes_token_source_package',
  ],
};

function representedDatabaseColumns(table: BackupTableName) {
  return BACKUP_TABLE_DEFINITIONS[table].map((column) =>
    column === 'payload_base64'
      ? 'payload_bytes'
      : column,
  );
}

interface BackupSchemaDatabase {
  getAllAsync(
    query: string,
  ): Promise<Array<{ name: string }>>;
}

/**
 * Prevent a successful-looking backup from silently dropping a newly added
 * table or column. This checks the actual migrated SQLCipher schema at export
 * time; intentional device-bound omissions must be declared above.
 */
export async function assertHealthBackupSchemaCoverage(
  database: BackupSchemaDatabase,
) {
  const tableRows = await database.getAllAsync(
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'`,
  );
  const portableTables = new Set<string>(BACKUP_TABLE_NAMES);
  const excludedTables = new Set<string>(
    Object.keys(HEALTH_BACKUP_EXCLUDED_TABLES),
  );
  const unclassifiedTables = tableRows
    .map((row) => row.name)
    .filter(
      (table) =>
        !portableTables.has(table) && !excludedTables.has(table),
    )
    .sort();
  if (unclassifiedTables.length) {
    throw new Error(
      `Portable backup policy is missing for database table${
        unclassifiedTables.length === 1 ? '' : 's'
      }: ${unclassifiedTables.join(', ')}.`,
    );
  }

  for (const table of BACKUP_TABLE_NAMES) {
    const columnRows = await database.getAllAsync(
      `PRAGMA table_info("${table.replace(/"/g, '""')}")`,
    );
    const classifiedColumns = new Set([
      ...representedDatabaseColumns(table),
      ...(HEALTH_BACKUP_EXCLUDED_COLUMNS[table] ?? []),
    ]);
    const unclassifiedColumns = columnRows
      .map((row) => row.name)
      .filter((column) => !classifiedColumns.has(column))
      .sort();
    if (unclassifiedColumns.length) {
      throw new Error(
        `Portable backup policy is missing for ${table} column${
          unclassifiedColumns.length === 1 ? '' : 's'
        }: ${unclassifiedColumns.join(', ')}.`,
      );
    }
  }
}

const BACKUP_TABLE_INTRODUCED_VERSION: Partial<
  Record<BackupTableName, number>
> = {
  import_source_payloads: 3,
  notification_source_events: 4,
  insight_reports: 4,
  context_notes: 6,
  insulin_daily_totals: 8,
  food_recipes: 10,
  food_recipe_items: 10,
  import_raw_records: 11,
  glooko_report_payloads: 12,
};

const BINARY_PAYLOAD_TABLES = new Set<BackupTableName>([
  'import_source_payloads',
  'glooko_report_payloads',
]);

export interface HealthBackupManifest {
  format: typeof HEALTH_BACKUP_FORMAT;
  version: typeof HEALTH_BACKUP_VERSION;
  createdAt: number;
  timeZone: typeof APP_TIME_ZONE;
  counts: Record<BackupTableName, number>;
  totalRecords: number;
  excludes: ['credentials', 'session tokens', 'Glooko web cookies'];
  preferences?: PortablePreferences;
}

export interface HealthBackupDocument {
  manifest: HealthBackupManifest;
  tables: Record<BackupTableName, BackupRow[]>;
}

export interface HealthBackupSummary {
  createdAt: number;
  counts: Record<BackupTableName, number>;
  totalRecords: number;
  preferencesIncluded: boolean;
}

export interface PreparedHealthBackup {
  file: File;
  summary: HealthBackupSummary;
}

export type PreparedHealthBackupRestore =
  | {
      kind: 'stream';
      manifest: HealthBackupManifest;
      sourceUri: string;
    }
  | {
      kind: 'legacy';
      manifest: HealthBackupManifest;
      document: HealthBackupDocument;
    };

export interface HealthBackupMergeResult {
  attempted: number;
  inserted: number;
  duplicates: number;
  byTable: Record<
    BackupTableName,
    { attempted: number; inserted: number; duplicates: number }
  >;
  preferenceRestore: 'not-included' | 'restored' | 'failed';
  preferenceWarning?: string;
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

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBackupBase64(bytes: Uint8Array) {
  return [...backupBase64Chunks(bytes)].join('');
}

function* backupBase64Chunks(
  bytes: Uint8Array,
  byteChunkSize = 48 * 1024,
) {
  const safeChunkSize = Math.max(3, byteChunkSize - (byteChunkSize % 3));
  for (
    let chunkStart = 0;
    chunkStart < bytes.length;
    chunkStart += safeChunkSize
  ) {
    const chunkEnd = Math.min(bytes.length, chunkStart + safeChunkSize);
    let output = '';
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index]!;
      const hasSecond = index + 1 < chunkEnd;
      const hasThird = index + 2 < chunkEnd;
      const second = hasSecond ? bytes[index + 1]! : 0;
      const third = hasThird ? bytes[index + 2]! : 0;
      const packed = (first << 16) | (second << 8) | third;
      output +=
        BASE64_ALPHABET[(packed >> 18) & 63]! +
        BASE64_ALPHABET[(packed >> 12) & 63]! +
        (hasSecond ? BASE64_ALPHABET[(packed >> 6) & 63]! : '=') +
        (hasThird ? BASE64_ALPHABET[packed & 63]! : '=');
    }
    yield output;
  }
}

function backupBase64ByteLength(value: string) {
  if (!value.length) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function backupBase64ToBytes(value: string) {
  if (
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('A retained source export has invalid binary encoding.');
  }
  const output = new Uint8Array(backupBase64ByteLength(value));
  const lookup = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    lookup[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  let cursor = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = lookup[value.charCodeAt(index)]!;
    const b = lookup[value.charCodeAt(index + 1)]!;
    const c =
      value[index + 2] === '=' ? 0 : lookup[value.charCodeAt(index + 2)]!;
    const d =
      value[index + 3] === '=' ? 0 : lookup[value.charCodeAt(index + 3)]!;
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('A retained source export has invalid binary encoding.');
    }
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    if (cursor < output.length) output[cursor++] = (packed >> 16) & 0xff;
    if (cursor < output.length) output[cursor++] = (packed >> 8) & 0xff;
    if (cursor < output.length) output[cursor++] = packed & 0xff;
  }
  return output;
}

type BackupFrame = {
  type: number;
  tableIndex: number;
  byteLength: number;
};

class BackupContainerWriter {
  private readonly chunks: Uint8Array[] = [];
  private bufferedBytes = 0;

  constructor(private readonly handle: FileHandle) {}

  write(bytes: Uint8Array) {
    if (!bytes.length) return;
    if (bytes.length >= CONTAINER_WRITE_BUFFER_BYTES) {
      this.flush();
      this.handle.writeBytes(bytes);
      return;
    }
    this.chunks.push(bytes);
    this.bufferedBytes += bytes.length;
    if (this.bufferedBytes >= CONTAINER_WRITE_BUFFER_BYTES) this.flush();
  }

  writeFrame(type: number, tableIndex: number, payload: Uint8Array) {
    this.write(encodeBackupFrameHeader(type, tableIndex, payload.length));
    this.write(payload);
  }

  finish() {
    this.write(
      encodeBackupFrameHeader(
        CONTAINER_FRAME_END,
        CONTAINER_NO_TABLE,
        0,
      ),
    );
    this.flush();
  }

  flush() {
    if (!this.bufferedBytes) return;
    const joined = new Uint8Array(this.bufferedBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    this.handle.writeBytes(joined);
    this.chunks.length = 0;
    this.bufferedBytes = 0;
  }
}

class BackupContainerReader {
  readonly size: number;

  constructor(private readonly handle: FileHandle) {
    this.size = handle.size ?? 0;
  }

  get offset() {
    return this.handle.offset ?? 0;
  }

  readExact(byteLength: number) {
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      this.offset + byteLength > this.size
    ) {
      throw new Error('The health backup ended unexpectedly.');
    }
    const bytes = this.handle.readBytes(byteLength);
    if (bytes.length !== byteLength) {
      throw new Error('The health backup ended unexpectedly.');
    }
    return bytes;
  }

  skipExact(byteLength: number) {
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      this.offset + byteLength > this.size
    ) {
      throw new Error('The health backup ended unexpectedly.');
    }
    this.handle.offset = this.offset + byteLength;
  }

  readFrame(): BackupFrame {
    return decodeBackupFrameHeader(this.readExact(CONTAINER_FRAME_HEADER_BYTES));
  }
}

export function encodeBackupFrameHeader(
  type: number,
  tableIndex: number,
  byteLength: number,
) {
  if (
    !Number.isInteger(type) ||
    type < 0 ||
    type > 255 ||
    !Number.isInteger(tableIndex) ||
    tableIndex < 0 ||
    tableIndex > 255 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > 0xffffffff
  ) {
    throw new Error('A health backup frame is outside the supported range.');
  }
  const header = new Uint8Array(CONTAINER_FRAME_HEADER_BYTES);
  const view = new DataView(header.buffer);
  view.setUint8(0, type);
  view.setUint8(1, tableIndex);
  view.setUint32(2, byteLength, false);
  return header;
}

export function decodeBackupFrameHeader(header: Uint8Array): BackupFrame {
  if (header.length !== CONTAINER_FRAME_HEADER_BYTES) {
    throw new Error('The health backup has an invalid frame header.');
  }
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  return {
    type: view.getUint8(0),
    tableIndex: view.getUint8(1),
    byteLength: view.getUint32(2, false),
  };
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function backupRestoreBinding(
  table: BackupTableName,
  row: BackupRow,
): { columns: string[]; values: RestoreValue[] } {
  const backupColumns = BACKUP_TABLE_DEFINITIONS[
    table
  ] as readonly string[];
  return {
    columns: backupColumns.map((column) =>
      column === 'payload_base64' ? 'payload_bytes' : column,
    ),
    values: backupColumns.map((column) => {
      if (column === 'payload_base64') {
        return backupBase64ToBytes(String(row[column] ?? ''));
      }
      if (
        table === 'glucose_readings' &&
        column === 'source_device_id'
      ) {
        return row[column] ?? '';
      }
      return row[column] ?? null;
    }),
  };
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
  if (BINARY_PAYLOAD_TABLES.has(table)) {
    const encoded = value.payload_base64;
    const reportedBytes = value.byte_length;
    if (
      typeof encoded !== 'string' ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      typeof reportedBytes !== 'number' ||
      reportedBytes <= 0 ||
      reportedBytes > MAX_IMPORT_PAYLOAD_BYTES ||
      backupBase64ByteLength(encoded) !== reportedBytes
    ) {
      throw new Error(
        `${table} row ${rowIndex + 1} contains an invalid retained export.`,
      );
    }
  }
  if (
    table === 'context_notes' &&
    (!['manual', 'imported', 'synthetic'].includes(String(value.origin)) ||
      ![
        'illness',
        'stress',
        'pump',
        'sensor',
        'hormones',
        'travel',
        'other',
      ].includes(String(value.category)))
  ) {
    throw new Error(
      `${table} row ${rowIndex + 1} contains an invalid note category or origin.`,
    );
  }
}

const LEGACY_V1_GLUCOSE_COLUMNS = [
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
] as const;

function migrateBackupRow(
  version: number,
  table: BackupTableName,
  value: unknown,
) {
  if (
    version === 1 &&
    table === 'glucose_readings' &&
    isPlainObject(value)
  ) {
    const keys = Object.keys(value);
    const legacy = new Set(LEGACY_V1_GLUCOSE_COLUMNS);
    if (
      keys.length === LEGACY_V1_GLUCOSE_COLUMNS.length &&
      keys.every((key) => legacy.has(key as never))
    ) {
      return {
        ...value,
        imported_at_ms: null,
        source_file: null,
        source_row: null,
        source_device_id: null,
      };
    }
  }
  if (
    version < 7 &&
    table === 'food_catalog_cache' &&
    isPlainObject(value)
  ) {
    return {
      ...value,
      ...(!('default_serving_amount' in value)
        ? { default_serving_amount: null }
        : {}),
      ...(!('default_serving_unit' in value)
        ? { default_serving_unit: null }
        : {}),
      last_portion_amount: null,
      last_portion_unit: null,
    };
  }
  if (
    version < 8 &&
    table === 'import_batches' &&
    isPlainObject(value) &&
    !('daily_total_count' in value)
  ) {
    return {
      ...value,
      daily_total_count: 0,
    };
  }
  if (
    version < 9 &&
    table === 'food_logs' &&
    isPlainObject(value) &&
    !('is_favorite' in value)
  ) {
    return {
      ...value,
      is_favorite: 0,
    };
  }
  if (version < 11 && table === 'insulin_basal' && isPlainObject(value)) {
    return {
      ...value,
      delivery_type: null,
      percentage: null,
      units_estimated: 0,
      source_device_id: null,
    };
  }
  if (version < 11 && table === 'insulin_bolus' && isPlainObject(value)) {
    return {
      ...value,
      delivery_type: null,
      blood_glucose_input_mmol_l: null,
      carbs_input_grams: null,
      carb_ratio_grams_per_unit: null,
      initial_units: null,
      extended_units: null,
      source_device_id: null,
    };
  }
  if (
    version < 11 &&
    table === 'insulin_daily_totals' &&
    isPlainObject(value)
  ) {
    return {
      ...value,
      source_device_id: null,
    };
  }
  if (version < 11 && table === 'context_events' && isPlainObject(value)) {
    return {
      ...value,
      energy_kcal: null,
      protein_grams: null,
      fat_grams: null,
      serving_quantity: null,
      serving_count: null,
      calories_burned: null,
      medication_type: null,
    };
  }
  return value;
}

export function validateHealthBackupDocument(
  value: unknown,
): HealthBackupDocument {
  if (!isPlainObject(value) || !isPlainObject(value.manifest)) {
    throw new Error('This file does not contain a T1 Arc health backup.');
  }
  const manifest = value.manifest;
  if (
    manifest.format !== HEALTH_BACKUP_FORMAT ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, HEALTH_BACKUP_VERSION].includes(
      manifest.version as number,
    )
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
  const version = manifest.version as number;
  const normalisedTables = {} as Record<BackupTableName, BackupRow[]>;
  const counts = emptyCounts();
  let totalRecords = 0;
  for (const table of BACKUP_TABLE_NAMES) {
    const introducedVersion = BACKUP_TABLE_INTRODUCED_VERSION[table] ?? 1;
    const legacyMissingTable =
      version < introducedVersion &&
      tables[table] === undefined &&
      manifest.counts[table] === undefined;
    const rows = legacyMissingTable ? [] : tables[table];
    const expectedCount = legacyMissingTable ? 0 : manifest.counts[table];
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
    const normalisedRows = rows.map((row) =>
      migrateBackupRow(version, table, row),
    );
    normalisedRows.forEach((row, index) => validateRow(table, row, index));
    normalisedTables[table] = normalisedRows as BackupRow[];
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
  const preferences =
    manifest.preferences === undefined
      ? undefined
      : validatePortablePreferences(manifest.preferences);

  return {
    manifest: {
      format: HEALTH_BACKUP_FORMAT,
      version: HEALTH_BACKUP_VERSION,
      createdAt: manifest.createdAt,
      timeZone: APP_TIME_ZONE,
      counts,
      totalRecords,
      excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
      preferences,
    },
    tables: normalisedTables,
  };
}

export function validateCurrentContainerManifest(
  value: unknown,
): HealthBackupManifest {
  if (!isPlainObject(value)) {
    throw new Error('The health backup manifest is missing.');
  }
  if (
    value.format !== HEALTH_BACKUP_FORMAT ||
    ![5, 6, 7, 8, 9, 10, 11, HEALTH_BACKUP_VERSION].includes(
      value.version as number,
    )
  ) {
    throw new Error('This health backup version is not supported.');
  }
  if (
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 ||
    value.createdAt > Date.now() + 24 * 60 * 60 * 1000
  ) {
    throw new Error('The backup creation time is invalid.');
  }
  if (value.timeZone !== APP_TIME_ZONE) {
    throw new Error('The backup does not use the Europe/London time basis.');
  }
  if (!isPlainObject(value.counts)) {
    throw new Error('The health backup manifest is incomplete.');
  }
  const sourceVersion = value.version as number;
  const expectedTables = BACKUP_TABLE_NAMES.filter(
    (table) =>
      (BACKUP_TABLE_INTRODUCED_VERSION[table] ?? 1) <= sourceVersion,
  );
  const countKeys = Object.keys(value.counts);
  if (
    countKeys.length !== expectedTables.length ||
    countKeys.some((key) =>
      !expectedTables.includes(key as BackupTableName),
    )
  ) {
    throw new Error('The health backup manifest has unsupported sections.');
  }
  const counts = emptyCounts();
  let totalRecords = 0;
  for (const table of BACKUP_TABLE_NAMES) {
    if ((BACKUP_TABLE_INTRODUCED_VERSION[table] ?? 1) > sourceVersion) {
      counts[table] = 0;
      continue;
    }
    const count = value.counts[table];
    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_ROWS_PER_TABLE
    ) {
      throw new Error(`The ${table} record count is invalid.`);
    }
    counts[table] = count;
    totalRecords += count;
  }
  if (
    totalRecords > MAX_TOTAL_ROWS ||
    typeof value.totalRecords !== 'number' ||
    !Number.isSafeInteger(value.totalRecords) ||
    value.totalRecords !== totalRecords
  ) {
    throw new Error('The total backup record count is inconsistent.');
  }
  const preferences =
    value.preferences === undefined
      ? undefined
      : validatePortablePreferences(value.preferences);
  return {
    format: HEALTH_BACKUP_FORMAT,
    version: HEALTH_BACKUP_VERSION,
    createdAt: value.createdAt,
    timeZone: APP_TIME_ZONE,
    counts,
    totalRecords,
    excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
    preferences,
  };
}

function validateContainerSourceMetadata(
  table: 'import_source_payloads' | 'glooko_report_payloads',
  value: unknown,
  rowIndex: number,
): asserts value is BackupRow {
  if (!isPlainObject(value)) {
    throw new Error(
      `${table} row ${rowIndex + 1} is not a record.`,
    );
  }
  const expected = BACKUP_TABLE_DEFINITIONS[table].filter(
    (column) => column !== 'payload_base64',
  );
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expectedSet.has(key as never)) ||
    expected.some((key) => !(key in value))
  ) {
    throw new Error(
      `${table} row ${rowIndex + 1} has an unsupported shape.`,
    );
  }
  for (const column of expected) {
    if (!isSqlValue(value[column])) {
      throw new Error(
        `${table} row ${rowIndex + 1} contains an invalid ${column} value.`,
      );
    }
  }
  if (
    typeof value.byte_length !== 'number' ||
    !Number.isSafeInteger(value.byte_length) ||
    value.byte_length <= 0 ||
    value.byte_length > MAX_IMPORT_PAYLOAD_BYTES
  ) {
    throw new Error(
      `${table} row ${rowIndex + 1} contains an invalid retained source file.`,
    );
  }
}

type BackupContainerVisitor = (
  table: BackupTableName,
  row: BackupRow,
  payloadBytes?: Uint8Array,
) => Promise<void> | void;

async function scanBackupContainer(
  uri: string,
  visitor?: BackupContainerVisitor,
) {
  const file = new File(uri);
  if (!file.exists || file.size <= 0) {
    throw new Error('The unlocked health backup is empty.');
  }
  if (file.size > MAX_JSON_BYTES) {
    throw new Error(
      'The unlocked health backup exceeds the 512 MB safety limit.',
    );
  }
  const handle = file.open(FileMode.ReadOnly);
  const reader = new BackupContainerReader(handle);
  const decoder = new TextDecoder();
  try {
    if (!bytesEqual(reader.readExact(CONTAINER_MAGIC.length), CONTAINER_MAGIC)) {
      throw new Error('This file does not contain a streamed health backup.');
    }
    const manifestFrame = reader.readFrame();
    if (
      manifestFrame.type !== CONTAINER_FRAME_MANIFEST ||
      manifestFrame.tableIndex !== CONTAINER_NO_TABLE ||
      manifestFrame.byteLength <= 0 ||
      manifestFrame.byteLength > MAX_MANIFEST_BYTES
    ) {
      throw new Error('The health backup manifest frame is invalid.');
    }
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(
        decoder.decode(reader.readExact(manifestFrame.byteLength)),
      );
    } catch {
      throw new Error('The health backup manifest contains invalid data.');
    }
    const sourceVersion =
      isPlainObject(manifestValue) &&
      typeof manifestValue.version === 'number'
        ? manifestValue.version
        : HEALTH_BACKUP_VERSION;
    const manifest = validateCurrentContainerManifest(manifestValue);
    const observedCounts = emptyCounts();
    let observedTotal = 0;
    let lastTableIndex = -1;
    let reachedEnd = false;

    while (reader.offset < reader.size) {
      const frame = reader.readFrame();
      if (frame.type === CONTAINER_FRAME_END) {
        if (
          frame.tableIndex !== CONTAINER_NO_TABLE ||
          frame.byteLength !== 0
        ) {
          throw new Error('The health backup end frame is invalid.');
        }
        reachedEnd = true;
        break;
      }
      if (
        frame.type !== CONTAINER_FRAME_ROW ||
        frame.tableIndex >= BACKUP_TABLE_NAMES.length ||
        frame.tableIndex < lastTableIndex ||
        frame.byteLength <= 0 ||
        frame.byteLength > MAX_ROW_JSON_BYTES
      ) {
        throw new Error('The health backup contains an invalid record frame.');
      }
      lastTableIndex = frame.tableIndex;
      const table = BACKUP_TABLE_NAMES[frame.tableIndex]!;
      let rowValue: unknown;
      try {
        rowValue = JSON.parse(
          decoder.decode(reader.readExact(frame.byteLength)),
        );
      } catch {
        throw new Error(
          `${table} row ${observedCounts[table] + 1} contains invalid data.`,
        );
      }

      rowValue = migrateBackupRow(sourceVersion, table, rowValue);
      let payloadBytes: Uint8Array | undefined;
      if (BINARY_PAYLOAD_TABLES.has(table)) {
        const binaryTable = table as
          | 'import_source_payloads'
          | 'glooko_report_payloads';
        validateContainerSourceMetadata(
          binaryTable,
          rowValue,
          observedCounts[table],
        );
        const payloadFrame = reader.readFrame();
        if (
          payloadFrame.type !== CONTAINER_FRAME_PAYLOAD ||
          payloadFrame.tableIndex !== frame.tableIndex ||
          payloadFrame.byteLength !== rowValue.byte_length
        ) {
          throw new Error(
            `${table} row ${
              observedCounts[table] + 1
            } has invalid source bytes.`,
          );
        }
        if (visitor) {
          payloadBytes = reader.readExact(payloadFrame.byteLength);
        } else {
          reader.skipExact(payloadFrame.byteLength);
        }
      } else {
        validateRow(table, rowValue, observedCounts[table]);
      }

      const row = rowValue as BackupRow;
      observedCounts[table] += 1;
      observedTotal += 1;
      if (
        observedCounts[table] > manifest.counts[table] ||
        observedCounts[table] > MAX_ROWS_PER_TABLE ||
        observedTotal > MAX_TOTAL_ROWS
      ) {
        throw new Error(`The ${table} section exceeds its manifest count.`);
      }
      await visitor?.(table, row, payloadBytes);
    }

    if (!reachedEnd || reader.offset !== reader.size) {
      throw new Error('The health backup has missing or trailing data.');
    }
    for (const table of BACKUP_TABLE_NAMES) {
      if (observedCounts[table] !== manifest.counts[table]) {
        throw new Error(
          `The ${table} record count does not match its manifest.`,
        );
      }
    }
    if (observedTotal !== manifest.totalRecords) {
      throw new Error('The total backup record count is inconsistent.');
    }
    return manifest;
  } finally {
    handle.close();
  }
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

export async function createHealthBackupFile(): Promise<PreparedHealthBackup> {
  const createdAt = Date.now();
  const preferences = await import('@/data/backup/portablePreferences')
    .then(({ capturePortablePreferences }) => capturePortablePreferences())
    .catch(() => undefined);
  const file = new File(
    Paths.cache,
    `health-backup-${createdAt}-${Math.random()
      .toString(36)
      .slice(2)}.container`,
  );
  file.create({ overwrite: true });
  const handle = file.open(FileMode.Truncate);
  const encoder = new TextEncoder();
  const writer = new BackupContainerWriter(handle);
  let handleClosed = false;

  try {
    const summary = await withDaymarkReadSnapshot(async (database) => {
      await assertHealthBackupSchemaCoverage(database);
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
        preferences,
      };
      writer.write(CONTAINER_MAGIC);
      const manifestBytes = encoder.encode(JSON.stringify(manifest));
      if (manifestBytes.length > MAX_MANIFEST_BYTES) {
        throw new Error('The health backup manifest is too large.');
      }
      writer.writeFrame(
        CONTAINER_FRAME_MANIFEST,
        CONTAINER_NO_TABLE,
        manifestBytes,
      );

      for (
        let tableIndex = 0;
        tableIndex < BACKUP_TABLE_NAMES.length;
        tableIndex += 1
      ) {
        const table = BACKUP_TABLE_NAMES[tableIndex]!;
        let rowIndex = 0;
        if (BINARY_PAYLOAD_TABLES.has(table)) {
          const textColumns = BACKUP_TABLE_DEFINITIONS[table].filter(
            (column) => column !== 'payload_base64',
          );
          for await (const row of database.getEachAsync<
            BackupRow & { payload_bytes: Uint8Array }
          >(
            `SELECT ${textColumns
              .map((column) => `"${column}"`)
              .join(', ')}, "payload_bytes"
             FROM "${table}"`,
          )) {
            const { payload_bytes, ...metadata } = row;
            if (
              payload_bytes.length !== metadata.byte_length ||
              payload_bytes.length > MAX_IMPORT_PAYLOAD_BYTES
            ) {
              throw new Error(
                `A retained ${table === 'glooko_report_payloads' ? 'Glooko report' : 'source export'} has an invalid stored size.`,
              );
            }
            const metadataBytes = encoder.encode(JSON.stringify(metadata));
            if (metadataBytes.length > MAX_ROW_JSON_BYTES) {
              throw new Error(
                `A retained ${table === 'glooko_report_payloads' ? 'Glooko report' : 'source export'} has oversized metadata.`,
              );
            }
            writer.writeFrame(
              CONTAINER_FRAME_ROW,
              tableIndex,
              metadataBytes,
            );
            writer.writeFrame(
              CONTAINER_FRAME_PAYLOAD,
              tableIndex,
              payload_bytes,
            );
            rowIndex += 1;
          }
        } else {
          for await (const row of database.getEachAsync<BackupRow>(
            `SELECT ${BACKUP_TABLE_DEFINITIONS[table]
              .map((column) => `"${column}"`)
              .join(', ')} FROM "${table}"`,
          )) {
            const rowBytes = encoder.encode(JSON.stringify(row));
            if (rowBytes.length > MAX_ROW_JSON_BYTES) {
              throw new Error(`${table} row ${rowIndex + 1} is too large.`);
            }
            writer.writeFrame(CONTAINER_FRAME_ROW, tableIndex, rowBytes);
            rowIndex += 1;
          }
        }
        if (rowIndex !== counts[table]) {
          throw new Error(
            `The ${table} snapshot changed while the backup was being made.`,
          );
        }
      }
      writer.finish();
      return {
        createdAt,
        counts,
        totalRecords,
        preferencesIncluded: preferences !== undefined,
      };
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

export async function readHealthBackupFile(
  uri: string,
): Promise<PreparedHealthBackupRestore> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0) {
    throw new Error('The unlocked health backup is empty.');
  }
  const handle = file.open(FileMode.ReadOnly);
  let streamed = false;
  try {
    if ((handle.size ?? 0) >= CONTAINER_MAGIC.length) {
      streamed = bytesEqual(
        handle.readBytes(CONTAINER_MAGIC.length),
        CONTAINER_MAGIC,
      );
    }
  } finally {
    handle.close();
  }
  if (streamed) {
    const manifest = await scanBackupContainer(uri);
    return {
      kind: 'stream',
      manifest,
      sourceUri: uri,
    };
  }
  const document = await readHealthBackupJson(uri);
  return {
    kind: 'legacy',
    manifest: document.manifest,
    document,
  };
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
      const rows = backup.tables[table];
      const firstBinding = rows[0]
        ? backupRestoreBinding(table, rows[0])
        : undefined;
      const columns =
        firstBinding?.columns ??
        (BACKUP_TABLE_DEFINITIONS[table] as readonly string[]).map((column) =>
          column === 'payload_base64' ? 'payload_bytes' : column,
        );
      const rowsPerBatch = Math.max(
        1,
        BINARY_PAYLOAD_TABLES.has(table)
          ? 1
          : Math.floor(MAX_SQL_PARAMETERS / columns.length),
      );
      for (let offset = 0; offset < rows.length; offset += rowsPerBatch) {
        const batch = rows.slice(offset, offset + rowsPerBatch);
        const placeholders = batch
          .map(() => `(${columns.map(() => '?').join(',')})`)
          .join(',');
        const values = batch.flatMap(
          (row) => backupRestoreBinding(table, row).values,
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
  const preferenceResult = await restorePreferences(backup.manifest);
  return {
    attempted,
    inserted,
    duplicates: attempted - inserted,
    byTable,
    ...preferenceResult,
  };
}

export async function mergePreparedHealthBackup(
  backup: PreparedHealthBackupRestore,
): Promise<HealthBackupMergeResult> {
  if (backup.kind === 'legacy') {
    return mergeHealthBackup(backup.document);
  }

  const byTable = Object.fromEntries(
    BACKUP_TABLE_NAMES.map((table) => [
      table,
      { attempted: 0, inserted: 0, duplicates: 0 },
    ]),
  ) as HealthBackupMergeResult['byTable'];

  await withDaymarkTransaction(async (database) => {
    let pendingTable: BackupTableName | undefined;
    let pendingRows: BackupRow[] = [];

    async function flushPendingRows() {
      const table = pendingTable;
      const rows = pendingRows;
      if (!table || !rows.length) return;
      const columns = BACKUP_TABLE_DEFINITIONS[
        table
      ] as readonly string[];
      const placeholders = rows
        .map(() => `(${columns.map(() => '?').join(',')})`)
        .join(',');
      const values = rows.flatMap((row) =>
        backupRestoreBinding(table, row).values,
      );
      const result = await database.runAsync(
        `INSERT OR IGNORE INTO "${table}" (
           ${columns.map((column) => `"${column}"`).join(',')}
         ) VALUES ${placeholders}`,
        ...values,
      );
      byTable[table].attempted += rows.length;
      byTable[table].inserted += result.changes;
      pendingTable = undefined;
      pendingRows = [];
    }

    await scanBackupContainer(
      backup.sourceUri,
      async (table, row, payloadBytes) => {
        if (BINARY_PAYLOAD_TABLES.has(table)) {
          await flushPendingRows();
          if (!payloadBytes) {
            throw new Error('A retained source export is missing its bytes.');
          }
          const backupColumns = BACKUP_TABLE_DEFINITIONS[
            table
          ] as readonly string[];
          const columns = backupColumns.map((column) =>
            column === 'payload_base64' ? 'payload_bytes' : column,
          );
          const values = backupColumns.map((column) =>
            column === 'payload_base64'
              ? payloadBytes
              : row[column] ?? null,
          );
          const result = await database.runAsync(
            `INSERT OR IGNORE INTO "${table}" (
               ${columns.map((column) => `"${column}"`).join(',')}
             ) VALUES (${columns.map(() => '?').join(',')})`,
            ...values,
          );
          byTable[table].attempted += 1;
          byTable[table].inserted += result.changes;
          return;
        }

        if (pendingTable && pendingTable !== table) {
          await flushPendingRows();
        }
        pendingTable = table;
        pendingRows.push(row);
        const rowsPerBatch = Math.max(
          1,
          Math.floor(
            MAX_SQL_PARAMETERS /
              BACKUP_TABLE_DEFINITIONS[table].length,
          ),
        );
        if (pendingRows.length >= rowsPerBatch) {
          await flushPendingRows();
        }
      },
    );
    await flushPendingRows();
  });

  for (const table of BACKUP_TABLE_NAMES) {
    byTable[table].duplicates =
      byTable[table].attempted - byTable[table].inserted;
  }
  const attempted = Object.values(byTable).reduce(
    (total, result) => total + result.attempted,
    0,
  );
  const inserted = Object.values(byTable).reduce(
    (total, result) => total + result.inserted,
    0,
  );
  const preferenceResult = await restorePreferences(backup.manifest);
  return {
    attempted,
    inserted,
    duplicates: attempted - inserted,
    byTable,
    ...preferenceResult,
  };
}

async function restorePreferences(
  manifest: HealthBackupManifest,
): Promise<
  Pick<
    HealthBackupMergeResult,
    'preferenceRestore' | 'preferenceWarning'
  >
> {
  if (!manifest.preferences) {
    return { preferenceRestore: 'not-included' };
  }
  try {
    const { restorePortablePreferences } = await import(
      '@/data/backup/portablePreferences'
    );
    await restorePortablePreferences(manifest.preferences);
    return { preferenceRestore: 'restored' };
  } catch (error) {
    return {
      preferenceRestore: 'failed',
      preferenceWarning:
        error instanceof Error
          ? error.message
          : 'Display and review preferences could not be restored.',
    };
  }
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
  return `T1-Arc-health-${part('year')}-${part('month')}-${part('day')}-${part(
    'hour',
  )}${part('minute')}${HEALTH_BACKUP_EXTENSION}`;
}

export function isFilePickerCancellation(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('picker was cancelled')
  );
}

const CONTAINER_MAGIC = new Uint8Array([
  0x44, 0x4d, 0x4b, 0x48, 0x4c, 0x54, 0x30, 0x35,
]);
const CONTAINER_FRAME_HEADER_BYTES = 6;
const CONTAINER_FRAME_END = 0;
const CONTAINER_FRAME_MANIFEST = 1;
const CONTAINER_FRAME_ROW = 2;
const CONTAINER_FRAME_PAYLOAD = 3;
const CONTAINER_NO_TABLE = 255;
const CONTAINER_WRITE_BUFFER_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ROW_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SQL_PARAMETERS = 900;
const MAX_ROWS_PER_TABLE = 3_000_000;
const MAX_TOTAL_ROWS = 4_000_000;
const MAX_JSON_BYTES = 512 * 1024 * 1024;
const MAX_IMPORT_PAYLOAD_BYTES = 50 * 1024 * 1024;
