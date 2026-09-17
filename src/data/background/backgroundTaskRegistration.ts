import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

/**
 * Expo runs every JavaScript background task through one native worker. The
 * last registered task controls that worker's interval, so every task must use
 * the same minimum and apply its own due/backoff policy inside the executor.
 */
export const BACKGROUND_WORKER_INTERVAL_MINUTES = 15;
const registrationTails = new Map<string, Promise<void>>();

function enqueueTaskRegistration<T>(taskName: string, task: () => Promise<T>) {
  const previous = registrationTails.get(taskName) ?? Promise.resolve();
  const operation = previous.then(task, task);
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  registrationTails.set(taskName, settled);
  void settled.finally(() => {
    if (registrationTails.get(taskName) === settled) {
      registrationTails.delete(taskName);
    }
  });
  return operation;
}

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

export async function reconcileBackgroundTaskRegistration(
  taskName: string,
  shouldRegister: boolean,
) {
  return enqueueTaskRegistration(taskName, async () => {
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
  });
}
