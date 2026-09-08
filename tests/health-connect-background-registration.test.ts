import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateHealthConnectBackgroundSyncRegistration } from '@/data/background/healthConnectSyncTask';
import { HEALTH_CONNECT_BACKGROUND_TASK } from '@/data/background/backgroundTaskNames';

const healthConnect = vi.hoisted(() => ({
  getHealthConnectStatus: vi.fn(),
  loadHealthConnectPreferences: vi.fn(),
  saveHealthConnectBackgroundState: vi.fn(),
  syncHealthConnectIfDue: vi.fn(),
}));
const registration = vi.hoisted(() => ({
  backgroundTaskSchedulerAvailable: vi.fn(),
  reconcileBackgroundTaskRegistration: vi.fn(),
}));
const taskManager = vi.hoisted(() => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(),
}));
const automation = vi.hoisted(() => ({
  beginAutomationRun: vi.fn(),
  finishAutomationRun: vi.fn(),
}));
const writeEpoch = vi.hoisted(() => ({
  acquireLocalDataWriteLease: vi.fn(),
  isLocalDataWriteSupersededError: vi.fn(
    (error: unknown) =>
      error instanceof Error && error.name === 'LocalDataWriteSupersededError',
  ),
}));
const regionalProfile = vi.hoisted(() => ({
  ensureRegionalProfileRuntimeHydrated: vi.fn(async () => undefined),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

vi.mock('expo-task-manager', () => ({
  defineTask: taskManager.defineTask,
  isTaskDefined: taskManager.isTaskDefined,
}));

vi.mock('@/data/background/backgroundTaskRegistration', () => ({
  backgroundTaskSchedulerAvailable:
    registration.backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration:
    registration.reconcileBackgroundTaskRegistration,
}));

vi.mock('@/data/background/automationRunLog', () => ({
  beginAutomationRun: automation.beginAutomationRun,
  finishAutomationRun: automation.finishAutomationRun,
}));

vi.mock('@/data/healthConnect/healthConnectRepository', () => ({
  getHealthConnectStatus: healthConnect.getHealthConnectStatus,
  loadHealthConnectPreferences: healthConnect.loadHealthConnectPreferences,
  saveHealthConnectBackgroundState:
    healthConnect.saveHealthConnectBackgroundState,
  syncHealthConnectIfDue: healthConnect.syncHealthConnectIfDue,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: writeEpoch.acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError: writeEpoch.isLocalDataWriteSupersededError,
}));

vi.mock('@/data/regionalProfile', () => ({
  ensureRegionalProfileRuntimeHydrated:
    regionalProfile.ensureRegionalProfileRuntimeHydrated,
}));

const backgroundTask = taskManager.defineTask.mock.calls[0]?.[1] as
  (() => Promise<number>) | undefined;

function supersededError() {
  const error = new Error(
    'This local-data operation was superseded by a privacy erase.',
  );
  error.name = 'LocalDataWriteSupersededError';
  return error;
}

function status(grantedCategories: string[]) {
  return {
    availability: 'available',
    backgroundGranted: true,
    categories: ['steps', 'sleep'].map((id) => ({
      id,
      granted: grantedCategories.includes(id),
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Health Connect background registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskManager.isTaskDefined.mockReturnValue(false);
    writeEpoch.acquireLocalDataWriteLease.mockResolvedValue({ epoch: 4 });
    automation.beginAutomationRun.mockResolvedValue('run-id');
    automation.finishAutomationRun.mockResolvedValue(undefined);
    healthConnect.saveHealthConnectBackgroundState.mockResolvedValue(undefined);
    healthConnect.syncHealthConnectIfDue.mockResolvedValue(undefined);
    registration.backgroundTaskSchedulerAvailable.mockResolvedValue(true);
    registration.reconcileBackgroundTaskRegistration.mockImplementation(
      async (_taskName: string, shouldRegister: boolean) => shouldRegister,
    );
  });

  it('unregisters the worker when every app category is disabled', async () => {
    healthConnect.getHealthConnectStatus.mockResolvedValue(status(['steps']));
    healthConnect.loadHealthConnectPreferences.mockResolvedValue([
      { category: 'steps', enabled: false, updatedAt: 10 },
      { category: 'sleep', enabled: false, updatedAt: 10 },
    ]);

    await expect(updateHealthConnectBackgroundSyncRegistration()).resolves.toBe(
      false,
    );
    expect(
      registration.reconcileBackgroundTaskRegistration,
    ).toHaveBeenCalledWith(HEALTH_CONNECT_BACKGROUND_TASK, false);
    expect(healthConnect.getHealthConnectStatus).not.toHaveBeenCalled();
    expect(registration.backgroundTaskSchedulerAvailable).not.toHaveBeenCalled();
  });

  it('settles no-category cleanup without waiting for a stalled native permission query', async () => {
    const nativeStatus = deferred<ReturnType<typeof status>>();
    healthConnect.getHealthConnectStatus.mockReturnValue(nativeStatus.promise);
    healthConnect.loadHealthConnectPreferences.mockResolvedValue([]);

    const operation = updateHealthConnectBackgroundSyncRegistration();
    let settled = false;
    void operation.then(() => { settled = true; });
    try {
      // The native promise deliberately never settles during this assertion.
      await vi.waitFor(() => expect(settled).toBe(true));
      await expect(operation).resolves.toBe(false);
      expect(healthConnect.getHealthConnectStatus).not.toHaveBeenCalled();
      expect(registration.backgroundTaskSchedulerAvailable).not.toHaveBeenCalled();
      expect(registration.reconcileBackgroundTaskRegistration).toHaveBeenCalledWith(
        HEALTH_CONNECT_BACKGROUND_TASK,
        false,
      );
    } finally {
      // Drain a regressed implementation too, so one failure cannot poison the
      // module's serialized registration queue for subsequent tests.
      nativeStatus.resolve(status([]));
      await operation;
    }
  });

  it('does not register for a granted category the user disabled', async () => {
    healthConnect.getHealthConnectStatus.mockResolvedValue(status(['steps']));
    healthConnect.loadHealthConnectPreferences.mockResolvedValue([
      { category: 'steps', enabled: false, updatedAt: 10 },
      { category: 'sleep', enabled: true, updatedAt: 10 },
    ]);

    await updateHealthConnectBackgroundSyncRegistration();
    expect(
      registration.reconcileBackgroundTaskRegistration,
    ).toHaveBeenCalledWith(HEALTH_CONNECT_BACKGROUND_TASK, false);
  });

  it('registers when the same category is enabled and granted', async () => {
    healthConnect.getHealthConnectStatus.mockResolvedValue(status(['steps']));
    healthConnect.loadHealthConnectPreferences.mockResolvedValue([
      { category: 'steps', enabled: true, updatedAt: 10 },
      { category: 'sleep', enabled: false, updatedAt: 10 },
    ]);

    await expect(updateHealthConnectBackgroundSyncRegistration()).resolves.toBe(
      true,
    );
    expect(
      registration.reconcileBackgroundTaskRegistration,
    ).toHaveBeenCalledWith(HEALTH_CONNECT_BACKGROUND_TASK, true);
    expect(healthConnect.getHealthConnectStatus).toHaveBeenCalledOnce();
    expect(registration.backgroundTaskSchedulerAvailable).toHaveBeenCalledOnce();
  });

  it.each([
    ['scheduler unavailable', true, 'available', true, false],
    ['provider unavailable', true, 'unavailable', true, true],
    ['background permission denied', true, 'available', false, true],
    ['category permission denied', false, 'available', true, true],
  ])('does not register enabled categories when %s', async (
    _label, categoryGranted, availability, backgroundGranted, schedulerAvailable,
  ) => {
    healthConnect.loadHealthConnectPreferences.mockResolvedValue([
      { category: 'steps', enabled: true, updatedAt: 10 },
    ]);
    healthConnect.getHealthConnectStatus.mockResolvedValue({
      ...status(categoryGranted ? ['steps'] : []),
      availability,
      backgroundGranted,
    });
    registration.backgroundTaskSchedulerAvailable.mockResolvedValue(schedulerAvailable);

    await expect(updateHealthConnectBackgroundSyncRegistration()).resolves.toBe(false);
    expect(healthConnect.getHealthConnectStatus).toHaveBeenCalledOnce();
    expect(registration.backgroundTaskSchedulerAvailable).toHaveBeenCalledOnce();
    expect(registration.reconcileBackgroundTaskRegistration).toHaveBeenCalledWith(
      HEALTH_CONNECT_BACKGROUND_TASK,
      false,
    );
  });

  it('preserves updater invocation order when an older enable snapshot is delayed', async () => {
    const firstStatus = deferred<ReturnType<typeof status>>();
    healthConnect.getHealthConnectStatus
      .mockReturnValueOnce(firstStatus.promise)
      .mockResolvedValue(status(['steps']));
    healthConnect.loadHealthConnectPreferences
      .mockResolvedValueOnce([
        { category: 'steps', enabled: true, updatedAt: 10 },
      ])
      .mockResolvedValueOnce([
        { category: 'steps', enabled: false, updatedAt: 11 },
      ]);

    const olderEnable = updateHealthConnectBackgroundSyncRegistration();
    await vi.waitFor(() =>
      expect(healthConnect.getHealthConnectStatus).toHaveBeenCalledOnce(),
    );
    const newerDisable = updateHealthConnectBackgroundSyncRegistration();
    await Promise.resolve();
    expect(healthConnect.getHealthConnectStatus).toHaveBeenCalledOnce();

    firstStatus.resolve(status(['steps']));
    await Promise.all([olderEnable, newerDisable]);

    expect(
      registration.reconcileBackgroundTaskRegistration.mock.calls.map(
        ([, enabled]) => enabled,
      ),
    ).toEqual([true, false]);
    expect(healthConnect.loadHealthConnectPreferences).toHaveBeenCalledTimes(2);
    expect(healthConnect.getHealthConnectStatus).toHaveBeenCalledOnce();
  });

  it('threads one erase lease through a successful background run', async () => {
    const lease = { epoch: 4 };
    writeEpoch.acquireLocalDataWriteLease.mockResolvedValue(lease);
    healthConnect.syncHealthConnectIfDue.mockResolvedValue({
      successfulCategories: ['steps'],
      failures: [],
      recordsProcessed: 12,
      recordsRemoved: 2,
    });

    await expect(backgroundTask?.()).resolves.toBe(1);

    expect(automation.beginAutomationRun).toHaveBeenCalledWith(
      'health-connect',
      expect.any(Number),
      lease,
    );
    expect(
      writeEpoch.acquireLocalDataWriteLease.mock.invocationCallOrder[0],
    ).toBeLessThan(automation.beginAutomationRun.mock.invocationCallOrder[0]!);
    expect(healthConnect.syncHealthConnectIfDue).toHaveBeenCalledWith(
      undefined,
      undefined,
      lease,
    );
    expect(automation.finishAutomationRun).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ outcome: 'success' }),
      lease,
    );
    expect(healthConnect.saveHealthConnectBackgroundState).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success' }),
      lease,
    );
  });

  it('treats an erase-intent lease rejection as a benign no-op', async () => {
    writeEpoch.acquireLocalDataWriteLease.mockRejectedValue(
      supersededError(),
    );

    await expect(backgroundTask?.()).resolves.toBe(1);

    expect(automation.beginAutomationRun).not.toHaveBeenCalled();
    expect(healthConnect.syncHealthConnectIfDue).not.toHaveBeenCalled();
  });

  it('retains failure semantics for an ordinary initial lease error', async () => {
    writeEpoch.acquireLocalDataWriteLease.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(backgroundTask?.()).resolves.toBe(2);

    expect(automation.beginAutomationRun).not.toHaveBeenCalled();
    expect(healthConnect.syncHealthConnectIfDue).not.toHaveBeenCalled();
  });

  it('treats an erase-superseded sync as benign without completion bookkeeping', async () => {
    healthConnect.syncHealthConnectIfDue.mockRejectedValue(supersededError());

    await expect(backgroundTask?.()).resolves.toBe(1);

    expect(automation.finishAutomationRun).not.toHaveBeenCalled();
    expect(
      healthConnect.saveHealthConnectBackgroundState,
    ).not.toHaveBeenCalled();
  });

  it('stops benignly when erase supersedes the initial audit write', async () => {
    automation.beginAutomationRun.mockRejectedValue(supersededError());

    await expect(backgroundTask?.()).resolves.toBe(1);

    expect(healthConnect.syncHealthConnectIfDue).not.toHaveBeenCalled();
    expect(automation.finishAutomationRun).not.toHaveBeenCalled();
    expect(
      healthConnect.saveHealthConnectBackgroundState,
    ).not.toHaveBeenCalled();
  });

  it('does not save background state when erase supersedes the success audit write', async () => {
    healthConnect.syncHealthConnectIfDue.mockResolvedValue({
      successfulCategories: ['steps'],
      failures: [],
      recordsProcessed: 1,
      recordsRemoved: 0,
    });
    automation.finishAutomationRun.mockRejectedValue(supersededError());

    await expect(backgroundTask?.()).resolves.toBe(1);

    expect(
      healthConnect.saveHealthConnectBackgroundState,
    ).not.toHaveBeenCalled();
  });

  it('retains failed scheduling semantics for an ordinary sync error', async () => {
    healthConnect.syncHealthConnectIfDue.mockRejectedValue(
      new Error('native read failed'),
    );

    await expect(backgroundTask?.()).resolves.toBe(2);

    expect(automation.finishAutomationRun).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({
        outcome: 'failed',
        detail: 'native read failed',
      }),
      { epoch: 4 },
    );
    expect(healthConnect.saveHealthConnectBackgroundState).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', failures: 1 }),
      { epoch: 4 },
    );
  });
});
