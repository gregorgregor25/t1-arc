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
  HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS,
  HEALTH_CONNECT_BACKGROUND_TIME_BUDGET_MS,
} from '@/data/healthConnect/healthConnectSyncPolicy';
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

    // Android stops a job after 10 minutes but cannot stop this JavaScript.
    // The sync therefore stops itself at a budget well inside that limit, or
    // earlier if the platform reports expiry (iOS only in expo-background-task).
    const startedAt = Date.now();
    const stop = new AbortController();
    const expiry = subscribeToBackgroundTaskExpiry(() => stop.abort());
    try {
      const result = await syncHealthConnectIfDue(
        Date.now(),
        HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS,
        writeLease,
        {
          signal: stop.signal,
          deadlineAt: Date.now() + HEALTH_CONNECT_BACKGROUND_TIME_BUDGET_MS,
          // The daily 48-hour re-check runs when the app is open instead.
          allowWindowCheck: false,
        },
      );
      const outcome = !result
        ? 'skipped'
        : result.failures.length || result.stoppedEarly
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
                : result.stoppedEarly
                  ? `${count(result.successfulCategories.length)} categories updated. Stopped early to save battery; the rest will update next time.`
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
          recordsWritten: result?.recordsWritten ?? 0,
          durationMs: Date.now() - startedAt,
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
    } finally {
      expiry.remove();
    }
  });
}

function subscribeToBackgroundTaskExpiry(onExpired: () => void) {
  try {
    if (typeof BackgroundTask.addExpirationListener === 'function') {
      return BackgroundTask.addExpirationListener(onExpired);
    }
  } catch {
    // Not available on this platform; the time budget still applies.
  }
  return { remove: () => undefined };
}

let healthConnectRegistrationTail: Promise<void> = Promise.resolve();

export function updateHealthConnectBackgroundSyncRegistration() {
  const operation = healthConnectRegistrationTail.then(async () => {
    const preferences = await loadHealthConnectPreferences();
    const enabledCategories = new Set(
      preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.category),
    );
    // Do not hold app setup behind a Health Connect provider response when
    // no enabled category can use the worker.
    // Still remove an existing registration when the last category is disabled.
    if (enabledCategories.size === 0) {
      return reconcileBackgroundTaskRegistration(
        HEALTH_CONNECT_BACKGROUND_TASK,
        false,
      );
    }
    const [healthStatus, schedulerAvailable] = await Promise.all([
      getHealthConnectStatus(),
      backgroundTaskSchedulerAvailable(),
    ]);
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
