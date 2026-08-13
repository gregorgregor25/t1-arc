import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  releaseDownload: vi.fn(),
  credentialStatus: vi.fn(),
  beginCommit: vi.fn(),
  endCommit: vi.fn(),
  prepareImport: vi.fn(),
  writeImport: vi.fn(),
  writeGlucose: vi.fn(),
  hasImportedData: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    async bytes() {
      return new Uint8Array([1, 2, 3]);
    }
    delete() {
      this.exists = false;
    }
  },
}));

vi.mock('../modules/daymark-glooko-export', () => ({
  default: {
    startExportAsync: mocks.startExport,
    startSilentExportAsync: mocks.startSilentExport,
    startRangeExportAsync: mocks.startRangeExport,
    startSilentRangeExportAsync: mocks.startSilentRangeExport,
    startSilentReportExportAsync: mocks.startSilentReportExport,
    releaseDownloadAsync: mocks.releaseDownload,
    getCredentialStatusAsync: mocks.credentialStatus,
    beginCredentialCommitAsync: mocks.beginCommit,
    endCredentialCommitAsync: mocks.endCommit,
    extractReportDataAsync: vi.fn(),
  },
}));

vi.mock('../modules/daymark-glucose-display', () => ({
  default: {
    showGlookoSignInRequiredAsync: vi.fn(async () => false),
    cancelGlookoSignInRequiredAsync: vi.fn(async () => false),
  },
}));

vi.mock('@/data/glooko/glookoSyncState', () => ({
  hasImportedGlookoData: mocks.hasImportedData,
  loadGlookoSyncState: mocks.loadSyncState,
  saveGlookoSyncState: mocks.saveSyncState,
  updateGlookoSyncState: mocks.updateSyncState,
}));

vi.mock('@/data/glooko/glookoReportSyncState', () => ({
  loadGlookoReportSyncState: mocks.loadReportState,
  saveGlookoReportSyncState: mocks.saveReportState,
  updateGlookoReportSyncState: mocks.updateReportState,
}));

vi.mock('@/data/import/glookoImport', () => ({
  prepareGlookoImport: mocks.prepareImport,
}));

vi.mock('@/data/import/glookoGlucoseImport', () => ({
  writeGlookoGlucoseHistory: mocks.writeGlucose,
}));

vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {},
}));

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {
    writeImport = mocks.writeImport;
  },
}));

vi.mock('@/data/glooko/glookoReportRepository', () => ({
  saveGlookoReport: vi.fn(),
}));

vi.mock('@/data/insights/insightReportRepository', () => ({
  clearSavedInsightReports: vi.fn(),
}));

vi.mock('@/data/insights/insightReviewGenerator', () => ({
  generateInsightReviewIfDue: vi.fn(),
}));

import {
  beginGlookoCredentialChange,
  beginGlookoDataChange,
  syncGlookoIfDue,
  syncGlookoManually,
  syncGlookoSilentlyNow,
  verifyGlookoCredentials,
} from '@/data/glooko/glookoSync';
import {
  syncGlookoReportIfDue,
  syncGlookoReportNow,
} from '@/data/glooko/glookoReportSync';
import { GlookoReportSyncState } from '@/data/glooko/glookoReportSyncPolicy';
import { GlookoSyncState } from '@/data/glooko/glookoSyncPolicy';

const ACCOUNT_A_FINGERPRINT = `af1_${'a'.repeat(64)}`;
const ACCOUNT_B_FINGERPRINT = `af1_${'b'.repeat(64)}`;
const READY_SYNC_STATE: GlookoSyncState = {
  automaticEnabled: true,
  sessionStatus: 'ready',
  consecutiveFailures: 0,
  verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
};
const REPORT_STATE: GlookoReportSyncState = {
  consecutiveFailures: 0,
};
const CANCELLED = {
  status: 'cancelled' as const,
  reason: 'cancelled' as const,
  message: 'Test cancellation',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
        typeof update === 'function'
          ? update(current)
          : { ...current, ...update };
      return current;
    },
  );
}

function healthyInsulinTables() {
  return [
    { name: 'bolus_data_1.csv', kind: 'bolus', records: 0, skippedRows: 0 },
    { name: 'basal_data_1.csv', kind: 'basal', records: 0, skippedRows: 0 },
    {
      name: 'insulin_data_1.csv',
      kind: 'daily-insulin',
      records: 0,
      skippedRows: 0,
    },
  ];
}

function validPrepared() {
  return {
    preview: {
      recognisedFiles: [
        { name: 'cgm_data_1.csv', kind: 'cgm', records: 1, skippedRows: 0 },
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

describe('Glooko sync entry-point concurrency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSyncState(READY_SYNC_STATE);
    mocks.loadReportState.mockResolvedValue(REPORT_STATE);
    mocks.saveReportState.mockResolvedValue(undefined);
    mocks.updateReportState.mockResolvedValue(REPORT_STATE);
    mocks.startExport.mockResolvedValue(CANCELLED);
    mocks.startSilentExport.mockResolvedValue(CANCELLED);
    mocks.startRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentReportExport.mockResolvedValue(CANCELLED);
    mocks.releaseDownload.mockResolvedValue(true);
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 1,
    });
    mocks.beginCommit.mockResolvedValue({
      acquired: true,
      token: 'commit-token',
    });
    mocks.endCommit.mockResolvedValue(true);
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

  it('keeps a CSV due-check reservation while its state load is pending', async () => {
    const planning = deferred<GlookoSyncState>();
    mocks.loadSyncState
      .mockImplementationOnce(() => planning.promise)
      .mockResolvedValue(READY_SYNC_STATE);

    const due = syncGlookoIfDue('background');
    await Promise.resolve();
    const immediate = syncGlookoSilentlyNow(1);

    expect(mocks.startSilentExport).not.toHaveBeenCalled();
    planning.resolve(READY_SYNC_STATE);
    const [dueResult, immediateResult] = await Promise.all([due, immediate]);

    expect(immediateResult).toEqual(dueResult);
    expect(dueResult).toMatchObject({ origin: 'background' });
    expect(mocks.startSilentExport).toHaveBeenCalledOnce();
  });

  it('waits one manual CSV run behind an active silent run', async () => {
    const nativeRun = deferred<typeof CANCELLED>();
    mocks.startSilentExport.mockImplementationOnce(() => nativeRun.promise);

    const silent = syncGlookoSilentlyNow(1);
    await vi.waitFor(() => {
      expect(mocks.startSilentExport).toHaveBeenCalledOnce();
    });
    const manual = syncGlookoManually(90);

    expect(mocks.startExport).not.toHaveBeenCalled();
    nativeRun.resolve(CANCELLED);
    await expect(silent).resolves.toMatchObject({ origin: 'app-open' });
    await expect(manual).resolves.toMatchObject({ origin: 'manual' });
    expect(mocks.startExport).toHaveBeenCalledOnce();
  });

  it('holds credential setup until an older database commit has settled', async () => {
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
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 0, skippedRows: 0 },
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
        status: 'downloaded',
        uri: 'file:///private/account-a.zip',
        fileName: 'account-a.zip',
        byteLength: 3,
        credentialGeneration: 1,
        accountFingerprint: ACCOUNT_A_FINGERPRINT,
      })
      .mockResolvedValueOnce({
        status: 'downloaded',
        uri: 'file:///private/account-b.zip',
        fileName: 'account-b.zip',
        byteLength: 3,
        credentialGeneration: 2,
        accountFingerprint: ACCOUNT_B_FINGERPRINT,
      });
    mocks.prepareImport.mockImplementation(async () => prepared());
    mocks.writeImport
      .mockImplementationOnce(async () => {
        const result = await oldWrite.promise;
        events.push('account-a-commit-complete');
        return result;
      })
      .mockImplementationOnce(async () => {
        events.push('account-b-commit');
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
      status: 'skipped',
      reason: 'superseded',
    });
    await barrier.ready;
    events.push('credential-save-boundary');

    // The reset/account-binding policy is covered separately; this test keeps
    // the store empty so it isolates the credential-setup ordering barrier.
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 2,
    });
    const accountB = verifyGlookoCredentials(2, async () => undefined);
    barrier.release();

    await expect(accountB).resolves.toMatchObject({ status: 'success' });
    expect(events).toEqual([
      'account-a-commit-complete',
      'credential-save-boundary',
      'account-b-commit',
    ]);
    expect(mocks.writeGlucose).toHaveBeenCalledOnce();
    expect(mocks.beginCommit).toHaveBeenCalledTimes(2);
    expect(mocks.endCommit).toHaveBeenCalledTimes(2);
  });

  it('holds a data reset behind older connector work and invalidates it', async () => {
    const oldExport = deferred<typeof CANCELLED>();
    mocks.startSilentExport.mockImplementationOnce(() => oldExport.promise);

    const oldRun = syncGlookoSilentlyNow(14);
    await vi.waitFor(() => expect(mocks.startSilentExport).toHaveBeenCalledOnce());
    const resetBarrier = beginGlookoDataChange();
    let resetReady = false;
    void resetBarrier.ready.then(() => {
      resetReady = true;
    });
    await Promise.resolve();
    expect(resetReady).toBe(false);

    oldExport.resolve(CANCELLED);
    await expect(oldRun).resolves.toMatchObject({
      status: 'skipped',
      reason: 'superseded',
    });
    await resetBarrier.ready;
    expect(resetReady).toBe(true);
    resetBarrier.release();
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it('releases a native commit acquired in the lease-invalidation gap', async () => {
    const nativeCommit = deferred<{
      acquired: true;
      token: string;
    }>();
    mocks.beginCommit.mockImplementationOnce(() => nativeCommit.promise);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/account-a.zip',
      fileName: 'account-a.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 1, skippedRows: 0 },
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
    nativeCommit.resolve({ acquired: true, token: 'late-token' });

    await expect(oldRun).resolves.toMatchObject({
      status: 'skipped',
      reason: 'superseded',
    });
    await resetBarrier.ready;
    resetBarrier.release();
    expect(mocks.endCommit).toHaveBeenCalledWith('late-token');
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it('preserves a direct connector failure category in state and outcome', async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'failed',
      reason: 'invalid-zip',
      message: 'Glooko did not return a complete ZIP export.',
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'invalid-zip',
      message: 'Glooko did not return a complete ZIP export.',
      syncState: {
        automaticEnabled: true,
        lastErrorCode: 'invalid-zip',
        sessionStatus: 'ready',
        nextEligibleAt: expect.any(Number),
      },
    });
  });

  it('accepts a password-change generation when the protected account identity matches', async () => {
    useSyncState({
      ...READY_SYNC_STATE,
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      lastErrorCode: 'session-required',
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/same-account-new-password.zip',
      fileName: 'same-account-new-password.zip',
      byteLength: 3,
      credentialGeneration: 2,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(
      2,
      async () => undefined,
    );

    expect(result).toMatchObject({
      status: 'success',
      syncState: {
        automaticEnabled: true,
        sessionStatus: 'ready',
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(result.syncState.verifiedCredentialGeneration).toBeUndefined();
    expect(mocks.beginCommit).toHaveBeenCalledWith(2);
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it('keeps imported data when forgotten credentials reconnect to the same account', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'needs-sign-in',
      consecutiveFailures: 1,
      verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      lastErrorCode: 'session-required',
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 3,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/same-account-reconnected.zip',
      fileName: 'same-account-reconnected.zip',
      byteLength: 3,
      credentialGeneration: 3,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(
      3,
      async () => undefined,
    );

    expect(result).toMatchObject({
      status: 'success',
      syncState: {
        automaticEnabled: true,
        sessionStatus: 'ready',
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
        consecutiveFailures: 0,
      },
    });
    expect(mocks.beginCommit).toHaveBeenCalledWith(3);
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it('rejects a different account fingerprint before any account data is written', async () => {
    useSyncState({
      ...READY_SYNC_STATE,
      verifiedCredentialGeneration: 1,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/account-b.zip',
      fileName: 'account-b.zip',
      byteLength: 3,
      credentialGeneration: 2,
      accountFingerprint: ACCOUNT_B_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 1, skippedRows: 0 },
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
      status: 'failed',
      reason: 'account-identity-mismatch',
      syncState: {
        automaticEnabled: false,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
        lastErrorCode: 'account-identity-mismatch',
      },
    });
    expect(mocks.beginCommit).not.toHaveBeenCalled();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
    expect(mocks.writeImport).not.toHaveBeenCalled();
    expect(mocks.writeGlucose).not.toHaveBeenCalled();
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      'file:///private/account-b.zip',
    );
  });

  it('migrates the previously verified generation to a protected identity once', async () => {
    useSyncState({
      automaticEnabled: true,
      sessionStatus: 'ready',
      consecutiveFailures: 0,
      verifiedCredentialGeneration: 1,
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/upgrade-bridge.zip',
      fileName: 'upgrade-bridge.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: 'success',
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(result.syncState.verifiedCredentialGeneration).toBeUndefined();
  });

  it('does not let an ordinary post-reset run create the first binding', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'ready',
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/post-reset.zip',
      fileName: 'post-reset.zip',
      byteLength: 3,
      credentialGeneration: 2,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'unverified-credentials',
      syncState: {
        automaticEnabled: false,
        lastErrorCode: 'unverified-credentials',
      },
    });
    expect(mocks.beginCommit).not.toHaveBeenCalled();
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it('allows the explicit verifier to create the first empty-store binding', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    });
    mocks.credentialStatus.mockResolvedValue({
      configured: true,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/verified.zip',
      fileName: 'verified.zip',
      byteLength: 3,
      credentialGeneration: 2,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(
      2,
      async () => undefined,
    );

    expect(result).toMatchObject({
      status: 'success',
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it('records same-generation legacy format confirmation as sign-in required', async () => {
    mocks.credentialStatus.mockResolvedValue({
      configured: false,
      credentialGeneration: 1,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'session-required',
      reason: 'session-required',
      message: 'Confirm the saved account format.',
      credentialGeneration: 1,
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: 'session-required',
      syncState: {
        automaticEnabled: false,
        sessionStatus: 'needs-sign-in',
        lastErrorCode: 'session-required',
      },
    });
  });

  it('treats an old-generation result after credential clear as superseded', async () => {
    mocks.credentialStatus.mockResolvedValue({
      configured: false,
      credentialGeneration: 2,
    });
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'session-required',
      reason: 'session-required',
      credentialGeneration: 1,
    });

    await expect(syncGlookoSilentlyNow(14)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'superseded',
    });
  });

  it('does not adopt unbound existing data for newly entered credentials', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/new-account.zip',
      fileName: 'new-account.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_B_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 1, skippedRows: 0 },
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
    );

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'unbound-existing-data',
      syncState: {
        automaticEnabled: false,
        lastErrorCode: 'unbound-existing-data',
      },
    });
    expect(mocks.writeImport).not.toHaveBeenCalled();
  });

  it('adopts unbound data only for the attested legacy credential continuity', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/legacy-account.zip',
      fileName: 'legacy-account.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 1, skippedRows: 0 },
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
      status: 'success',
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it('uses a persisted legacy attestation when the first verification retry failed', async () => {
    useSyncState({
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 1,
      pendingLegacyCredentialContinuity: true,
      lastErrorCode: 'network',
    });
    mocks.hasImportedData.mockResolvedValue(true);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/legacy-retry.zip',
      fileName: 'legacy-retry.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce(validPrepared());

    const result = await verifyGlookoCredentials(
      1,
      async () => undefined,
    );

    expect(result).toMatchObject({
      status: 'success',
      syncState: {
        automaticEnabled: true,
        verifiedAccountFingerprint: ACCOUNT_A_FINGERPRINT,
      },
    });
    expect(result.syncState.pendingLegacyCredentialContinuity).toBeUndefined();
    expect(mocks.writeImport).toHaveBeenCalledOnce();
  });

  it.each([
    'account-selection-required',
    'export-not-authorized',
    'account-code-not-found',
    'authentication-protocol-changed',
    'unsupported-region',
  ] as const)(
    'pauses a previously verified schedule for %s',
    async (reason) => {
      mocks.startSilentExport.mockResolvedValueOnce({
        status: 'failed',
        reason,
        message: 'This direct export requires attention.',
      });

      const result = await syncGlookoSilentlyNow(14);

      expect(result).toMatchObject({
        status: 'failed',
        reason,
        syncState: {
          automaticEnabled: false,
          sessionStatus: 'ready',
          lastErrorCode: reason,
        },
      });
      expect(result.syncState.nextEligibleAt).toBeUndefined();
    },
  );

  it('preserves a region mismatch as an actionable sign-in state', async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'session-required',
      reason: 'region-mismatch',
      message: 'This Glooko account belongs to the other service region.',
    });

    const result = await syncGlookoSilentlyNow(14);

    expect(result).toMatchObject({
      status: 'session-required',
      reason: 'region-mismatch',
      syncState: {
        lastErrorCode: 'region-mismatch',
        sessionStatus: 'needs-sign-in',
      },
    });
  });

  it('does not verify an automatic archive missing its required insulin tables', async () => {
    const pendingState: GlookoSyncState = {
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    };
    useSyncState(pendingState);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/glooko.zip',
      fileName: 'glooko.zip',
      byteLength: 3,
      credentialGeneration: 1,
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
      status: 'failed',
      reason: 'insulin-table-missing',
      syncState: {
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
        lastErrorCode: 'insulin-table-missing',
      },
    });
  });

  it('does not verify an archive when every supported data row is rejected', async () => {
    const pendingState: GlookoSyncState = {
      automaticEnabled: false,
      sessionStatus: 'pending-verification',
      consecutiveFailures: 0,
    };
    useSyncState(pendingState);
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/glooko.zip',
      fileName: 'glooko.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        recognisedFiles: [
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 0, skippedRows: 3 },
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
      status: 'failed',
      reason: 'rejected-archive-rows',
      syncState: {
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
        lastErrorCode: 'rejected-archive-rows',
      },
    });
    expect(mocks.releaseDownload).toHaveBeenCalledWith(
      'file:///private/glooko.zip',
    );
  });

  it('rejects a mixed-locale archive before writing valid sibling rows', async () => {
    mocks.startSilentExport.mockResolvedValueOnce({
      status: 'downloaded',
      uri: 'file:///private/glooko.zip',
      fileName: 'glooko.zip',
      byteLength: 3,
      credentialGeneration: 1,
      accountFingerprint: ACCOUNT_A_FINGERPRINT,
    });
    mocks.prepareImport.mockResolvedValueOnce({
      preview: {
        unsafeTimestampLocale: true,
        recognisedFiles: [
          { name: 'bolus_uk.csv', kind: 'bolus', records: 1, skippedRows: 0 },
          {
            name: 'bolus_month_first.csv',
            kind: 'bolus',
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
      status: 'failed',
      reason: 'unsafe-timestamp-locale',
      syncState: {
        automaticEnabled: false,
        lastErrorCode: 'unsafe-timestamp-locale',
      },
    });
    expect(result.syncState.nextEligibleAt).toBeUndefined();
    expect(mocks.writeImport).not.toHaveBeenCalled();
    expect(mocks.writeGlucose).not.toHaveBeenCalled();
  });

  it('deduplicates a PDF due-check while legacy automation is disabled', async () => {
    const planning = deferred<GlookoReportSyncState>();
    mocks.loadReportState
      .mockImplementationOnce(() => planning.promise)
      .mockResolvedValue(REPORT_STATE);

    const due = syncGlookoReportIfDue('background');
    await Promise.resolve();
    const immediate = syncGlookoReportNow('manual');

    expect(mocks.startSilentReportExport).not.toHaveBeenCalled();
    planning.resolve(REPORT_STATE);
    const [dueResult, immediateResult] = await Promise.all([due, immediate]);

    expect(immediateResult).toEqual(dueResult);
    expect(dueResult).toMatchObject({ origin: 'background' });
    expect(mocks.startSilentReportExport).not.toHaveBeenCalled();
    expect(dueResult).toMatchObject({
      status: 'skipped',
      plan: { reason: 'unsupported' },
    });
  });
});
