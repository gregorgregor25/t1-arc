import { describe, expect, it, vi } from 'vitest';

import { updateHevyBackgroundSyncRegistration } from '@/data/background/hevySyncTask';

const mocks = vi.hoisted(() => ({
  hydrateProfile: vi.fn(async () => undefined),
  loadConnection: vi.fn(),
  reconcile: vi.fn(),
  schedulerAvailable: vi.fn(),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Failed: 'failed', Success: 'success' },
}));

vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(() => true),
}));

vi.mock('@/data/hevy/secureStore', () => ({
  loadHevyConnection: mocks.loadConnection,
}));

vi.mock('@/data/hevy/sync', () => ({
  syncHevyIfDue: vi.fn(),
}));

vi.mock('@/data/background/backgroundTaskRegistration', () => ({
  backgroundTaskSchedulerAvailable: mocks.schedulerAvailable,
  reconcileBackgroundTaskRegistration: mocks.reconcile,
}));

vi.mock('@/data/regionalProfile', () => ({
  ensureRegionalProfileRuntimeHydrated: mocks.hydrateProfile,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Hevy background registration ordering', () => {
  it('lets the later credential-clear reconciliation win over a stale configure', async () => {
    const staleScheduler = deferred<boolean>();
    const staleRegistration = deferred<boolean>();
    mocks.schedulerAvailable
      .mockReturnValueOnce(staleScheduler.promise)
      .mockResolvedValueOnce(true);
    mocks.loadConnection
      .mockResolvedValueOnce({ apiKey: 'old-key' })
      .mockResolvedValueOnce(undefined);
    mocks.reconcile
      .mockReturnValueOnce(staleRegistration.promise)
      .mockResolvedValueOnce(false);

    const staleConfigure = updateHevyBackgroundSyncRegistration();
    const afterErase = updateHevyBackgroundSyncRegistration();
    await Promise.resolve();
    expect(mocks.schedulerAvailable).toHaveBeenCalledOnce();

    staleScheduler.resolve(true);
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    expect(mocks.reconcile).toHaveBeenNthCalledWith(
      1,
      't1arc.background.hevy-sync.v1',
      true,
    );
    expect(mocks.schedulerAvailable).toHaveBeenCalledOnce();

    staleRegistration.resolve(true);
    await expect(staleConfigure).resolves.toBe(true);
    await expect(afterErase).resolves.toBe(false);

    expect(mocks.reconcile).toHaveBeenNthCalledWith(
      2,
      't1arc.background.hevy-sync.v1',
      false,
    );
  });
});
