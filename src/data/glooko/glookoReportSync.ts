import { File } from 'expo-file-system';

import DaymarkGlookoExport, {
  GlookoExportResult,
} from '../../../modules/daymark-glooko-export';
import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';
import {
  GlookoReportAutomaticPlan,
  GlookoReportSyncState,
  planAutomaticGlookoReportSync,
} from './glookoReportSyncPolicy';
import {
  loadGlookoReportSyncState,
  saveGlookoReportSyncState,
  updateGlookoReportSyncState,
} from './glookoReportSyncState';
import {
  isBusyGlookoExportResult,
  stateAfterBusyGlookoAttempt,
} from './glookoSyncOutcome';
import { GlookoSingleFlight } from './glookoSingleFlight';
import { saveGlookoReport, StoredGlookoReport } from './glookoReportRepository';
import { glookoFailureBackoffMs } from './glookoSyncPolicy';
import {
  loadGlookoSyncState,
  updateGlookoSyncState,
} from './glookoSyncState';
import { clearSavedInsightReports } from '@/data/insights/insightReportRepository';
import { generateInsightReviewIfDue } from '@/data/insights/insightReviewGenerator';

export type GlookoReportSyncOrigin = 'manual' | 'app-open' | 'background';

export type GlookoReportSyncOutcome =
  | {
      status: 'success';
      origin: GlookoReportSyncOrigin;
      days: 7;
      report: StoredGlookoReport;
      inserted: boolean;
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    }
  | {
      status: 'skipped';
      origin: GlookoReportSyncOrigin;
      plan?: GlookoReportAutomaticPlan;
      reason?: 'busy';
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    }
  | {
      status: 'session-required' | 'cancelled' | 'failed';
      origin: GlookoReportSyncOrigin;
      days: 7;
      message: string;
      reason?: string;
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    };

const reportSingleFlight =
  new GlookoSingleFlight<GlookoReportSyncOutcome>();

async function readAndStoreReport(
  exported: Extract<GlookoExportResult, { status: 'downloaded' }>,
) {
  const file = new File(exported.uri);
  let bytes: Uint8Array | undefined;
  try {
    const extraction =
      await DaymarkGlookoExport.extractReportDataAsync(exported.uri);
    bytes = await file.bytes();
    return await saveGlookoReport(
      exported.fileName,
      bytes,
      extraction.text,
      extraction.pumpTrackIntervals,
    );
  } finally {
    bytes?.fill(0);
    try {
      if (file.exists) file.delete();
    } catch {
      // The native cache is private and old entries are cleaned automatically.
    }
  }
}

async function markFailure(
  previous: GlookoReportSyncState,
  startedAt: number,
  code: string,
  message: string,
) {
  const failures = previous.consecutiveFailures + 1;
  const next: GlookoReportSyncState = {
    ...previous,
    lastAttemptAt: startedAt,
    nextEligibleAt: startedAt + glookoFailureBackoffMs(failures),
    consecutiveFailures: failures,
    lastErrorCode: code.slice(0, 80),
    lastErrorMessage: message.slice(0, 240),
  };
  await saveGlookoReportSyncState(next);
  return next;
}

async function execute(
  origin: GlookoReportSyncOrigin,
): Promise<GlookoReportSyncOutcome> {
  const startedAt = Date.now();
  const previous = await loadGlookoReportSyncState();
  await saveGlookoReportSyncState({
    ...previous,
    lastAttemptAt: startedAt,
  });
  try {
    const exported =
      await DaymarkGlookoExport.startSilentReportExportAsync(7);
    if (exported.status !== 'downloaded') {
      if (isBusyGlookoExportResult(exported)) {
        const next = await updateGlookoReportSyncState((current) =>
          stateAfterBusyGlookoAttempt(previous, current, startedAt),
        );
        return {
          status: 'skipped',
          origin,
          reason: 'busy',
          syncState: next,
          diagnostic: exported.diagnostic,
        };
      }
      const sessionRequired = exported.status === 'session-required';
      const message =
        exported.message ??
        (sessionRequired
          ? 'Open T1 Arc and sign into Glooko again.'
          : 'Glooko did not provide a PDF report.');
      const next = await markFailure(
        previous,
        startedAt,
        sessionRequired
          ? 'session-required'
          : exported.reason ?? 'cancelled',
        message,
      );
      if (sessionRequired) {
        await updateGlookoSyncState((current) => ({
          ...current,
          sessionStatus: 'needs-sign-in',
          nextEligibleAt: undefined,
          lastErrorCode: 'session-required',
          lastErrorMessage: message,
        }));
        if (origin === 'background') {
          await DaymarkGlucoseDisplay.showGlookoSignInRequiredAsync().catch(
            () => false,
          );
        }
      }
      return {
        status: sessionRequired ? 'session-required' : 'cancelled',
        origin,
        days: 7,
        message,
        reason: exported.reason,
        syncState: next,
        diagnostic: exported.diagnostic,
      };
    }
    const saved = await readAndStoreReport(exported);
    const completedAt = Date.now();
    const next: GlookoReportSyncState = {
      ...previous,
      lastAttemptAt: startedAt,
      lastSuccessAt: completedAt,
      nextEligibleAt: completedAt + 24 * 60 * 60 * 1000,
      consecutiveFailures: 0,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      lastReportStart: saved.report.preview.reportStart,
      lastReportEnd: saved.report.preview.reportEnd,
      lastDailyModeCount:
        saved.report.preview.dailyModeSummaries.length,
      lastInserted: saved.inserted,
      lastDiagnostic: exported.diagnostic,
    };
    await saveGlookoReportSyncState(next);
    await clearSavedInsightReports();
    await generateInsightReviewIfDue(Date.now(), 0).catch(
      () => undefined,
    );
    return {
      status: 'success',
      origin,
      days: 7,
      report: saved.report,
      inserted: saved.inserted,
      syncState: next,
      diagnostic: exported.diagnostic,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The automatic Glooko report could not be refreshed.';
    const next = await markFailure(
      previous,
      startedAt,
      'unexpected',
      message,
    );
    return {
      status: 'failed',
      origin,
      days: 7,
      message,
      reason: 'unexpected',
      syncState: next,
    };
  }
}

export async function syncGlookoReportNow(
  origin: GlookoReportSyncOrigin = 'manual',
) {
  return reportSingleFlight.run(() => execute(origin));
}

export async function syncGlookoReportIfDue(
  origin: Exclude<GlookoReportSyncOrigin, 'manual'>,
) {
  return reportSingleFlight.run(async () => {
    const [reportState, glookoState] = await Promise.all([
      loadGlookoReportSyncState(),
      loadGlookoSyncState(),
    ]);
    const plan = planAutomaticGlookoReportSync(
      reportState,
      glookoState,
    );
    if (!plan.due) {
      return {
        status: 'skipped',
        origin,
        plan,
        syncState: reportState,
      } satisfies GlookoReportSyncOutcome;
    }
    return execute(origin);
  });
}
