import { File } from "expo-file-system";

import T1ArcGlookoExport, {
  GlookoExportResult,
} from "../../../modules/t1arc-glooko-export";
import T1ArcGlucoseDisplay from "../../../modules/t1arc-glucose-display";
import {
  glookoRangeDays,
  GLOOKO_MAX_EXPORT_DAYS,
  isDateKey,
} from "./glookoBackfill";
import {
  GLOOKO_INCREMENTAL_INTERVAL_MS,
  GlookoAutomaticPlan,
  GlookoSyncState,
  glookoFailureDisposition,
  glookoFailureBackoffMs,
  isGlookoAccountFingerprint,
  planAutomaticGlookoSync,
} from "./glookoSyncPolicy";
import {
  hasImportedGlookoData,
  loadGlookoSyncState,
  updateGlookoSyncState,
} from "./glookoSyncState";
import {
  automaticGlookoCgmTableHealthIssue,
  automaticGlookoInsulinTableHealthIssue,
} from "./glookoImportHealth";
import {
  isBusyGlookoExportResult,
  stateAfterBusyGlookoAttempt,
} from "./glookoSyncOutcome";
import {
  GlookoSingleFlight,
  GlookoSingleFlightLease,
} from "./glookoSingleFlight";
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from "@/data/import/glookoImport";
import { writeGlookoGlucoseHistory } from "@/data/import/glookoGlucoseImport";
import { ImportWriteResult } from "@/data/persistence/HealthRecordStore";
import { SqliteGlucoseHistoryStore } from "@/data/persistence/SqliteGlucoseHistoryStore";
import { SqliteHealthRecordStore } from "@/data/persistence/SqliteHealthRecordStore";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";
import { addDays, DateKey, toDateKey } from "@/domain/time";
import { isIanaTimeZone } from "@/domain/regionalProfile";

/**
 * A newly verified account gets the broadest export Glooko currently allows.
 * The archive may contain fewer days when the account has less history.
 */
export const GLOOKO_INITIAL_HISTORY_DAYS = GLOOKO_MAX_EXPORT_DAYS;

export type GlookoSyncOrigin = "manual" | "app-open" | "background";

export interface GlookoSyncSuccess {
  status: "success";
  origin: GlookoSyncOrigin;
  days: number;
  prepared: PreparedGlookoImport;
  result: ImportWriteResult;
  syncState: GlookoSyncState;
  diagnostic?: string;
}

export interface GlookoSyncSkipped {
  status: "skipped";
  origin: GlookoSyncOrigin;
  plan?: GlookoAutomaticPlan;
  reason?: "busy" | "superseded";
  syncState: GlookoSyncState;
  diagnostic?: string;
}

export interface GlookoSyncUnavailable {
  status: "session-required" | "cancelled" | "failed";
  origin: GlookoSyncOrigin;
  days: number;
  message: string;
  reason?: string;
  syncState: GlookoSyncState;
  diagnostic?: string;
}

export type GlookoSyncOutcome =
  GlookoSyncSuccess | GlookoSyncSkipped | GlookoSyncUnavailable;

const syncSingleFlight = new GlookoSingleFlight<GlookoSyncOutcome>();

class GlookoVerificationError extends Error {
  constructor(
    readonly code:
      | "unsupported-archive"
      | "rejected-archive-rows"
      | "unsafe-timestamp-locale"
      | "credential-generation-mismatch"
      | "account-identity-mismatch"
      | "missing-account-identity"
      | "insulin-table-missing"
      | "insulin-table-unreadable"
      | "insulin-table-rows-rejected"
      | "unbound-existing-data"
      | "unverified-credentials",
    message: string,
  ) {
    super(message);
    this.name = "GlookoVerificationError";
  }
}

class GlookoSyncSupersededError extends Error {
  constructor() {
    super("A newer Glooko credential generation replaced this refresh.");
    this.name = "GlookoSyncSupersededError";
  }
}

function ensureCurrentLease(lease: GlookoSingleFlightLease) {
  if (!lease.isCurrent()) throw new GlookoSyncSupersededError();
}

function isCredentialGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface GlookoAccountExportContract {
  region: "eu" | "us";
  timeZone: string;
}

async function assertDirectAccountBinding(
  accountFingerprint: string,
  lease: GlookoSingleFlightLease,
  allowInitialCredentialBinding: boolean,
  existingDataBindingApproved: boolean,
  writeLease: LocalDataWriteLease,
) {
  ensureCurrentLease(lease);
  const current = await loadGlookoSyncState(writeLease);
  ensureCurrentLease(lease);
  if (!isGlookoAccountFingerprint(accountFingerprint)) {
    throw new GlookoVerificationError(
      "missing-account-identity",
      "Glooko did not provide a protected account identity, so nothing was imported.",
    );
  }
  if (current.verifiedAccountFingerprint !== undefined) {
    if (current.verifiedAccountFingerprint !== accountFingerprint) {
      throw new GlookoVerificationError(
        "account-identity-mismatch",
        "This is a different Glooko account from the one that owns the imported data. Nothing was imported.",
      );
    }
    ensureCurrentLease(lease);
    return;
  }

  const hasExistingData = await hasImportedGlookoData();
  ensureCurrentLease(lease);
  if (!allowInitialCredentialBinding) {
    throw new GlookoVerificationError(
      hasExistingData ? "unbound-existing-data" : "unverified-credentials",
      hasExistingData
        ? "Existing Glooko data is not bound to a verified sign-in. Remove imported Glooko data, then verify the saved connection."
        : "Verify the saved Glooko connection before it can import data for the first time.",
    );
  }
  const bindingApproved =
    existingDataBindingApproved ||
    current.pendingExistingDataBinding === true;
  if (hasExistingData && !bindingApproved) {
    ensureCurrentLease(lease);
    throw new GlookoVerificationError(
      "unbound-existing-data",
      "Existing Glooko data is not bound to this verified sign-in. Remove imported Glooko data before connecting this account.",
    );
  }
  ensureCurrentLease(lease);
}

async function assertKnownAccountFingerprint(
  accountFingerprint: string,
  lease: GlookoSingleFlightLease,
  writeLease: LocalDataWriteLease,
) {
  ensureCurrentLease(lease);
  if (!isGlookoAccountFingerprint(accountFingerprint)) {
    throw new GlookoVerificationError(
      "missing-account-identity",
      "Glooko did not provide a protected account identity, so nothing was imported.",
    );
  }
  const current = await loadGlookoSyncState(writeLease);
  ensureCurrentLease(lease);
  if (
    current.verifiedAccountFingerprint !== undefined &&
    current.verifiedAccountFingerprint !== accountFingerprint
  ) {
    throw new GlookoVerificationError(
      "account-identity-mismatch",
      "This is a different Glooko account from the one that owns the imported data. Nothing was imported.",
    );
  }
}

async function supersededOutcome(
  origin: GlookoSyncOrigin,
  diagnostic?: string,
  writeLease?: LocalDataWriteLease,
): Promise<GlookoSyncSkipped> {
  return {
    status: "skipped",
    origin,
    reason: "superseded",
    syncState: await loadGlookoSyncState(writeLease),
    diagnostic,
  };
}

async function assertCredentialGeneration(
  exported: GlookoExportResult,
  lease: GlookoSingleFlightLease,
  expectedCredentialGeneration?: number,
) {
  ensureCurrentLease(lease);
  const exportedGeneration = exported.credentialGeneration;
  if (
    expectedCredentialGeneration !== undefined &&
    exportedGeneration !== expectedCredentialGeneration
  ) {
    throw new GlookoSyncSupersededError();
  }
  if (
    exported.status === "downloaded" &&
    !isCredentialGeneration(exportedGeneration)
  ) {
    throw new GlookoSyncSupersededError();
  }
  if (!isCredentialGeneration(exportedGeneration)) return undefined;

  const current = await T1ArcGlookoExport.getCredentialStatusAsync();
  ensureCurrentLease(lease);
  const downloadedContractInvalid =
    exported.status === "downloaded" &&
    (!isIanaTimeZone(exported.timeZone) ||
      exported.timeZone !== current.timeZone);
  if (
    current.credentialGeneration !== exportedGeneration ||
    (exported.status === "downloaded" &&
      (!current.configured ||
        (current.region !== "eu" && current.region !== "us") ||
        !isIanaTimeZone(current.timeZone ?? "") ||
        downloadedContractInvalid))
  ) {
    throw new GlookoSyncSupersededError();
  }
  const currentTimeZone = current.timeZone;
  if (
    !current.configured ||
    (current.region !== "eu" && current.region !== "us") ||
    typeof currentTimeZone !== "string" ||
    !isIanaTimeZone(currentTimeZone)
  ) {
    return undefined;
  }
  return {
    region: current.region,
    timeZone: currentTimeZone,
  };
}

function insertedRecords(result: ImportWriteResult) {
  return (
    result.insertedGlucose +
    result.insertedBasal +
    result.insertedBoluses +
    result.insertedContext +
    result.insertedDailyTotals
  );
}

function parsedRecords(prepared: PreparedGlookoImport) {
  return prepared.preview.recognisedFiles.reduce(
    (total, file) => total + file.records,
    0,
  );
}

function releasedPrepared(
  prepared: PreparedGlookoImport,
): PreparedGlookoImport {
  return {
    preview: prepared.preview,
    batch: prepared.batch,
  };
}

async function markFailure(
  now: number,
  code: string,
  message: string,
  sessionRequired: boolean,
  writeLease: LocalDataWriteLease,
) {
  return updateGlookoSyncState((current) => {
    const failures = current.consecutiveFailures + 1;
    const actionRequired =
      sessionRequired || glookoFailureDisposition(code) === "action-required";
    return {
      ...current,
      automaticEnabled: actionRequired ? false : current.automaticEnabled,
      sessionStatus: sessionRequired ? "needs-sign-in" : current.sessionStatus,
      lastAttemptAt: now,
      consecutiveFailures: failures,
      nextEligibleAt: actionRequired
        ? undefined
        : now + glookoFailureBackoffMs(failures),
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 240),
    };
  }, writeLease);
}

async function runFencedGlookoNotification(
  writeLease: LocalDataWriteLease,
  operation: () => Promise<boolean>,
) {
  try {
    return await withLocalDataWriteLeaseTransaction(writeLease, operation);
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) throw error;
    return false;
  }
}

async function readPreparedExport(
  exported: Extract<GlookoExportResult, { status: "downloaded" }>,
  account: GlookoAccountExportContract,
) {
  const cachedFile = new File(exported.uri);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await cachedFile.bytes();
    return await prepareGlookoImport(exported.fileName, bytes, Date.now(), {
      timeZone: account.timeZone,
      dateOrder: account.region === "us" ? "month-first" : "day-first",
    });
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    const released =
      typeof T1ArcGlookoExport.releaseDownloadAsync === "function"
        ? await T1ArcGlookoExport.releaseDownloadAsync(exported.uri).catch(
            () => false,
          )
        : false;
    try {
      if (!released && cachedFile.exists) cachedFile.delete();
    } catch {
      // The native connector may already have released its private cache file.
    }
  }
}

async function executeSync(
  origin: GlookoSyncOrigin,
  days: number,
  interactive: boolean,
  lease: GlookoSingleFlightLease,
  writeLease: LocalDataWriteLease,
  historicalRange?: { startDate: DateKey; endDate: DateKey },
  expectedCredentialGeneration?: number,
  allowInitialCredentialBinding = false,
  existingDataBindingApproved = false,
): Promise<GlookoSyncOutcome> {
  if (!lease.isCurrent())
    return supersededOutcome(origin, undefined, writeLease);
  const startedAt = Date.now();
  const previous = await loadGlookoSyncState(writeLease);
  if (!lease.isCurrent())
    return supersededOutcome(origin, undefined, writeLease);
  const requestedEndDate = historicalRange?.endDate ?? toDateKey(startedAt);
  const requestedStartDate =
    historicalRange?.startDate ?? addDays(requestedEndDate, -(days - 1));
  ensureCurrentLease(lease);
  await updateGlookoSyncState(
    (current) => ({
      ...current,
      lastAttemptAt: startedAt,
      lastRangeDays: days,
      ...(historicalRange
        ? {}
        : {
            lastRequestedStartDate: requestedStartDate,
            lastRequestedEndDate: requestedEndDate,
          }),
    }),
    writeLease,
  );
  let preparedToRelease: PreparedGlookoImport | undefined;
  let downloadedExport:
    Extract<GlookoExportResult, { status: "downloaded" }> | undefined;
  let credentialCommitToken: string | undefined;
  let downloadedAt: number | undefined;
  ensureCurrentLease(lease);

  try {
    const exported = historicalRange
      ? interactive
        ? await T1ArcGlookoExport.startRangeExportAsync(
            historicalRange.startDate,
            historicalRange.endDate,
          )
        : await T1ArcGlookoExport.startSilentRangeExportAsync(
            historicalRange.startDate,
            historicalRange.endDate,
          )
      : interactive
        ? await T1ArcGlookoExport.startExportAsync(days)
        : await T1ArcGlookoExport.startSilentExportAsync(days);
    if (exported.status === "downloaded") downloadedExport = exported;
    const accountContract = await assertCredentialGeneration(
      exported,
      lease,
      expectedCredentialGeneration,
    );
    if (exported.status !== "downloaded") {
      if (isBusyGlookoExportResult(exported)) {
        const next = await updateGlookoSyncState(
          (current) =>
            stateAfterBusyGlookoAttempt(previous, current, startedAt),
          writeLease,
        );
        return {
          status: "skipped",
          origin,
          reason: "busy",
          syncState: next,
          diagnostic: exported.diagnostic,
        };
      }
      const sessionRequired = exported.status === "session-required";
      const message =
        exported.message ??
        (sessionRequired
          ? "Open T1 Arc and sign into Glooko again."
          : "Glooko did not provide an export.");
      const next = await markFailure(
        startedAt,
        exported.reason ?? (sessionRequired ? "session-required" : "cancelled"),
        message,
        sessionRequired,
        writeLease,
      );
      if (sessionRequired && origin === "background") {
        await runFencedGlookoNotification(writeLease, () =>
          T1ArcGlucoseDisplay.showGlookoSignInRequiredAsync(),
        );
      }
      return {
        status: sessionRequired
          ? "session-required"
          : exported.status === "failed"
            ? "failed"
            : "cancelled",
        origin,
        days,
        message,
        reason: exported.reason,
        syncState: next,
        diagnostic: exported.diagnostic,
      };
    }
    if (!accountContract) {
      throw new GlookoSyncSupersededError();
    }

    // Reject a known different account immediately after native
    // authentication and before parsing or writing any personal records.
    await assertKnownAccountFingerprint(
      exported.accountFingerprint,
      lease,
      writeLease,
    );
    downloadedAt = Date.now();
    ensureCurrentLease(lease);
    await updateGlookoSyncState(
      (current) => ({
        ...current,
        lastDownloadedAt: downloadedAt,
      }),
      writeLease,
    );
    const prepared = await readPreparedExport(exported, accountContract);
    preparedToRelease = prepared;
    const parsedCount = parsedRecords(prepared);
    if (prepared.preview.unsafeTimestampLocale) {
      const dateOrder =
        accountContract.region === "us" ? "month/day/year" : "day/month/year";
      throw new GlookoVerificationError(
        "unsafe-timestamp-locale",
        `At least one Glooko CSV contains a timestamp T1 Arc cannot safely map using ${dateOrder} dates in the confirmed ${accountContract.timeZone} account timezone (a conflicting date order, skipped local time, or unresolved repeated hour). Nothing was imported.`,
      );
    }
    const insulinIssue = automaticGlookoInsulinTableHealthIssue(
      prepared.preview,
    );
    if (insulinIssue) {
      throw new GlookoVerificationError(
        insulinIssue.code,
        insulinIssue.message,
      );
    }
    const cgmIssue = automaticGlookoCgmTableHealthIssue(prepared.preview);
    if (cgmIssue) {
      throw new GlookoVerificationError(cgmIssue.code, cgmIssue.message);
    }
    if (prepared.preview.recognisedFiles.length === 0) {
      throw new GlookoVerificationError(
        "unsupported-archive",
        "The ZIP was valid, but it did not contain a supported Glooko CSV table. Automatic refresh remains off; use manual import to inspect the archive.",
      );
    }
    const rejectedRecognisedRows = prepared.preview.recognisedFiles.reduce(
      (total, file) => total + file.skippedRows,
      0,
    );
    if (parsedCount === 0 && rejectedRecognisedRows > 0) {
      throw new GlookoVerificationError(
        "rejected-archive-rows",
        "Glooko returned supported CSV headers, but every data row was rejected. Automatic refresh remains off because the date or data format may have changed.",
      );
    }
    const store = new SqliteHealthRecordStore();
    // Daily 30-day and weekly/manual 90-day archives are eligible for the
    // encrypted recovery cache. The repository bounds that cache by coverage,
    // count and total bytes. Hourly two-week snapshots are normalised only.
    const retainSource =
      interactive || days >= 30 || historicalRange !== undefined;
    // This native generation read is intentionally adjacent to the first
    // health-data write. A credential saved while the export or parsing was
    // in flight invalidates the old account before its archive can commit.
    const currentAccountContract = await assertCredentialGeneration(
      exported,
      lease,
      expectedCredentialGeneration,
    );
    if (
      !currentAccountContract ||
      currentAccountContract.region !== accountContract.region ||
      currentAccountContract.timeZone !== accountContract.timeZone
    ) {
      throw new GlookoSyncSupersededError();
    }
    await assertDirectAccountBinding(
      exported.accountFingerprint,
      lease,
      allowInitialCredentialBinding,
      existingDataBindingApproved,
      writeLease,
    );
    const commitLease = await T1ArcGlookoExport.beginCredentialCommitAsync(
      exported.credentialGeneration,
    );
    if (commitLease.acquired) {
      // Record ownership before any lease assertion can throw; otherwise an
      // invalidation in the native-await gap would leak the process gate.
      credentialCommitToken = commitLease.token;
    }
    ensureCurrentLease(lease);
    if (!commitLease.acquired) {
      throw new GlookoSyncSupersededError();
    }
    await updateGlookoSyncState(
      (current) => ({
        ...current,
        lastDownloadedAt: downloadedAt,
        verifiedAccountFingerprint: exported.accountFingerprint,
        pendingExistingDataBinding: undefined,
      }),
      writeLease,
    );
    ensureCurrentLease(lease);
    const healthResult = await store
      .withWriteLease(writeLease)
      .writeImport(
        prepared.batch,
        prepared.preview.basal,
        prepared.preview.boluses,
        prepared.preview.context,
        retainSource ? prepared.sourcePayload : undefined,
        prepared.preview.dailyInsulinTotals,
        prepared.preview.rawRecords,
      );
    await assertCredentialGeneration(
      exported,
      lease,
      expectedCredentialGeneration,
    );
    const insertedGlucose = await writeGlookoGlucoseHistory(
      new SqliteGlucoseHistoryStore().withWriteLease(writeLease),
      prepared.preview.glucose,
    );
    const result = {
      ...healthResult,
      insertedGlucose,
      duplicateCount:
        healthResult.duplicateCount +
        Math.max(0, prepared.preview.glucose.length - insertedGlucose),
    };
    const completedAt = Date.now();
    const insertedCount = insertedRecords(result);
    const sourceAdvanced =
      prepared.preview.dataThrough !== undefined &&
      (previous.dataThrough === undefined ||
        prepared.preview.dataThrough > previous.dataThrough);
    const recentDataChanged =
      !historicalRange && (sourceAdvanced || insertedCount > 0);
    const checkOutcome =
      parsedCount === 0
        ? ("empty-range" as const)
        : recentDataChanged
          ? ("new-data" as const)
          : ("no-new-data" as const);
    await assertCredentialGeneration(
      exported,
      lease,
      expectedCredentialGeneration,
    );
    const next = await updateGlookoSyncState(
      (current) => ({
        ...current,
        automaticEnabled: allowInitialCredentialBinding
          ? true
          : current.automaticEnabled,
        sessionStatus: "ready",
        verifiedAccountFingerprint: exported.accountFingerprint,
        pendingExistingDataBinding: undefined,
        lastAttemptAt: startedAt,
        lastCheckedAt: historicalRange ? current.lastCheckedAt : completedAt,
        lastDownloadedAt: downloadedAt ?? completedAt,
        lastDataChangedAt: recentDataChanged
          ? completedAt
          : current.lastDataChangedAt,
        lastSuccessAt: historicalRange ? current.lastSuccessAt : completedAt,
        lastAutomaticAt: interactive ? current.lastAutomaticAt : completedAt,
        lastFullSuccessAt:
          days >= 30 && !historicalRange
            ? completedAt
            : current.lastFullSuccessAt,
        lastExtendedSuccessAt:
          days >= 90 && !historicalRange
            ? completedAt
            : current.lastExtendedSuccessAt,
        dataThrough:
          prepared.preview.dataThrough === undefined
            ? current.dataThrough
            : current.dataThrough === undefined
              ? prepared.preview.dataThrough
              : Math.max(current.dataThrough, prepared.preview.dataThrough),
        nextEligibleAt: completedAt + GLOOKO_INCREMENTAL_INTERVAL_MS,
        consecutiveFailures: 0,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        lastRangeDays: days,
        lastInsertedRecords: insertedCount,
        lastParsedRecords: historicalRange
          ? current.lastParsedRecords
          : parsedCount,
        lastCheckOutcome: historicalRange
          ? current.lastCheckOutcome
          : checkOutcome,
        historyBackfillBeforeDate: historicalRange
          ? current.historyBackfillBeforeDate === undefined ||
            historicalRange.startDate < current.historyBackfillBeforeDate
            ? historicalRange.startDate
            : current.historyBackfillBeforeDate
          : current.historyBackfillBeforeDate,
        lastHistoryBackfillAt: historicalRange
          ? completedAt
          : current.lastHistoryBackfillAt,
      }),
      writeLease,
    );
    await runFencedGlookoNotification(writeLease, () =>
      T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync(),
    );
    return {
      status: "success",
      origin,
      days,
      prepared: releasedPrepared(prepared),
      result,
      syncState: next,
      diagnostic: exported.diagnostic,
    };
  } catch (error) {
    if (error instanceof GlookoSyncSupersededError) {
      return supersededOutcome(
        origin,
        downloadedExport?.diagnostic,
        writeLease,
      );
    }
    if (isLocalDataWriteSupersededError(error)) throw error;
    const message =
      error instanceof Error
        ? error.message
        : "Glooko could not be refreshed on this device.";
    const reason =
      error instanceof GlookoVerificationError ? error.code : "unexpected";
    const next = await markFailure(
      startedAt,
      reason,
      message,
      false,
      writeLease,
    );
    return {
      status: "failed",
      origin,
      days,
      message,
      reason,
      syncState: next,
    };
  } finally {
    if (credentialCommitToken) {
      await T1ArcGlookoExport.endCredentialCommitAsync(
        credentialCommitToken,
      ).catch(() => false);
    }
    preparedToRelease?.sourcePayload?.bytes.fill(0);
    if (downloadedExport) {
      try {
        const released =
          typeof T1ArcGlookoExport.releaseDownloadAsync === "function"
            ? await T1ArcGlookoExport.releaseDownloadAsync(
                downloadedExport.uri,
              ).catch(() => false)
            : false;
        const cachedFile = new File(downloadedExport.uri);
        if (!released && cachedFile.exists) cachedFile.delete();
      } catch {
        // The parser normally deletes this file; this also covers an export
        // superseded before parsing started.
      }
    }
  }
}

export async function syncGlookoManually(
  days = 90,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return syncSingleFlight.runInteractive((lease) =>
    executeSync("manual", days, true, lease, writeLease),
  );
}

/**
 * Runs the same saved-session, invisible export used by foreground and
 * background automation without waiting for the normal due-time policy.
 */
export async function syncGlookoSilentlyNow(
  days = 1,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  if (!Number.isInteger(days) || days < 1 || days > GLOOKO_MAX_EXPORT_DAYS) {
    throw new Error("A quiet Glooko refresh must contain 1 to 90 days.");
  }
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return syncSingleFlight.run((lease) =>
    executeSync("app-open", days, false, lease, writeLease),
  );
}

export interface GlookoCredentialChangeBarrier {
  ready: Promise<void>;
  release(): void;
}

function beginGlookoExclusiveChange(): GlookoCredentialChangeBarrier {
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
  const completion = syncSingleFlight.runFresh(async () => {
    markReady();
    await held;
    return supersededOutcome("app-open");
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

/**
 * Invalidates current work immediately, then holds the single-flight owner
 * after all older commit work has settled. The credential Activity must not
 * open until `ready`; keeping the barrier held prevents another refresh from
 * starting while the user edits or saves the account.
 */
export function beginGlookoCredentialChange(): GlookoCredentialChangeBarrier {
  return beginGlookoExclusiveChange();
}

/** Holds direct sync while imported rows are manually written or removed. */
export function beginGlookoDataChange(): GlookoCredentialChangeBarrier {
  return beginGlookoExclusiveChange();
}

/**
 * Reserves a new generation synchronously, before any state update can yield.
 * Verification therefore cannot join an export that authenticated before the
 * credential Activity saved the account represented by credentialGeneration.
 */
export function verifyGlookoCredentials(
  credentialGeneration: number,
  beforeSync: (writeLease: LocalDataWriteLease) => Promise<void>,
  days = GLOOKO_INITIAL_HISTORY_DAYS,
  existingDataBindingApproved = false,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  if (
    !isCredentialGeneration(credentialGeneration) ||
    credentialGeneration < 1
  ) {
    throw new Error("The saved Glooko credential generation is invalid.");
  }
  if (!Number.isInteger(days) || days < 1 || days > GLOOKO_MAX_EXPORT_DAYS) {
    throw new Error("A Glooko verification must contain 1 to 90 days.");
  }
  return syncSingleFlight.runFresh(async (lease) => {
    const writeLease =
      suppliedWriteLease ?? (await acquireLocalDataWriteLease());
    if (!lease.isCurrent()) {
      return supersededOutcome("app-open", undefined, writeLease);
    }
    await beforeSync(writeLease);
    if (!lease.isCurrent()) {
      return supersededOutcome("app-open", undefined, writeLease);
    }
    return executeSync(
      "app-open",
      days,
      false,
      lease,
      writeLease,
      undefined,
      credentialGeneration,
      true,
      existingDataBindingApproved,
    );
  });
}

export async function syncGlookoHistoryRange(
  startDate: DateKey,
  endDate: DateKey,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    throw new Error("Choose a valid Glooko history range.");
  }
  const days = glookoRangeDays(startDate, endDate);
  if (days < 1 || days > GLOOKO_MAX_EXPORT_DAYS) {
    throw new Error("A Glooko history range must contain 1 to 90 days.");
  }
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return syncSingleFlight.runInteractive((lease) =>
    executeSync("manual", days, true, lease, writeLease, {
      startDate,
      endDate,
    }),
  );
}

export async function syncGlookoIfDue(
  origin: Exclude<GlookoSyncOrigin, "manual">,
  suppliedWriteLease?: LocalDataWriteLease,
) {
  const writeLease = suppliedWriteLease ?? (await acquireLocalDataWriteLease());
  return syncSingleFlight.run(async (lease) => {
    const state = await loadGlookoSyncState(writeLease);
    const plan = planAutomaticGlookoSync(state);
    if (!plan.due) {
      return {
        status: "skipped",
        origin,
        plan,
        syncState: state,
      } satisfies GlookoSyncSkipped;
    }
    return executeSync(
      origin,
      plan.days,
      false,
      lease,
      writeLease,
      plan.reason === "history-backfill" ? plan.historicalRange : undefined,
    );
  });
}
