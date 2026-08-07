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
}));

vi.mock('expo-file-system', () => ({
  File: class {},
}));

vi.mock('../modules/daymark-glooko-export', () => ({
  default: {
    startExportAsync: mocks.startExport,
    startSilentExportAsync: mocks.startSilentExport,
    startRangeExportAsync: mocks.startRangeExport,
    startSilentRangeExportAsync: mocks.startSilentRangeExport,
    startSilentReportExportAsync: mocks.startSilentReportExport,
    extractReportDataAsync: vi.fn(),
  },
}));

vi.mock('../modules/daymark-glucose-display', () => ({
  default: {
    showGlookoSignInRequiredAsync: vi.fn(),
    cancelGlookoSignInRequiredAsync: vi.fn(),
  },
}));

vi.mock('@/data/glooko/glookoSyncState', () => ({
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
  prepareGlookoImport: vi.fn(),
}));

vi.mock('@/data/import/glookoGlucoseImport', () => ({
  writeGlookoGlucoseHistory: vi.fn(),
}));

vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {},
}));

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {},
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
  syncGlookoIfDue,
  syncGlookoManually,
  syncGlookoSilentlyNow,
} from '@/data/glooko/glookoSync';
import {
  syncGlookoReportIfDue,
  syncGlookoReportNow,
} from '@/data/glooko/glookoReportSync';
import { GlookoReportSyncState } from '@/data/glooko/glookoReportSyncPolicy';
import { GlookoSyncState } from '@/data/glooko/glookoSyncPolicy';

const READY_SYNC_STATE: GlookoSyncState = {
  automaticEnabled: true,
  sessionStatus: 'ready',
  consecutiveFailures: 0,
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

describe('Glooko sync entry-point concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSyncState.mockResolvedValue(READY_SYNC_STATE);
    mocks.saveSyncState.mockResolvedValue(undefined);
    mocks.updateSyncState.mockResolvedValue(READY_SYNC_STATE);
    mocks.loadReportState.mockResolvedValue(REPORT_STATE);
    mocks.saveReportState.mockResolvedValue(undefined);
    mocks.updateReportState.mockResolvedValue(REPORT_STATE);
    mocks.startExport.mockResolvedValue(CANCELLED);
    mocks.startSilentExport.mockResolvedValue(CANCELLED);
    mocks.startRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentRangeExport.mockResolvedValue(CANCELLED);
    mocks.startSilentReportExport.mockResolvedValue(CANCELLED);
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

  it('keeps a PDF due-check reservation while its state load is pending', async () => {
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
    expect(mocks.startSilentReportExport).toHaveBeenCalledOnce();
  });
});
