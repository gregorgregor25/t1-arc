import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKGROUND_WORKER_INTERVAL_MINUTES,
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
  shouldRegisterGlucoseBackgroundSync,
} from '@/data/background/backgroundTaskRegistration';

const backgroundTask = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}));
const taskManager = vi.hoisted(() => ({
  getTaskOptionsAsync: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: backgroundTask.getStatusAsync,
  registerTaskAsync: backgroundTask.registerTaskAsync,
  unregisterTaskAsync: backgroundTask.unregisterTaskAsync,
}));

vi.mock('expo-task-manager', () => ({
  getTaskOptionsAsync: taskManager.getTaskOptionsAsync,
  isTaskRegisteredAsync: taskManager.isTaskRegisteredAsync,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('shared Android background worker registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not wake Android when no live glucose source is configured', () => {
    expect(shouldRegisterGlucoseBackgroundSync(true, 0)).toBe(false);
    expect(shouldRegisterGlucoseBackgroundSync(true, 1)).toBe(true);
    expect(shouldRegisterGlucoseBackgroundSync(false, 2)).toBe(false);
  });

  it('migrates an existing slow task to the shared 15-minute worker', async () => {
    taskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    taskManager.getTaskOptionsAsync.mockResolvedValue({
      minimumInterval: 360,
    });

    await expect(
      reconcileBackgroundTaskRegistration('weekly-review', true),
    ).resolves.toBe(true);
    expect(backgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(
      'weekly-review',
    );
    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledWith(
      'weekly-review',
      { minimumInterval: BACKGROUND_WORKER_INTERVAL_MINUTES },
    );
  });

  it('leaves an already-correct task alone', async () => {
    taskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    taskManager.getTaskOptionsAsync.mockResolvedValue({
      minimumInterval: BACKGROUND_WORKER_INTERVAL_MINUTES,
    });

    await reconcileBackgroundTaskRegistration('glucose-sync', true);
    expect(backgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(backgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('unregisters a disabled task', async () => {
    taskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    await expect(
      reconcileBackgroundTaskRegistration('glooko-sync', false),
    ).resolves.toBe(false);
    expect(backgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(
      'glooko-sync',
    );
  });

  it('serializes a delayed enable ahead of a newer disable for the same task', async () => {
    const firstRead = deferred<boolean>();
    let registered = false;
    taskManager.isTaskRegisteredAsync
      .mockReturnValueOnce(firstRead.promise)
      .mockImplementation(async () => registered);
    backgroundTask.registerTaskAsync.mockImplementation(async () => {
      registered = true;
    });
    backgroundTask.unregisterTaskAsync.mockImplementation(async () => {
      registered = false;
    });

    const enable = reconcileBackgroundTaskRegistration('race-task', true);
    await vi.waitFor(() =>
      expect(taskManager.isTaskRegisteredAsync).toHaveBeenCalledOnce(),
    );
    const disable = reconcileBackgroundTaskRegistration('race-task', false);
    await Promise.resolve();
    expect(taskManager.isTaskRegisteredAsync).toHaveBeenCalledOnce();

    firstRead.resolve(false);
    await Promise.all([enable, disable]);

    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledOnce();
    expect(backgroundTask.unregisterTaskAsync).toHaveBeenCalledOnce();
    expect(registered).toBe(false);
  });

  it('reports whether Android background scheduling is available', async () => {
    backgroundTask.getStatusAsync
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    await expect(backgroundTaskSchedulerAvailable()).resolves.toBe(true);
    await expect(backgroundTaskSchedulerAvailable()).resolves.toBe(false);
  });
});
