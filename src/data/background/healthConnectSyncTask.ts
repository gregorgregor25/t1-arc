import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
} from './backgroundTaskRegistration';
import {
  beginAutomationRun,
  finishAutomationRun,
} from './automationRunLog';
import { HEALTH_CONNECT_BACKGROUND_TASK } from './backgroundTaskNames';
import {
  getHealthConnectStatus,
  saveHealthConnectBackgroundState,
  syncHealthConnectIfDue,
} from '@/data/healthConnect/healthConnectRepository';

if (!TaskManager.isTaskDefined(HEALTH_CONNECT_BACKGROUND_TASK)) {
  TaskManager.defineTask(HEALTH_CONNECT_BACKGROUND_TASK, async () => {
    const runId = await beginAutomationRun('health-connect').catch(
      () => undefined,
    );
    try {
      const result = await syncHealthConnectIfDue();
      const outcome = !result
        ? 'skipped'
        : result.failures.length
          ? 'partial'
          : 'success';
      if (runId) {
        await finishAutomationRun(runId, {
          outcome,
          recordsProcessed: result?.recordsProcessed ?? 0,
          recordsRemoved: result?.recordsRemoved ?? 0,
          detail: !result
            ? 'Health data was already current.'
            : result.failures.length
              ? `${result.successfulCategories.length} categories updated; ${result.failures.length} need attention.`
              : `${result.successfulCategories.length} categories updated.`,
        }).catch(() => undefined);
      }
      await saveHealthConnectBackgroundState({
        lastRunAt: Date.now(),
        outcome,
        recordsProcessed: result?.recordsProcessed ?? 0,
        recordsRemoved: result?.recordsRemoved ?? 0,
        failures: result?.failures.length ?? 0,
      });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail:
            error instanceof Error
              ? error.message
              : 'Health data could not update in the background.',
        }).catch(() => undefined);
      }
      await saveHealthConnectBackgroundState({
        lastRunAt: Date.now(),
        outcome: 'failed',
        recordsProcessed: 0,
        recordsRemoved: 0,
        failures: 1,
      }).catch(() => undefined);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function updateHealthConnectBackgroundSyncRegistration() {
  const [healthStatus, schedulerAvailable] = await Promise.all([
    getHealthConnectStatus(),
    backgroundTaskSchedulerAvailable(),
  ]);
  const shouldRegister =
    schedulerAvailable &&
    healthStatus.availability === 'available' &&
    healthStatus.backgroundGranted &&
    healthStatus.categories.some((category) => category.granted);

  return reconcileBackgroundTaskRegistration(
    HEALTH_CONNECT_BACKGROUND_TASK,
    shouldRegister,
  );
}
