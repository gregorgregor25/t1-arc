import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { loadLibreLinkUpCredentials } from '@/data/libreLinkUp/secureStore';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';

export const LIBRE_BACKGROUND_TASK = 'daymark-librelinkup-sync-v1';

if (!TaskManager.isTaskDefined(LIBRE_BACKGROUND_TASK)) {
  TaskManager.defineTask(LIBRE_BACKGROUND_TASK, async () => {
    const credentials = await loadLibreLinkUpCredentials();
    if (!credentials) return BackgroundTask.BackgroundTaskResult.Success;

    try {
      const source = new DirectLibreLinkUpSource(
        credentials,
        new SqliteGlucoseHistoryStore(),
      );
      await source.refresh();
      await updateGlucoseDisplayFromHistory();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      await updateGlucoseDisplayFromHistory().catch(() => undefined);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerLibreBackgroundSync() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  const registered = await TaskManager.isTaskRegisteredAsync(
    LIBRE_BACKGROUND_TASK,
  );
  if (!registered) {
    await BackgroundTask.registerTaskAsync(LIBRE_BACKGROUND_TASK, {
      minimumInterval: 15,
    });
  }
  return true;
}

export async function unregisterLibreBackgroundSync() {
  const registered = await TaskManager.isTaskRegisteredAsync(
    LIBRE_BACKGROUND_TASK,
  );
  if (registered) {
    await BackgroundTask.unregisterTaskAsync(LIBRE_BACKGROUND_TASK);
  }
}
