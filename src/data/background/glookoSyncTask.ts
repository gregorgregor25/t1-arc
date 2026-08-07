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
import { GLOOKO_BACKGROUND_TASK } from './backgroundTaskNames';
import { syncGlookoReportIfDue } from '@/data/glooko/glookoReportSync';
import { syncGlookoIfDue } from '@/data/glooko/glookoSync';
import {
  loadGlookoSyncState,
  updateGlookoSyncState,
} from '@/data/glooko/glookoSyncState';

if (!TaskManager.isTaskDefined(GLOOKO_BACKGROUND_TASK)) {
  TaskManager.defineTask(GLOOKO_BACKGROUND_TASK, async () => {
    const runId = await beginAutomationRun('glooko').catch(
      () => undefined,
    );
    try {
      const outcome = await syncGlookoIfDue('background');
      const reportOutcome = await syncGlookoReportIfDue('background');
      const csvDetail =
        outcome.status === 'skipped'
          ? `CSV ${outcome.plan.reason}`
          : outcome.status === 'success'
            ? outcome.syncState.lastCheckOutcome === 'empty-range'
              ? `${outcome.days}-day CSV checked; valid empty range`
              : outcome.syncState.lastCheckOutcome === 'no-new-data'
                ? `${outcome.days}-day CSV checked; no newer data`
                : `${outcome.days}-day CSV completed with new data`
            : outcome.status === 'session-required'
              ? 'Glooko sign-in is required'
              : outcome.status === 'cancelled'
                ? 'CSV was not provided'
                : 'CSV refresh failed';
      const reportDetail =
        reportOutcome.status === 'skipped'
          ? `report ${reportOutcome.plan.reason}`
          : reportOutcome.status === 'success'
            ? `7-day PDF completed (${reportOutcome.syncState.lastDailyModeCount ?? 0} daily mode summaries)`
            : reportOutcome.status === 'session-required'
              ? 'report needs Glooko sign-in'
              : reportOutcome.status === 'cancelled'
                ? 'PDF was not provided'
                : 'PDF refresh failed';
      const detail = `${csvDetail}; ${reportDetail}`;
      const recordsProcessed =
        outcome.status === 'success'
          ? outcome.result.insertedGlucose +
            outcome.result.insertedBasal +
            outcome.result.insertedBoluses +
            outcome.result.insertedContext +
            outcome.result.insertedDailyTotals +
            (reportOutcome.status === 'success'
              ? reportOutcome.syncState.lastDailyModeCount ?? 0
              : 0)
          : 0;
      const failed =
        outcome.status === 'failed' || reportOutcome.status === 'failed';
      const needsAttention =
        outcome.status === 'session-required' ||
        reportOutcome.status === 'session-required';
      const bothSkipped =
        outcome.status === 'skipped' &&
        reportOutcome.status === 'skipped';
      if (runId) {
        await finishAutomationRun(runId, {
          outcome:
            failed
              ? 'failed'
              : needsAttention
                ? 'needs-attention'
                : bothSkipped
                  ? 'skipped'
                  : outcome.status === 'success' ||
                      reportOutcome.status === 'success'
              ? 'success'
                    : 'partial',
          recordsProcessed,
          detail,
        }).catch(() => undefined);
      }
      await updateGlookoSyncState((current) => ({
        ...current,
        lastBackgroundRunAt: Date.now(),
        lastBackgroundOutcome: outcome.status,
        lastBackgroundDetail: detail,
      }));
      return failed
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      if (runId) {
        await finishAutomationRun(runId, {
          outcome: 'failed',
          detail:
            error instanceof Error
              ? error.message
              : 'Android background execution failed',
        }).catch(() => undefined);
      }
      await updateGlookoSyncState((current) => ({
        ...current,
        lastBackgroundRunAt: Date.now(),
        lastBackgroundOutcome: 'failed',
        lastBackgroundDetail: 'Android background execution failed',
      })).catch(() => undefined);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function updateGlookoBackgroundSyncRegistration() {
  const state = await loadGlookoSyncState();
  const available = await backgroundTaskSchedulerAvailable();
  const shouldRegister = state.automaticEnabled && available;
  return reconcileBackgroundTaskRegistration(
    GLOOKO_BACKGROUND_TASK,
    shouldRegister,
  );
}
