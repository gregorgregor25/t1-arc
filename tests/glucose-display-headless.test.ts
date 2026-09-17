import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settleHeadlessPromise } from '@/data/glucoseDisplay/headlessTaskSettlement';
import {
  glucoseDisplayAlreadyPublished,
  runGlucoseDisplayForegroundSync,
  updateGlucoseDisplayFromHistory,
  updateGlucoseDisplayFromHistoryWithLease,
} from '@/data/glucoseDisplay/glucoseDisplayCoordinator';

const mocks = vi.hoisted(() => ({
  getDisplayStatus: vi.fn(),
  updateMissing: vi.fn(),
  updateReading: vi.fn(),
  updateHistory: vi.fn(),
  updatePrivate: vi.fn(),
  refreshConfiguredSources: vi.fn(),
  reconcileAlerts: vi.fn(),
  initializeStore: vi.fn(),
  getLatestReading: vi.fn(),
  getSyncState: vi.fn(),
  getReadings: vi.fn(),
  acquireLease: vi.fn(),
  leaseTransaction: vi.fn(),
  transactionGetFirst: vi.fn(),
  transactionGetAll: vi.fn(),
  assertSourceLease: vi.fn(),
  transactionLatest: undefined as
    | {
        id: string;
        sourceId: string;
        timestamp: number;
        receivedAt: number;
        mmolL: number;
        trend: string;
        sourceDeviceId?: string;
      }
    | undefined,
  transactionHistory: [] as {
    id: string;
    sourceId: string;
    timestamp: number;
    receivedAt: number;
    mmolL: number;
    trend: string;
    sourceDeviceId?: string;
  }[],
  transactionSyncError: undefined as string | undefined,
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    getStatusAsync: mocks.getDisplayStatus,
    updateMissingAsync: mocks.updateMissing,
    updateReadingAsync: mocks.updateReading,
    updateHistoryAsync: mocks.updateHistory,
    updatePrivateGlucoseForWriteEpochAsync: mocks.updatePrivate,
  },
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  withLocalDataWriteLeaseTransaction: mocks.leaseTransaction,
}));

vi.mock('@/data/live/configuredGlucoseSources', () => ({
  refreshConfiguredGlucoseSources: mocks.refreshConfiguredSources,
}));

vi.mock('@/data/live/sourceConnectionOwnership', () => ({
  assertSourceConnectionWriteLeaseInTransaction: mocks.assertSourceLease,
}));

vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  reconcileGlucoseAlerts: mocks.reconcileAlerts,
}));

vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {
    initialize = mocks.initializeStore;
    getLatestReading = mocks.getLatestReading;
    getSyncState = mocks.getSyncState;
    getReadings = mocks.getReadings;
  },
}));

function transactionRow(reading: NonNullable<typeof mocks.transactionLatest>) {
  return {
    id: reading.id,
    source_id: reading.sourceId,
    timestamp_ms: reading.timestamp,
    received_at_ms: reading.receivedAt,
    mmol_l: reading.mmolL,
    trend: reading.trend,
    // SQLite stores a missing device identity as the schema's canonical empty
    // string, while readingFromRow exposes it to domain code as undefined.
    source_device_id: reading.sourceDeviceId ?? '',
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('glucose display Headless JS settlement', () => {
  beforeEach(() => {
    mocks.getDisplayStatus.mockReset().mockResolvedValue({ supported: false });
    mocks.updateMissing.mockReset().mockResolvedValue(undefined);
    mocks.updateReading.mockReset().mockResolvedValue(undefined);
    mocks.updateHistory.mockReset().mockResolvedValue(true);
    mocks.updatePrivate.mockReset().mockResolvedValue(true);
    mocks.refreshConfiguredSources.mockReset().mockResolvedValue([]);
    mocks.reconcileAlerts.mockReset().mockResolvedValue(undefined);
    mocks.initializeStore.mockReset().mockResolvedValue(undefined);
    mocks.getLatestReading.mockReset().mockResolvedValue(undefined);
    mocks.getSyncState.mockReset().mockResolvedValue(undefined);
    mocks.getReadings.mockReset().mockResolvedValue([]);
    mocks.acquireLease.mockReset().mockResolvedValue({ epoch: 7 });
    mocks.assertSourceLease.mockReset().mockResolvedValue(undefined);
    mocks.transactionLatest = undefined;
    mocks.transactionHistory = [];
    mocks.transactionSyncError = undefined;
    mocks.transactionGetFirst.mockReset().mockImplementation(
      async (query: string) =>
        query.includes('FROM source_sync_state')
          ? { last_error_code: mocks.transactionSyncError ?? null }
          : mocks.transactionLatest
            ? transactionRow(mocks.transactionLatest)
            : null,
    );
    mocks.transactionGetAll.mockReset().mockImplementation(async () =>
      mocks.transactionHistory.map(transactionRow),
    );
    mocks.leaseTransaction.mockReset().mockImplementation(
      async (
        _lease: { epoch: number },
        task: (transaction: {
          getFirstAsync: typeof mocks.transactionGetFirst;
          getAllAsync: typeof mocks.transactionGetAll;
        }) => Promise<unknown>,
      ) =>
        task({
          getFirstAsync: mocks.transactionGetFirst,
          getAllAsync: mocks.transactionGetAll,
        }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the native boundary when source work rejects', async () => {
    await expect(
      settleHeadlessPromise(Promise.reject(new Error('Offline')), 50),
    ).resolves.toBe(true);
  });

  it('recognises an identical native publication without rereading history', () => {
    const reading = {
      id: 'reading-1',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'flat' as const,
      quality: 'measured' as const,
    };

    expect(
      glucoseDisplayAlreadyPublished(
        {
          latestTimestamp: reading.timestamp,
          latestMmolL: reading.mmolL,
          latestTrend: reading.trend,
          latestTrendOrigin: 'source',
          latestSourceLabel: 'T1 Arc direct LibreLinkUp',
        },
        reading,
        'T1 Arc direct LibreLinkUp',
      ),
    ).toBe(true);
    expect(
      glucoseDisplayAlreadyPublished(
        {
          latestTimestamp: reading.timestamp - 1,
          latestMmolL: reading.mmolL,
          latestTrend: reading.trend,
          latestTrendOrigin: 'source',
          latestSourceLabel: 'T1 Arc direct LibreLinkUp',
        },
        reading,
        'T1 Arc direct LibreLinkUp',
      ),
    ).toBe(false);
  });

  it('only skips unchanged history for an opted-in periodic publication', async () => {
    const reading = {
      id: 'reading-derived-trend',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'unknown' as const,
      quality: 'measured' as const,
    };
    mocks.getDisplayStatus.mockResolvedValue({
      supported: true,
      latestTimestamp: reading.timestamp,
      latestMmolL: reading.mmolL,
      latestTrend: 'slightDown',
      latestTrendOrigin: 'calculated',
      latestSourceLabel: 'T1 Arc direct LibreLinkUp',
    });
    mocks.getLatestReading.mockResolvedValue(reading);
    mocks.getReadings.mockResolvedValue([reading]);
    mocks.transactionLatest = reading;
    mocks.transactionHistory = [reading];

    await expect(updateGlucoseDisplayFromHistory()).resolves.toBe(true);
    expect(mocks.getReadings).toHaveBeenCalledOnce();
    expect(mocks.updatePrivate).toHaveBeenCalledOnce();

    await expect(
      updateGlucoseDisplayFromHistory({ allowUnchangedSkip: true }),
    ).resolves.toBe(true);
    expect(mocks.getReadings).toHaveBeenCalledOnce();
    expect(mocks.updatePrivate).toHaveBeenCalledOnce();
    expect(mocks.reconcileAlerts).toHaveBeenLastCalledWith(
      reading,
      'slightDown',
    );
  });

  it('reprepares instead of publishing an older row after the DB advances', async () => {
    const older = {
      id: 'older-reading',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'flat' as const,
      quality: 'measured' as const,
    };
    const newer = {
      ...older,
      id: 'newer-reading',
      timestamp: older.timestamp + 60_000,
      receivedAt: older.receivedAt + 60_000,
      mmolL: 6.8,
    };
    mocks.getDisplayStatus.mockResolvedValue({ supported: true });
    mocks.getLatestReading
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce(newer);
    mocks.getReadings
      .mockResolvedValueOnce([older])
      .mockResolvedValueOnce([newer]);
    mocks.transactionLatest = newer;
    mocks.transactionHistory = [newer];

    await expect(
      updateGlucoseDisplayFromHistoryWithLease({ epoch: 7 }),
    ).resolves.toBe(true);

    expect(mocks.updatePrivate).toHaveBeenCalledOnce();
    expect(mocks.updatePrivate).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        timestampMs: newer.timestamp,
        mmolL: newer.mmolL,
      }),
      [
        {
          mmolL: newer.mmolL,
          timestampMs: newer.timestamp,
        },
      ],
      'No personal glucose reading',
    );
    expect(mocks.reconcileAlerts).toHaveBeenCalledWith(newer, 'flat');
  });

  it('reprepares an exact graph when history changes but latest stays the same', async () => {
    const latest = {
      id: 'latest-reading',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'unknown' as const,
      quality: 'measured' as const,
    };
    const older = {
      ...latest,
      id: 'older-reading',
      timestamp: latest.timestamp - 10 * 60_000,
      receivedAt: latest.receivedAt - 10 * 60_000,
      mmolL: 6.0,
    };
    const inserted = {
      ...latest,
      id: 'inserted-reading',
      timestamp: latest.timestamp - 5 * 60_000,
      receivedAt: latest.receivedAt - 5 * 60_000,
      mmolL: 6.2,
    };
    mocks.getDisplayStatus.mockResolvedValue({ supported: true });
    mocks.getLatestReading.mockResolvedValue(latest);
    mocks.getReadings
      .mockResolvedValueOnce([older, latest])
      .mockResolvedValue([older, inserted, latest]);
    mocks.transactionLatest = latest;
    mocks.transactionHistory = [older, inserted, latest];

    await expect(
      updateGlucoseDisplayFromHistoryWithLease({ epoch: 7 }),
    ).resolves.toBe(true);

    expect(mocks.updatePrivate).toHaveBeenCalledOnce();
    expect(mocks.updatePrivate).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ timestampMs: latest.timestamp }),
      [older, inserted, latest].map((reading) => ({
        mmolL: reading.mmolL,
        timestampMs: reading.timestamp,
      })),
      'No personal glucose reading',
    );
    expect(mocks.getReadings).toHaveBeenCalledTimes(2);
  });

  it('does not publish or alert when the writer boundary supersedes the work', async () => {
    mocks.getDisplayStatus.mockResolvedValue({ supported: true });
    mocks.leaseTransaction.mockRejectedValueOnce(
      new Error('privacy erase superseded this operation'),
    );

    await expect(
      updateGlucoseDisplayFromHistoryWithLease({ epoch: 7 }),
    ).rejects.toThrow(/superseded/i);
    expect(mocks.updatePrivate).not.toHaveBeenCalled();
    expect(mocks.reconcileAlerts).not.toHaveBeenCalled();
  });

  it('holds exact source ownership through a verified native publication', async () => {
    const reading = {
      id: 'verified-libre-reading',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'flat' as const,
      quality: 'measured' as const,
    };
    const sourceWriteLease = {
      sourceId: 't1arc-librelinkup' as const,
      localDataWriteLease: { epoch: 7 },
      ownerGeneration: 4,
      identityDigest: 'a'.repeat(64),
    };
    mocks.getDisplayStatus.mockResolvedValue({ supported: true });
    mocks.getLatestReading.mockResolvedValue(reading);
    mocks.getReadings.mockResolvedValue([reading]);
    mocks.transactionLatest = reading;
    mocks.transactionHistory = [reading];

    await expect(
      updateGlucoseDisplayFromHistoryWithLease(
        { epoch: 7 },
        {},
        undefined,
        sourceWriteLease,
      ),
    ).resolves.toBe(true);

    expect(mocks.assertSourceLease).toHaveBeenCalledWith(
      expect.objectContaining({
        getFirstAsync: mocks.transactionGetFirst,
      }),
      sourceWriteLease,
      't1arc-librelinkup',
    );
    expect(mocks.assertSourceLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updatePrivate.mock.invocationCallOrder[0]!,
    );
  });

  it.each(['t1arc-librelinkup', 'xdrip-local'] as const)(
    'publishes a missing-device %s reading after SQLite canonicalizes it to an empty string',
    async (sourceId) => {
      const reading = {
        id: `${sourceId}-without-device-id`,
        sourceId,
        timestamp: 1_800_000_000_000,
        receivedAt: 1_800_000_000_100,
        mmolL: 6.4,
        trend: 'flat' as const,
        quality: 'measured' as const,
      };
      mocks.getDisplayStatus.mockResolvedValue({ supported: true });
      mocks.getLatestReading.mockResolvedValue(reading);
      mocks.getReadings.mockResolvedValue([reading]);
      mocks.transactionLatest = reading;
      mocks.transactionHistory = [reading];

      await expect(
        updateGlucoseDisplayFromHistoryWithLease({ epoch: 7 }),
      ).resolves.toBe(true);

      expect(mocks.updatePrivate).toHaveBeenCalledOnce();
    },
  );

  it('does not collapse distinct nonempty device identities', async () => {
    const prepared = {
      id: 'device-scoped-reading',
      sourceId: 't1arc-librelinkup',
      timestamp: 1_800_000_000_000,
      receivedAt: 1_800_000_000_100,
      mmolL: 6.4,
      trend: 'flat' as const,
      quality: 'measured' as const,
      sourceDeviceId: 'sensor-a',
    };
    mocks.getDisplayStatus.mockResolvedValue({ supported: true });
    mocks.getLatestReading.mockResolvedValue(prepared);
    mocks.getReadings.mockResolvedValue([prepared]);
    mocks.transactionLatest = {
      ...prepared,
      sourceDeviceId: 'sensor-b',
    };
    mocks.transactionHistory = [mocks.transactionLatest];

    await expect(
      updateGlucoseDisplayFromHistoryWithLease({ epoch: 7 }),
    ).resolves.toBe(false);

    expect(mocks.updatePrivate).not.toHaveBeenCalled();
    expect(mocks.reconcileAlerts).not.toHaveBeenCalled();
  });

  it('settles a pending-erase lease rejection without starting source work', async () => {
    mocks.acquireLease.mockRejectedValueOnce(
      new Error('A local-data privacy erase is still being completed.'),
    );

    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();
    expect(mocks.refreshConfiguredSources).not.toHaveBeenCalled();
    expect(mocks.updatePrivate).not.toHaveBeenCalled();
  });

  it('resolves before the native timeout when work never settles', async () => {
    vi.useFakeTimers();
    const onDeadline = vi.fn();
    const result = settleHeadlessPromise(
      new Promise(() => {
        // Intentionally unresolved to exercise the native-deadline fallback.
      }),
      95_000,
      onDeadline,
    );

    await vi.advanceTimersByTimeAsync(95_000);

    await expect(result).resolves.toBe(false);
    expect(onDeadline).toHaveBeenCalledTimes(1);
  });

  it('settles a rejected refresh and releases the owner for the next tick', async () => {
    mocks.refreshConfiguredSources
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce([]);

    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();
    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();

    expect(mocks.refreshConfiguredSources).toHaveBeenCalledTimes(2);
  });

  it('plumbs only the exact validated-network task-data reason', async () => {
    await runGlucoseDisplayForegroundSync({ reason: 'validated-network' });
    await runGlucoseDisplayForegroundSync({ reason: 'glucose-display' });

    expect(mocks.refreshConfiguredSources).toHaveBeenNthCalledWith(
      1,
      undefined,
      {
        reason: 'validated-network',
        signal: expect.any(AbortSignal),
        writeLease: { epoch: 7 },
      },
    );
    expect(mocks.refreshConfiguredSources).toHaveBeenNthCalledWith(
      2,
      undefined,
      {
        reason: undefined,
        signal: expect.any(AbortSignal),
        writeLease: { epoch: 7 },
      },
    );
  });

  it('preserves one validated-network edge that arrives during an active owner', async () => {
    let finishRefresh!: () => void;
    mocks.refreshConfiguredSources
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      )
      .mockResolvedValue([]);

    const ownerTick = runGlucoseDisplayForegroundSync();
    await flushMicrotasks();
    const networkTick = runGlucoseDisplayForegroundSync({
      reason: 'validated-network',
    });
    await flushMicrotasks();
    expect(mocks.refreshConfiguredSources).toHaveBeenCalledTimes(1);

    finishRefresh();
    await Promise.all([ownerTick, networkTick]);
    await runGlucoseDisplayForegroundSync({ reason: 'glucose-display' });
    await runGlucoseDisplayForegroundSync();

    expect(mocks.refreshConfiguredSources).toHaveBeenNthCalledWith(
      2,
      undefined,
      {
        reason: 'validated-network',
        signal: expect.any(AbortSignal),
        writeLease: { epoch: 7 },
      },
    );
    expect(mocks.refreshConfiguredSources).toHaveBeenNthCalledWith(
      3,
      undefined,
      {
        reason: undefined,
        signal: expect.any(AbortSignal),
        writeLease: { epoch: 7 },
      },
    );
  });

  it('aborts a hung owner, drains it, then lets the next tick recover without overlap', async () => {
    vi.useFakeTimers();
    let activeRefreshes = 0;
    let maximumActiveRefreshes = 0;
    let observedAbort = false;
    mocks.refreshConfiguredSources
      .mockImplementationOnce(
        (_history, options: { signal?: AbortSignal }) =>
          new Promise<void>((_resolve, reject) => {
            activeRefreshes += 1;
            maximumActiveRefreshes = Math.max(
              maximumActiveRefreshes,
              activeRefreshes,
            );
            options.signal?.addEventListener('abort', () => {
              observedAbort = true;
              activeRefreshes -= 1;
              reject(new Error('Aborted'));
            });
          }),
      )
      .mockResolvedValueOnce([]);

    const firstTick = runGlucoseDisplayForegroundSync();
    await flushMicrotasks();
    expect(mocks.refreshConfiguredSources).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(95_000);
    await expect(firstTick).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(observedAbort).toBe(true);
    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();
    expect(mocks.refreshConfiguredSources).toHaveBeenCalledTimes(2);
    expect(maximumActiveRefreshes).toBe(1);
  });

});
