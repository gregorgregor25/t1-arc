import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthConnectRecord } from '../modules/t1arc-health-connect/src/T1ArcHealthConnect.types';

import {
  lockHealthConnectSources,
  syncHealthConnect,
} from '@/data/healthConnect/healthConnectRepository';

const state = vi.hoisted(() => ({
  currentEpoch: 1,
  eraseAfterRecordBatch: true,
  order: [] as string[],
  transactionEvents: [] as string[][],
  writes: [] as string[],
  writesAfterErase: [] as string[],
  sourceRows: [] as Record<string, unknown>[],
  sourceCategoryRows: [] as Record<string, unknown>[],
}));

const nativeHealthConnect = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  getChangesTokenAsync: vi.fn(),
  readRecordsPageAsync: vi.fn(),
  readChangesPageAsync: vi.fn(),
}));

const persistence = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(async (sql: string) => {
      if (sql.includes('health_connect_preferences')) {
        state.order.push('preferences');
        return [
          {
            category: 'steps',
            enabled: 1,
            preferred_source_package: null,
            preferred_source_mode: null,
            updated_at_ms: 1,
          },
        ];
      }
      if (sql.includes('FROM health_connect_sources s')) {
        return state.sourceRows;
      }
      if (sql.includes('GROUP BY source_package, kind')) {
        return state.sourceCategoryRows;
      }
      return [];
    }),
    getFirstAsync: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*) AS total')) {
        return { total: 0, earliest: null, latest: null };
      }
      return null;
    }),
    runAsync: vi.fn(async (sql: string) => {
      state.writes.push(sql);
      if (state.currentEpoch !== 1) state.writesAfterErase.push(sql);
      return { changes: 1 };
    }),
  };

  const withT1ArcTransaction = vi.fn(
    async (work: (transaction: typeof database) => Promise<unknown>) => {
      const events: string[] = [];
      let wroteRecord = false;
      const transaction = {
        getAllAsync: vi.fn(
          async (...parameters: Parameters<typeof database.getAllAsync>) => {
            events.push('read');
            return database.getAllAsync(...parameters);
          },
        ),
        getFirstAsync: vi.fn(
          async (...parameters: Parameters<typeof database.getFirstAsync>) => {
            events.push('read');
            return database.getFirstAsync(...parameters);
          },
        ),
        runAsync: vi.fn(async (sql: string, ..._parameters: unknown[]) => {
          events.push('write');
          if (sql.includes('INSERT INTO health_connect_records')) {
            wroteRecord = true;
          }
          return database.runAsync(sql);
        }),
      };
      state.transactionEvents.push(events);
      const result = await work(transaction as never);
      if (
        wroteRecord &&
        state.eraseAfterRecordBatch &&
        state.currentEpoch === 1
      ) {
        state.currentEpoch = 2;
      }
      return result;
    },
  );

  return {
    database,
    openT1ArcDatabase: vi.fn(async () => database),
    withT1ArcTransaction,
  };
});

const epoch = vi.hoisted(() => ({
  acquireLocalDataWriteLease: vi.fn(async () => {
    state.order.push('acquire');
    return { epoch: state.currentEpoch };
  }),
  assertLocalDataWriteLeaseInTransaction: vi.fn(
    async (_database: unknown, lease: { epoch: number }) => {
      state.transactionEvents.at(-1)?.push('assert');
      if (lease.epoch !== state.currentEpoch) {
        const error = new Error(
          'This local-data operation was superseded by a privacy erase.',
        );
        error.name = 'LocalDataWriteSupersededError';
        throw error;
      }
    },
  ),
}));

vi.mock('../modules/t1arc-health-connect', () => ({
  default: nativeHealthConnect,
}));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(),
  },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: persistence.openT1ArcDatabase,
  withT1ArcTransaction: persistence.withT1ArcTransaction,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => {
  class LocalDataWriteSupersededError extends Error {
    constructor() {
      super('This local-data operation was superseded by a privacy erase.');
      this.name = 'LocalDataWriteSupersededError';
    }
  }
  return {
    acquireLocalDataWriteLease: epoch.acquireLocalDataWriteLease,
    assertLocalDataWriteLeaseInTransaction:
      epoch.assertLocalDataWriteLeaseInTransaction,
    isLocalDataWriteSupersededError: (error: unknown) =>
      error instanceof Error && error.name === 'LocalDataWriteSupersededError',
    LocalDataWriteSupersededError,
  };
});

function stepRecord(index: number): HealthConnectRecord {
  return {
    externalId: `steps-${index}`,
    kind: 'steps',
    sourcePackage: 'com.example.health',
    startTimeMs: index * 1_000,
    endTimeMs: index * 1_000 + 500,
    lastModifiedTimeMs: 100_000,
    recordingMethod: 1,
    clientRecordVersion: 1,
    value: index + 1,
    unit: 'count',
  };
}

describe('Health Connect privacy-erase generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.currentEpoch = 1;
    state.eraseAfterRecordBatch = true;
    state.order.length = 0;
    state.transactionEvents.length = 0;
    state.writes.length = 0;
    state.writesAfterErase.length = 0;
    state.sourceRows.length = 0;
    state.sourceCategoryRows.length = 0;
    nativeHealthConnect.getStatusAsync.mockImplementation(async () => {
      state.order.push('status');
      return {
        availability: 'available',
        historyGranted: true,
        categories: [{ id: 'steps', granted: true }],
      };
    });
    nativeHealthConnect.getChangesTokenAsync.mockResolvedValue('token-1');
    nativeHealthConnect.readRecordsPageAsync.mockResolvedValue({
      records: Array.from({ length: 26 }, (_, index) => stepRecord(index)),
      sources: [],
      nextPageToken: null,
    });
  });

  it('captures before status/preferences and rejects the rest of a native page after erase', async () => {
    await expect(
      syncHealthConnect({ categories: ['steps'], fullHistory: true }),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });

    expect(state.order.slice(0, 3)).toEqual([
      'acquire',
      'status',
      'preferences',
    ]);
    expect(
      state.transactionEvents.every((events) => events[0] === 'assert'),
    ).toBe(true);
    expect(state.writesAfterErase).toEqual([]);
    expect(state.writes.some((sql) => sql.includes("'read_failed'"))).toBe(
      false,
    );
    expect(state.writes.some((sql) => sql.includes('last_success_at_ms'))).toBe(
      false,
    );
    expect(
      state.writes.some((sql) =>
        sql.includes('INSERT INTO health_connect_preferences'),
      ),
    ).toBe(false);
  });

  it('fences reconciliation and success state on an uninterrupted sync', async () => {
    state.eraseAfterRecordBatch = false;
    nativeHealthConnect.readRecordsPageAsync.mockResolvedValue({
      records: [stepRecord(0)],
      sources: [],
      nextPageToken: null,
    });

    await expect(
      syncHealthConnect({ categories: ['steps'], fullHistory: true }),
    ).resolves.toMatchObject({
      successfulCategories: ['steps'],
      failures: [],
    });

    expect(state.transactionEvents.length).toBeGreaterThanOrEqual(5);
    expect(
      state.transactionEvents.every((events) => events[0] === 'assert'),
    ).toBe(true);
    expect(state.writes.some((sql) => sql.includes('last_success_at_ms'))).toBe(
      true,
    );
  });

  it('does not clear a token or save an error when erase wins a native read failure', async () => {
    nativeHealthConnect.readRecordsPageAsync.mockImplementationOnce(
      async () => {
        state.currentEpoch = 2;
        throw new Error('native page failed');
      },
    );

    await expect(
      syncHealthConnect({ categories: ['steps'], fullHistory: true }),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });

    expect(state.writesAfterErase).toEqual([]);
    // The one clear happened before the native call and is the durable marker
    // that makes a process death during a full scan restart as full-history.
    expect(
      state.writes.filter((sql) => sql.includes('SET changes_token = NULL')),
    ).toHaveLength(1);
    expect(state.writes.some((sql) => sql.includes("'read_failed'"))).toBe(
      false,
    );
  });

  it('blocks automatic source locking after its lease is erased', async () => {
    const lease = { epoch: 1 };
    state.sourceRows.push({
      package_name: 'com.example.health',
      display_name: 'Example Health',
      first_seen_at_ms: 1,
      last_seen_at_ms: 2,
      record_count: 10,
    });
    state.sourceCategoryRows.push({
      package_name: 'com.example.health',
      kind: 'steps',
      record_count: 10,
      data_start_ms: 1,
      data_through_ms: 2,
    });
    state.currentEpoch = 2;

    await expect(
      lockHealthConnectSources(['steps'], lease),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });

    expect(state.transactionEvents).toEqual([['assert']]);
    expect(state.writesAfterErase).toEqual([]);
  });
});
