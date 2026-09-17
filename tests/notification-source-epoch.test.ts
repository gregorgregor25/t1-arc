import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATION_SOURCE_EPOCH_KEY,
  NotificationDrainSupersededError,
  advanceNotificationSourceEpochInTransaction,
  assertNotificationSourceEpochInTransaction,
  readNotificationSourceEpoch,
} from '@/data/notification/notificationSourceEpoch';

const mocks = vi.hoisted(() => ({
  getFirst: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: mocks.getFirst,
  })),
  withT1ArcTransaction: mocks.transaction,
}));

const transaction = {
  getFirstAsync: mocks.getFirst,
  runAsync: mocks.run,
};

describe('notification source epoch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockResolvedValue({ changes: 1 });
    mocks.transaction.mockImplementation(
      async (work: (value: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    );
  });

  it('treats an absent durable epoch as zero', async () => {
    mocks.getFirst.mockResolvedValue(null);

    await expect(readNotificationSourceEpoch()).resolves.toBe(0);
    await expect(
      assertNotificationSourceEpochInTransaction(transaction, 0),
    ).resolves.toBeUndefined();
  });

  it('increments an existing epoch with an optimistic exact-value guard', async () => {
    mocks.getFirst.mockResolvedValue({ value: '7' });

    await expect(
      advanceNotificationSourceEpochInTransaction(transaction),
    ).resolves.toBe(8);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE app_metadata'),
      '8',
      NOTIFICATION_SOURCE_EPOCH_KEY,
      '7',
    );
  });

  it('creates epoch one when no prior erase has occurred', async () => {
    mocks.getFirst.mockResolvedValue(null);

    await expect(
      advanceNotificationSourceEpochInTransaction(transaction),
    ).resolves.toBe(1);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_metadata'),
      NOTIFICATION_SOURCE_EPOCH_KEY,
      '1',
    );
  });

  it('advances an explicitly stored zero epoch without attempting a duplicate insert', async () => {
    mocks.getFirst.mockResolvedValue({ value: '0' });

    await expect(
      advanceNotificationSourceEpochInTransaction(transaction),
    ).resolves.toBe(1);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE app_metadata'),
      '1',
      NOTIFICATION_SOURCE_EPOCH_KEY,
      '0',
    );
  });

  it('rejects a drain from an older epoch without writing', async () => {
    mocks.getFirst.mockResolvedValue({ value: '3' });

    await expect(
      assertNotificationSourceEpochInTransaction(transaction, 2),
    ).rejects.toBeInstanceOf(NotificationDrainSupersededError);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([{ value: '-1' }, { value: '01' }, { value: '1.5' }, { value: 'x' }])(
    'fails closed for malformed durable epoch $value',
    async (row) => {
      mocks.getFirst.mockResolvedValue(row);

      await expect(readNotificationSourceEpoch()).rejects.toThrow(
        /notification source epoch/i,
      );
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );

  it('fails closed if an epoch compare-and-set unexpectedly loses ownership', async () => {
    mocks.getFirst.mockResolvedValue({ value: '4' });
    mocks.run.mockResolvedValue({ changes: 0 });

    await expect(
      advanceNotificationSourceEpochInTransaction(transaction),
    ).rejects.toThrow(/could not be advanced safely/i);
  });
});
