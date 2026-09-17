import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadEpochBoundSecureStoreValue,
  saveEpochBoundSecureStoreValue,
} from '@/data/privacy/localDataEpochSecureStore';

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      epoch.order.push('secure-set');
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

const epoch = vi.hoisted(() => ({
  current: 0,
  order: [] as string[],
  advanceOnTransactionEntry: false,
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('@/data/privacy/localDataWriteEpoch', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/data/privacy/localDataWriteEpoch')
  >();
  return {
    ...original,
    assertLocalDataWriteLeaseCurrent: vi.fn(async (lease) => {
      if (lease.epoch !== epoch.current) {
        throw new original.LocalDataWriteSupersededError();
      }
    }),
    assertLocalDataWriteLeaseInTransaction: vi.fn(async (_transaction, lease) => {
      epoch.order.push('epoch-assert');
      if (lease.epoch !== epoch.current) {
        throw new original.LocalDataWriteSupersededError();
      }
    }),
  };
});
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  withT1ArcTransaction: async (task: (transaction: object) => Promise<unknown>) => {
    epoch.order.push('transaction-enter');
    if (epoch.advanceOnTransactionEntry) epoch.current += 1;
    try {
      return await task({});
    } finally {
      epoch.order.push('transaction-exit');
    }
  },
}));

const key = 'test.private-value';
const parseObject = (value: unknown) =>
  value && typeof value === 'object' && 'secret' in value
    ? (value as { secret: string })
    : undefined;

describe('epoch-bound SecureStore values', () => {
  beforeEach(() => {
    epoch.current = 0;
    epoch.order.length = 0;
    epoch.advanceOnTransactionEntry = false;
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it('loads a value written under the current durable epoch', async () => {
    epoch.current = 4;
    await saveEpochBoundSecureStoreValue(key, { secret: 'current' }, { epoch: 4 });

    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 4 }, parseObject),
    ).resolves.toEqual({ secret: 'current' });
  });

  it('holds the DB writer transaction across the epoch assertion and SecureStore set', async () => {
    epoch.current = 5;
    await saveEpochBoundSecureStoreValue(key, { secret: 'ordered' }, { epoch: 5 });

    expect(epoch.order).toEqual([
      'transaction-enter',
      'epoch-assert',
      'secure-set',
      'transaction-exit',
    ]);
  });

  it('rejects a stale save before touching SecureStore', async () => {
    epoch.current = 6;
    await expect(
      saveEpochBoundSecureStoreValue(key, { secret: 'stale' }, { epoch: 5 }),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('rechecks inside the writer lock when erase wins after the precheck', async () => {
    epoch.current = 5;
    epoch.advanceOnTransactionEntry = true;

    await expect(
      saveEpochBoundSecureStoreValue(key, { secret: 'raced' }, { epoch: 5 }),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    expect(epoch.order).toEqual([
      'transaction-enter',
      'epoch-assert',
      'transaction-exit',
    ]);
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('makes a late stale write unusable after an erase, including after a crash', async () => {
    epoch.current = 7;
    await saveEpochBoundSecureStoreValue(key, { secret: 'pre-erase' }, { epoch: 7 });

    // Model the process dying immediately after the old worker's SecureStore
    // write: the stale envelope remains, but the durable DB epoch advanced.
    epoch.current = 9;

    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 9 }, parseObject),
    ).resolves.toBeUndefined();
  });

  it('accepts legacy untagged values only before the first erase epoch', async () => {
    secureStore.values.set(key, JSON.stringify({ secret: 'legacy' }));
    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 0 }, parseObject),
    ).resolves.toEqual({ secret: 'legacy' });

    epoch.current = 1;
    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 1 }, parseObject),
    ).resolves.toBeUndefined();
  });

  it('leaves a mismatched envelope inert without deleting the stored value', async () => {
    epoch.current = 2;
    secureStore.values.set(
      key,
      JSON.stringify({ version: 1, localDataWriteEpoch: 1, payload: { secret: 'old' } }),
    );
    secureStore.getItemAsync.mockImplementationOnce(async () => {
      const old = secureStore.values.get(key) ?? null;
      secureStore.values.set(
        key,
        JSON.stringify({ version: 1, localDataWriteEpoch: 2, payload: { secret: 'new' } }),
      );
      return old;
    });

    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 2 }, parseObject),
    ).resolves.toBeUndefined();
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not let an old loader delete a value created after erase', async () => {
    epoch.current = 3;
    secureStore.getItemAsync.mockImplementationOnce(async () => {
      epoch.current = 4;
      const replacement = JSON.stringify({
        version: 1,
        localDataWriteEpoch: 4,
        payload: { secret: 'post-erase' },
      });
      secureStore.values.set(key, replacement);
      return replacement;
    });

    await expect(
      loadEpochBoundSecureStoreValue(key, { epoch: 3 }, parseObject),
    ).rejects.toMatchObject({ name: 'LocalDataWriteSupersededError' });
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(secureStore.values.get(key)).toContain('post-erase');
  });
});
