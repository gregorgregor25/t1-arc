import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthConnectRecord } from '../modules/t1arc-health-connect/src/T1ArcHealthConnect.types';

import {
  HEALTH_CONNECT_WRITE_BATCH_SIZE,
  removeHealthConnectRecordsByExternalIdInBatches,
  writeHealthConnectPageInBatches,
} from '@/data/healthConnect/healthConnectRepository';

const persistence = vi.hoisted(() => {
  let activeTransactionEvents: string[] | undefined;
  const transactionEvents: string[][] = [];
  const recordWritesPerTransaction: number[] = [];
  const recordDeletesPerTransaction: number[] = [];
  const sourceWritesPerTransaction: number[] = [];
  const withT1ArcTransaction = vi.fn(
    async (work: (database: Record<string, unknown>) => Promise<unknown>) => {
      let recordWrites = 0;
      let recordDeletes = 0;
      let sourceWrites = 0;
      const database = {
        getAllAsync: vi.fn(async () => {
          events.push('read');
          return [];
        }),
        getFirstAsync: vi.fn(async () => {
          events.push('read');
          return null;
        }),
        runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
          events.push('write');
          if (/INSERT INTO health_connect_records/.test(sql)) {
            recordWrites += 1;
          }
          if (/DELETE FROM health_connect_records/.test(sql)) {
            // The filter binds each id once for external_id and once for
            // parent_external_id.
            recordDeletes += parameters.length / 2;
          }
          if (/INSERT INTO health_connect_sources/.test(sql)) {
            sourceWrites += 1;
          }
          return { changes: 1 };
        }),
      };
      const events: string[] = [];
      activeTransactionEvents = events;
      try {
        const result = await work(database);
        transactionEvents.push(events);
        recordWritesPerTransaction.push(recordWrites);
        recordDeletesPerTransaction.push(recordDeletes);
        sourceWritesPerTransaction.push(sourceWrites);
        return result;
      } finally {
        activeTransactionEvents = undefined;
      }
    },
  );
  return {
    database: {
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async () => null),
      runAsync: vi.fn(async () => ({ changes: 0 })),
    },
    activeTransactionEvents: () => activeTransactionEvents,
    recordDeletesPerTransaction,
    recordWritesPerTransaction,
    sourceWritesPerTransaction,
    transactionEvents,
    withT1ArcTransaction,
  };
});

const writeEpoch = vi.hoisted(() => ({
  assertionCount: 0,
  failOnAssertion: Number.POSITIVE_INFINITY,
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => {
    writeEpoch.assertionCount += 1;
    persistence.activeTransactionEvents()?.push('assert');
    if (writeEpoch.assertionCount === writeEpoch.failOnAssertion) {
      const error = new Error(
        'This local-data operation was superseded by a privacy erase.',
      );
      error.name = 'LocalDataWriteSupersededError';
      throw error;
    }
  }),
}));

vi.mock('../modules/t1arc-health-connect', () => ({ default: {} }));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(),
  },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: persistence.withT1ArcTransaction,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  assertLocalDataWriteLeaseInTransaction:
    writeEpoch.assertLocalDataWriteLeaseInTransaction,
}));

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

describe('Health Connect write batching', () => {
  const lease = { epoch: 7 };

  beforeEach(() => {
    vi.clearAllMocks();
    persistence.recordDeletesPerTransaction.length = 0;
    persistence.recordWritesPerTransaction.length = 0;
    persistence.sourceWritesPerTransaction.length = 0;
    persistence.transactionEvents.length = 0;
    writeEpoch.assertionCount = 0;
    writeEpoch.failOnAssertion = Number.POSITIVE_INFINITY;
  });

  it('releases the SQLite writer between bounded record batches', async () => {
    const records = Array.from(
      { length: HEALTH_CONNECT_WRITE_BATCH_SIZE * 2 + 1 },
      (_, index) => stepRecord(index),
    );
    await writeHealthConnectPageInBatches(
      records,
      [
        {
          packageName: 'com.example.health',
          displayName: 'Example Health',
        },
      ],
      123_000,
      lease,
    );

    expect(persistence.recordWritesPerTransaction).toEqual([
      HEALTH_CONNECT_WRITE_BATCH_SIZE,
      HEALTH_CONNECT_WRITE_BATCH_SIZE,
      1,
    ]);
    expect(persistence.sourceWritesPerTransaction).toEqual([1, 1, 1]);
  });

  it('bounds and de-duplicates change-page deletions', async () => {
    const ids = Array.from(
      { length: HEALTH_CONNECT_WRITE_BATCH_SIZE * 2 + 1 },
      (_, index) => `record-${index}`,
    );

    await removeHealthConnectRecordsByExternalIdInBatches(
      [...ids, ids[0]!],
      lease,
    );

    expect(persistence.recordDeletesPerTransaction).toEqual([
      HEALTH_CONNECT_WRITE_BATCH_SIZE,
      HEALTH_CONNECT_WRITE_BATCH_SIZE,
      1,
    ]);
  });

  it('retains a source label even when its page contains no records', async () => {
    await writeHealthConnectPageInBatches(
      [],
      [{ packageName: 'com.example.health', displayName: 'Example Health' }],
      123_000,
      lease,
    );

    expect(persistence.recordWritesPerTransaction).toEqual([0]);
    expect(persistence.sourceWritesPerTransaction).toEqual([1]);
  });

  it('asserts the erase generation before every batch touches SQLite', async () => {
    await writeHealthConnectPageInBatches(
      Array.from({ length: HEALTH_CONNECT_WRITE_BATCH_SIZE + 1 }, (_, index) =>
        stepRecord(index),
      ),
      [],
      123_000,
      lease,
    );

    expect(persistence.transactionEvents).toHaveLength(2);
    expect(
      persistence.transactionEvents.every((events) => events[0] === 'assert'),
    ).toBe(true);
  });

  it('stops before a second record batch when an erase supersedes the page', async () => {
    writeEpoch.failOnAssertion = 2;

    await expect(
      writeHealthConnectPageInBatches(
        Array.from(
          { length: HEALTH_CONNECT_WRITE_BATCH_SIZE + 1 },
          (_, index) => stepRecord(index),
        ),
        [],
        123_000,
        lease,
      ),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });

    expect(persistence.recordWritesPerTransaction).toEqual([
      HEALTH_CONNECT_WRITE_BATCH_SIZE,
    ]);
  });
});
