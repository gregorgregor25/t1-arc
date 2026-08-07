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

if (!TaskManager.isTaskDefined(INSIGHT_REVIEW_BACKGROUND_TASK)) {
  TaskManager.defineTask(INSIGHT_REVIEW_BACKGROUND_TASK, async () => {
    const runId = await beginAutomationRun('insight-review').catch(
      () => undefined,
    );
    try {
      const result = await runScheduledInsightReview();
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: result.generated ? 'success' : 'skipped',
          detail: result.generated
            ? result.notificationShown
              ? 'Scheduled review updated and its notification was shown.'
              : 'Scheduled review updated.'
            : 'No scheduled review update was due.',
        }).catch(() => undefined);
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail:
            error instanceof Error
              ? error.message
              : 'The scheduled review could not update.',
        }).catch(() => undefined);
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function updateInsightReviewBackgroundRegistration(
  enabled: boolean,
) {
  const available = await backgroundTaskSchedulerAvailable();
  const shouldRegister = enabled && available;
  return reconcileBackgroundTaskRegistration(
    INSIGHT_REVIEW_BACKGROUND_TASK,
    shouldRegister,
  );
}
