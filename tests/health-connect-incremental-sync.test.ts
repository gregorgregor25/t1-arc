import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthConnectRecord } from '../modules/t1arc-health-connect/src/T1ArcHealthConnect.types';

import {
  HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS,
  HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS,
  HEALTH_CONNECT_MANUAL_SYNC_INTERVAL_MS,
  HEALTH_CONNECT_WINDOW_CHECK_SPAN_MS,
  healthConnectSyncDue,
  healthConnectSyncShouldStop,
  healthConnectWindowCheckDue,
  orderHealthConnectCategoriesForSync,
  syncHealthConnect,
  syncHealthConnectIfDue,
} from '@/data/healthConnect/healthConnectRepository';
import { HEALTH_CONNECT_IDENTITY_INDEX_SQL } from '@/data/persistence/healthConnectIdentityIndex';

// All values below are synthetic.
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2030, 2, 10, 12, 0, 0);
const SOURCE = 'com.example.scale';

const harness = vi.hoisted(() => ({
  database: undefined as unknown,
}));

const native = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  getChangesTokenAsync: vi.fn(),
  readRecordsPageAsync: vi.fn(),
  readChangesPageAsync: vi.fn(),
}));

vi.mock('../modules/t1arc-health-connect', () => ({ default: native }));

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: vi.fn() },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => harness.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = harness.database as TestDatabase;
      database.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(database);
        database.sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        database.sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  ),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 1 })),
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
  isLocalDataWriteSupersededError: vi.fn(() => false),
}));

class TestDatabase {
  readonly runCalls: string[] = [];

  constructor(readonly sqlite: DatabaseSync) {}

  async getAllAsync<T>(sql: string, ...parameters: unknown[]) {
    return this.sqlite
      .prepare(sql)
      .all(...(parameters as SQLInputValue[])) as T[];
  }

  async getFirstAsync<T>(sql: string, ...parameters: unknown[]) {
    return (
      (this.sqlite
        .prepare(sql)
        .get(...(parameters as SQLInputValue[])) as T | undefined) ?? null
    );
  }

  async runAsync(sql: string, ...parameters: unknown[]) {
    this.runCalls.push(sql);
    const result = this.sqlite
      .prepare(sql)
      .run(...(parameters as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  recordStatements() {
    return this.runCalls.filter((sql) =>
      /(INSERT INTO|UPDATE|DELETE FROM) health_connect_records/.test(sql),
    );
  }

  contextStatements() {
    return this.runCalls.filter((sql) =>
      /(INSERT INTO|DELETE FROM) context_(events|notes)/.test(sql),
    );
  }
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE health_connect_records (
      id TEXT NOT NULL PRIMARY KEY,
      external_id TEXT NOT NULL,
      parent_external_id TEXT,
      kind TEXT NOT NULL,
      source_package TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      last_modified_ms INTEGER NOT NULL,
      recording_method INTEGER NOT NULL,
      value REAL,
      unit TEXT,
      payload_json TEXT NOT NULL,
      imported_at_ms INTEGER NOT NULL,
      reconciliation_scope TEXT NOT NULL DEFAULT 'current',
      UNIQUE(kind, source_package, external_id)
    );
    CREATE INDEX idx_health_connect_kind_time
      ON health_connect_records(kind, start_ms, end_ms);
    ${HEALTH_CONNECT_IDENTITY_INDEX_SQL}
    CREATE TABLE health_connect_sources (
      package_name TEXT NOT NULL PRIMARY KEY,
      display_name TEXT NOT NULL,
      first_seen_at_ms INTEGER NOT NULL,
      last_seen_at_ms INTEGER NOT NULL
    );
    CREATE TABLE health_connect_preferences (
      category TEXT NOT NULL PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      preferred_source_package TEXT,
      preferred_source_mode TEXT,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE health_connect_sync_state (
      category TEXT NOT NULL PRIMARY KEY,
      last_attempt_at_ms INTEGER,
      last_success_at_ms INTEGER,
      data_start_ms INTEGER,
      data_through_ms INTEGER,
      record_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_message TEXT,
      changes_token TEXT,
      changes_token_source_package TEXT
    );
    CREATE TABLE context_events (
      id TEXT NOT NULL PRIMARY KEY, source_id TEXT NOT NULL,
      origin TEXT NOT NULL, kind TEXT NOT NULL, start_ms INTEGER NOT NULL,
      end_ms INTEGER, title TEXT NOT NULL, meal_type TEXT, carbs_grams REAL,
      energy_kcal REAL, protein_grams REAL, fat_grams REAL, fibre_grams REAL,
      sugars_grams REAL, saturated_fat_grams REAL, serving_quantity REAL,
      serving_count REAL, activity_type TEXT, duration_minutes REAL,
      intensity TEXT, calories_burned REAL, quality_percent REAL,
      kilograms REAL, amount REAL, unit TEXT, medication_type TEXT,
      recorded_at_ms INTEGER NOT NULL, source_file TEXT, source_row INTEGER
    );
    CREATE TABLE context_notes (
      id TEXT NOT NULL PRIMARY KEY, source_id TEXT NOT NULL,
      origin TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER,
      title TEXT NOT NULL, category TEXT NOT NULL, detail TEXT,
      recorded_at_ms INTEGER NOT NULL, source_file TEXT, source_row INTEGER
    );
  `);
  sqlite
    .prepare(
      `INSERT INTO health_connect_preferences
         (category, enabled, preferred_source_package, preferred_source_mode,
          updated_at_ms)
       VALUES ('weight', 1, ?, 'manual', 1)`,
    )
    .run(SOURCE);
  return new TestDatabase(sqlite);
}

function weight(
  index: number,
  overrides: Partial<HealthConnectRecord> = {},
): HealthConnectRecord {
  const start = NOW - 10 * HOUR + index * HOUR;
  return {
    externalId: `weight-${index}`,
    kind: 'weight',
    sourcePackage: SOURCE,
    startTimeMs: start,
    endTimeMs: start,
    lastModifiedTimeMs: start + 1_000,
    recordingMethod: 1,
    clientRecordVersion: 1,
    value: 70 + index / 10,
    unit: 'kg',
    ...overrides,
  };
}

const sources = [{ packageName: SOURCE, displayName: 'Example Scale' }];

function emptyChanges(nextChangesToken = 'token-2') {
  return {
    upserted: [],
    deletedRecordIds: [],
    sources: [],
    nextChangesToken,
    hasMore: false,
    tokenExpired: false,
  };
}

function db() {
  return harness.database as TestDatabase;
}

function storedIds() {
  return (
    db()
      .sqlite.prepare(
        'SELECT external_id FROM health_connect_records ORDER BY external_id',
      )
      .all() as { external_id: string }[]
  ).map((row) => row.external_id);
}

function syncRow() {
  return db()
    .sqlite.prepare(
      "SELECT * FROM health_connect_sync_state WHERE category = 'weight'",
    )
    .get() as Record<string, unknown>;
}

async function firstFullSync(records: HealthConnectRecord[]) {
  native.readRecordsPageAsync.mockResolvedValueOnce({
    records,
    sources,
    nextPageToken: null,
  });
  await syncHealthConnect({ categories: ['weight'] });
}

describe('Health Connect incremental sync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    harness.database = createDatabase();
    native.getStatusAsync.mockReset().mockResolvedValue({
      availability: 'available',
      historyGranted: false,
      backgroundGranted: true,
      categories: [{ id: 'weight', granted: true }],
    });
    native.getChangesTokenAsync.mockReset().mockResolvedValue('token-1');
    native.readRecordsPageAsync.mockReset();
    native.readChangesPageAsync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores a first full read and its changes token', async () => {
    await firstFullSync([weight(1), weight(2)]);

    expect(storedIds()).toEqual(['weight-1', 'weight-2']);
    expect(syncRow()).toMatchObject({
      changes_token: 'token-1',
      record_count: 2,
      last_success_at_ms: NOW,
    });
    expect(
      db().sqlite.prepare('SELECT COUNT(*) AS n FROM context_events').get(),
    ).toEqual({ n: 2 });
  });

  it('uses only the changes feed when the token is valid and nothing changed', async () => {
    await firstFullSync([weight(1), weight(2)]);
    native.readRecordsPageAsync.mockClear();
    db().runCalls.length = 0;
    vi.setSystemTime(NOW + HOUR);
    native.readChangesPageAsync.mockResolvedValueOnce(emptyChanges());

    const result = await syncHealthConnect({ categories: ['weight'] });

    expect(native.readChangesPageAsync).toHaveBeenCalledWith('token-1');
    expect(native.readRecordsPageAsync).not.toHaveBeenCalled();
    expect(db().recordStatements()).toEqual([]);
    expect(db().contextStatements()).toEqual([]);
    expect(result).toMatchObject({
      recordsRead: 0,
      recordsWritten: 0,
      stoppedEarly: false,
    });
    expect(syncRow()).toMatchObject({
      changes_token: 'token-2',
      last_success_at_ms: NOW + HOUR,
      record_count: 2,
    });
  });

  it('applies an edited record and a deletion from the changes feed', async () => {
    await firstFullSync([weight(1), weight(2)]);
    vi.setSystemTime(NOW + HOUR);
    native.readChangesPageAsync.mockResolvedValueOnce({
      upserted: [weight(1, { value: 71.5, lastModifiedTimeMs: NOW + 10 })],
      deletedRecordIds: ['weight-2'],
      sources,
      nextChangesToken: 'token-2',
      hasMore: false,
      tokenExpired: false,
    });

    await syncHealthConnect({ categories: ['weight'] });

    expect(storedIds()).toEqual(['weight-1']);
    expect(
      db()
        .sqlite.prepare(
          "SELECT value FROM health_connect_records WHERE external_id = 'weight-1'",
        )
        .get(),
    ).toEqual({ value: 71.5 });
    expect(syncRow()).toMatchObject({ record_count: 1 });
  });

  it('falls back to a full read when the changes token has expired', async () => {
    await firstFullSync([weight(1)]);
    native.readRecordsPageAsync.mockClear();
    vi.setSystemTime(NOW + HOUR);
    native.readChangesPageAsync.mockResolvedValueOnce({
      ...emptyChanges(),
      tokenExpired: true,
    });
    native.getChangesTokenAsync.mockResolvedValueOnce('token-fresh');
    native.readRecordsPageAsync.mockResolvedValueOnce({
      records: [weight(1), weight(3)],
      sources,
      nextPageToken: null,
    });

    await syncHealthConnect({ categories: ['weight'] });

    expect(native.readRecordsPageAsync).toHaveBeenCalledOnce();
    // The full read starts at the oldest readable time, not a short window.
    const [, startTimeMs] = native.readRecordsPageAsync.mock.calls[0]!;
    expect(startTimeMs).toBeLessThan(NOW - 29 * 24 * HOUR);
    expect(storedIds()).toEqual(['weight-1', 'weight-3']);
    expect(syncRow()).toMatchObject({ changes_token: 'token-fresh' });
  });

  it('runs the 48-hour safety check once a day, and not again within 24 hours', async () => {
    await firstFullSync([weight(1), weight(2)]);
    native.readRecordsPageAsync.mockClear();
    native.readChangesPageAsync.mockResolvedValue(emptyChanges());

    // Within 24 hours of the full read: changes feed only.
    vi.setSystemTime(NOW + 23 * HOUR);
    await syncHealthConnect({ categories: ['weight'] });
    expect(native.readRecordsPageAsync).not.toHaveBeenCalled();

    // A day later: one short window read.
    vi.setSystemTime(NOW + 25 * HOUR);
    native.readRecordsPageAsync.mockResolvedValueOnce({
      records: [weight(1), weight(2)],
      sources,
      nextPageToken: null,
    });
    db().runCalls.length = 0;
    const checked = await syncHealthConnect({ categories: ['weight'] });
    expect(native.readRecordsPageAsync).toHaveBeenCalledOnce();
    const [, startTimeMs, endTimeMs] =
      native.readRecordsPageAsync.mock.calls[0]!;
    expect(endTimeMs).toBe(NOW + 25 * HOUR);
    expect(startTimeMs).toBe(
      NOW + 25 * HOUR - HEALTH_CONNECT_WINDOW_CHECK_SPAN_MS,
    );
    // Unchanged records are confirmed with reads only.
    expect(db().recordStatements()).toEqual([]);
    expect(db().contextStatements()).toEqual([]);
    expect(checked).toMatchObject({ recordsRead: 2, recordsWritten: 0 });
    expect(storedIds()).toEqual(['weight-1', 'weight-2']);

    // An hour later the check is not repeated.
    native.readRecordsPageAsync.mockClear();
    vi.setSystemTime(NOW + 26 * HOUR);
    await syncHealthConnect({ categories: ['weight'] });
    expect(native.readRecordsPageAsync).not.toHaveBeenCalled();
  });

  it('never runs the window check when the caller does not allow it', async () => {
    await firstFullSync([weight(1)]);
    native.readRecordsPageAsync.mockClear();
    native.readChangesPageAsync.mockResolvedValue(emptyChanges());
    vi.setSystemTime(NOW + 30 * HOUR);

    await syncHealthConnect({
      categories: ['weight'],
      control: { allowWindowCheck: false },
    });

    expect(native.readRecordsPageAsync).not.toHaveBeenCalled();
  });

  it('writes an edited record and removes a missing one during a window check', async () => {
    await firstFullSync([weight(1), weight(2), weight(3)]);
    native.readChangesPageAsync.mockResolvedValue(emptyChanges());
    vi.setSystemTime(NOW + 25 * HOUR);
    native.readRecordsPageAsync.mockResolvedValueOnce({
      records: [
        weight(1),
        weight(2, { value: 72.25, lastModifiedTimeMs: NOW + 20 * HOUR }),
      ],
      sources,
      nextPageToken: null,
    });
    db().runCalls.length = 0;

    const result = await syncHealthConnect({ categories: ['weight'] });

    expect(result).toMatchObject({ recordsWritten: 1, recordsRemoved: 1 });
    expect(storedIds()).toEqual(['weight-1', 'weight-2']);
    expect(
      db()
        .sqlite.prepare(
          "SELECT value FROM health_connect_records WHERE external_id = 'weight-2'",
        )
        .get(),
    ).toEqual({ value: 72.25 });
    expect(
      db().sqlite.prepare('SELECT COUNT(*) AS n FROM context_events').get(),
    ).toEqual({ n: 2 });
  });

  it('stops between pages when its signal is aborted and keeps the full-scan marker', async () => {
    const controller = new AbortController();
    native.readRecordsPageAsync.mockImplementationOnce(async () => {
      controller.abort();
      return { records: [weight(1)], sources, nextPageToken: 'page-2' };
    });

    const result = await syncHealthConnect({
      categories: ['weight'],
      control: { signal: controller.signal },
    });

    expect(native.readRecordsPageAsync).toHaveBeenCalledOnce();
    expect(result.stoppedEarly).toBe(true);
    expect(result.successfulCategories).toEqual([]);
    expect(result.failures).toEqual([]);
    // The committed page is kept; no token means the next run reads fully.
    expect(storedIds()).toEqual(['weight-1']);
    expect(syncRow()).toMatchObject({
      changes_token: null,
      last_success_at_ms: null,
      last_error_code: null,
    });

    native.readRecordsPageAsync.mockResolvedValueOnce({
      records: [weight(1), weight(2)],
      sources,
      nextPageToken: null,
    });
    await syncHealthConnect({ categories: ['weight'] });
    expect(storedIds()).toEqual(['weight-1', 'weight-2']);
    expect(syncRow()).toMatchObject({ changes_token: 'token-1' });
  });

  it('starts no work when the time budget is already used', async () => {
    const result = await syncHealthConnect({
      categories: ['weight'],
      control: { deadlineAt: NOW - 1 },
    });

    expect(result.stoppedEarly).toBe(true);
    expect(native.readRecordsPageAsync).not.toHaveBeenCalled();
    expect(syncRow()).toBeUndefined();
  });

  it('decides due from sync state only and honours each caller interval', async () => {
    await firstFullSync([weight(1)]);
    native.readChangesPageAsync.mockResolvedValue(emptyChanges());
    db().runCalls.length = 0;
    const getAll = vi.spyOn(db(), 'getAllAsync');

    expect(
      await syncHealthConnectIfDue(
        NOW + 20 * 60 * 1000,
        HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS,
      ),
    ).toBeUndefined();
    // No whole-table aggregate is read to decide.
    expect(
      getAll.mock.calls.some(([sql]) => /COUNT\(|GROUP BY/.test(sql)),
    ).toBe(false);
    expect(native.readChangesPageAsync).not.toHaveBeenCalled();

    vi.setSystemTime(NOW + 31 * 60 * 1000);
    expect(
      await syncHealthConnectIfDue(
        NOW + 31 * 60 * 1000,
        HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS,
      ),
    ).toBeDefined();
  });

  it('gives a stable, clientRecordId-matched row one identity inside a batch', async () => {
    await firstFullSync([
      weight(1, { clientRecordId: 'client-a', externalId: 'local-1' }),
      weight(1, {
        clientRecordId: 'client-a',
        externalId: 'local-1b',
        lastModifiedTimeMs: NOW + 5,
      }),
    ]);

    expect(
      db()
        .sqlite.prepare('SELECT COUNT(*) AS n FROM health_connect_records')
        .get(),
    ).toEqual({ n: 1 });
  });
});

describe('Health Connect sync timing rules', () => {
  it('uses separate intervals for refresh, app open and background', () => {
    expect(HEALTH_CONNECT_MANUAL_SYNC_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS).toBe(3 * HOUR);
    const states = [{ category: 'steps' as const, lastAttemptAt: NOW }];
    expect(
      healthConnectSyncDue(['steps'], states, NOW + 29 * 60 * 1000, HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS),
    ).toBe(false);
    expect(
      healthConnectSyncDue(['steps'], states, NOW + 30 * 60 * 1000, HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS),
    ).toBe(true);
    expect(
      healthConnectSyncDue(['steps'], states, NOW + 2 * HOUR, HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS),
    ).toBe(false);
    expect(
      healthConnectSyncDue(['steps'], states, NOW + 3 * HOUR, HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS),
    ).toBe(true);
    // A never-synced category, or a clock moved backwards, is due.
    expect(healthConnectSyncDue(['sleep'], states, NOW, HOUR)).toBe(true);
    expect(healthConnectSyncDue(['steps'], states, NOW - HOUR, HOUR)).toBe(true);
  });

  it('allows the daily check only when permitted and a day has passed', () => {
    expect(healthConnectWindowCheckDue(undefined, NOW, true)).toBe(true);
    expect(healthConnectWindowCheckDue(NOW - 23 * HOUR, NOW, true)).toBe(false);
    expect(healthConnectWindowCheckDue(NOW - 24 * HOUR, NOW, true)).toBe(true);
    expect(healthConnectWindowCheckDue(undefined, NOW, false)).toBe(false);
  });

  it('stops on an aborted signal or a passed deadline', () => {
    expect(healthConnectSyncShouldStop(undefined)).toBe(false);
    expect(healthConnectSyncShouldStop({ signal: { aborted: true } })).toBe(true);
    expect(healthConnectSyncShouldStop({ deadlineAt: 10 }, 9)).toBe(false);
    expect(healthConnectSyncShouldStop({ deadlineAt: 10 }, 10)).toBe(true);
  });

  it('puts the category that waited longest first', () => {
    expect(
      orderHealthConnectCategoriesForSync(
        ['steps', 'sleep', 'weight'],
        [
          { category: 'steps', lastAttemptAt: 30 },
          { category: 'sleep', lastAttemptAt: 10 },
        ],
      ),
    ).toEqual(['weight', 'sleep', 'steps']);
  });
});
