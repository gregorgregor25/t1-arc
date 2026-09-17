import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
  shouldRegisterGlucoseBackgroundSync,
} from './backgroundTaskRegistration';
import {
  beginAutomationRun,
  finishAutomationRun,
} from './automationRunLog';
import { LIBRE_BACKGROUND_TASK } from './backgroundTaskNames';
import { updateGlucoseDisplayFromHistoryWithLease } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  configuredGlucoseSources,
  refreshConfiguredGlucoseSources,
} from '@/data/live/configuredGlucoseSources';
import { glucoseAutomationSummary } from '@/data/live/glucoseSourceRefresh';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
} from '@/data/privacy/localDataWriteEpoch';
import { ensureRegionalProfileRuntimeHydrated } from '@/data/regionalProfile';

export async function runLibreBackgroundTask() {
  let writeLease;
  try {
    await ensureRegionalProfileRuntimeHydrated();
    writeLease = await acquireLocalDataWriteLease();
  } catch (error) {
    return isLocalDataWriteSupersededError(error)
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  }
  const runId = await beginAutomationRun(
      'glucose',
      Date.now(),
      writeLease,
    ).catch(() => undefined);
  try {
    const results = await refreshConfiguredGlucoseSources(undefined, {
      writeLease,
    });
    const displayUpdated = await updateGlucoseDisplayFromHistoryWithLease(
      writeLease,
    );
    const summary = glucoseAutomationSummary(results, displayUpdated);
    if (runId) {
      try {
        await finishAutomationRun(runId, {
          outcome: summary.outcome,
          detail: summary.detail,
        }, writeLease);
      } catch (error) {
        if (isLocalDataWriteSupersededError(error)) throw error;
      }
    }
    await assertLocalDataWriteLeaseCurrent(writeLease);
    return summary.outcome === 'failed'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (runId) {
      try {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail: 'Glucose sources could not update. T1 Arc will try again.',
        }, writeLease);
      } catch (finishError) {
        if (isLocalDataWriteSupersededError(finishError)) {
          return BackgroundTask.BackgroundTaskResult.Success;
        }
      }
    }
    try {
      await assertLocalDataWriteLeaseCurrent(writeLease);
    } catch (leaseError) {
      if (isLocalDataWriteSupersededError(leaseError)) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    }
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

if (!TaskManager.isTaskDefined(LIBRE_BACKGROUND_TASK)) {
  TaskManager.defineTask(LIBRE_BACKGROUND_TASK, runLibreBackgroundTask);
}

export async function registerLibreBackgroundSync() {
  const [available, sources] = await Promise.all([
    backgroundTaskSchedulerAvailable(),
    configuredGlucoseSources(),
  ]);
  return reconcileBackgroundTaskRegistration(
    LIBRE_BACKGROUND_TASK,
    shouldRegisterGlucoseBackgroundSync(available, sources.length),
  );
}

export async function unregisterLibreBackgroundSync() {
  await reconcileBackgroundTaskRegistration(
    LIBRE_BACKGROUND_TASK,
    false,
  );
}
