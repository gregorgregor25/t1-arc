import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HEALTH_CONNECT_CATEGORIES } from '@/data/healthConnect/healthConnectRecords';
import {
  loadHealthConnectPreferences,
  saveHealthConnectPreferences,
} from '@/data/healthConnect/healthConnectRepository';
import { LOCAL_DATA_RESET_SENTINEL_KEY } from '@/data/privacy/localDataResetSentinel';

const harness = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock('../modules/t1arc-health-connect', () => ({ default: {} }));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(),
  },
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
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })),
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
  isLocalDataWriteSupersededError: vi.fn(() => false),
}));

interface RunCall {
  parameterCount: number;
  sql: string;
}

class TestDatabase {
  readonly runCalls: RunCall[] = [];

  constructor(readonly sqlite: DatabaseSync) {}

  resetMeasurements() {
    this.runCalls.length = 0;
  }

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
    this.runCalls.push({ sql, parameterCount: parameters.length });
    const result = this.sqlite
      .prepare(sql)
      .run(...(parameters as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }
}

const CONFIG_REVISION_KEY = 'health-connect-config-revision-v1';

function createSchema() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE health_connect_preferences (
      category TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      preferred_source_package TEXT,
      preferred_source_mode TEXT,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  return sqlite;
}

function seedPreferences(sqlite: DatabaseSync) {
  sqlite
    .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
    .run(LOCAL_DATA_RESET_SENTINEL_KEY, 'reset');
  sqlite
    .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
    .run(CONFIG_REVISION_KEY, '7');
  sqlite
    .prepare(
      `INSERT INTO health_connect_preferences (
         category, enabled, preferred_source_package,
         preferred_source_mode, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run('steps', 0, 'com.example.watch', 'manual', 10);
}

function storedState(sqlite: DatabaseSync) {
  return {
    metadata: sqlite
      .prepare('SELECT key, value FROM app_metadata ORDER BY key')
      .all(),
    preferences: sqlite
      .prepare(
        `SELECT category, enabled, preferred_source_package,
           preferred_source_mode, updated_at_ms
         FROM health_connect_preferences ORDER BY category`,
      )
      .all(),
  };
}

let sqlite: DatabaseSync;
let database: TestDatabase;

beforeEach(() => {
  sqlite = createSchema();
  seedPreferences(sqlite);
  database = new TestDatabase(sqlite);
  harness.database = database;
  vi.spyOn(Date, 'now').mockReturnValue(123_456);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('Health Connect preference batching', () => {
  it('persists every category with one bounded UPSERT and preserves source choices', async () => {
    await saveHealthConnectPreferences(['steps', 'sleep']);

    const preferenceWrites = database.runCalls.filter(({ sql }) =>
      sql.includes('INSERT INTO health_connect_preferences'),
    );
    expect(preferenceWrites).toHaveLength(1);
    expect(preferenceWrites[0]?.parameterCount).toBe(
      DEFAULT_HEALTH_CONNECT_CATEGORIES.length * 3,
    );
    expect(preferenceWrites[0]?.sql.match(/\?/g)).toHaveLength(
      DEFAULT_HEALTH_CONNECT_CATEGORIES.length * 3,
    );
    expect(database.runCalls).toHaveLength(3);

    const saved = await loadHealthConnectPreferences();
    expect(saved).toHaveLength(DEFAULT_HEALTH_CONNECT_CATEGORIES.length);
    expect(saved.find(({ category }) => category === 'steps')).toEqual({
      category: 'steps',
      enabled: true,
      preferredSourceMode: 'manual',
      preferredSourcePackage: 'com.example.watch',
      updatedAt: 123_456,
    });
    expect(saved.find(({ category }) => category === 'sleep')).toEqual({
      category: 'sleep',
      enabled: true,
      updatedAt: 123_456,
    });
    expect(
      saved
        .filter(({ category }) => category !== 'steps' && category !== 'sleep')
        .every(({ enabled }) => !enabled),
    ).toBe(true);
    expect(
      sqlite
        .prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(CONFIG_REVISION_KEY),
    ).toEqual({ value: '8' });
    expect(
      sqlite
        .prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(LOCAL_DATA_RESET_SENTINEL_KEY),
    ).toBeUndefined();
  });

  it('rolls back the sentinel removal and every category if revision fencing fails', async () => {
    const before = storedState(sqlite);
    sqlite.exec(`
      CREATE TRIGGER fail_health_connect_revision
      BEFORE UPDATE OF value ON app_metadata
      WHEN OLD.key = '${CONFIG_REVISION_KEY}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated revision failure');
      END;
    `);
    database.resetMeasurements();

    await expect(saveHealthConnectPreferences(['sleep'])).rejects.toThrow(
      'simulated revision failure',
    );

    expect(storedState(sqlite)).toEqual(before);
    expect(database.runCalls).toHaveLength(3);
  });
});
