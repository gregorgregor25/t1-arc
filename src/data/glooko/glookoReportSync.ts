import { File } from "expo-file-system";

import T1ArcGlookoExport, {
  GlookoExportResult,
  GlookoSharedReport,
} from "../../../modules/t1arc-glooko-export";
import {
  GLOOKO_REPORT_MIN_INTERVAL_MS,
  GlookoReportAutomaticPlan,
  GlookoReportSyncState,
  planAutomaticGlookoReportSync,
} from "./glookoReportSyncPolicy";
import {
  loadGlookoReportSyncState,
  saveGlookoReportSyncState,
} from "./glookoReportSyncState";
import { GlookoSingleFlight } from "./glookoSingleFlight";
import { saveGlookoReport, StoredGlookoReport } from "./glookoReportRepository";
import {
  GlookoReportInboxCandidate,
  scanGlookoReportInbox,
} from "./glookoReportInbox";
import {
  glookoFailureBackoffMs,
  isGlookoAccountFingerprint,
  GlookoSyncState,
} from "./glookoSyncPolicy";
import { loadGlookoSyncState } from "./glookoSyncState";
import { parseGlookoReportText } from "./glookoReport";
import { clearSavedInsightReports } from "@/data/insights/insightReportRepository";
import { generateInsightReviewIfDue } from "@/data/insights/insightReviewGenerator";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";
import { addDays, toDateKey } from "@/domain/time";
import { isIanaTimeZone } from "@/domain/regionalProfile";

export type GlookoReportSyncOrigin = "manual" | "app-open" | "background";

export type GlookoReportSyncOutcome =
  | {
      status: "success";
      origin: GlookoReportSyncOrigin;
      days: 7;
      report: StoredGlookoReport;
      inserted: boolean;
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    }
  | {
      status: "skipped";
      origin: GlookoReportSyncOrigin;
      plan?: GlookoReportAutomaticPlan;
      reason?:
        "busy" | "not-configured" | "no-new-file" | "no-supported-report";
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    }
  | {
      status: "session-required" | "cancelled" | "failed";
      origin: GlookoReportSyncOrigin;
      days: 7;
      message: string;
      reason?: string;
      syncState: GlookoReportSyncState;
      diagnostic?: string;
    };

interface ReportCandidate {
  uri: string;
  fileName: string;
  byteLength: number;
  source: "direct" | "folder" | "shared";
}

type DownloadedGlookoReport = Extract<
  GlookoExportResult,
  { status: "downloaded" }
>;
type GlookoReportDownloadFailure = Exclude<
  GlookoExportResult,
  { status: "downloaded" }
>;

const reportSingleFlight = new GlookoSingleFlight<GlookoReportSyncOutcome>();

export interface GlookoReportDataChangeBarrier {
  ready: Promise<void>;
  release(): void;
}

class GlookoReportVerificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GlookoReportVerificationError";
  }
}

function directReportAvailable(state: GlookoSyncState) {
  return (
    state.automaticEnabled &&
    state.sessionStatus === "ready" &&
    isGlookoAccountFingerprint(state.verifiedAccountFingerprint)
  );
}

function credentialGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function assertDirectReportBinding(
  downloaded: DownloadedGlookoReport,
  writeLease: LocalDataWriteLease,
) {
  if (!isGlookoAccountFingerprint(downloaded.accountFingerprint)) {
    throw new GlookoReportVerificationError(
      "missing-account-identity",
      "Glooko did not provide a protected account identity for this report. Nothing was imported.",
    );
  }
  if (!credentialGeneration(downloaded.credentialGeneration)) {
    throw new GlookoReportVerificationError(
      "credentials-changed",
      "The saved Glooko sign-in changed while its report was downloading. Nothing was imported.",
    );
  }
  const [syncState, credentialStatus] = await Promise.all([
    loadGlookoSyncState(writeLease),
    T1ArcGlookoExport.getCredentialStatusAsync(),
  ]);
  if (
    !isGlookoAccountFingerprint(syncState.verifiedAccountFingerprint) ||
    syncState.verifiedAccountFingerprint !== downloaded.accountFingerprint
  ) {
    throw new GlookoReportVerificationError(
      "account-identity-mismatch",
      "This report came from a different Glooko account than the imported history. Nothing was imported.",
    );
  }
  if (
    !credentialStatus.configured ||
    credentialStatus.credentialGeneration !== downloaded.credentialGeneration ||
    !isIanaTimeZone(downloaded.timeZone) ||
    downloaded.timeZone !== credentialStatus.timeZone
  ) {
    throw new GlookoReportVerificationError(
      "credentials-changed",
      "The saved Glooko sign-in changed while its report was downloading. Nothing was imported.",
    );
  }
}

function assertSevenDayReport(
  text: string,
  pumpTrackIntervals: Parameters<typeof parseGlookoReportText>[1],
) {
  const preview = parseGlookoReportText(text, pumpTrackIntervals);
  if (preview.reportStart === undefined || preview.reportEnd === undefined) {
    throw new GlookoReportVerificationError(
      "unexpected-report-range",
      "The PDF does not state a readable Glooko report range. Nothing was imported.",
    );
  }
  const actualStart = toDateKey(preview.reportStart);
  const actualEnd = toDateKey(preview.reportEnd - 1);
  if (addDays(actualStart, 6) !== actualEnd) {
    throw new GlookoReportVerificationError(
      "unexpected-report-range",
      `The report covers ${actualStart} to ${actualEnd}. Choose a one-week Daily Overview so every day can be checked consistently.`,
    );
  }
  if (actualEnd > toDateKey(Date.now())) {
    throw new GlookoReportVerificationError(
      "unexpected-report-range",
      "The report ends in the future, so it was not imported.",
    );
  }
  if (
    preview.dailyModeSummaries.length === 0 &&
    preview.pumpStateIntervals.length === 0
  ) {
    throw new GlookoReportVerificationError(
      "report-content-missing",
      "The PDF does not contain readable Daily Overview pump-state data. Existing history was kept.",
    );
  }
}

async function readAndStoreReport(
  candidate: ReportCandidate,
  writeLease: LocalDataWriteLease,
) {
  const file = new File(candidate.uri);
  let bytes: Uint8Array | undefined;
  try {
    if (
      !file.exists ||
      candidate.byteLength < 5 ||
      candidate.byteLength > 25 * 1024 * 1024
    ) {
      throw new GlookoReportVerificationError(
        "report-content-missing",
        "The report is missing or outside the 25 MB safety limit.",
      );
    }
    bytes = await file.bytes();
    const extraction = await T1ArcGlookoExport.extractReportDataAsync(
      candidate.uri,
    );
    assertSevenDayReport(extraction.text, extraction.pumpTrackIntervals);
    return await saveGlookoReport(
      candidate.fileName,
      bytes,
      extraction.text,
      extraction.pumpTrackIntervals,
      Date.now(),
      extraction.subjectFingerprint,
      writeLease,
    );
  } finally {
    bytes?.fill(0);
  }
}

async function markFailure(
  previous: GlookoReportSyncState,
  startedAt: number,
  code: string,
  message: string,
  writeLease: LocalDataWriteLease,
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
  await saveGlookoReportSyncState(next, writeLease);
  return next;
}

async function markChecked(
  previous: GlookoReportSyncState,
  startedAt: number,
  snapshot: string | undefined,
  writeLease: LocalDataWriteLease,
  diagnostic = "The Glooko report sources were checked.",
) {
  const glookoState = await loadGlookoSyncState(writeLease);
  const next: GlookoReportSyncState = {
    ...previous,
    lastAttemptAt: startedAt,
    lastCheckedAt: Date.now(),
    nextEligibleAt: undefined,
    consecutiveFailures: 0,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    lastSourceDataThrough: glookoState.dataThrough,
    lastInboxSnapshot: snapshot ?? previous.lastInboxSnapshot,
    lastDiagnostic: diagnostic,
  };
  await saveGlookoReportSyncState(next, writeLease);
  return next;
}

async function pendingSharedReport(): Promise<GlookoSharedReport | null> {
  try {
    return await T1ArcGlookoExport.getPendingSharedReportAsync();
  } catch {
    return null;
  }
}

async function runFencedReportMutation<T>(
  writeLease: LocalDataWriteLease,
  operation: () => Promise<T>,
  fallback: T,
) {
  try {
    return await withLocalDataWriteLeaseTransaction(writeLease, operation);
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) throw error;
    return fallback;
  }
}

async function acknowledgeSharedReport(
  uri: string,
  writeLease: LocalDataWriteLease,
) {
  return runFencedReportMutation(
    writeLease,
    () => T1ArcGlookoExport.acknowledgeSharedReportAsync(uri),
    false,
  );
}

async function withDataCommit<T>(operation: () => Promise<T>) {
  const lease = await T1ArcGlookoExport.beginDataCommitAsync();
  if (!lease.acquired) return undefined;
  try {
    return await operation();
  } finally {
    await T1ArcGlookoExport.endDataCommitAsync(lease.token).catch(
      () => false,
    );
  }
}

async function withDirectReportCommit<T>(
  downloaded: DownloadedGlookoReport,
  writeLease: LocalDataWriteLease,
  operation: () => Promise<T>,
) {
  await assertDirectReportBinding(downloaded, writeLease);
  const lease = await T1ArcGlookoExport.beginCredentialCommitAsync(
    downloaded.credentialGeneration,
  );
  if (!lease.acquired) {
    throw new GlookoReportVerificationError(
      "credentials-changed",
      "The saved Glooko sign-in changed while its report was downloading. Nothing was imported.",
    );
  }
  try {
    await assertDirectReportBinding(downloaded, writeLease);
    return await operation();
  } finally {
    await T1ArcGlookoExport.endCredentialCommitAsync(lease.token).catch(
      () => false,
    );
  }
}

async function releaseDirectReport(
  downloaded: DownloadedGlookoReport | undefined,
  writeLease: LocalDataWriteLease,
) {
  if (!downloaded) return;
  await runFencedReportMutation(
    writeLease,
    async () => {
      const released = await T1ArcGlookoExport.releaseDownloadAsync(
        downloaded.uri,
      ).catch(() => false);
      if (!released) {
        const file = new File(downloaded.uri);
        if (file.exists) file.delete();
      }
      return released;
    },
    false,
  );
}

async function execute(
  origin: GlookoReportSyncOrigin,
  writeLease: LocalDataWriteLease,
  suppliedShared?: GlookoSharedReport | null,
): Promise<GlookoReportSyncOutcome> {
  const startedAt = Date.now();
  const previous = await loadGlookoReportSyncState();
  await saveGlookoReportSyncState(
    { ...previous, lastAttemptAt: startedAt },
    writeLease,
  );
  const shared =
    suppliedShared === undefined ? await pendingSharedReport() : suppliedShared;
  let sharedAcknowledged = false;
  let directDownloaded: DownloadedGlookoReport | undefined;
  let directFailure: GlookoReportDownloadFailure | undefined;
  let snapshot: string | undefined;
  try {
    let saved: Awaited<ReturnType<typeof readAndStoreReport>> | undefined;
    let importedSource: ReportCandidate["source"] | undefined;
    let lastCandidateError: unknown;

    if (shared) {
      try {
        saved = await withDataCommit(() =>
          readAndStoreReport({ ...shared, source: "shared" }, writeLease),
        );
        if (!saved) {
          return {
            status: "skipped",
            origin,
            reason: "busy",
            syncState: previous,
          };
        }
        importedSource = "shared";
        await acknowledgeSharedReport(shared.uri, writeLease);
        sharedAcknowledged = true;
      } catch (error) {
        if (isLocalDataWriteSupersededError(error)) throw error;
        await acknowledgeSharedReport(shared.uri, writeLease);
        sharedAcknowledged = true;
        throw error;
      }
    }

    const connectionState = await loadGlookoSyncState(writeLease);
    if (!saved && !shared && directReportAvailable(connectionState)) {
      const downloaded =
        await T1ArcGlookoExport.startSilentReportExportAsync(7);
      if (downloaded.status === "downloaded") {
        directDownloaded = downloaded;
        try {
          saved = await withDirectReportCommit(downloaded, writeLease, () =>
            readAndStoreReport({ ...downloaded, source: "direct" }, writeLease),
          );
          importedSource = "direct";
        } catch (error) {
          lastCandidateError = error;
        }
      } else {
        directFailure = downloaded;
      }
    }

    let inbox: Awaited<ReturnType<typeof scanGlookoReportInbox>> | undefined;
    if (!saved) {
      inbox = await scanGlookoReportInbox();
      snapshot = inbox.status === "ready" ? inbox.snapshot : undefined;
      const folderChanged =
        inbox.status === "ready" && snapshot !== previous.lastInboxSnapshot;
      const folderCandidates: ReportCandidate[] =
        inbox.status === "ready" && folderChanged
          ? inbox.candidates.map(
              (candidate: GlookoReportInboxCandidate): ReportCandidate => ({
                ...candidate,
                source: "folder",
              }),
            )
          : [];
      for (const candidate of folderCandidates) {
        try {
          saved = await withDataCommit(() =>
            readAndStoreReport(candidate, writeLease),
          );
          if (!saved) {
            return {
              status: "skipped",
              origin,
              reason: "busy",
              syncState: previous,
            };
          }
          importedSource = "folder";
          break;
        } catch (error) {
          lastCandidateError = error;
          // A fallback folder can contain unrelated PDFs. Continue until a
          // validated one-week Glooko Daily Overview is found.
        }
      }
    }

    if (!saved || !importedSource) {
      if (directDownloaded && lastCandidateError) throw lastCandidateError;
      if (directFailure) {
        if (
          directFailure.status === "cancelled" &&
          directFailure.reason === "busy"
        ) {
          return {
            status: "skipped",
            origin,
            reason: "busy",
            syncState: previous,
            diagnostic: directFailure.diagnostic,
          };
        }
        const message =
          directFailure.message ??
          "Glooko did not provide its seven-day Daily Overview.";
        const reason = directFailure.reason ?? "unexpected";
        const next = await markFailure(
          previous,
          startedAt,
          reason,
          message,
          writeLease,
        );
        return {
          status:
            directFailure.status === "session-required"
              ? "session-required"
              : directFailure.status === "cancelled"
                ? "cancelled"
                : "failed",
          origin,
          days: 7,
          message,
          reason,
          syncState: next,
          diagnostic: directFailure.diagnostic,
        };
      }
      if (inbox?.status === "unavailable") {
        throw new GlookoReportVerificationError(
          "folder-unavailable",
          inbox.message,
        );
      }
      const next = await markChecked(
        previous,
        startedAt,
        snapshot,
        writeLease,
        "No new validated Daily Overview was available from the report fallbacks.",
      );
      const unchanged =
        inbox?.status === "ready" && snapshot === previous.lastInboxSnapshot;
      return {
        status: "skipped",
        origin,
        reason:
          inbox?.status === "not-configured"
            ? "not-configured"
            : unchanged
              ? "no-new-file"
              : "no-supported-report",
        syncState: next,
        diagnostic:
          lastCandidateError instanceof Error
            ? lastCandidateError.message
            : undefined,
      };
    }

    const completedAt = Date.now();
    const activityCount = saved.report.preview.pumpStateIntervals.filter(
      (interval) => interval.kind === "activity-mode",
    ).length;
    const pauseCount = saved.report.preview.pumpStateIntervals.filter(
      (interval) => interval.kind === "automated-pause",
    ).length;
    const glookoState = await loadGlookoSyncState(writeLease);
    const next: GlookoReportSyncState = {
      ...previous,
      lastAttemptAt: startedAt,
      lastCheckedAt: completedAt,
      lastSuccessAt: completedAt,
      nextEligibleAt: completedAt + GLOOKO_REPORT_MIN_INTERVAL_MS,
      consecutiveFailures: 0,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      lastReportStart: saved.report.preview.reportStart,
      lastReportEnd: saved.report.preview.reportEnd,
      lastDailyModeCount: saved.report.preview.dailyModeSummaries.length,
      lastActivityCount: activityCount,
      lastPauseCount: pauseCount,
      lastSourceDataThrough: glookoState.dataThrough,
      lastInserted: saved.inserted,
      lastInboxSnapshot: snapshot ?? previous.lastInboxSnapshot,
      lastReportSource: importedSource,
      lastDiagnostic:
        importedSource === "direct"
          ? "A seven-day Daily Overview was downloaded from the signed-in Glooko account, validated and indexed."
          : importedSource === "shared"
            ? "A PDF shared through Android was validated and indexed."
            : "A new PDF in the approved Android folder was validated and indexed.",
    };
    await saveGlookoReportSyncState(next, writeLease);
    await clearSavedInsightReports(writeLease);
    try {
      await generateInsightReviewIfDue(Date.now(), 0, writeLease);
    } catch (error) {
      if (isLocalDataWriteSupersededError(error)) throw error;
    }
    return {
      status: "success",
      origin,
      days: 7,
      report: saved.report,
      inserted: saved.inserted,
      syncState: next,
      diagnostic: next.lastDiagnostic,
    };
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) throw error;
    if (shared && !sharedAcknowledged) {
      await acknowledgeSharedReport(shared.uri, writeLease);
    }
    const message =
      error instanceof Error
        ? error.message
        : "The Glooko report inbox could not be checked.";
    const next = await markFailure(
      previous,
      startedAt,
      error instanceof GlookoReportVerificationError
        ? error.code
        : "unexpected",
      message,
      writeLease,
    );
    return {
      status: "failed",
      origin,
      days: 7,
      message,
      reason:
        error instanceof GlookoReportVerificationError
          ? error.code
          : "unexpected",
      syncState: next,
    };
  } finally {
    await releaseDirectReport(directDownloaded, writeLease);
  }
}

export async function syncGlookoReportNow(
  origin: GlookoReportSyncOrigin = "manual",
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return reportSingleFlight.run(() => execute(origin, writeLease));
}

export async function syncGlookoReportIfDue(
  origin: Exclude<GlookoReportSyncOrigin, "manual">,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return reportSingleFlight.run(async () => {
    const shared = await pendingSharedReport();
    if (shared) return execute(origin, writeLease, shared);

    const [reportState, glookoState] = await Promise.all([
      loadGlookoReportSyncState(),
      loadGlookoSyncState(writeLease),
    ]);
    const plan = planAutomaticGlookoReportSync(reportState, glookoState);
    if (!plan.due) {
      return {
        status: "skipped",
        origin,
        plan,
        syncState: reportState,
      } satisfies GlookoReportSyncOutcome;
    }
    return execute(origin, writeLease, null);
  });
}

/**
 * Invalidates current report work, waits for its native/data cleanup to
 * settle, then prevents a newer report run from starting during deletion.
 */
export function beginGlookoReportDataChange(): GlookoReportDataChangeBarrier {
  let markReady!: () => void;
  let rejectReady!: (reason?: unknown) => void;
  let releaseGate!: () => void;
  let released = false;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });
  const held = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const completion = reportSingleFlight.runFresh(async () => {
    markReady();
    await held;
    return {
      status: "skipped",
      origin: "app-open",
      reason: "busy",
      syncState: await loadGlookoReportSyncState(),
    } satisfies GlookoReportSyncOutcome;
  });
  void completion.catch(rejectReady);
  return {
    ready,
    release() {
      if (released) return;
      released = true;
      releaseGate();
    },
  };
}
