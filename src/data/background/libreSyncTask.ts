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
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  configuredGlucoseSources,
  refreshConfiguredGlucoseSources,
} from '@/data/live/configuredGlucoseSources';
import { glucoseAutomationSummary } from '@/data/live/glucoseSourceRefresh';

if (!TaskManager.isTaskDefined(LIBRE_BACKGROUND_TASK)) {
  TaskManager.defineTask(LIBRE_BACKGROUND_TASK, async () => {
    const runId = await beginAutomationRun('glucose').catch(
      () => undefined,
    );
    try {
      const results = await refreshConfiguredGlucoseSources();
      const displayUpdated = await updateGlucoseDisplayFromHistory()
        .then((updated) => updated)
        .catch(() => false);
      const summary = glucoseAutomationSummary(results, displayUpdated);
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: summary.outcome,
          detail: summary.detail,
        }).catch(() => undefined);
      }
      return summary.outcome === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail: 'Glucose sources could not update. T1 Arc will try again.',
        }).catch(() => undefined);
      }
      await updateGlucoseDisplayFromHistory().catch(() => undefined);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
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
