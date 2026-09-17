import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import {
  backgroundTaskSchedulerAvailable,
  reconcileBackgroundTaskRegistration,
} from "./backgroundTaskRegistration";
import { beginAutomationRun, finishAutomationRun } from "./automationRunLog";
import { GLOOKO_BACKGROUND_TASK } from "./backgroundTaskNames";
import { syncGlookoReportIfDue } from "@/data/glooko/glookoReportSync";
import { syncGlookoIfDue } from "@/data/glooko/glookoSync";
import {
  glookoStepCountsAsFailure,
  glookoStepCountsAsSkipped,
} from "@/data/glooko/glookoSyncOutcome";
import { glookoReportBackgroundSchedulingEnabled } from "@/data/glooko/glookoReportSyncPolicy";
import { loadGlookoReportSyncState } from "@/data/glooko/glookoReportSyncState";
import { glookoBackgroundSchedulingEnabled } from "@/data/glooko/glookoSyncPolicy";
import {
  loadGlookoSyncState,
  updateGlookoSyncState,
} from "@/data/glooko/glookoSyncState";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";
import { ensureRegionalProfileRuntimeHydrated } from "@/data/regionalProfile";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

export async function runGlookoBackgroundTask() {
  let writeLease: LocalDataWriteLease;
  try {
    await ensureRegionalProfileRuntimeHydrated();
    // Capture before audit rows, native session/export calls, inbox reads or
    // network work. The same lease owns every eventual write below.
    writeLease = await acquireLocalDataWriteLease();
  } catch (error) {
    return isLocalDataWriteSupersededError(error)
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  }

  let runId: string | undefined;
  try {
    const startedAt = Date.now();
    runId = await beginAutomationRun("glooko", startedAt, writeLease);
    const outcome = await syncGlookoIfDue("background", writeLease);
    const reportOutcome = await syncGlookoReportIfDue("background", writeLease);
    const count = (value: number) =>
      formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
        maximumFractionDigits: 0,
      });
    const csvDetail =
      outcome.status === "skipped"
        ? outcome.reason === "busy"
          ? "CSV already updating"
          : `CSV ${outcome.plan?.reason ?? "fresh"}`
        : outcome.status === "success"
          ? outcome.syncState.lastCheckOutcome === "empty-range"
            ? `${count(outcome.days)}-day CSV checked; valid empty range`
            : outcome.syncState.lastCheckOutcome === "no-new-data"
              ? `${count(outcome.days)}-day CSV checked; no newer data`
              : `${count(outcome.days)}-day CSV completed with new data`
          : outcome.status === "session-required"
            ? "Glooko sign-in is required"
            : outcome.status === "cancelled"
              ? "CSV was not provided"
              : "CSV refresh failed";
    const reportDetail =
      reportOutcome.status === "skipped"
        ? reportOutcome.reason === "busy"
          ? "report already updating"
          : reportOutcome.reason === "no-new-file"
            ? "Daily Overview and fallback inbox unchanged"
            : reportOutcome.reason === "no-supported-report"
              ? "no valid Daily Overview available"
              : reportOutcome.reason === "not-configured"
                ? "report sign-in or fallback inbox not configured"
                : `report ${reportOutcome.plan?.reason ?? "fresh"}`
        : reportOutcome.status === "success"
          ? `${count(7)}-day pump report completed (${count(reportOutcome.syncState.lastActivityCount ?? 0)} Activity periods, ${count(reportOutcome.syncState.lastPauseCount ?? 0)} pauses)`
          : reportOutcome.status === "session-required"
            ? "report needs Glooko sign-in"
            : reportOutcome.status === "cancelled"
              ? "PDF was not provided"
              : "PDF refresh failed";
    const detail = `${csvDetail}; ${reportDetail}`;
    const recordsProcessed =
      (outcome.status === "success"
        ? outcome.result.insertedGlucose +
          outcome.result.insertedBasal +
          outcome.result.insertedBoluses +
          outcome.result.insertedContext +
          outcome.result.insertedDailyTotals
        : 0) +
      (reportOutcome.status === "success"
        ? (reportOutcome.syncState.lastDailyModeCount ?? 0) +
          (reportOutcome.syncState.lastActivityCount ?? 0) +
          (reportOutcome.syncState.lastPauseCount ?? 0)
        : 0);
    const csvFailed = glookoStepCountsAsFailure(outcome);
    const reportFailed =
      reportOutcome.status === "session-required" ||
      glookoStepCountsAsFailure(reportOutcome);
    const failed = csvFailed;
    const needsAttention = outcome.status === "session-required";
    const bothSkipped =
      glookoStepCountsAsSkipped(outcome) &&
      glookoStepCountsAsSkipped(reportOutcome);
    if (runId) {
      await finishAutomationRun(
        runId,
        {
          outcome: failed
            ? "failed"
            : needsAttention
              ? "needs-attention"
              : reportFailed
                ? "partial"
                : bothSkipped
                  ? "skipped"
                  : outcome.status === "success" ||
                      reportOutcome.status === "success"
                    ? "success"
                    : "partial",
          recordsProcessed,
          detail,
        },
        writeLease,
      );
    }
    await updateGlookoSyncState(
      (current) => ({
        ...current,
        lastBackgroundRunAt: Date.now(),
        lastBackgroundOutcome: outcome.status,
        lastBackgroundDetail: detail,
      }),
      writeLease,
    );
    if (
      !outcome.syncState.automaticEnabled ||
      (outcome.status === "skipped" &&
        outcome.plan?.reason === "action-required")
    ) {
      try {
        await updateGlookoBackgroundSyncRegistration(writeLease);
      } catch (error) {
        if (isLocalDataWriteSupersededError(error)) throw error;
      }
    }
    return failed
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    try {
      if (runId) {
        await finishAutomationRun(
          runId,
          {
            outcome: "failed",
            detail:
              error instanceof Error
                ? error.message
                : "Android background execution failed",
          },
          writeLease,
        );
      }
      await updateGlookoSyncState(
        (current) => ({
          ...current,
          lastBackgroundRunAt: Date.now(),
          lastBackgroundOutcome: "failed",
          lastBackgroundDetail: "Android background execution failed",
        }),
        writeLease,
      );
    } catch (auditError) {
      if (isLocalDataWriteSupersededError(auditError)) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    }
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

if (!TaskManager.isTaskDefined(GLOOKO_BACKGROUND_TASK)) {
  TaskManager.defineTask(GLOOKO_BACKGROUND_TASK, runGlookoBackgroundTask);
}

export async function updateGlookoBackgroundSyncRegistration(
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  const [state, reportState] = await Promise.all([
    loadGlookoSyncState(writeLease),
    loadGlookoReportSyncState(),
  ]);
  const available = await backgroundTaskSchedulerAvailable();
  const shouldRegister =
    available &&
    (glookoBackgroundSchedulingEnabled(state) ||
      glookoReportBackgroundSchedulingEnabled(reportState, state));
  const reconcile = () =>
    reconcileBackgroundTaskRegistration(GLOOKO_BACKGROUND_TASK, shouldRegister);
  return withLocalDataWriteLeaseTransaction(writeLease, reconcile);
}
