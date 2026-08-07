import { beforeEach, describe, expect, it, vi } from 'vitest';

const backgroundTask = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}));
const taskManager = vi.hoisted(() => ({
  getTaskOptionsAsync: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
}));
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
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

vi.mock('expo-secure-store', () => ({
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
}));

import {
  BACKGROUND_WORKER_INTERVAL_MINUTES,
  backgroundTaskSchedulerAvailable,
  migrateBackgroundWorkerRegistration,
  reconcileBackgroundTaskRegistration,
  shouldRegisterGlucoseBackgroundSync,
} from '@/data/background/backgroundTaskRegistration';
import {
  GLOOKO_BACKGROUND_TASK,
  HEALTH_CONNECT_BACKGROUND_TASK,
  INSIGHT_REVIEW_BACKGROUND_TASK,
  LIBRE_BACKGROUND_TASK,
} from '@/data/background/backgroundTaskNames';

describe('shared Android background worker registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces a persisted pre-migration worker exactly once', async () => {
    secureStore.getItemAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('15-minute-shared-worker');
    taskManager.isTaskRegisteredAsync.mockResolvedValue(true);

    await expect(migrateBackgroundWorkerRegistration()).resolves.toBe(true);
    expect(backgroundTask.unregisterTaskAsync.mock.calls).toEqual(
      [
        [LIBRE_BACKGROUND_TASK],
        [GLOOKO_BACKGROUND_TASK],
        [HEALTH_CONNECT_BACKGROUND_TASK],
        [INSIGHT_REVIEW_BACKGROUND_TASK],
      ],
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'daymark.background-worker.registration.v2',
      '15-minute-shared-worker',
    );

    vi.clearAllMocks();
    secureStore.getItemAsync.mockResolvedValue('15-minute-shared-worker');
    await expect(migrateBackgroundWorkerRegistration()).resolves.toBe(false);
    expect(backgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
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

  it('reports whether Android background scheduling is available', async () => {
    backgroundTask.getStatusAsync
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    await expect(backgroundTaskSchedulerAvailable()).resolves.toBe(true);
    await expect(backgroundTaskSchedulerAvailable()).resolves.toBe(false);
  });
});
