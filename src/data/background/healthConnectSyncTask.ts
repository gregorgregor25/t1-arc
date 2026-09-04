import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
} from './backgroundTaskRegistration';
import { beginAutomationRun, finishAutomationRun } from './automationRunLog';
import { HEALTH_CONNECT_BACKGROUND_TASK } from './backgroundTaskNames';
import {
  getHealthConnectStatus,
  loadHealthConnectPreferences,
  saveHealthConnectBackgroundState,
  syncHealthConnectIfDue,
} from '@/data/healthConnect/healthConnectRepository';
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import { ensureRegionalProfileRuntimeHydrated } from '@/data/regionalProfile';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

async function ignoreAutomationWriteFailure(operation: () => Promise<void>) {
  try {
    await operation();
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) throw error;
  }
}

if (!TaskManager.isTaskDefined(HEALTH_CONNECT_BACKGROUND_TASK)) {
  TaskManager.defineTask(HEALTH_CONNECT_BACKGROUND_TASK, async () => {
    let writeLease: LocalDataWriteLease;
    try {
      await ensureRegionalProfileRuntimeHydrated();
      // Capture before the audit row, due-check reads, or native paging. Every
      // write made by this task must prove that this same lease is still current.
      writeLease = await acquireLocalDataWriteLease();
    } catch (error) {
      return isLocalDataWriteSupersededError(error)
        ? BackgroundTask.BackgroundTaskResult.Success
        : BackgroundTask.BackgroundTaskResult.Failed;
    }

    let runId: string | undefined;
    try {
      runId = await beginAutomationRun(
        'health-connect',
        Date.now(),
        writeLease,
      );
    } catch (error) {
      if (isLocalDataWriteSupersededError(error)) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    }

    try {
      const result = await syncHealthConnectIfDue(
        undefined,
        undefined,
        writeLease,
      );
      const outcome = !result
        ? 'skipped'
        : result.failures.length
          ? 'partial'
          : 'success';
      const count = (value: number) =>
        formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
          maximumFractionDigits: 0,
        });
      if (runId) {
        await ignoreAutomationWriteFailure(() =>
          finishAutomationRun(
            runId,
            {
              outcome,
              recordsProcessed: result?.recordsProcessed ?? 0,
              recordsRemoved: result?.recordsRemoved ?? 0,
              detail: !result
                ? 'Health data was already current.'
                : result.failures.length
                  ? `${count(result.successfulCategories.length)} categories updated; ${count(result.failures.length)} need attention.`
                  : `${count(result.successfulCategories.length)} categories updated.`,
            },
            writeLease,
          ),
        );
      }
      await saveHealthConnectBackgroundState(
        {
          lastRunAt: Date.now(),
          outcome,
          recordsProcessed: result?.recordsProcessed ?? 0,
          recordsRemoved: result?.recordsRemoved ?? 0,
          failures: result?.failures.length ?? 0,
        },
        writeLease,
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      if (isLocalDataWriteSupersededError(error)) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      if (runId) {
        try {
          await ignoreAutomationWriteFailure(() =>
            finishAutomationRun(
              runId,
              {
                outcome: 'failed',
                detail:
                  error instanceof Error
                    ? error.message
                    : 'Health data could not update in the background.',
              },
              writeLease,
            ),
          );
        } catch (finishError) {
          if (isLocalDataWriteSupersededError(finishError)) {
            return BackgroundTask.BackgroundTaskResult.Success;
          }
        }
      }
      try {
        await saveHealthConnectBackgroundState(
          {
            lastRunAt: Date.now(),
            outcome: 'failed',
            recordsProcessed: 0,
            recordsRemoved: 0,
            failures: 1,
          },
          writeLease,
        );
      } catch (stateError) {
        if (isLocalDataWriteSupersededError(stateError)) {
          return BackgroundTask.BackgroundTaskResult.Success;
        }
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

let healthConnectRegistrationTail: Promise<void> = Promise.resolve();

export function updateHealthConnectBackgroundSyncRegistration() {
  const operation = healthConnectRegistrationTail.then(async () => {
    const [healthStatus, preferences, schedulerAvailable] = await Promise.all([
      getHealthConnectStatus(),
      loadHealthConnectPreferences(),
      backgroundTaskSchedulerAvailable(),
    ]);
    const enabledCategories = new Set(
      preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.category),
    );
    const shouldRegister =
      schedulerAvailable &&
      healthStatus.availability === 'available' &&
      healthStatus.backgroundGranted &&
      healthStatus.categories.some(
        (category) => category.granted && enabledCategories.has(category.id),
      );

    return reconcileBackgroundTaskRegistration(
      HEALTH_CONNECT_BACKGROUND_TASK,
      shouldRegister,
    );
  });
  healthConnectRegistrationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
