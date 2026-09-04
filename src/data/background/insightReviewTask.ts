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
import { INSIGHT_REVIEW_BACKGROUND_TASK } from './backgroundTaskNames';
import { runScheduledInsightReview } from '@/data/insights/scheduledInsightReview';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
} from '@/data/privacy/localDataWriteEpoch';
import { ensureRegionalProfileRuntimeHydrated } from '@/data/regionalProfile';

export async function runInsightReviewBackgroundTask() {
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
      'insight-review',
      Date.now(),
      writeLease,
    ).catch(() => undefined);
  try {
    const result = await runScheduledInsightReview(Date.now(), writeLease);
    if (runId) {
      try {
        await finishAutomationRun(runId, {
          outcome: result.generated ? 'success' : 'skipped',
          detail: result.generated
            ? result.notificationShown
              ? 'Scheduled review updated and its notification was shown.'
              : 'Scheduled review updated.'
            : 'No scheduled review update was due.',
        }, writeLease);
      } catch (error) {
        if (isLocalDataWriteSupersededError(error)) throw error;
      }
    }
    await assertLocalDataWriteLeaseCurrent(writeLease);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    if (runId) {
      try {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail:
            error instanceof Error
              ? error.message
              : 'The scheduled review could not update.',
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

if (!TaskManager.isTaskDefined(INSIGHT_REVIEW_BACKGROUND_TASK)) {
  TaskManager.defineTask(INSIGHT_REVIEW_BACKGROUND_TASK, runInsightReviewBackgroundTask);
}

let insightReviewRegistrationTail: Promise<void> = Promise.resolve();

export function updateInsightReviewBackgroundRegistration(
  enabled: boolean,
) {
  const operation = insightReviewRegistrationTail.then(async () => {
    const available = await backgroundTaskSchedulerAvailable();
    const shouldRegister = enabled && available;
    return reconcileBackgroundTaskRegistration(
      INSIGHT_REVIEW_BACKGROUND_TASK,
      shouldRegister,
    );
  });
  insightReviewRegistrationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
