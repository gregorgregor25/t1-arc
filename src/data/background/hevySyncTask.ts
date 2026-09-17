import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { loadHevyConnection } from '@/data/hevy/secureStore';
import { syncHevyIfDue } from '@/data/hevy/sync';
import { ensureRegionalProfileRuntimeHydrated } from '@/data/regionalProfile';

import {
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
} from './backgroundTaskRegistration';
import { HEVY_BACKGROUND_TASK } from './backgroundTaskNames';

let hevyRegistrationTail: Promise<void> = Promise.resolve();

if (!TaskManager.isTaskDefined(HEVY_BACKGROUND_TASK)) {
  TaskManager.defineTask(HEVY_BACKGROUND_TASK, async () => {
    try {
      await ensureRegionalProfileRuntimeHydrated();
      await syncHevyIfDue();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export function updateHevyBackgroundSyncRegistration() {
  // Registration is a last-writer-wins setting. Serialize callers and read
  // credentials only when their turn begins so an older live-mode configure
  // cannot finish after privacy erase and re-register the worker.
  const run = hevyRegistrationTail.then(async () => {
    const schedulerAvailable = await backgroundTaskSchedulerAvailable();
    const connection = await loadHevyConnection();
    return reconcileBackgroundTaskRegistration(
      HEVY_BACKGROUND_TASK,
      schedulerAvailable && Boolean(connection),
    );
  });
  hevyRegistrationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
