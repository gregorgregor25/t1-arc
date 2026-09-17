import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_ERASE_INTENT_KEY,
  LOCAL_DATA_WRITE_EPOCH_KEY,
} from '@/data/privacy/localDataWriteEpoch';
import { sourceConnectionOwnershipMetadataKey } from '@/data/live/sourceConnectionOwnership';

import {
  clearOwnedGlucoseSourceDataInTransaction,
  SqliteGlucoseHistoryStore,
} from '@/data/persistence/SqliteGlucoseHistoryStore';
import {
  clearOwnedHealthSourceDataInTransaction,
  SqliteHealthRecordStore,
} from '@/data/persistence/SqliteHealthRecordStore';

const SOURCE_ID = 'nightscout' as const;
const IDENTITY = 'a'.repeat(64);

const fake = vi.hoisted(() => {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const transaction = {
    getFirstAsync: vi.fn(async (_sql: string, key?: unknown) => {
      if (key === LOCAL_DATA_ERASE_INTENT_KEY) return null;
      if (key === LOCAL_DATA_WRITE_EPOCH_KEY) return { value: '7' };
      if (key === sourceConnectionOwnershipMetadataKey(SOURCE_ID)) {
        return {
          value: JSON.stringify({
            version: 1,
            changeGeneration: 9,
            ownerGeneration: 4,
            connected: true,
            identityDigest: IDENTITY,
          }),
        };
      }
      return null;
    }),
    getAllAsync: vi.fn(async () => []),
    runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      writes.push({ sql, parameters });
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };
  return {
    transaction,
    writes,
    reset() {
      writes.length = 0;
      transaction.getFirstAsync.mockClear();
      transaction.getAllAsync.mockClear();
      transaction.runAsync.mockClear();
    },
  };
});

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => fake.transaction),
  withT1ArcTransaction: vi.fn(
    async (task: (transaction: typeof fake.transaction) => Promise<unknown>) =>
      task(fake.transaction),
  ),
  withT1ArcCriticalTransaction: vi.fn(
    async (task: (transaction: typeof fake.transaction) => Promise<unknown>) =>
      task(fake.transaction),
  ),
}));

const localLease = { epoch: 7 } as const;
const sourceLease = {
  sourceId: SOURCE_ID,
  localDataWriteLease: localLease,
  ownerGeneration: 4,
  identityDigest: IDENTITY,
} as const;

describe('SQLite source connection write leases', () => {
  beforeEach(() => fake.reset());

  it('preserves a glucose source lease when a local write lease is applied', async () => {
    const store = new SqliteGlucoseHistoryStore()
      .withSourceWriteLease(sourceLease)
      .withWriteLease(localLease);

    await store.saveSyncState({
      sourceId: SOURCE_ID,
      lastAttemptAt: 10,
      recordCount: 0,
    });

    expect(fake.transaction.getFirstAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('app_metadata'),
      LOCAL_DATA_ERASE_INTENT_KEY,
    );
    expect(fake.transaction.getFirstAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('app_metadata'),
      LOCAL_DATA_WRITE_EPOCH_KEY,
    );
    expect(fake.transaction.getFirstAsync).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('app_metadata'),
      sourceConnectionOwnershipMetadataKey(SOURCE_ID),
    );
    expect(fake.writes.at(-1)?.sql).toContain('source_sync_state');
  });

  it('rejects a glucose sink whose source id does not match the owner', async () => {
    const store = new SqliteGlucoseHistoryStore().withSourceWriteLease(
      sourceLease,
    );

    await expect(
      store.saveSyncState({ sourceId: 'xdrip-local', recordCount: 0 }),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    expect(fake.writes).toHaveLength(0);
  });

  it('rejects mixed-source glucose rows before inserting any row', async () => {
    const store = new SqliteGlucoseHistoryStore().withSourceWriteLease(
      sourceLease,
    );

    await expect(
      store.upsertReadings([
        {
          id: 'wrong',
          sourceId: 'xdrip-local',
          timestamp: 1,
          receivedAt: 2,
          mmolL: 6,
          trend: 'flat',
          quality: 'measured',
        },
      ]),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    expect(fake.writes).toHaveLength(0);
  });

  it('validates every imported health record against the leased source', async () => {
    const store = new SqliteHealthRecordStore().withSourceWriteLease(
      sourceLease,
    );

    await expect(
      store.writeImport(
        {
          id: 'batch',
          sourceId: SOURCE_ID,
          fileName: 'nightscout.json',
          fileSha256: 'f'.repeat(64),
          importedAt: 100,
          skippedCount: 0,
          warnings: [],
        },
        [],
        [],
        [
          {
            id: 'wrong-note',
            sourceId: 'xdrip-local',
            origin: 'imported',
            kind: 'note',
            start: 100,
            title: 'Wrong source',
            category: 'other',
          },
        ],
      ),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses to replace a source lease with a different global epoch', () => {
    const glucose = new SqliteGlucoseHistoryStore().withSourceWriteLease(
      sourceLease,
    );
    const health = new SqliteHealthRecordStore().withSourceWriteLease(
      sourceLease,
    );

    expect(() => glucose.withWriteLease({ epoch: 8 })).toThrow(
      /does not match the source connection lease/i,
    );
    expect(() => health.withWriteLease({ epoch: 8 })).toThrow(
      /does not match the source connection lease/i,
    );
  });

  it('clears replacement-account auxiliary rows only for the exact source id', async () => {
    await clearOwnedGlucoseSourceDataInTransaction(
      fake.transaction as never,
      SOURCE_ID,
    );
    await clearOwnedHealthSourceDataInTransaction(
      fake.transaction as never,
      SOURCE_ID,
    );

    expect(fake.writes).toHaveLength(11);
    expect(fake.writes.every(({ parameters }) => parameters[0] === SOURCE_ID))
      .toBe(true);
    expect(
      fake.writes.some(({ sql }) => sql.includes('import_source_payloads')),
    ).toBe(true);
    expect(
      fake.writes.some(({ sql }) =>
        sql.includes("context_events") && sql.includes("origin = 'imported'"),
      ),
    ).toBe(true);
  });
});
