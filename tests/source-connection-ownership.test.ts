import { describe, expect, it, vi } from 'vitest';

import {
  acquireSourceConnectionWriteLeaseFromDatabase,
  activateSourceConnectionCandidateInTransaction,
  assertSourceConnectionWriteLeaseInTransaction,
  assertSourceConnectionActivationCurrentInTransaction,
  beginSourceConnectionChangeInTransaction,
  disconnectSourceConnectionInTransaction,
  sourceConnectionOwnershipMetadataKey,
  SourceConnectionSupersededError,
} from '@/data/live/sourceConnectionOwnership';
import {
  LOCAL_DATA_ERASE_INTENT_KEY,
  LOCAL_DATA_WRITE_EPOCH_KEY,
} from '@/data/privacy/localDataWriteEpoch';

const SOURCE_ID = 'nightscout';
const OTHER_SOURCE_ID = 'xdrip-local';
const IDENTITY_A = 'a'.repeat(64);
const IDENTITY_B = 'b'.repeat(64);

function fakeDatabase(initialState?: unknown, localEpoch = '4') {
  const values = new Map<string, string>();
  values.set(LOCAL_DATA_WRITE_EPOCH_KEY, localEpoch);
  if (initialState !== undefined) {
    values.set(
      sourceConnectionOwnershipMetadataKey(SOURCE_ID),
      typeof initialState === 'string'
        ? initialState
        : JSON.stringify(initialState),
    );
  }
  const calls: string[] = [];
  const database = {
    getFirstAsync: vi.fn(async (_sql: string, key: string) => {
      calls.push(`read:${key}`);
      return values.has(key) ? { value: values.get(key)! } : null;
    }),
    runAsync: vi.fn(async (sql: string, key: string, value?: string) => {
      calls.push(`write:${key}`);
      if (/^DELETE/i.test(sql.trim())) values.delete(key);
      else if (value !== undefined) values.set(key, value);
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };
  return {
    database,
    calls,
    state() {
      const raw = values.get(sourceConnectionOwnershipMetadataKey(SOURCE_ID));
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    },
  };
}

function connectedState(
  changeGeneration = 3,
  ownerGeneration = 2,
  identityDigest = IDENTITY_A,
) {
  return {
    version: 1,
    changeGeneration,
    ownerGeneration,
    connected: true,
    identityDigest,
  };
}

describe('durable glucose-source connection ownership', () => {
  it('asserts the global erase lease before reading source ownership', async () => {
    const { database, calls } = fakeDatabase();

    await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    expect(calls.slice(0, 3)).toEqual([
      `read:${LOCAL_DATA_ERASE_INTENT_KEY}`,
      `read:${LOCAL_DATA_WRITE_EPOCH_KEY}`,
      `read:${sourceConnectionOwnershipMetadataKey(SOURCE_ID)}`,
    ]);
  });

  it('uses independent change and owner generations so failed verification preserves the active owner', async () => {
    const { database, state } = fakeDatabase(connectedState());
    const active = await acquireSourceConnectionWriteLeaseFromDatabase(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    const candidate = await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    expect(candidate.changeGeneration).toBe(4);
    expect(state()).toEqual(connectedState(4));
    await expect(
      assertSourceConnectionWriteLeaseInTransaction(
        database as never,
        active!,
        SOURCE_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('supersedes an older connect success callback while preserving its active data-write lease', async () => {
    const { database } = fakeDatabase(connectedState());
    const active = await acquireSourceConnectionWriteLeaseFromDatabase(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );
    await expect(
      assertSourceConnectionActivationCurrentInTransaction(
        database as never,
        active!,
        3,
      ),
    ).resolves.toBeUndefined();

    await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    await expect(
      assertSourceConnectionWriteLeaseInTransaction(
        database as never,
        active!,
        SOURCE_ID,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertSourceConnectionActivationCurrentInTransaction(
        database as never,
        active!,
        3,
      ),
    ).rejects.toBeInstanceOf(SourceConnectionSupersededError);
  });

  it('lets a newer candidate supersede an older candidate without invalidating the active owner', async () => {
    const { database } = fakeDatabase(connectedState());
    const first = await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );
    const second = await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    await expect(
      activateSourceConnectionCandidateInTransaction(
        database as never,
        first,
        IDENTITY_B,
      ),
    ).rejects.toBeInstanceOf(SourceConnectionSupersededError);
    await expect(
      activateSourceConnectionCandidateInTransaction(
        database as never,
        second,
        IDENTITY_B,
      ),
    ).resolves.toMatchObject({
      sourceId: SOURCE_ID,
      ownerGeneration: 3,
      identityDigest: IDENTITY_B,
      localDataWriteLease: { epoch: 4 },
    });
  });

  it('makes disconnect durable and fail closed before credential cleanup', async () => {
    const { database, state } = fakeDatabase(connectedState());
    const active = await acquireSourceConnectionWriteLeaseFromDatabase(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );
    const candidate = await beginSourceConnectionChangeInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    await disconnectSourceConnectionInTransaction(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    expect(state()).toEqual({
      version: 1,
      changeGeneration: 5,
      ownerGeneration: 3,
      connected: false,
      identityDigest: IDENTITY_A,
    });
    await expect(
      assertSourceConnectionWriteLeaseInTransaction(
        database as never,
        active!,
        SOURCE_ID,
      ),
    ).rejects.toBeInstanceOf(SourceConnectionSupersededError);
    await expect(
      activateSourceConnectionCandidateInTransaction(
        database as never,
        candidate,
        IDENTITY_B,
      ),
    ).rejects.toBeInstanceOf(SourceConnectionSupersededError);
  });

  it('rejects a lease at a sink for any other source id', async () => {
    const { database } = fakeDatabase(connectedState());
    const active = await acquireSourceConnectionWriteLeaseFromDatabase(
      database as never,
      SOURCE_ID,
      { epoch: 4 },
    );

    await expect(
      assertSourceConnectionWriteLeaseInTransaction(
        database as never,
        active!,
        OTHER_SOURCE_ID,
      ),
    ).rejects.toBeInstanceOf(SourceConnectionSupersededError);
  });

  it.each([
    'not-json',
    JSON.stringify({
      ...connectedState(),
      changeGeneration: Number.MAX_SAFE_INTEGER + 1,
    }),
    JSON.stringify({
      ...connectedState(),
      ownerGeneration: -1,
    }),
    JSON.stringify({
      ...connectedState(),
      identityDigest: 'raw@example.com',
    }),
  ])('fails closed on malformed or unsafe durable state', async (invalid) => {
    const { database } = fakeDatabase(invalid);

    await expect(
      acquireSourceConnectionWriteLeaseFromDatabase(
        database as never,
        SOURCE_ID,
        { epoch: 4 },
      ),
    ).rejects.toThrow(/ownership state is invalid/i);
  });

  it('disconnects a corrupt owner without deriving recovery generations from corrupt data', async () => {
    const { database, state } = fakeDatabase('not-json');

    await expect(
      disconnectSourceConnectionInTransaction(
        database as never,
        SOURCE_ID,
        { epoch: 4 },
      ),
    ).resolves.toMatchObject({ connected: false });

    expect(state()).toEqual({
      version: 1,
      changeGeneration: 2 ** 52 + 1,
      ownerGeneration: 2 ** 52 + 1,
      connected: false,
    });
    await expect(
      beginSourceConnectionChangeInTransaction(
        database as never,
        SOURCE_ID,
        { epoch: 4 },
      ),
    ).resolves.toMatchObject({
      changeGeneration: 2 ** 52 + 2,
      observedOwnerGeneration: 2 ** 52 + 1,
      observedConnected: false,
    });
  });

  it('fails closed instead of overflowing either generation', async () => {
    const changeOverflow = fakeDatabase(
      connectedState(Number.MAX_SAFE_INTEGER, 1),
    );
    await expect(
      beginSourceConnectionChangeInTransaction(
        changeOverflow.database as never,
        SOURCE_ID,
        { epoch: 4 },
      ),
    ).rejects.toThrow(/change generation cannot be advanced safely/i);

    const ownerOverflow = fakeDatabase(
      connectedState(8, Number.MAX_SAFE_INTEGER),
    );
    const candidate = await beginSourceConnectionChangeInTransaction(
      ownerOverflow.database as never,
      SOURCE_ID,
      { epoch: 4 },
    );
    await expect(
      activateSourceConnectionCandidateInTransaction(
        ownerOverflow.database as never,
        candidate,
        IDENTITY_B,
      ),
    ).rejects.toThrow(/owner generation cannot be advanced safely/i);
  });

  it('rejects unknown or ambiguous source ids', async () => {
    const { database } = fakeDatabase();

    for (const sourceId of [
      '',
      'Nightscout',
      'notification',
      'nightscout:other',
    ]) {
      await expect(
        beginSourceConnectionChangeInTransaction(
          database as never,
          sourceId,
          { epoch: 4 },
        ),
      ).rejects.toThrow(/does not support durable connection ownership/i);
    }
  });
});
