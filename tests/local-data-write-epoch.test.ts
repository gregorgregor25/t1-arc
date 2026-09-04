import { describe, expect, it, vi } from 'vitest';

import {
  acquireLocalDataWriteLeaseFromDatabase,
  advanceLocalDataWriteEpochInTransaction,
  assertLocalDataWriteLeaseInTransaction,
  LocalDataErasePendingError,
  LocalDataWriteSupersededError,
  LOCAL_DATA_ERASE_INTENT_KEY,
  LOCAL_DATA_WRITE_EPOCH_KEY,
  prepareLocalDataEraseIntentInTransaction,
} from '@/data/privacy/localDataWriteEpoch';

function fakeDatabase(initialValue?: string, initialIntent?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(LOCAL_DATA_WRITE_EPOCH_KEY, initialValue);
  }
  if (initialIntent !== undefined) {
    values.set(LOCAL_DATA_ERASE_INTENT_KEY, initialIntent);
  }
  const database = {
    getFirstAsync: vi.fn(async (_sql: string, key: string) =>
      values.has(key) ? { value: values.get(key)! } : null,
    ),
    runAsync: vi.fn(async (sql: string, key: string, next?: string) => {
      if (/^DELETE/i.test(sql.trim())) values.delete(key);
      else if (next !== undefined) values.set(key, next);
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };
  return {
    database,
    value: () => values.get(LOCAL_DATA_WRITE_EPOCH_KEY),
    intent: () => values.get(LOCAL_DATA_ERASE_INTENT_KEY),
  };
}

describe('local-data write epoch', () => {
  it('treats a legacy database without a marker as epoch zero', async () => {
    const { database } = fakeDatabase();

    await expect(
      acquireLocalDataWriteLeaseFromDatabase(database as never),
    ).resolves.toEqual({ epoch: 0 });
  });

  it('rejects a stale runtime inside its eventual write transaction', async () => {
    const { database } = fakeDatabase();
    const stale = await acquireLocalDataWriteLeaseFromDatabase(
      database as never,
    );

    await advanceLocalDataWriteEpochInTransaction(database as never);

    await expect(
      assertLocalDataWriteLeaseInTransaction(database as never, stale),
    ).rejects.toBeInstanceOf(LocalDataWriteSupersededError);
    expect(database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_metadata'),
      LOCAL_DATA_WRITE_EPOCH_KEY,
      '1',
    );
  });

  it('allows genuinely new work to acquire the advanced epoch', async () => {
    const { database, value } = fakeDatabase('41');
    const stale = await acquireLocalDataWriteLeaseFromDatabase(
      database as never,
    );
    await advanceLocalDataWriteEpochInTransaction(database as never);
    const current = await acquireLocalDataWriteLeaseFromDatabase(
      database as never,
    );

    await expect(
      assertLocalDataWriteLeaseInTransaction(database as never, stale),
    ).rejects.toBeInstanceOf(LocalDataWriteSupersededError);
    await expect(
      assertLocalDataWriteLeaseInTransaction(database as never, current),
    ).resolves.toBeUndefined();
    expect(current).toEqual({ epoch: 42 });
    expect(value()).toBe('42');
  });

  it.each(['-1', '1.5', 'not-a-number', String(Number.MAX_SAFE_INTEGER + 1)])(
    'fails closed on an invalid durable value: %s',
    async (invalid) => {
      const { database } = fakeDatabase(invalid);
      await expect(
        acquireLocalDataWriteLeaseFromDatabase(database as never),
      ).rejects.toThrow(/epoch is invalid/i);
    },
  );

  it('commits a matching write epoch and erase intent as one durable phase', async () => {
    const { database, value, intent } = fakeDatabase('4');

    await expect(
      prepareLocalDataEraseIntentInTransaction(database as never),
    ).resolves.toEqual({ epoch: 5 });
    expect(value()).toBe('5');
    expect(intent()).toBe('5');
    await expect(
      acquireLocalDataWriteLeaseFromDatabase(database as never),
    ).rejects.toBeInstanceOf(LocalDataErasePendingError);
  });

  it('reuses only an erase intent that exactly matches the write epoch', async () => {
    const exact = fakeDatabase('9', '9');
    await expect(
      prepareLocalDataEraseIntentInTransaction(exact.database as never),
    ).resolves.toEqual({ epoch: 9 });
    expect(exact.database.runAsync).not.toHaveBeenCalled();

    for (const [epoch, intent] of [
      ['10', '9'],
      ['9', '10'],
    ]) {
      const mismatch = fakeDatabase(epoch, intent);
      await expect(
        prepareLocalDataEraseIntentInTransaction(mismatch.database as never),
      ).rejects.toThrow(/does not match/i);
    }
  });
});
