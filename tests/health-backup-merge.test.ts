import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKUP_TABLE_NAMES,
  encodeBackupFrameHeader,
  HEALTH_BACKUP_FORMAT,
  HEALTH_BACKUP_VERSION,
  importPreparedHealthMigration,
  mergeHealthBackup,
  mergePreparedHealthBackup,
  readHealthBackupFile,
  validateHealthBackupDocument,
} from '@/data/backup/healthBackup';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { validatePortablePreferences } from '@/domain/portablePreferences';
import { MAINTAINER_MIGRATION_APPLIED_KEY } from '@/data/migration/migrationFormat';
import {
  FULL_RECONCILIATION_CANDIDATE_KEY,
  FULL_RECONCILIATION_METADATA_KEY,
} from '@/data/hevy/repository';
import { TARVIS_CONVERSATION_STORAGE_KEY } from '@/data/tarvis/conversationStore';
import { resolveTarvisDatasetOwnerIdentity } from '@/data/tarvis/conversationScope';
import { runExclusiveLocalDataMutation } from '@/data/privacy/localDataMutationCoordinator';
import { LOCAL_DATA_WRITE_EPOCH_KEY } from '@/data/privacy/localDataWriteEpoch';
import { NOTEBOOK_STORAGE_KEY } from '@/domain/personalNotebook';
import { DISPLAY_PREFERENCES_STORAGE_KEY, DEFAULT_DISPLAY_PREFERENCES } from '@/domain/displayPreferences';

const mocks = vi.hoisted(() => {
  const metadata = new Map<string, string>();
  const files = new Map<string, Uint8Array>();
  const notificationEvents = new Map<string, Record<string, unknown>>();
  const retainedSources = new Set<string>();
  const database = {
    getAllAsync: vi.fn(async (query: string, ...parameters: unknown[]) => {
      if (query.includes('FROM notification_source_events')) {
        return parameters.flatMap((id) => {
          const row = notificationEvents.get(String(id));
          return row ? [row] : [];
        });
      }
      return [];
    }),
    getFirstAsync: vi.fn(
      async (
        query: string,
        key: string,
      ): Promise<{ value: string } | { count: number } | null> => {
        if (query.includes('COUNT(*)')) {
          if (query.includes('FROM "notification_source_events"')) {
            return { count: notificationEvents.size };
          }
          if (query.includes('FROM "app_metadata"')) {
            return { count: metadata.has(key) ? 1 : 0 };
          }
          return { count: 0 };
        }
        const value = metadata.get(key);
        return value === undefined ? null : { value };
      },
    ),
    runAsync: vi.fn(async (query: string, ...parameters: unknown[]) => {
      if (query.includes('DELETE FROM app_metadata')) {
        const removed = parameters.reduce<number>(
          (count, key) => count + (metadata.delete(String(key)) ? 1 : 0),
          0,
        );
        return { changes: removed, lastInsertRowId: 0 };
      }
      if (query.includes('INSERT INTO app_metadata')) {
        const [key, value] = parameters as [string, string];
        const previous = metadata.get(key);
        metadata.set(key, value);
        return { changes: previous === value ? 0 : 1, lastInsertRowId: 0 };
      }
      if (
        query.includes('INSERT') &&
        query.includes('INTO "notification_source_events"')
      ) {
        const columns = [
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
          'reconciliation_scope',
        ];
        let changes = 0;
        for (
          let offset = 0;
          offset < parameters.length;
          offset += columns.length
        ) {
          const row = Object.fromEntries(
            columns.map((column, columnIndex) => [
              column,
              parameters[offset + columnIndex],
            ]),
          );
          const id = String(row.id);
          if (!notificationEvents.has(id)) {
            notificationEvents.set(id, row);
            changes += 1;
          }
        }
        return { changes, lastInsertRowId: 0 };
      }
      return { changes: 0, lastInsertRowId: 0 };
    }),
  };
  return {
    database,
    files,
    metadata,
    notificationEvents,
    retainedSources,
    withT1ArcTransaction: vi.fn(
      async (task: (transaction: typeof database) => Promise<unknown>) => {
        const metadataBefore = new Map(metadata);
        const notificationEventsBefore = new Map(notificationEvents);
        try {
          return await task(database);
        } catch (error) {
          metadata.clear();
          metadataBefore.forEach((value, key) => metadata.set(key, value));
          notificationEvents.clear();
          notificationEventsBefore.forEach((value, key) =>
            notificationEvents.set(key, value),
          );
          throw error;
        }
      },
    ),
    withT1ArcReadSnapshot: vi.fn(
      async (task: (snapshot: typeof database) => Promise<unknown>) =>
        task(database),
    ),
    pruneRetainedGlookoSources: vi.fn(async () => {
      retainedSources.clear();
      return { removedArchives: 1, removedReports: 1, retainedBytes: 0 };
    }),
    backfillLegacyGlookoMeterContextNotes: vi.fn(async () => 0),
  };
});

vi.mock('expo-file-system', () => ({
  File: class {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists() {
      return mocks.files.has(this.uri);
    }

    get size() {
      return mocks.files.get(this.uri)?.length ?? 0;
    }

    open() {
      const bytes = mocks.files.get(this.uri) ?? new Uint8Array();
      let offset = 0;
      return {
        close: vi.fn(),
        get offset() {
          return offset;
        },
        set offset(value: number) {
          offset = value;
        },
        readBytes(byteLength: number) {
          const result = bytes.slice(offset, offset + byteLength);
          offset += result.length;
          return result;
        },
        size: bytes.length,
      };
    }
  },
  FileMode: { ReadOnly: 'r', Truncate: 'wt' },
  Paths: { cache: 'file:///cache' },
}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-sqlite', () => ({}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  backfillLegacyGlookoMeterContextNotes:
    mocks.backfillLegacyGlookoMeterContextNotes,
  withT1ArcReadSnapshot: mocks.withT1ArcReadSnapshot,
  withT1ArcTransaction: mocks.withT1ArcTransaction,
}));
vi.mock('@/data/glooko/glookoSourceRetention', () => ({
  pruneRetainedGlookoSources: mocks.pruneRetainedGlookoSources,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function conversation(updatedAt: number) {
  return JSON.stringify({ schemaVersion: 3, updatedAt, exchanges: [] });
}

function scopedConversation(updatedAt: number, ownerIdentity: string) {
  return JSON.stringify({
    schemaVersion: 3,
    updatedAt,
    exchanges: [
      {
        id: 'exchange-scoped',
        threadId: 'thread-scoped',
        question: 'What happened yesterday?',
        answer: {
          headline: 'Observed records',
          answer: 'A preserved answer.',
          confidence: 'limited',
          evidenceIds: [],
          limitations: [],
        },
        evidence: [],
        createdAt: updatedAt - 1,
        scope: {
          kind: 'live',
          identity: `live:live:${ownerIdentity}`,
          dataMode: 'live',
          ownerIdentity,
          accountId: 'recovery-account',
        },
      },
    ],
  });
}

function emptyBackup(): {
  manifest: Record<string, any> & {
    counts: Record<string, number>;
    totalRecords: number;
  };
  tables: Record<string, Record<string, any>[]>;
} {
  return {
    manifest: {
      format: HEALTH_BACKUP_FORMAT,
      version: HEALTH_BACKUP_VERSION,
      createdAt: Date.now() - 1_000,
      timeZone: 'Europe/London',
      counts: Object.fromEntries(
        BACKUP_TABLE_NAMES.map((name) => [name, 0]),
      ),
      totalRecords: 0,
      excludes: ['credentials', 'session tokens', 'Glooko web cookies'],
    },
    tables: Object.fromEntries(BACKUP_TABLE_NAMES.map((name) => [name, []])),
  };
}

const MIGRATION_METADATA = {
  format: 't1arc-maintainer-migration' as const,
  version: 1 as const,
  createdAt: 1_775_000_000_000,
  sourceBackupVersion: 16,
  sourceContainerSha256: 'a'.repeat(64),
  recordFingerprintSha256: 'b'.repeat(64),
};
const MIGRATION_FINGERPRINT = {
  algorithm: 'sha256' as const,
  byteLength: 8,
  sha256: MIGRATION_METADATA.recordFingerprintSha256,
};

function migrationPreferences(themeMode: 'dark' | 'light') {
  return validatePortablePreferences({
    version: 6,
    glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
    glanceableDisplay: {
      lockScreenVisible: false,
      aodPosition: 'middleCenter',
      aodSize: 'standard',
    },
    insightReviews: {
      weeklyNotificationEnabled: false,
      reviewWeekday: 1,
      reviewHour: 7,
      reviewMinute: 0,
    },
    glucoseAlerts: {
      lowEnabled: true,
      lowThresholdMmolL: 3.9,
      highEnabled: true,
      highThresholdMmolL: 13.9,
      staleEnabled: false,
      repeatMinutes: 30,
    },
    themeMode,
    healthGoals: { dailyStepGoal: 8_500 },
    treatmentProfile: null,
    regionalProfile: DEFAULT_REGIONAL_PROFILE,
  });
}

function backupWithConversation(updatedAt: number) {
  const backup = emptyBackup();
  backup.tables.portable_app_state!.push({
    key: TARVIS_CONVERSATION_STORAGE_KEY,
    value: conversation(updatedAt),
  });
  backup.manifest.counts.portable_app_state = 1;
  backup.manifest.totalRecords = 1;
  return validateHealthBackupDocument(backup);
}

function notificationEvent(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const receivedAt = Date.parse('2026-08-25T08:00:00+01:00');
  return {
    id: 'notification-observation:v2:native-id:1787641200000',
    package_name: 'com.insulet.myblue.pdm',
    posted_at_ms: receivedAt - 1_000,
    notification_when_ms: receivedAt - 2_000,
    received_at_ms: receivedAt,
    is_ongoing: 1,
    payload_json: JSON.stringify({
      id: 'native-id',
      packageName: 'com.insulet.myblue.pdm',
      postedAt: receivedAt - 1_000,
      notificationWhen: receivedAt - 2_000,
      receivedAt,
      isOngoing: true,
      text: 'IOB 1.25 U',
      textLines: [],
    }),
    parser_version: 1,
    parsed_glucose_id: null,
    parsed_iob_units: 1.25,
    parsed_pump_mode: 'automated',
    imported_at_ms: receivedAt + 500,
    ...overrides,
  };
}

function backupWithNotificationEvents(
  rows: Record<string, any>[],
) {
  const backup = emptyBackup();
  backup.tables.notification_source_events = rows;
  backup.manifest.counts.notification_source_events = rows.length;
  backup.manifest.totalRecords = rows.length;
  return validateHealthBackupDocument(backup);
}

function joinBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function streamedNotificationBackup(rows: Record<string, any>[], sourceVersion = HEALTH_BACKUP_VERSION) {
  const backup = backupWithNotificationEvents(rows);
  const encoder = new TextEncoder();
  const manifest = encoder.encode(JSON.stringify({ ...backup.manifest, version: sourceVersion }));
  const tableIndex = BACKUP_TABLE_NAMES.indexOf('notification_source_events');
  const uri = `file:///notification-restore-${mocks.files.size}.container`;
  const frames = [
    new TextEncoder().encode('T1ARCCN1'),
    encodeBackupFrameHeader(1, 255, manifest.length),
    manifest,
    ...rows.flatMap((row) => {
      const payload = encoder.encode(JSON.stringify(row));
      return [encodeBackupFrameHeader(2, tableIndex, payload.length), payload];
    }),
    encodeBackupFrameHeader(0, 255, 0),
  ];
  mocks.files.set(uri, joinBytes(frames));
  return {
    kind: 'stream' as const,
    manifest: backup.manifest,
    sourceVersion,
    sourceUri: uri,
  };
}

function streamedPortableConversationMigration(value: string) {
  const backup = emptyBackup();
  backup.manifest.version = 16;
  const row = { key: TARVIS_CONVERSATION_STORAGE_KEY, value };
  backup.tables.portable_app_state = [row];
  backup.manifest.counts.portable_app_state = 1;
  backup.manifest.totalRecords = 1;
  backup.manifest.migration = MIGRATION_METADATA;
  const document = validateHealthBackupDocument(backup);
  const encoder = new TextEncoder();
  const manifest = encoder.encode(JSON.stringify({ ...document.manifest, version: 16 }));
  const payload = encoder.encode(JSON.stringify(row));
  const tableIndex = BACKUP_TABLE_NAMES.indexOf('portable_app_state');
  const uri = `file:///portable-migration-${mocks.files.size}.container`;
  mocks.files.set(
    uri,
    joinBytes([
      encoder.encode('T1ARCCN1'),
      encodeBackupFrameHeader(1, 255, manifest.length),
      manifest,
      encodeBackupFrameHeader(2, tableIndex, payload.length),
      payload,
      encodeBackupFrameHeader(0, 255, 0),
    ]),
  );
  return {
    kind: 'stream' as const,
    manifest: document.manifest,
    sourceVersion: 16,
    sourceUri: uri,
  };
}

function healthConnectRecord(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const start = Date.parse('2026-08-24T08:00:00+01:00');
  return {
    id: 'health-connect:steps:com.google.android.apps.fitness:steps-1',
    external_id: 'steps-1',
    parent_external_id: null,
    kind: 'steps',
    source_package: 'com.google.android.apps.fitness',
    start_ms: start,
    end_ms: start + 60_000,
    last_modified_ms: start + 120_000,
    recording_method: 1,
    value: 123,
    unit: 'count',
    payload_json: '{}',
    imported_at_ms: start + 180_000,
    ...overrides,
  };
}

function hevyWorkout(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const start = Date.parse('2026-08-24T09:00:00+01:00');
  return {
    id: 'hevy-workout-1',
    context_event_id: 'hevy:hevy-workout-1',
    title: 'Strength workout',
    description: null,
    start_ms: start,
    end_ms: start + 45 * 60_000,
    updated_at_ms: start + 60 * 60_000,
    created_at_ms: start,
    payload_json: '{}',
    imported_at_ms: start + 60 * 60_000,
    ...overrides,
  };
}

function insulinBolus(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const timestamp = Date.parse('2026-08-24T10:00:00+01:00');
  return {
    id: 'bolus-1',
    source_id: 'glooko-export',
    timestamp_ms: timestamp,
    units: 2.5,
    delivery_type: 'standard',
    blood_glucose_input_mmol_l: null,
    carbs_input_grams: null,
    carb_ratio_grams_per_unit: null,
    initial_units: null,
    extended_units: null,
    imported_at_ms: timestamp + 1_000,
    source_file: 'export.csv',
    source_row: 1,
    source_device_id: null,
    ...overrides,
  };
}

function sqliteRestoreDatabase(schema: string, table: string) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const database = {
    getAllAsync: vi.fn(async (query: string, ...parameters: unknown[]) => {
      if (!query.includes(`FROM ${table}`)) return [];
      return sqlite
        .prepare(query)
        .all(...(parameters as SQLInputValue[])) as Record<string, unknown>[];
    }),
    getFirstAsync: vi.fn(async () => null),
    runAsync: vi.fn(async (query: string, ...parameters: unknown[]) => {
      if (!query.includes('INSERT') || !query.includes(`INTO "${table}"`)) {
        return { changes: 0, lastInsertRowId: 0 };
      }
      const result = sqlite
        .prepare(query)
        .run(...(parameters as SQLInputValue[]));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    }),
  };
  return { database, sqlite };
}

const NOTIFICATION_RESTORE_SCHEMA = `CREATE TABLE notification_source_events (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  posted_at_ms INTEGER NOT NULL,
  notification_when_ms INTEGER,
  received_at_ms INTEGER NOT NULL,
  is_ongoing INTEGER NOT NULL CHECK (is_ongoing IN (0, 1)),
  payload_json TEXT NOT NULL,
  parser_version INTEGER NOT NULL,
  parsed_glucose_id TEXT,
  parsed_iob_units REAL,
  parsed_pump_mode TEXT,
  reconciliation_scope TEXT NOT NULL CHECK (
    reconciliation_scope IN ('local', 'restored', 'unknown')
  ),
  imported_at_ms INTEGER NOT NULL
)`;

const INSULIN_BOLUS_RESTORE_SCHEMA = `CREATE TABLE insulin_bolus (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  units REAL NOT NULL CHECK (units >= 0),
  delivery_type TEXT,
  blood_glucose_input_mmol_l REAL,
  carbs_input_grams REAL,
  carb_ratio_grams_per_unit REAL,
  initial_units REAL,
  extended_units REAL,
  imported_at_ms INTEGER NOT NULL,
  source_file TEXT,
  source_row INTEGER,
  source_device_id TEXT
)`;

function streamedVersionedBackup(options: {
  version: number;
  table?: string;
  tableIndex: number;
  row: Record<string, unknown>;
}) {
  const backup = emptyBackup();
  backup.manifest.version = options.version;
  if (options.version < 13) {
    delete backup.manifest.counts.hevy_workouts;
  }
  if (options.version < 14) {
    delete backup.manifest.counts.portable_app_state;
  }
  if (options.table) {
    backup.manifest.counts[options.table] = 1;
    backup.manifest.totalRecords = 1;
  }

  const encoder = new TextEncoder();
  const manifest = encoder.encode(JSON.stringify(backup.manifest));
  const row = encoder.encode(JSON.stringify(options.row));
  const uri = `file:///versioned-restore-${mocks.files.size}.container`;
  mocks.files.set(
    uri,
    joinBytes([
      new TextEncoder().encode('T1ARCCN1'),
      encodeBackupFrameHeader(1, 255, manifest.length),
      manifest,
      encodeBackupFrameHeader(2, options.tableIndex, row.length),
      row,
      encodeBackupFrameHeader(0, 255, 0),
    ]),
  );
  return uri;
}

async function mergeNotificationEvents(
  kind: 'legacy' | 'stream',
  rows: Record<string, any>[],
) {
  return kind === 'legacy'
    ? mergeHealthBackup(backupWithNotificationEvents(rows))
    : mergePreparedHealthBackup(streamedNotificationBackup(rows));
}

describe('health backup additive merge', () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.metadata.clear();
    mocks.notificationEvents.clear();
    mocks.retainedSources.clear();
    mocks.database.getAllAsync.mockClear();
    mocks.database.getFirstAsync.mockClear();
    mocks.database.runAsync.mockClear();
    mocks.withT1ArcTransaction.mockClear();
    mocks.withT1ArcReadSnapshot.mockClear();
    mocks.pruneRetainedGlookoSources.mockClear();
    mocks.backfillLegacyGlookoMeterContextNotes.mockClear();
  });

  it('merges notebook items without replacing local edits and keeps destination display choices', async () => {
    const entry = (id: string, note: string) => ({
      id, ownerIdentity: 'demo-fixture-v1', dataMode: 'demo', createdAt: 1_750_000_000_000,
      title: 'Saved observation', answer: 'An answer', note, limitations: [], evidence: [],
    });
    mocks.metadata.set(NOTEBOOK_STORAGE_KEY, JSON.stringify({ version: 1, entries: [entry('kept', 'My edited note')] }));
    const display = { ...DEFAULT_DISPLAY_PREFERENCES, glanceOrder: ['sleep', 'activity', 'time-in-range'] };
    mocks.metadata.set(DISPLAY_PREFERENCES_STORAGE_KEY, JSON.stringify(display));
    const backup = emptyBackup();
    backup.tables.portable_app_state = [
      { key: NOTEBOOK_STORAGE_KEY, value: JSON.stringify({ version: 1, entries: [entry('kept', 'Older copy'), entry('new', 'New note')] }) },
      { key: DISPLAY_PREFERENCES_STORAGE_KEY, value: JSON.stringify(DEFAULT_DISPLAY_PREFERENCES) },
    ];
    backup.manifest.counts.portable_app_state = 2;
    backup.manifest.totalRecords = 2;
    await mergeHealthBackup(validateHealthBackupDocument(backup));
    await mergeHealthBackup(validateHealthBackupDocument(backup));
    expect(JSON.parse(mocks.metadata.get(NOTEBOOK_STORAGE_KEY)!)).toMatchObject({ entries: [
      { id: 'kept', note: 'My edited note' }, { id: 'new', note: 'New note' },
    ] });
    expect(JSON.parse(mocks.metadata.get(DISPLAY_PREFERENCES_STORAGE_KEY)!)).toEqual(display);
  });

  it('rejects notebook overflow rather than discarding saved observations during restore', async () => {
    const entry = (id: string) => ({ id, ownerIdentity: 'demo-fixture-v1', dataMode: 'demo',
      createdAt: 1_750_000_000_000, title: 'Saved', answer: '', note: '', limitations: [], evidence: [] });
    const original = JSON.stringify({ version: 1, entries: Array.from({ length: 150 }, (_, index) => entry(String(index))) });
    mocks.metadata.set(NOTEBOOK_STORAGE_KEY, original);
    const backup = emptyBackup();
    backup.tables.portable_app_state = [{ key: NOTEBOOK_STORAGE_KEY, value: JSON.stringify({ version: 1, entries: [entry('new')] }) }];
    backup.manifest.counts.portable_app_state = 1;
    backup.manifest.totalRecords = 1;
    await expect(mergeHealthBackup(validateHealthBackupDocument(backup))).rejects.toThrow(/exceed 150/);
    expect(mocks.metadata.get(NOTEBOOK_STORAGE_KEY)).toBe(original);
  });

  it('replaces an older local Tarv1s conversation with a newer backup', async () => {
    mocks.metadata.set(TARVIS_CONVERSATION_STORAGE_KEY, conversation(100));

    const result = await mergeHealthBackup(backupWithConversation(200));

    expect(
      JSON.parse(mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!),
    ).toMatchObject({ schemaVersion: 3, updatedAt: 200 });
    expect(result.byTable.portable_app_state).toEqual({
      attempted: 1,
      inserted: 1,
      duplicates: 0,
    });
    expect(mocks.database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(key) DO UPDATE'),
      TARVIS_CONVERSATION_STORAGE_KEY,
      expect.any(String),
    );
  });

  it('does not rebind a Tarv1s owner during an ordinary additive backup restore', async () => {
    mocks.metadata.set(TARVIS_CONVERSATION_STORAGE_KEY, conversation(100));
    const sourceOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: 'live',
      localDataEpoch: 9,
      ownedSources: [
        { sourceId: 'librelinkup', identityDigest: 'a'.repeat(64) },
      ],
    });
    const backup = emptyBackup();
    backup.tables.portable_app_state = [
      {
        key: TARVIS_CONVERSATION_STORAGE_KEY,
        value: scopedConversation(200, sourceOwner),
      },
    ];
    backup.manifest.counts.portable_app_state = 1;
    backup.manifest.totalRecords = 1;

    await mergeHealthBackup(validateHealthBackupDocument(backup));

    const stored = JSON.parse(
      mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!,
    );
    expect(stored.exchanges[0].scope).toMatchObject({
      identity: `live:live:${sourceOwner}`,
      ownerIdentity: sourceOwner,
      accountId: 'recovery-account',
    });
  });

  it.each(['legacy', 'stream'] as const)('recovers conversation ownership into an empty store after erase (%s)', async kind => {
    const sourceOwner = resolveTarvisDatasetOwnerIdentity({ dataMode: 'live', localDataEpoch: 0, ownedSources: [] });
    const targetOwner = resolveTarvisDatasetOwnerIdentity({ dataMode: 'live', localDataEpoch: 7, ownedSources: [] });
    mocks.metadata.set(LOCAL_DATA_WRITE_EPOCH_KEY, '7');
    const value = scopedConversation(200, sourceOwner);
    if (kind === 'stream') {
      await mergePreparedHealthBackup(streamedPortableConversationMigration(value));
    } else {
      const backup = emptyBackup();
      backup.tables.portable_app_state = [{ key: TARVIS_CONVERSATION_STORAGE_KEY, value }];
      backup.manifest.counts.portable_app_state = backup.manifest.totalRecords = 1;
      await mergeHealthBackup(validateHealthBackupDocument(backup));
    }
    const stored = JSON.parse(mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!);
    expect(stored.exchanges[0]).toMatchObject({ question: 'What happened yesterday?', answer: { answer: 'A preserved answer.' }, scope: { ownerIdentity: targetOwner } });
    expect(stored.exchanges[0].scope).not.toHaveProperty('accountId');
  });

  it.each(['health', 'source', 'glooko'] as const)('does not adopt backup conversations into a destination with existing %s', async occupied => {
    const sourceOwner = resolveTarvisDatasetOwnerIdentity({ dataMode: 'live', localDataEpoch: 9, ownedSources: [] });
    if (occupied === 'health') mocks.notificationEvents.set('existing', { id: 'existing' });
    if (occupied === 'source') mocks.metadata.set('glucose-source-connection-ownership-v1:nightscout', JSON.stringify({ version: 1, changeGeneration: 1, ownerGeneration: 1, connected: true, identityDigest: 'b'.repeat(64) }));
    if (occupied === 'glooko') mocks.metadata.set('glooko-sync-state-v1', JSON.stringify({ verifiedAccountFingerprint: `af1_${'c'.repeat(64)}` }));
    await mergePreparedHealthBackup(streamedPortableConversationMigration(scopedConversation(200, sourceOwner)));
    expect(JSON.parse(mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!).exchanges[0].scope.ownerIdentity).toBe(sourceOwner);
  });

  it('recovers a notebook into the new erase epoch without changing its content', async () => {
    const sourceOwner = resolveTarvisDatasetOwnerIdentity({ dataMode: 'live', localDataEpoch: 0, ownedSources: [] });
    mocks.metadata.set(LOCAL_DATA_WRITE_EPOCH_KEY, '7');
    const entry = { id: 'note', ownerIdentity: sourceOwner, dataMode: 'live', createdAt: 1_750_000_000_000, title: 'Saved observation', answer: 'Keep this answer', note: 'My note', limitations: [], evidence: [] };
    const backup = emptyBackup();
    backup.tables.portable_app_state = [{ key: NOTEBOOK_STORAGE_KEY, value: JSON.stringify({ version: 1, entries: [entry] }) }];
    backup.manifest.counts.portable_app_state = backup.manifest.totalRecords = 1;
    await mergeHealthBackup(validateHealthBackupDocument(backup));
    expect(JSON.parse(mocks.metadata.get(NOTEBOOK_STORAGE_KEY)!).entries).toEqual([{ ...entry, ownerIdentity: 'dataset-owner-v1|epoch:7|glooko:none' }]);
  });

  it('preserves a newer or equally recent local Tarv1s conversation', async () => {
    mocks.metadata.set(TARVIS_CONVERSATION_STORAGE_KEY, conversation(300));

    const olderResult = await mergeHealthBackup(backupWithConversation(200));
    const equalResult = await mergeHealthBackup(backupWithConversation(300));

    expect(
      JSON.parse(mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!),
    ).toMatchObject({ updatedAt: 300 });
    expect(olderResult.byTable.portable_app_state).toEqual({
      attempted: 1,
      inserted: 0,
      duplicates: 1,
    });
    expect(equalResult.byTable.portable_app_state).toEqual({
      attempted: 1,
      inserted: 0,
      duplicates: 1,
    });
    expect(mocks.database.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_metadata'),
      TARVIS_CONVERSATION_STORAGE_KEY,
      expect.any(String),
    );
  });

  it('replaces unusable local conversation state with the validated backup', async () => {
    mocks.metadata.set(TARVIS_CONVERSATION_STORAGE_KEY, '{broken-json');

    const result = await mergeHealthBackup(backupWithConversation(200));

    expect(
      JSON.parse(mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!),
    ).toMatchObject({ schemaVersion: 3, updatedAt: 200 });
    expect(result.byTable.portable_app_state.inserted).toBe(1);
  });

  it('does not prune unrelated retained source artifacts during restore', async () => {
    mocks.retainedSources.add('existing-archive');
    mocks.retainedSources.add('existing-report');

    await mergeHealthBackup(validateHealthBackupDocument(emptyBackup()));

    expect(mocks.pruneRetainedGlookoSources).not.toHaveBeenCalled();
    expect([...mocks.retainedSources]).toEqual([
      'existing-archive',
      'existing-report',
    ]);
  });

  it('invalidates a pre-restore staged Hevy reconciliation snapshot', async () => {
    mocks.metadata.set(
      FULL_RECONCILIATION_CANDIDATE_KEY,
      JSON.stringify({ fingerprint: 'pre-restore-snapshot' }),
    );
    mocks.metadata.set(
      FULL_RECONCILIATION_METADATA_KEY,
      JSON.stringify({ lastSuccessfulAt: Date.now(), userId: 'hevy-user' }),
    );

    await mergeHealthBackup(validateHealthBackupDocument(emptyBackup()));

    expect(mocks.metadata.has(FULL_RECONCILIATION_CANDIDATE_KEY)).toBe(false);
    expect(mocks.metadata.has(FULL_RECONCILIATION_METADATA_KEY)).toBe(false);
    expect(mocks.database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM app_metadata'),
      FULL_RECONCILIATION_CANDIDATE_KEY,
      FULL_RECONCILIATION_METADATA_KEY,
    );
  });

  it('backfills native meal nutrition inside the additive restore transaction', async () => {
    await mergeHealthBackup(validateHealthBackupDocument(emptyBackup()));

    expect(mocks.withT1ArcTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE context_events'),
    );
    expect(mocks.database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("source_id = 't1arc-food'"),
    );
  });

  it('reads a genuine version 12 Health Connect frame at its pre-Hevy index', async () => {
    const uri = streamedVersionedBackup({
      version: 12,
      table: 'health_connect_records',
      tableIndex: 5,
      row: healthConnectRecord(),
    });

    await expect(readHealthBackupFile(uri)).resolves.toMatchObject({
      kind: 'stream',
      sourceVersion: 12,
      sourceUri: uri,
    });
  });

  it('reads a later version 12 notification frame at its pre-Hevy index', async () => {
    const uri = streamedVersionedBackup({
      version: 12,
      table: 'notification_source_events',
      tableIndex: 14,
      row: notificationEvent(),
    });

    await expect(readHealthBackupFile(uri)).resolves.toMatchObject({
      kind: 'stream',
      sourceVersion: 12,
      sourceUri: uri,
    });
  });

  it('preserves the shipped version 13 Hevy frame index', async () => {
    const uri = streamedVersionedBackup({
      version: 13,
      table: 'hevy_workouts',
      tableIndex: 5,
      row: hevyWorkout(),
    });

    await expect(readHealthBackupFile(uri)).resolves.toMatchObject({
      kind: 'stream',
      sourceVersion: 13,
      sourceUri: uri,
    });
  });

  it('preserves the current notification frame index', async () => {
    const uri = streamedVersionedBackup({
      version: HEALTH_BACKUP_VERSION,
      table: 'notification_source_events',
      tableIndex: BACKUP_TABLE_NAMES.indexOf('notification_source_events'),
      row: notificationEvent(),
    });

    await expect(readHealthBackupFile(uri)).resolves.toMatchObject({
      kind: 'stream',
      sourceVersion: HEALTH_BACKUP_VERSION,
      sourceUri: uri,
    });
  });

  it('rejects a frame index that did not exist in the source backup version', async () => {
    const uri = streamedVersionedBackup({
      version: 12,
      tableIndex: 22,
      row: {},
    });

    await expect(readHealthBackupFile(uri)).rejects.toThrow(
      /invalid record frame/i,
    );
  });

  it('keeps legacy JSON version 12 table names independent of stream indexes', async () => {
    const backup = emptyBackup();
    backup.manifest.version = 12;
    delete backup.manifest.counts.hevy_workouts;
    delete backup.manifest.counts.portable_app_state;
    delete backup.tables.hevy_workouts;
    delete backup.tables.portable_app_state;
    backup.tables.health_connect_records = [healthConnectRecord()];
    backup.manifest.counts.health_connect_records = 1;
    backup.manifest.totalRecords = 1;

    await expect(
      mergeHealthBackup(validateHealthBackupDocument(backup)),
    ).resolves.toMatchObject({ attempted: 1 });
    expect(
      mocks.database.runAsync.mock.calls.some(([query]) =>
        String(query).includes(
          'INTO "health_connect_records"',
        ),
      ),
    ).toBe(true);
  });

  it('fails closed when a legacy row violates a SQLite NOT NULL constraint', async () => {
    const actual = sqliteRestoreDatabase(
      NOTIFICATION_RESTORE_SCHEMA,
      'notification_source_events',
    );
    mocks.withT1ArcTransaction.mockImplementationOnce((task) =>
      task(actual.database as never),
    );
    try {
      await expect(
        mergeHealthBackup(
          backupWithNotificationEvents([
            notificationEvent({ parser_version: null }),
          ]),
        ),
      ).rejects.toThrow(/not null constraint/i);
      expect(
        actual.sqlite
          .prepare('SELECT COUNT(*) AS count FROM notification_source_events')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      actual.sqlite.close();
    }
  });

  it('fails closed when a streamed row violates a SQLite CHECK constraint', async () => {
    const actual = sqliteRestoreDatabase(
      INSULIN_BOLUS_RESTORE_SCHEMA,
      'insulin_bolus',
    );
    mocks.withT1ArcTransaction.mockImplementationOnce((task) =>
      task(actual.database as never),
    );
    const uri = streamedVersionedBackup({
      version: HEALTH_BACKUP_VERSION,
      table: 'insulin_bolus',
      tableIndex: BACKUP_TABLE_NAMES.indexOf('insulin_bolus'),
      row: insulinBolus({ units: -1 }),
    });
    const prepared = await readHealthBackupFile(uri);
    try {
      await expect(
        mergePreparedHealthBackup(prepared),
      ).rejects.toThrow(/check constraint/i);
      expect(
        actual.sqlite.prepare('SELECT COUNT(*) AS count FROM insulin_bolus').get(),
      ).toEqual({ count: 0 });
    } finally {
      actual.sqlite.close();
    }
  });

  it('still treats an exact immutable notification retry as a duplicate', async () => {
    const actual = sqliteRestoreDatabase(
      NOTIFICATION_RESTORE_SCHEMA,
      'notification_source_events',
    );
    mocks.withT1ArcTransaction
      .mockImplementationOnce((task) => task(actual.database as never))
      .mockImplementationOnce((task) => task(actual.database as never));
    const backup = backupWithNotificationEvents([notificationEvent()]);
    try {
      await expect(mergeHealthBackup(backup)).resolves.toMatchObject({
        attempted: 1,
        inserted: 1,
        duplicates: 0,
      });
      await expect(mergeHealthBackup(backup)).resolves.toMatchObject({
        attempted: 1,
        inserted: 0,
        duplicates: 1,
      });
    } finally {
      actual.sqlite.close();
    }
  });

  it.each(['legacy', 'stream'] as const)(
    'keeps %s restore accounting attempt-local across a whole-transaction retry',
    async (kind) => {
      mocks.withT1ArcTransaction.mockImplementationOnce(async (task) => {
        await task(mocks.database);
        // Model runT1ArcTransaction rolling back after a SQLITE_LOCKED COMMIT
        // and retrySqliteBusy invoking the entire callback on a new connection.
        mocks.notificationEvents.clear();
        return task(mocks.database);
      });
      const event = notificationEvent({ id: `retry-${kind}` });

      const result = await mergeNotificationEvents(kind, [event]);

      expect(result).toMatchObject({
        attempted: 1,
        inserted: 1,
        duplicates: 0,
      });
      expect(result.byTable.notification_source_events).toEqual({
        attempted: 1,
        inserted: 1,
        duplicates: 0,
      });
    },
  );

  it('rejects rather than queues another restore behind an active privacy mutation', async () => {
    let release!: () => void;
    let started!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transactionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.withT1ArcTransaction.mockImplementationOnce(async (task) => {
      started();
      await released;
      return task(mocks.database);
    });

    const first = mergeHealthBackup(validateHealthBackupDocument(emptyBackup()));
    await transactionStarted;
    await expect(
      mergeHealthBackup(validateHealthBackupDocument(emptyBackup())),
    ).rejects.toThrow(/restore.*already in progress/i);

    release();
    await expect(first).resolves.toMatchObject({ attempted: 0, inserted: 0 });
  });

  it('holds restore ownership until its post-commit refresh has settled', async () => {
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    const erase = vi.fn(async () => 'erased');

    const restore = mergeHealthBackup(
      validateHealthBackupDocument(emptyBackup()),
      {
        afterCommit: async (result) => {
          expect(result).toMatchObject({ attempted: 0, inserted: 0 });
          callbackStarted.resolve();
          await releaseCallback.promise;
        },
      },
    );
    await callbackStarted.promise;

    await expect(
      runExclusiveLocalDataMutation('erase', erase),
    ).rejects.toThrow(/restore.*already in progress/i);
    expect(erase).not.toHaveBeenCalled();

    releaseCallback.resolve();
    await expect(restore).resolves.toMatchObject({ attempted: 0, inserted: 0 });
    await expect(
      runExclusiveLocalDataMutation('erase', erase),
    ).resolves.toBe('erased');
  });

  it.each(['legacy', 'stream'] as const)(
    'rejects divergent duplicate notification IDs inside a %s backup',
    async (kind) => {
      const original = notificationEvent();
      const collision = notificationEvent({
        payload_json: String(original.payload_json).replace('1.25', '9.5'),
      });

      await expect(
        mergeNotificationEvents(kind, [original, collision]),
      ).rejects.toThrow(/conflicting notification evidence/i);
    },
  );

  it.each(['legacy', 'stream'] as const)(
    'rejects a non-text notification evidence ID during %s restore',
    async (kind) => {
      await expect(
        mergeNotificationEvents(kind, [notificationEvent({ id: 123 })]),
      ).rejects.toThrow(/invalid notification evidence record ID/i);
    },
  );

  it.each(['legacy', 'stream'] as const)(
    'rejects a %s notification row that conflicts with the local immutable envelope',
    async (kind) => {
      const local = notificationEvent();
      mocks.notificationEvents.set(local.id, {
        ...local,
        reconciliation_scope: 'local',
      });
      const collision = notificationEvent({
        received_at_ms: local.received_at_ms + 1,
      });

      await expect(
        mergeNotificationEvents(kind, [collision]),
      ).rejects.toThrow(/conflicting notification evidence/i);
    },
  );

  it.each(['legacy', 'stream'] as const)(
    'rejects divergent duplicate notification IDs across bounded %s restore batches',
    async (kind) => {
      const original = notificationEvent({ id: 'notification-boundary-id' });
      const intervening = Array.from({ length: 74 }, (_, index) =>
        notificationEvent({ id: `notification-intervening-${index}` }),
      );
      const collision = notificationEvent({
        id: original.id,
        posted_at_ms: original.posted_at_ms + 1,
      });

      await expect(
        mergeNotificationEvents(kind, [
          original,
          ...intervening,
          collision,
        ]),
      ).rejects.toThrow(/conflicting notification evidence/i);
      expect(mocks.notificationEvents.size).toBe(0);
    },
  );

  it('documents the SQLite affinity coercion that collision preflight must reject before insertion', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE notification_source_events (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      posted_at_ms INTEGER NOT NULL,
      notification_when_ms INTEGER,
      received_at_ms INTEGER NOT NULL,
      is_ongoing INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )`);
    sqlite
      .prepare(
        `INSERT INTO notification_source_events VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('affinity-collision', 123, '001', null, 2, '1', 42);

    expect(
      sqlite
        .prepare(
          `SELECT id, package_name, posted_at_ms, notification_when_ms,
             received_at_ms, is_ongoing, payload_json
           FROM notification_source_events`,
        )
        .get(),
    ).toEqual({
      id: 'affinity-collision',
      package_name: '123.0',
      posted_at_ms: 1,
      notification_when_ms: null,
      received_at_ms: 2,
      is_ongoing: 1,
      payload_json: '42.0',
    });
    sqlite.close();
  });

  it.each(['legacy', 'stream'] as const)(
    'rejects invalid notification identity before SQLite affinity can mask a cross-batch %s collision',
    async (kind) => {
      const id = 'notification-affinity-collision';
      const affinityCoerced = notificationEvent({
        id,
        package_name: 123,
        posted_at_ms: '001',
        notification_when_ms: null,
        received_at_ms: 2,
        is_ongoing: '1',
        payload_json: 42,
      });
      const intervening = Array.from({ length: 68 }, (_, index) =>
        notificationEvent({ id: `notification-affinity-${index}` }),
      );
      const canonicalCollision = notificationEvent({
        id,
        package_name: '123.0',
        posted_at_ms: 1,
        notification_when_ms: null,
        received_at_ms: 2,
        is_ongoing: 1,
        payload_json: '42.0',
      });

      await expect(
        mergeNotificationEvents(kind, [
          affinityCoerced,
          ...intervening,
          canonicalCollision,
        ]),
      ).rejects.toThrow(/invalid notification evidence envelope/i);
      expect(mocks.notificationEvents.size).toBe(0);
    },
  );

  it.each([
    ['package_name', { package_name: 123 }],
    ['posted_at_ms', { posted_at_ms: '1' }],
    ['notification_when_ms', { notification_when_ms: '1' }],
    ['received_at_ms', { received_at_ms: '1' }],
    ['is_ongoing', { is_ongoing: '1' }],
    ['payload_json', { payload_json: 123 }],
    [
      'unsafe timestamp',
      { received_at_ms: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])('rejects an invalid notification %s before restore', async (_field, overrides) => {
    await expect(
      mergeNotificationEvents('legacy', [notificationEvent(overrides)]),
    ).rejects.toThrow(/invalid notification evidence envelope/i);
    expect(mocks.notificationEvents.size).toBe(0);
  });

  it.each(['legacy', 'stream'] as const)(
    'keeps an exact local notification envelope during %s restore even when derived metadata differs',
    async (kind) => {
      const local = notificationEvent();
      mocks.notificationEvents.set(local.id, local);
      const reprocessed = notificationEvent({
        parser_version: 99,
        parsed_glucose_id: 'new-parser-glucose-id',
        parsed_iob_units: 8.75,
        parsed_pump_mode: 'manual',
        imported_at_ms: local.imported_at_ms + 60_000,
      });

      await expect(
        mergeNotificationEvents(kind, [reprocessed, reprocessed]),
      ).resolves.toBeDefined();
      expect(mocks.notificationEvents.get(local.id)).toEqual(local);
    },
  );

  it.each(['legacy', 'stream'] as const)(
    'keeps the first exact incoming notification envelope during %s restore when derived metadata differs',
    async (kind) => {
      const first = notificationEvent({ id: 'notification-reprocessed-id' });
      const reprocessed = notificationEvent({
        id: first.id,
        parser_version: 99,
        parsed_glucose_id: 'new-parser-glucose-id',
        parsed_iob_units: 8.75,
        parsed_pump_mode: 'manual',
        imported_at_ms: first.imported_at_ms + 60_000,
      });

      await expect(
        mergeNotificationEvents(kind, [first, reprocessed]),
      ).resolves.toBeDefined();
      expect(mocks.notificationEvents.get(first.id)).toEqual({
        ...first,
        reconciliation_scope: 'restored',
      });
    },
  );

  it('imports a validated migration exactly once into an empty store', async () => {
    const backup = streamedNotificationBackup([notificationEvent()], 16);
    backup.manifest.migration = MIGRATION_METADATA;

    const first = await importPreparedHealthMigration(
      backup,
      MIGRATION_METADATA,
      MIGRATION_FINGERPRINT,
    );
    const second = await importPreparedHealthMigration(
      backup,
      MIGRATION_METADATA,
      MIGRATION_FINGERPRINT,
    );

    expect(first).toMatchObject({
      kind: 'imported',
      totalRecords: 1,
      recordFingerprintSha256:
        MIGRATION_METADATA.recordFingerprintSha256,
      preferences: 'not-included',
    });
    expect(first.kind === 'imported' && first.byTable.notification_source_events)
      .toEqual({ attempted: 1, inserted: 1, duplicates: 0 });
    expect(second).toMatchObject({
      kind: 'already-imported',
      totalRecords: 1,
    });
    expect(mocks.notificationEvents.size).toBe(1);
    expect(
      JSON.parse(mocks.metadata.get(MAINTAINER_MIGRATION_APPLIED_KEY)!),
    ).toMatchObject({
      schemaVersion: 1,
      recordFingerprintSha256:
        MIGRATION_METADATA.recordFingerprintSha256,
      sourceContainerSha256: MIGRATION_METADATA.sourceContainerSha256,
    });
    expect(mocks.backfillLegacyGlookoMeterContextNotes).not.toHaveBeenCalled();
  });

  it('rebinds only the exact-migration Tarv1s row to the empty target sandbox', async () => {
    const sourceOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: 'live',
      localDataEpoch: 9,
      ownedSources: [
        { sourceId: 'librelinkup', identityDigest: 'a'.repeat(64) },
      ],
    });
    const targetOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: 'live',
      localDataEpoch: 7,
      ownedSources: [],
    });
    mocks.metadata.set(LOCAL_DATA_WRITE_EPOCH_KEY, '7');
    const portableConversation = scopedConversation(
      MIGRATION_METADATA.createdAt,
      sourceOwner,
    );

    const result = await importPreparedHealthMigration(
      streamedPortableConversationMigration(portableConversation),
      MIGRATION_METADATA,
      MIGRATION_FINGERPRINT,
    );
    const stored = JSON.parse(
      mocks.metadata.get(TARVIS_CONVERSATION_STORAGE_KEY)!,
    );

    expect(result).toMatchObject({ kind: 'imported', totalRecords: 1 });
    expect(stored.exchanges[0]).toMatchObject({
      id: 'exchange-scoped',
      threadId: 'thread-scoped',
      question: 'What happened yesterday?',
      answer: { answer: 'A preserved answer.' },
      scope: {
        kind: 'live',
        identity: `live:live:${targetOwner}`,
        dataMode: 'live',
        ownerIdentity: targetOwner,
      },
    });
    expect(stored.exchanges[0].scope).not.toHaveProperty('accountId');
  });

  it('rejects migration metadata that differs from the authenticated manifest', async () => {
    const backup = streamedNotificationBackup([], 16);
    backup.manifest.migration = MIGRATION_METADATA;

    await expect(
      importPreparedHealthMigration(backup, {
        ...MIGRATION_METADATA,
        createdAt: MIGRATION_METADATA.createdAt + 1,
      }, MIGRATION_FINGERPRINT),
    ).rejects.toThrow(/metadata does not match its manifest/i);
    expect(mocks.withT1ArcTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unverified record fingerprint before opening a transaction', async () => {
    const backup = streamedNotificationBackup([], 16);
    backup.manifest.migration = MIGRATION_METADATA;

    await expect(
      importPreparedHealthMigration(backup, MIGRATION_METADATA, {
        ...MIGRATION_FINGERPRINT,
        sha256: 'c'.repeat(64),
      }),
    ).rejects.toThrow(/record fingerprint is invalid/i);
    expect(mocks.withT1ArcTransaction).not.toHaveBeenCalled();
  });

  it('rejects a different bundle after a completed migration', async () => {
    const backup = streamedNotificationBackup([], 16);
    backup.manifest.migration = MIGRATION_METADATA;
    await importPreparedHealthMigration(
      backup,
      MIGRATION_METADATA,
      MIGRATION_FINGERPRINT,
    );
    const differentMetadata = {
      ...MIGRATION_METADATA,
      recordFingerprintSha256: 'c'.repeat(64),
    };
    backup.manifest.migration = differentMetadata;

    await expect(
      importPreparedHealthMigration(backup, differentMetadata, {
        ...MIGRATION_FINGERPRINT,
        sha256: differentMetadata.recordFingerprintSha256,
      }),
    ).rejects.toThrow(/different maintainer migration/i);
  });

  it('rolls back when final destination counts differ from the manifest', async () => {
    const backup = streamedNotificationBackup([notificationEvent()], 16);
    backup.manifest.migration = MIGRATION_METADATA;
    const originalGetFirst = mocks.database.getFirstAsync.getMockImplementation()!;
    let notificationCountReads = 0;
    mocks.database.getFirstAsync.mockImplementation(
      async (query: string, key: string) => {
        if (
          query.includes('COUNT(*)') &&
          query.includes('FROM "notification_source_events"')
        ) {
          notificationCountReads += 1;
          return { count: notificationCountReads === 1 ? 0 : 2 };
        }
        return originalGetFirst(query, key);
      },
    );
    try {
      await expect(
        importPreparedHealthMigration(
          backup,
          MIGRATION_METADATA,
          MIGRATION_FINGERPRINT,
        ),
      ).rejects.toThrow(/destination count check failed/i);
      expect(mocks.notificationEvents.size).toBe(0);
      expect(mocks.metadata.has(MAINTAINER_MIGRATION_APPLIED_KEY)).toBe(false);
    } finally {
      mocks.database.getFirstAsync.mockImplementation(originalGetFirst);
    }
  });

  it('rejects a migration when portable destination data already exists', async () => {
    const backup = streamedNotificationBackup([], 16);
    backup.manifest.migration = MIGRATION_METADATA;
    const originalGetFirst = mocks.database.getFirstAsync.getMockImplementation()!;
    mocks.database.getFirstAsync.mockImplementation(
      async (query: string, key: string) => {
        if (
          query.includes('COUNT(*)') &&
          query.includes('FROM "glucose_readings"')
        ) {
          return { count: 1 };
        }
        return originalGetFirst(query, key);
      },
    );
    try {
      await expect(
        importPreparedHealthMigration(
          backup,
          MIGRATION_METADATA,
          MIGRATION_FINGERPRINT,
        ),
      ).rejects.toThrow(/only be applied to an empty/i);
      expect(mocks.metadata.has(MAINTAINER_MIGRATION_APPLIED_KEY)).toBe(false);
    } finally {
      mocks.database.getFirstAsync.mockImplementation(originalGetFirst);
    }
  });

  it('treats excluded raw-payload tables as non-empty migration state', async () => {
    const backup = streamedNotificationBackup([], 16);
    backup.manifest.migration = MIGRATION_METADATA;
    const originalGetFirst = mocks.database.getFirstAsync.getMockImplementation()!;
    mocks.database.getFirstAsync.mockImplementation(
      async (query: string, key: string) => {
        if (
          query.includes('COUNT(*)') &&
          query.includes('FROM "glooko_report_payloads"')
        ) {
          return { count: 1 };
        }
        return originalGetFirst(query, key);
      },
    );
    try {
      await expect(
        importPreparedHealthMigration(
          backup,
          MIGRATION_METADATA,
          MIGRATION_FINGERPRINT,
        ),
      ).rejects.toThrow(/only be applied to an empty/i);
      expect(mocks.metadata.has(MAINTAINER_MIGRATION_APPLIED_KEY)).toBe(false);
    } finally {
      mocks.database.getFirstAsync.mockImplementation(originalGetFirst);
    }
  });

  it('rolls rows and portable preferences back if the applied marker cannot commit', async () => {
    const backup = streamedNotificationBackup([notificationEvent()], 16);
    backup.manifest.migration = MIGRATION_METADATA;
    const originalPreferences = migrationPreferences('light');
    const incomingPreferences = migrationPreferences('dark');
    backup.manifest.preferences = incomingPreferences;
    let currentPreferences = originalPreferences;
    const adapter = {
      capture: vi.fn(async () => currentPreferences),
      restore: vi.fn(async (
        preferences: typeof currentPreferences,
        transaction?: unknown,
      ) => {
        if (preferences === incomingPreferences) {
          expect(transaction).toBe(mocks.database);
        } else {
          expect(transaction).toBeUndefined();
        }
        currentPreferences = preferences;
      }),
    };
    const originalRun = mocks.database.runAsync.getMockImplementation()!;
    mocks.database.runAsync.mockImplementation(
      async (query: string, ...parameters: unknown[]) => {
        if (
          query.includes('INSERT INTO app_metadata') &&
          parameters[0] === MAINTAINER_MIGRATION_APPLIED_KEY
        ) {
          throw new Error('simulated interrupted commit');
        }
        return originalRun(query, ...parameters);
      },
    );
    try {
      await expect(
        importPreparedHealthMigration(
          backup,
          MIGRATION_METADATA,
          MIGRATION_FINGERPRINT,
          adapter,
        ),
      ).rejects.toThrow(/simulated interrupted commit/i);
      expect(adapter.restore).toHaveBeenNthCalledWith(
        1,
        incomingPreferences,
        mocks.database,
      );
      expect(adapter.restore).toHaveBeenNthCalledWith(2, originalPreferences);
      expect(currentPreferences).toBe(originalPreferences);
      expect(mocks.notificationEvents.size).toBe(0);
      expect(mocks.metadata.has(MAINTAINER_MIGRATION_APPLIED_KEY)).toBe(false);
    } finally {
      mocks.database.runAsync.mockImplementation(originalRun);
    }
  });
});
