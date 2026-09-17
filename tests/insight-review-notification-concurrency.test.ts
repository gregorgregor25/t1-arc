import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearInsightReviewPreferences,
  loadInsightReviewPreferences,
  publishWeeklyReviewNotificationIfDue,
  resetInsightReviewPreferencesCoordinatorForTests,
  restoreInsightReviewPreferencesInTransaction,
  setWeeklyReviewNotificationEnabled,
} from '@/data/insights/insightReviewPreferences';

const mocks = vi.hoisted(() => ({
  cancelNotification: vi.fn(),
  acquireLease: vi.fn(),
  databaseGet: vi.fn(),
  databaseRun: vi.fn(),
  deleteItem: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  showNotification: vi.fn(),
  withLease: vi.fn(
    async (_lease: unknown, task: () => Promise<unknown>) => task(),
  ),
}));

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: mocks.deleteItem,
  getItemAsync: mocks.getItem,
  setItemAsync: mocks.setItem,
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    cancelReviewReadyNotificationAsync: mocks.cancelNotification,
    showReviewReadyNotificationAsync: mocks.showNotification,
  },
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  withLocalDataWriteLeaseTransaction: mocks.withLease,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('weekly insight notification ownership', () => {
  let legacyStored: string | null;
  let databaseStored: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetInsightReviewPreferencesCoordinatorForTests();
    legacyStored = null;
    databaseStored = JSON.stringify({
      weeklyNotificationEnabled: true,
    });
    mocks.acquireLease.mockResolvedValue({ epoch: 4 });
    mocks.databaseGet.mockImplementation(async () =>
      databaseStored === null ? null : { value: databaseStored },
    );
    mocks.databaseRun.mockImplementation(
      async (_sql: string, _key: string, value: string) => {
        databaseStored = value;
        return { changes: 1 };
      },
    );
    mocks.withLease.mockImplementation(
      async (_lease: unknown, task: (database: unknown) => Promise<unknown>) =>
        task({
          getFirstAsync: mocks.databaseGet,
          runAsync: mocks.databaseRun,
        }),
    );
    mocks.getItem.mockImplementation(async () => legacyStored);
    mocks.setItem.mockImplementation(async (_key: string, value: string) => {
      legacyStored = value;
    });
    mocks.deleteItem.mockImplementation(async () => {
      legacyStored = null;
    });
    mocks.cancelNotification.mockResolvedValue(true);
    mocks.showNotification.mockResolvedValue(true);
  });

  it('lets disable wait for an in-flight show and leaves the final notification absent', async () => {
    const show = deferred<boolean>();
    mocks.showNotification.mockReturnValueOnce(show.promise);
    const publication = publishWeeklyReviewNotificationIfDue(
      Date.parse('2026-08-25T10:00:00+01:00'),
      { epoch: 4 },
    );
    await vi.waitFor(() =>
      expect(mocks.showNotification).toHaveBeenCalledOnce(),
    );

    const disabled = setWeeklyReviewNotificationEnabled(false);
    await Promise.resolve();
    expect(mocks.cancelNotification).not.toHaveBeenCalled();

    show.resolve(true);
    await publication;
    await disabled;

    expect(JSON.parse(databaseStored!)).toMatchObject({
      weeklyNotificationEnabled: false,
      lastNotifiedWeek: '2026-08-24',
    });
    expect(mocks.cancelNotification).toHaveBeenCalledOnce();
  });

  it('rechecks the latest disabled preference before a stale scheduled run can show', async () => {
    const disabled = setWeeklyReviewNotificationEnabled(false);
    const publication = publishWeeklyReviewNotificationIfDue(
      Date.parse('2026-08-25T10:00:00+01:00'),
      { epoch: 4 },
    );

    await expect(disabled).resolves.toMatchObject({
      weeklyNotificationEnabled: false,
    });
    await expect(publication).resolves.toEqual({ due: false, shown: false });
    expect(mocks.showNotification).not.toHaveBeenCalled();
  });

  it('fully removes preference metadata and cancels the notification during erase', async () => {
    legacyStored = JSON.stringify({ weeklyNotificationEnabled: true });
    await clearInsightReviewPreferences();

    expect(legacyStored).toBeNull();
    expect(mocks.deleteItem).toHaveBeenCalledOnce();
    expect(mocks.cancelNotification).toHaveBeenCalledOnce();
  });

  it('migrates the legacy SecureStore preference into the SQLite writer boundary', async () => {
    databaseStored = null;
    legacyStored = JSON.stringify({
      weeklyNotificationEnabled: true,
      lastNotifiedWeek: '2026-08-17',
    });

    await expect(loadInsightReviewPreferences()).resolves.toEqual({
      weeklyNotificationEnabled: true,
      lastNotifiedWeek: '2026-08-17',
    });
    expect(JSON.parse(databaseStored!)).toEqual({
      weeklyNotificationEnabled: true,
      lastNotifiedWeek: '2026-08-17',
    });
    expect(legacyStored).toBeNull();
  });

  it('restores migration preferences through the already-owned transaction', async () => {
    const transaction = {
      getFirstAsync: mocks.databaseGet,
      runAsync: mocks.databaseRun,
    };

    await expect(
      restoreInsightReviewPreferencesInTransaction(transaction as never, {
        weeklyNotificationEnabled: false,
        reviewWeekday: 1,
        reviewHour: 8,
        reviewMinute: 30,
      }),
    ).resolves.toMatchObject({
      weeklyNotificationEnabled: false,
      reviewWeekday: 1,
      reviewHour: 8,
      reviewMinute: 30,
    });

    expect(mocks.withLease).not.toHaveBeenCalled();
    expect(JSON.parse(databaseStored!)).toMatchObject({
      weeklyNotificationEnabled: false,
      reviewWeekday: 1,
      reviewHour: 8,
      reviewMinute: 30,
    });
    expect(mocks.cancelNotification).toHaveBeenCalledOnce();
  });
});
