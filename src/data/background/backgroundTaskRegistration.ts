import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import {
  GLOOKO_BACKGROUND_TASK,
  HEALTH_CONNECT_BACKGROUND_TASK,
  INSIGHT_REVIEW_BACKGROUND_TASK,
  LIBRE_BACKGROUND_TASK,
} from './backgroundTaskNames';

/**
 * Expo runs every JavaScript background task through one native worker. The
 * last registered task controls that worker's interval, so every task must use
 * the same minimum and apply its own due/backoff policy inside the executor.
 */
export const BACKGROUND_WORKER_INTERVAL_MINUTES = 15;
const BACKGROUND_WORKER_MIGRATION_KEY =
  'daymark.background-worker.registration.v2';
const BACKGROUND_WORKER_MIGRATION_VERSION = '15-minute-shared-worker';
const KNOWN_BACKGROUND_TASKS = [
  LIBRE_BACKGROUND_TASK,
  GLOOKO_BACKGROUND_TASK,
  HEALTH_CONNECT_BACKGROUND_TASK,
  INSIGHT_REVIEW_BACKGROUND_TASK,
] as const;

export function shouldRegisterGlucoseBackgroundSync(
  schedulerAvailable: boolean,
  configuredSourceCount: number,
) {
  return schedulerAvailable && configuredSourceCount > 0;
}

export async function backgroundTaskSchedulerAvailable() {
  return (
    (await BackgroundTask.getStatusAsync()) ===
    BackgroundTask.BackgroundTaskStatus.Available
  );
}

/**
 * Expo persists each task and the single WorkManager request independently.
 * Updating a task's saved interval therefore does not necessarily replace an
 * already-enqueued worker from an older build. Reset all known consumers once
 * after this migration so the first newly registered 15-minute task owns a
 * fresh native worker. This does not run again on ordinary app launches.
 */
export async function migrateBackgroundWorkerRegistration() {
  const migrated = await SecureStore.getItemAsync(
    BACKGROUND_WORKER_MIGRATION_KEY,
  );
  if (migrated === BACKGROUND_WORKER_MIGRATION_VERSION) return false;

  for (const taskName of KNOWN_BACKGROUND_TASKS) {
    if (await TaskManager.isTaskRegisteredAsync(taskName)) {
      await BackgroundTask.unregisterTaskAsync(taskName);
    }
  }
  await SecureStore.setItemAsync(
    BACKGROUND_WORKER_MIGRATION_KEY,
    BACKGROUND_WORKER_MIGRATION_VERSION,
  );
  return true;
}

export async function reconcileBackgroundTaskRegistration(
  taskName: string,
  shouldRegister: boolean,
) {
  const registered =
    await TaskManager.isTaskRegisteredAsync(taskName);
  if (!shouldRegister) {
    if (registered) {
      await BackgroundTask.unregisterTaskAsync(taskName);
    }
    return false;
  }

  let intervalMatches = false;
  if (registered) {
    const options = await TaskManager.getTaskOptionsAsync<{
      minimumInterval?: number;
    }>(taskName).catch(() => undefined);
    intervalMatches =
      options?.minimumInterval === BACKGROUND_WORKER_INTERVAL_MINUTES;
  }
  if (registered && !intervalMatches) {
    await BackgroundTask.unregisterTaskAsync(taskName);
  }
  if (!registered || !intervalMatches) {
    await BackgroundTask.registerTaskAsync(taskName, {
      minimumInterval: BACKGROUND_WORKER_INTERVAL_MINUTES,
    });
  }
  return true;
}
