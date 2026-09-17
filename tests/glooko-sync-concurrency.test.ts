import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginGlookoCredentialChange,
  beginGlookoDataChange,
  GLOOKO_INITIAL_HISTORY_DAYS,
  syncGlookoIfDue,
  syncGlookoManually,
  syncGlookoSilentlyNow,
  verifyGlookoCredentials,
} from "@/data/glooko/glookoSync";
import {
  beginGlookoReportDataChange,
  syncGlookoReportIfDue,
  syncGlookoReportNow,
} from "@/data/glooko/glookoReportSync";
import { GlookoReportSyncState } from "@/data/glooko/glookoReportSyncPolicy";
import { GlookoSyncState } from "@/data/glooko/glookoSyncPolicy";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

const mocks = vi.hoisted(() => ({
  loadSyncState: vi.fn(),
  saveSyncState: vi.fn(),
  updateSyncState: vi.fn(),
  loadReportState: vi.fn(),
  saveReportState: vi.fn(),
  updateReportState: vi.fn(),
  startExport: vi.fn(),
  startSilentExport: vi.fn(),
  startRangeExport: vi.fn(),
  startSilentRangeExport: vi.fn(),
  startSilentReportExport: vi.fn(),
  getPendingSharedReport: vi.fn(),
  acknowledgeSharedReport: vi.fn(),
  releaseDownload: vi.fn(),
  credentialStatus: vi.fn(),
  beginCommit: vi.fn(),
  endCommit: vi.fn(),
  beginDataCommit: vi.fn(),
  endDataCommit: vi.fn(),
  extractReportData: vi.fn(),
  saveReport: vi.fn(),
  prepareImport: vi.fn(),
  writeImport: vi.fn(),
  writeGlucose: vi.fn(),
  hasImportedData: vi.fn(),
  acquireLocalWriteLease: vi.fn(),
  withLocalWriteTransaction: vi.fn(),
  showGlookoSignIn: vi.fn(),
  cancelGlookoSignIn: vi.fn(),
  clearInsights: vi.fn(),
  generateInsights: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    exists = true;
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
    delete() {
      this.exists = false;
    }
  },
  Directory: class {},
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: vi.fn(),
}));

vi.mock("../modules/t1arc-glooko-export", () => ({
  default: {
    startExportAsync: mocks.startExport,
    startSilentExportAsync: mocks.startSilentExport,
    startRangeExportAsync: mocks.startRangeExport,
    startSilentRangeExportAsync: mocks.startSilentRangeExport,
    startSilentReportExportAsync: mocks.startSilentReportExport,
    getPendingSharedReportAsync: mocks.getPendingSharedReport,
    acknowledgeSharedReportAsync: mocks.acknowledgeSharedReport,
    releaseDownloadAsync: mocks.releaseDownload,
    getCredentialStatusAsync: mocks.credentialStatus,
    beginCredentialCommitAsync: mocks.beginCommit,
    endCredentialCommitAsync: mocks.endCommit,
    beginDataCommitAsync: mocks.beginDataCommit,
    endDataCommitAsync: mocks.endDataCommit,
    extractReportDataAsync: mocks.extractReportData,
  },
}));

vi.mock("../modules/t1arc-glucose-display", () => ({
  default: {
    showGlookoSignInRequiredAsync: mocks.showGlookoSignIn,
    cancelGlookoSignInRequiredAsync: mocks.cancelGlookoSignIn,
  },
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLocalWriteLease,
  isLocalDataWriteSupersededError: (error: unknown) =>
    error instanceof Error && error.name === "LocalDataWriteSupersededError",
  withLocalDataWriteLeaseTransaction: mocks.withLocalWriteTransaction,
}));

vi.mock("@/data/glooko/glookoSyncState", () => ({
  hasImportedGlookoData: mocks.hasImportedData,
  loadGlookoSyncState: mocks.loadSyncState,
  saveGlookoSyncState: mocks.saveSyncState,
  updateGlookoSyncState: mocks.updateSyncState,
}));

vi.mock("@/data/glooko/glookoReportSyncState", () => ({
  loadGlookoReportSyncState: mocks.loadReportState,
  saveGlookoReportSyncState: mocks.saveReportState,
  updateGlookoReportSyncState: mocks.updateReportState,
}));

vi.mock("@/data/import/glookoImport", () => ({
  prepareGlookoImport: mocks.prepareImport,
}));

vi.mock("@/data/import/glookoGlucoseImport", () => ({
  writeGlookoGlucoseHistory: mocks.writeGlucose,
}));

vi.mock("@/data/persistence/SqliteGlucoseHistoryStore", () => ({
  SqliteGlucoseHistoryStore: class {
    withWriteLease() {
      return this;
    }
  },
}));

vi.mock("@/data/persistence/SqliteHealthRecordStore", () => ({
  SqliteHealthRecordStore: class {
    writeImport = mocks.writeImport;
    withWriteLease() {
      return this;
    }
  },
}));

vi.mock("@/data/glooko/glookoReportRepository", () => ({
  saveGlookoReport: mocks.saveReport,
}));

vi.mock("@/data/insights/insightReportRepository", () => ({
  clearSavedInsightReports: mocks.clearInsights,
}));

vi.mock("@/data/insights/insightReviewGenerator", () => ({
  generateInsightReviewIfDue: mocks.generateInsights,
}));

const ACCOUNT_A_FINGERPRINT = `af1_${"a".repeat(64)}`;
const ACCOUNT_B_FINGERPRINT = `af1_${"b".repeat(64)}`;
const READY_SYNC_STATE: GlookoSyncState = {
  automaticEnabled: true,
  sessionStatus: "ready",
  consecutiveFailures: 0,
  verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
};
const REPORT_STATE: GlookoReportSyncState = {
  consecutiveFailures: 0,
  inboxConfigured: true,
};
const WRITE_LEASE = { epoch: 7 };
const DIRECT_REPORT_TEXT = `Example
Diabetes: Type 1  Mon, 1 Jan 2024 - Sun, 7 Jan 2024 (7 days)
Daily Overview`;
const CANCELLED = {
  status: "cancelled" as const,
  reason: "cancelled" as const,
  message: "Test cancellation",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function localDataSupersededError() {
  const error = new Error(
    "This local-data operation was superseded by a privacy erase.",
  );
  error.name = "LocalDataWriteSupersededError";
  return error;
}

function useSyncState(initial: GlookoSyncState) {
  let current = { ...initial };
  mocks.loadSyncState.mockImplementation(async () => current);
  mocks.saveSyncState.mockImplementation(async (next: GlookoSyncState) => {
    current = next;
  });
  mocks.updateSyncState.mockImplementation(
    async (
      update:
        | Partial<GlookoSyncState>
        | ((state: GlookoSyncState) => GlookoSyncState),
    ) => {
      current =
        typeof update === "function"
          ? update(current)
          : { ...current, ...update };
      return current;
    },
  );
}

function healthyInsulinTables() {
  return [
    { name: "bolus_data_1.csv", kind: "bolus", records: 0, skippedRows: 0 },
    { name: "basal_data_1.csv", kind: "basal", records: 0, skippedRows: 0 },
    {
      name: "insulin_data_1.csv",
      kind: "daily-insulin",
      records: 0,
      skippedRows: 0,
    },
  ];
}

function validPrepared() {
  return {
    preview: {
      recognisedFiles: [
        { name: "cgm_data_1.csv", kind: "cgm", records: 1, skippedRows: 0 },
        ...healthyInsulinTables(),
      ],
      retainedFiles: [],
      unrecognisedFiles: [],
      basal: [],
      boluses: [],
      context: [],
      dailyInsulinTotals: [],
      rawRecords: [],
      glucose: [],
    },
    batch: {},
    sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
  };
}

function emptyHistoryPrepared() {
  return {
    preview: {
      recognisedFiles: [
        { name: "cgm_data_1.csv", kind: "cgm", records: 0, skippedRows: 0 },
        ...healthyInsulinTables(),
      ],
      retainedFiles: [],
      unrecognisedFiles: [],
      basal: [],
      boluses: [],
      context: [],
      dailyInsulinTotals: [],
      rawRecords: [],
      glucose: [],
    },
    batch: {},
    sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
  };
}

function historyBackfillState(): GlookoSyncState {
  const now = Date.now();
  return {
    ...READY_SYNC_STATE,
    lastCheckedAt: now,
    lastFullSuccessAt: now,
    lastExtendedSuccessAt: now,
    historyBackfillBeforeDate: "2026-07-01",
    historyBackfillTargetDate: "2026-01-01",
  };
}

describe("Glooko sync entry-point concurrency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
    mocks.acquireLocalWriteLease.mockResolvedValue(WRITE_LEASE);
    mocks.withLocalWriteTransaction.mockImplementation(
      async (_lease, operation) => operation(),
    );
    mocks.showGlookoSignIn.mockResolvedValue(true);
    mocks.cancelGlookoSignIn.mockResolvedValue(true);
    mocks.clearInsights.mockResolvedValue(undefined);
    mocks.generateInsights.mockResolvedValue(undefined);
    useSyncState(READY_SYNC_STATE);
    mocks.loadReportState.mockResolvedValue(REPORT_STATE);
    mocks.saveReportState.mockResolvedValue(undefined);
    mocks.updateReportState.mockResolvedValue(REPORT_STATE);
    mocks.startExport.mockResolvedValue(CANCELLED);
    mocks.startSilentExport.mockResolvedValue(CANCELLED);
    mocks.startRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentReportExport.mockResolvedValue(CANCELLED);
    mocks.getPendingSharedReport.mockResolvedValue(null);
    mocks.releaseDownload.mockResolvedValue(true);
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 1,
    });
    mocks.beginCommit.mockResolvedValue({
      acquired: true,
      token: "commit-token",
    });
    mocks.endCommit.mockResolvedValue(true);
    mocks.beginDataCommit.mockResolvedValue({
      acquired: true,
      token: "data-commit-token",
    });
    mocks.endDataCommit.mockResolvedValue(true);
    mocks.writeGlucose.mockResolvedValue(0);
    mocks.hasImportedData.mockResolvedValue(false);
    mocks.writeImport.mockResolvedValue({
      alreadyImported: false,
      insertedGlucose: 0,
      insertedBasal: 0,
      insertedBoluses: 0,
      insertedContext: 0,
      insertedDailyTotals: 0,
      duplicateCount: 0,
      sourcePayloadStored: false,
      batch: {},
    });
  });

  it.each([
    {
      label: "EU account with Tokyo presentation",
      accountRegion: "eu" as const,
      accountTimeZone: "Europe/London",
      profile: {
        ...DEFAULT_REGIONAL_PROFILE,
        region: "japan" as const,
        countryCode: "JP",
        languageTag: "ja-JP",
        analysisTimeZone: "Asia/Tokyo",
        followDeviceTimeZone: false,
        clinicalJurisdiction: "JP",
      },
      expected: {
        timeZone: "Europe/London",
        dateOrder: "day-first",
      },
    },
    {
      label: "US New York account with Tokyo presentation",
      accountRegion: "us" as const,
      accountTimeZone: "America/New_York",
      profile: {
        ...DEFAULT_REGIONAL_PROFILE,
        region: "japan" as const,
        countryCode: "JP",
        languageTag: "ja-JP",
        analysisTimeZone: "Asia/Tokyo",
        followDeviceTimeZone: false,
        clinicalJurisdiction: "JP",
      },
      expected: {
        timeZone: "America/New_York",
        dateOrder: "month-first",
      },
    },
  ])(
    "keeps Glooko date order bound to the saved account for $label",
    async ({ accountRegion, accountTimeZone, profile, expected }) => {
      setRuntimeRegionalProfile(profile);
      mocks.credentialStatus.mockResolvedValue({
        configured: true,
        region: accountRegion,
        timeZone: accountTimeZone,
        credentialGeneration: 1,
      });
      mocks.startSilentExport.mockResolvedValueOnce({
        status: "downloaded",
        uri: "file:///private/regional-account.zip",
        fileName: "regional-account.zip",
        byteLength: 3,
        credentialGeneration: 1,
        timeZone: accountTimeZone,
        accountFingerprint: ACCOUNT_A_FINGERPRINT,
      });
      mocks.prepareImport.mockResolvedValueOnce(validPrepared());

      await expect(syncGlookoSilentlyNow(1)).resolves.toMatchObject({
        status: "success",
      });
      expect(mocks.prepareImport).toHaveBeenCalledWith(
        "regional-account.zip",
        expect.any(Uint8Array),
        expect.any(Number),
        expected,
      );
    },
  );

  it("rejects an export whose account timezone no longer matches the credential vault", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/wrong-account-timezone.zip",
      fileName: "wrong-account-timezone.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Asia/Tokyo",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });

    await expect(syncGlookoSilentlyNow(1)).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
    expect(mocks.prepareImport).not.toHaveBeenCalled();
    expect(mocks.writeImport).not.toHaveBeenCalled();
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      "file:///private/wrong-account-timezone.zip",
    );
  });

  it("keeps a CSV due-check reservation while its state load is pending", async () => {
    const planning = deferred<GlookoSyncState>();
    mocks.loadSyncState
      .mockImplementationOnce(() => planning.promise)
      .mockResolvedValue(READY_SYNC_STATE);

    const due = syncGlookoIfDue("background");
    await Promise.resolve();
    const immediate = syncGlookoSilentlyNow(1);

    expect(mocks.startSilentExport).not.toHaveBeenCalled();
    planning.resolve(READY_SYNC_STATE);
    const [dueResult, immediateResult] = await Promise.all([due, immediate]);

    expect(immediateResult).toEqual(dueResult);
    expect(dueResult).toMatchObject({ origin: "background" });
    expect(mocks.startSilentExport).toHaveBeenCalledOnce();
  });

  it("waits one manual CSV run behind an active silent run", async () => {
    const nativeRun = deferred<typeof CANCELLED>();
    mocks.startSilentExport.mockImplementationOnce(() => nativeRun.promise);

    const silent = syncGlookoSilentlyNow(1);
    await vi.waitFor(() => {
      expect(mocks.startSilentExport).toHaveBeenCalledOnce();
    });
    const manual = syncGlookoManually(90);

    expect(mocks.startExport).not.toHaveBeenCalled();
    nativeRun.resolve(CANCELLED);
    await expect(silent).resolves.toMatchObject({ origin: "app-open" });
    await expect(manual).resolves.toMatchObject({ origin: "manual" });
    expect(mocks.startExport).toHaveBeenCalledOnce();
  });

  it("keeps a failed history cursor and retries the exact same range after backoff", async () => {
    useSyncState(historyBackfillState());
    mocks.startSilentRangeExport.mockResolvedValue({
      status: "failed",
      reason: "network",
      message: "Temporary connection failure",
    });

    const first = await syncGlookoIfDue("background");

    expect(first).toMatchObject({
      status: "failed",
      reason: "network",
      syncState: { historyBackfillBeforeDate: "2026-07-01" },
    });
    expect(mocks.startSilentRangeExport).toHaveBeenNthCalledWith(
      1,
      "2026-04-02",
      "2026-06-30",
    );

    await mocks.updateSyncState({ nextEligibleAt: Date.now() - 1 });
    const retry = await syncGlookoIfDue("background");

    expect(retry).toMatchObject({
      status: "failed",
      reason: "network",
      syncState: { historyBackfillBeforeDate: "2026-07-01" },
    });
    expect(mocks.startSilentRangeExport).toHaveBeenNthCalledWith(
      2,
      "2026-04-02",
      "2026-06-30",
    );
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it("advances an empty-but-successful history range without claiming recent data changed", async () => {
    useSyncState(historyBackfillState());
    mocks.startSilentRangeExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/empty-history.zip",
      fileName: "empty-history.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(emptyHistoryPrepared());

    const result = await syncGlookoIfDue("background");

    expect(result).toMatchObject({
      status: "success",
      days: 90,
      syncState: {
        historyBackfillBeforeDate: "2026-04-02",
        consecutiveFailures: 0,
      },
    });
    expect(result.syncState.lastHistoryBackfillAt).toEqual(expect.any(Number));
    expect(result.syncState.lastDataChangedAt).toBeUndefined();
    expect(mocks.writeImport).toHaveBeenCalledOnce();
    expect(mocks.startSilentRangeExport).toHaveBeenCalledWith(
      "2026-04-02",
      "2026-06-30",
    );
  });

  it("retries a partially written history range and accepts idempotent duplicate results before advancing", async () => {
    useSyncState(historyBackfillState());
    const downloaded = (uri: string) => ({
      status: "downloaded" as const,
      uri,
      fileName: "history.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.startSilentRangeExport
      .mockResolvedValueOnce(downloaded("file:///private/history-first.zip"))
      .mockResolvedValueOnce(downloaded("file:///private/history-retry.zip"));
    mocks.prepareImport
      .mockResolvedValueOnce(validPrepared())
      .mockResolvedValueOnce(validPrepared());
    mocks.writeImport
      .mockResolvedValueOnce({
        alreadyImported: false,
        insertedGlucose: 0,
        insertedBasal: 1,
        insertedBoluses: 0,
        insertedContext: 0,
        insertedDailyTotals: 0,
        duplicateCount: 0,
        sourcePayloadStored: true,
        batch: {},
      })
      .mockResolvedValueOnce({
        alreadyImported: true,
        insertedGlucose: 0,
        insertedBasal: 0,
        insertedBoluses: 0,
        insertedContext: 0,
        insertedDailyTotals: 0,
        duplicateCount: 1,
        sourcePayloadStored: false,
        batch: {},
      });
    mocks.writeGlucose
      .mockRejectedValueOnce(new Error("Injected glucose write failure"))
      .mockResolvedValueOnce(0);

    const interrupted = await syncGlookoIfDue("background");

    expect(interrupted).toMatchObject({
      status: "failed",
      reason: "unexpected",
      syncState: { historyBackfillBeforeDate: "2026-07-01" },
    });
    await mocks.updateSyncState({ nextEligibleAt: Date.now() - 1 });

    const retry = await syncGlookoIfDue("background");

    expect(retry).toMatchObject({
      status: "success",
      result: { alreadyImported: true, duplicateCount: 1 },
      syncState: { historyBackfillBeforeDate: "2026-04-02" },
    });
    expect(mocks.startSilentRangeExport.mock.calls).toEqual([
      ["2026-04-02", "2026-06-30"],
      ["2026-04-02", "2026-06-30"],
    ]);
    expect(mocks.writeImport).toHaveBeenCalledTimes(2);
  });

  it("holds credential setup until an older database commit has settled", async () => {
    const events: string[] = [];
    const importResult = {
      alreadyImported: false,
      insertedGlucose: 0,
      insertedBasal: 0,
      insertedBoluses: 0,
      insertedContext: 0,
      insertedDailyTotals: 0,
      duplicateCount: 0,
      sourcePayloadStored: false,
      batch: {},
    };
    const oldWrite = deferred<typeof importResult>();
    const prepared = () => ({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 0, skippedRows: 0 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
        basal: [],
        boluses: [],
        context: [],
        dailyInsulinTotals: [],
        rawRecords: [],
        glucose: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });
    mocks.startSilentExport
      .mockResolvedValueOnce({
        status: "downloaded",
        uri: "file:///private/account-a.zip",
        fileName: "account-a.zip",
        byteLength: 3,
        credentialGeneration: 1,
        timeZone: "Europe/London",
        accountFingerprint: ACCOUNT_A_FINGERPRINT,
      })
      .mockResolvedValueOnce({
        status: "downloaded",
        uri: "file:///private/account-b.zip",
        fileName: "account-b.zip",
        byteLength: 3,
        credentialGeneration: 2,
        timeZone: "Europe/London",
        accountFingerprint: ACCOUNT_B_FINGERPRINT,
      });
    mocks.prepareImport.mockImplementation(async () => prepared());
    mocks.writeImport
      .mockImplementationOnce(async () => {
        const result = await oldWrite.promise;
        events.push("account-a-commit-complete");
        return result;
      })
      .mockImplementationOnce(async () => {
        events.push("account-b-commit");
        return importResult;
      });

    const accountA = syncGlookoSilentlyNow(14);
    await vi.waitFor(() => expect(mocks.writeImport).toHaveBeenCalledOnce());

    const barrier = beginGlookoCredentialChange();
    let setupReady = false;
    void barrier.ready.then(() => {
      setupReady = true;
    });
    await Promise.resolve();
    expect(setupReady).toBe(false);

    oldWrite.resolve(importResult);
    await expect(accountA).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
    await barrier.ready;
    events.push("credential-save-boundary");

    // The reset/account-binding policy is covered separately; this test keeps
    // the store empty so it isolates the credential-setup ordering barrier.
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 2,
    });
    const accountB = verifyGlookoCredentials(2, async () => undefined);
    barrier.release();

    await expect(accountB).resolves.toMatchObject({ status: "success" });
    expect(GLOOKO_INITIAL_HISTORY_DAYS).toBe(90);
    expect(mocks.startSilentExport).toHaveBeenNthCalledWith(2, 90);
    expect(events).toEqual([
      "account-a-commit-complete",
      "credential-save-boundary",
      "account-b-commit",
    ]);
    expect(mocks.writeGlucose).toHaveBeenCalledOnce();
    expect(mocks.beginCommit).toHaveBeenCalledTimes(2);
    expect(mocks.endCommit).toHaveBeenCalledTimes(2);
  });

  it("holds a data reset behind older connector work and invalidates it", async () => {
    const oldExport = deferred<typeof CANCELLED>();
    mocks.startSilentExport.mockImplementationOnce(() => oldExport.promise);

    const oldRun = syncGlookoSilentlyNow(14);
    await vi.waitFor(() =>
      expect(mocks.startSilentExport).toHaveBeenCalledOnce(),
    );
    const resetBarrier = beginGlookoDataChange();
    let resetReady = false;
    void resetBarrier.ready.then(() => {
      resetReady = true;
    });
    await Promise.resolve();
    expect(resetReady).toBe(false);

    oldExport.resolve(CANCELLED);
    await expect(oldRun).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
    await resetBarrier.ready;
    expect(resetReady).toBe(true);
    resetBarrier.release();
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it("releases a native commit acquired in the lease-invalidation gap", async () => {
    const nativeCommit = deferred<{
      acquired: true;
      token: string;
    }>();
    mocks.beginCommit.mockImplementationOnce(() => nativeCommit.promise);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/account-a.zip",
      fileName: "account-a.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 1, skippedRows: 0 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
        basal: [],
        boluses: [],
        context: [],
        dailyInsulinTotals: [],
        rawRecords: [],
        glucose: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const oldRun = syncGlookoSilentlyNow(14);
    await vi.waitFor(() => expect(mocks.beginCommit).toHaveBeenCalledOnce());
    const resetBarrier = beginGlookoDataChange();
    nativeCommit.resolve({ acquired: true, token: "late-token" });

    await expect(oldRun).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
    await resetBarrier.ready;
    resetBarrier.release();
    expect(mocks.endCommit).toHaveBeenCalledWith("late-token");
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it("preserves a direct connector failure category in state and outcome", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "failed",
      reason: "invalid-zip",
      message: "Glooko did not return a complete ZIP export.",
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "invalid-zip",
      message: "Glooko did not return a complete ZIP export.",
      syncState: {
        automaticEnabled: true,
        lastErrorCode: "invalid-zip",
        sessionStatus: "ready",
        nextEligibleAt: expect.any(Number),
      },
    });
  });

  it("accepts a password-change generation when the protected account identity matches", async () => {
    useSyncState({
      ...READY_SYNC_STATE,
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      lastErrorCode: "session-required",
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/same-account-new-password.zip",
      fileName: "same-account-new-password.zip",
      byteLength: 3,
      credentialGeneration: 2,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(2, async () => undefined);

    expect(result).toMatchObject({
      status: "success",
      syncState: {
        automaticEnabled: true,
        sessionStatus: "ready",
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(mocks.beginCommit).toHaveBeenCalledWith(2);
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it("keeps imported data when forgotten credentials reconnect to the same account", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "needs-sign-in",
      consecutiveFailures: 1,
      verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      lastErrorCode: "session-required",
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 3,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/same-account-reconnected.zip",
      fileName: "same-account-reconnected.zip",
      byteLength: 3,
      credentialGeneration: 3,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(3, async () => undefined);

    expect(result).toMatchObject({
      status: "success",
      syncState: {
        automaticEnabled: true,
        sessionStatus: "ready",
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
        consecutiveFailures: 0,
      },
    });
    expect(mocks.beginCommit).toHaveBeenCalledWith(3);
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it("rejects a different account fingerprint before any account data is written", async () => {
    useSyncState({
      ...READY_SYNC_STATE,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/account-b.zip",
      fileName: "account-b.zip",
      byteLength: 3,
      credentialGeneration: 2,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_B_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 1, skippedRows: 0 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
        basal: [],
        boluses: [],
        context: [],
        dailyInsulinTotals: [],
        rawRecords: [],
        glucose: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "account-identity-mismatch",
      syncState: {
        automaticEnabled: false,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
        lastErrorCode: "account-identity-mismatch",
      },
    });
    expect(mocks.beginCommit).not.toHaveBeenCalled();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
    expect(mocks.writeImport).not.toHaveBeenCalled();
    expect(mocks.writeGlucose).not.toHaveBeenCalled();
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      "file:///private/account-b.zip",
    );
  });

  it("does not let an ordinary post-reset run create the first binding", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "ready",
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/post-reset.zip",
      fileName: "post-reset.zip",
      byteLength: 3,
      credentialGeneration: 2,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "unverified-credentials",
      syncState: {
        automaticEnabled: false,
        lastErrorCode: "unverified-credentials",
      },
    });
    expect(mocks.beginCommit).not.toHaveBeenCalled();
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it("allows the explicit verifier to create the first empty-store binding", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      region: "eu",
      timeZone: "Europe/London",
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/verified.zip",
      fileName: "verified.zip",
      byteLength: 3,
      credentialGeneration: 2,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(2, async () => undefined);

    expect(result).toMatchObject({
      status: "success",
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it("records same-generation legacy format confirmation as sign-in required", async () => {
    mocks.credentialStatus.mockResolvedValue({
      configured: false,
      credentialGeneration: 1,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "session-required",
      reason: "session-required",
      message: "Confirm the saved account format.",
      credentialGeneration: 1,
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "session-required",
      syncState: {
        automaticEnabled: false,
        sessionStatus: "needs-sign-in",
        lastErrorCode: "session-required",
      },
    });
  });

  it("treats an old-generation result after credential clear as superseded", async () => {
    mocks.credentialStatus.mockResolvedValue({
      configured: false,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "session-required",
      reason: "session-required",
      credentialGeneration: 1,
    });

    await expect(syncGlookoSilentlyNow(14)).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
  });

  it("does not adopt unbound existing data for newly entered credentials", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/new-account.zip",
      fileName: "new-account.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_B_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 1, skippedRows: 0 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
        basal: [],
        boluses: [],
        context: [],
        dailyInsulinTotals: [],
        rawRecords: [],
        glucose: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await verifyGlookoCredentials(1, async () => undefined);

    expect(result).toMatchObject({
      status: "failed",
      reason: "unbound-existing-data",
      syncState: {
        automaticEnabled: false,
        lastErrorCode: "unbound-existing-data",
      },
    });
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it("adopts unbound data only after existing-data binding approval", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/restored-account.zip",
      fileName: "restored-account.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 1, skippedRows: 0 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
        basal: [],
        boluses: [],
        context: [],
        dailyInsulinTotals: [],
        rawRecords: [],
        glucose: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await verifyGlookoCredentials(
      1,
      async () => undefined,
      14,
      true,
    );

    expect(result).toMatchObject({
      status: "success",
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it("uses a persisted binding approval when the first verification retry failed", async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 1,
      pendingExistingDataBinding: true,
      lastErrorCode: "network",
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/binding-retry.zip",
      fileName: "binding-retry.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(1, async () => undefined);

    expect(result).toMatchObject({
      status: "success",
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(result.syncState.pendingExistingDataBinding).toBeUndefined();
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it.each([
    "account-selection-required",
    "export-not-authorized",
    "account-code-not-found",
    "authentication-protocol-changed",
    "unsupported-region",
  ] as const)(
    "pauses a previously verified schedule for %s",
    async (reason) => {
      mocks.startSilentExport.mockResolvedValueOnce({
        status: "failed",
        reason,
        message: "This direct export requires attention.",
      });

      const result = await syncGlookoSilentlyNow(14);

      expect(result).toMatchObject({
        status: "failed",
        reason,
        syncState: {
          automaticEnabled: false,
          sessionStatus: "ready",
          lastErrorCode: reason,
        },
      });
      expect(result.syncState.nextEligibleAt).toBeUndefined();
    },
  );

  it("preserves a region mismatch as an actionable sign-in state", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "session-required",
      reason: "region-mismatch",
      message: "This Glooko account belongs to the other service region.",
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "session-required",
      reason: "region-mismatch",
      syncState: {
        lastErrorCode: "region-mismatch",
        sessionStatus: "needs-sign-in",
      },
    });
  });

  it("serializes the background sign-in notification with its privacy lease", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "session-required",
      reason: "expired-session",
      message: "Sign in again.",
    });

    await expect(
      syncGlookoIfDue("background", WRITE_LEASE),
    ).resolves.toMatchObject({ status: "session-required" });

    expect(mocks.withLocalWriteTransaction).toHaveBeenCalledWith(
      WRITE_LEASE,
      expect.any(Function),
    );
    expect(mocks.showGlookoSignIn).toHaveBeenCalledOnce();
    for (const call of mocks.updateSyncState.mock.calls) {
      expect(call[1]).toBe(WRITE_LEASE);
    }
  });

  it("does not show a stale sign-in notification after erase wins", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "session-required",
      reason: "expired-session",
      message: "Sign in again.",
    });
    mocks.withLocalWriteTransaction.mockRejectedValueOnce(
      localDataSupersededError(),
    );

    await expect(
      syncGlookoIfDue("background", WRITE_LEASE),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });
    expect(mocks.showGlookoSignIn).not.toHaveBeenCalled();
  });

  it("does not verify an automatic archive missing its required insulin tables", async () => {
    const pendingState: GlookoSyncState = {
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    };
    useSyncState(pendingState);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/glooko.zip",
      fileName: "glooko.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [],
        retainedFiles: [],
        unrecognisedFiles: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "insulin-table-missing",
      syncState: {
        automaticEnabled: false,
        sessionStatus: "pending-verification",
        lastErrorCode: "insulin-table-missing",
      },
    });
  });

  it("does not verify an archive when every supported data row is rejected", async () => {
    const pendingState: GlookoSyncState = {
      automaticEnabled: false,
      sessionStatus: "pending-verification",
      consecutiveFailures: 0,
    };
    useSyncState(pendingState);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/glooko.zip",
      fileName: "glooko.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: "cgm_data_1.csv", kind: "cgm", records: 0, skippedRows: 3 },
          ...healthyInsulinTables(),
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "rejected-archive-rows",
      syncState: {
        automaticEnabled: false,
        sessionStatus: "pending-verification",
        lastErrorCode: "rejected-archive-rows",
      },
    });
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      "file:///private/glooko.zip",
    );
  });

  it("rejects a mixed-locale archive before writing valid sibling rows", async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/glooko.zip",
      fileName: "glooko.zip",
      byteLength: 3,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        unsafeTimestampLocale: true,
        recognisedFiles: [
          { name: "bolus_uk.csv", kind: "bolus", records: 1, skippedRows: 0 },
          {
            name: "bolus_month_first.csv",
            kind: "bolus",
            records: 0,
            skippedRows: 1,
          },
        ],
        retainedFiles: [],
        unrecognisedFiles: [],
      },
      batch: {},
      sourcePayload: { bytes: new Uint8Array([1, 2, 3]) },
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: "failed",
      reason: "unsafe-timestamp-locale",
      syncState: {
        automaticEnabled: false,
        lastErrorCode: "unsafe-timestamp-locale",
      },
    });
    expect(result.syncState.nextEligibleAt).toBeUndefined();
    expect(mocks.writeImport).not.toHaveBeenCalled();
    expect(mocks.writeGlucose).not.toHaveBeenCalled();
  });

  it("downloads, account-binds, stores and releases a direct Daily Overview", async () => {
    mocks.startSilentReportExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/glooko-report.pdf",
      fileName: "glooko-daily-overview.pdf",
      byteLength: 128,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
      diagnostic: "Direct report downloaded.",
    });
    mocks.extractReportData.mockResolvedValueOnce({
      text: DIRECT_REPORT_TEXT,
      subjectFingerprint: `rs1_${"c".repeat(64)}`,
      pumpTrackIntervals: [
        {
          dateLabel: "01/JAN",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 1,
        },
      ],
    });
    mocks.saveReport.mockResolvedValueOnce({
      inserted: true,
      report: {
        id: "glooko-export:report:test",
        fileName: "glooko-daily-overview.pdf",
        importedAt: Date.parse("2024-01-08T12:00:00Z"),
        byteLength: 128,
        preview: {
          reportStart: Date.parse("2024-01-01T00:00:00Z"),
          reportEnd: Date.parse("2024-01-08T00:00:00Z"),
          dailyModeSummaries: [],
          pumpStateIntervals: [
            {
              kind: "activity-mode",
              start: Date.parse("2024-01-01T01:00:00Z"),
              end: Date.parse("2024-01-01T01:30:00Z"),
            },
          ],
          warnings: [],
        },
      },
    });

    const result = await syncGlookoReportNow("manual");

    expect(result).toMatchObject({
      status: "success",
      inserted: true,
      syncState: {
        lastReportSource: "direct",
        lastActivityCount: 1,
      },
    });
    expect(mocks.startSilentReportExport).toHaveBeenCalledWith(7);
    expect(mocks.beginCommit).toHaveBeenCalledWith(1);
    expect(mocks.saveReport).toHaveBeenCalledOnce();
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      "file:///private/glooko-report.pdf",
    );
  });

  it("rejects a direct report from a different verified Glooko account", async () => {
    mocks.startSilentReportExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/other-account.pdf",
      fileName: "glooko-daily-overview.pdf",
      byteLength: 128,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_B_FINGERPRINT,
    });

    const result = await syncGlookoReportNow("manual");

    expect(result).toMatchObject({
      status: "failed",
      reason: "account-identity-mismatch",
    });
    expect(mocks.extractReportData).not.toHaveBeenCalled();
    expect(mocks.saveReport).not.toHaveBeenCalled();
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      "file:///private/other-account.pdf",
    );
  });

  it("does not turn a privacy-rejected report repository write into failure metadata", async () => {
    mocks.startSilentReportExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/stale-report.pdf",
      fileName: "glooko-daily-overview.pdf",
      byteLength: 128,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.extractReportData.mockResolvedValueOnce({
      text: DIRECT_REPORT_TEXT,
      subjectFingerprint: `rs1_${"d".repeat(64)}`,
      pumpTrackIntervals: [
        {
          dateLabel: "01/JAN",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 1,
        },
      ],
    });
    mocks.saveReport.mockRejectedValueOnce(localDataSupersededError());

    await expect(
      syncGlookoReportNow("manual", WRITE_LEASE),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });

    expect(mocks.saveReport).toHaveBeenCalledWith(
      "glooko-daily-overview.pdf",
      expect.any(Uint8Array),
      DIRECT_REPORT_TEXT,
      expect.any(Array),
      expect.any(Number),
      `rs1_${"d".repeat(64)}`,
      WRITE_LEASE,
    );
    expect(mocks.saveReportState).toHaveBeenCalledTimes(1);
  });

  it("does not publish report success follow-ups when erase rejects final metadata", async () => {
    mocks.startSilentReportExport.mockResolvedValueOnce({
      status: "downloaded",
      uri: "file:///private/stale-metadata.pdf",
      fileName: "glooko-daily-overview.pdf",
      byteLength: 128,
      credentialGeneration: 1,
      timeZone: "Europe/London",
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.extractReportData.mockResolvedValueOnce({
      text: DIRECT_REPORT_TEXT,
      subjectFingerprint: `rs1_${"e".repeat(64)}`,
      pumpTrackIntervals: [
        {
          dateLabel: "01/JAN",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 1,
        },
      ],
    });
    mocks.saveReport.mockResolvedValueOnce({
      inserted: true,
      report: {
        id: "glooko-export:report:stale",
        fileName: "glooko-daily-overview.pdf",
        importedAt: Date.now(),
        byteLength: 128,
        preview: {
          reportStart: Date.parse("2024-01-01T00:00:00Z"),
          reportEnd: Date.parse("2024-01-08T00:00:00Z"),
          dailyModeSummaries: [],
          pumpStateIntervals: [],
          warnings: [],
        },
      },
    });
    mocks.saveReportState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(localDataSupersededError());

    await expect(
      syncGlookoReportNow("manual", WRITE_LEASE),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });

    expect(mocks.clearInsights).not.toHaveBeenCalled();
    expect(mocks.generateInsights).not.toHaveBeenCalled();
    expect(mocks.saveReportState).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge a shared-report URI after erase supersedes it", async () => {
    mocks.getPendingSharedReport.mockResolvedValueOnce({
      uri: "file:///private/shared-report.pdf",
      fileName: "shared-report.pdf",
      byteLength: 128,
    });
    mocks.extractReportData.mockResolvedValueOnce({
      text: DIRECT_REPORT_TEXT,
      subjectFingerprint: `rs1_${"f".repeat(64)}`,
      pumpTrackIntervals: [
        {
          dateLabel: "01/JAN",
          startMinute: 60,
          endMinute: 90,
          kind: "activity-mode",
          pageNumber: 1,
        },
      ],
    });
    mocks.saveReport.mockResolvedValueOnce({
      inserted: true,
      report: {
        id: "glooko-export:report:shared",
        fileName: "shared-report.pdf",
        importedAt: Date.now(),
        byteLength: 128,
        preview: {
          reportStart: Date.parse("2024-01-01T00:00:00Z"),
          reportEnd: Date.parse("2024-01-08T00:00:00Z"),
          dailyModeSummaries: [],
          pumpStateIntervals: [],
          warnings: [],
        },
      },
    });
    mocks.withLocalWriteTransaction.mockRejectedValueOnce(
      localDataSupersededError(),
    );

    await expect(
      syncGlookoReportIfDue("background", WRITE_LEASE),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });

    expect(mocks.acknowledgeSharedReport).not.toHaveBeenCalled();
    expect(mocks.saveReportState).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent automatic and manual direct-report checks", async () => {
    const planning = deferred<GlookoReportSyncState>();
    mocks.loadReportState
      .mockImplementationOnce(() => planning.promise)
      .mockResolvedValue(REPORT_STATE);

    const due = syncGlookoReportIfDue("background");
    await Promise.resolve();
    const immediate = syncGlookoReportNow("manual");

    await vi.waitFor(() =>
      expect(mocks.getPendingSharedReport).toHaveBeenCalledOnce(),
    );
    planning.resolve(REPORT_STATE);
    const [dueResult, immediateResult] = await Promise.all([due, immediate]);

    expect(immediateResult).toEqual(dueResult);
    expect(dueResult).toMatchObject({ origin: "background" });
    expect(mocks.startSilentReportExport).toHaveBeenCalledOnce();
    expect(mocks.startSilentReportExport).toHaveBeenCalledWith(7);
    expect(dueResult).toMatchObject({
      status: "cancelled",
      reason: "cancelled",
    });
  });

  it("holds ordinary deletion until active report work has fully settled", async () => {
    const nativeReport = deferred<typeof CANCELLED>();
    mocks.startSilentReportExport.mockImplementationOnce(
      () => nativeReport.promise,
    );

    const active = syncGlookoReportNow("manual", WRITE_LEASE);
    await vi.waitFor(() =>
      expect(mocks.startSilentReportExport).toHaveBeenCalledOnce(),
    );
    const barrier = beginGlookoReportDataChange();
    let ready = false;
    void barrier.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    nativeReport.resolve(CANCELLED);
    await barrier.ready;
    expect(ready).toBe(true);
    barrier.release();
    await expect(active).resolves.toMatchObject({ status: "cancelled" });
  });
});
