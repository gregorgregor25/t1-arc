import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocalDataResetState } from '@/data/privacy/localDataResetState';

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  loadLibre: vi.fn(),
  loadNightscout: vi.fn(),
  loadDexcom: vi.fn(),
  loadMedtrum: vi.fn(),
  loadXdrip: vi.fn(),
  loadHevy: vi.fn(),
  credentialStatus: vi.fn(),
  inboxStatus: vi.fn(),
  loadGlookoSync: vi.fn(),
  notificationStatus: vi.fn(),
  displayStatus: vi.fn(),
  loadAlerts: vi.fn(),
  loadInsightReview: vi.fn(),
  loadTarvisStatus: vi.fn(),
  getFirst: vi.fn(),
}));

vi.mock('../modules/t1arc-glooko-export', () => ({
  default: { getCredentialStatusAsync: mocks.credentialStatus },
}));
vi.mock('../modules/t1arc-notification-source', () => ({
  default: { getStatusAsync: mocks.notificationStatus },
}));
vi.mock('../modules/t1arc-glucose-display', () => ({
  default: { getStatusAsync: mocks.displayStatus },
}));
vi.mock('@/data/privacy/localDataVault', () => ({
  getLocalDataSummary: mocks.getSummary,
}));
vi.mock('@/data/libreLinkUp/secureStore', () => ({
  loadLibreLinkUpCredentials: mocks.loadLibre,
}));
vi.mock('@/data/nightscout/secureStore', () => ({
  loadNightscoutConnection: mocks.loadNightscout,
}));
vi.mock('@/data/dexcomShare/secureStore', () => ({
  loadDexcomShareConnection: mocks.loadDexcom,
}));
vi.mock('@/data/medtrum/secureStore', () => ({
  loadMedtrumConnection: mocks.loadMedtrum,
}));
vi.mock('@/data/xdrip/secureStore', () => ({
  loadXdripConnection: mocks.loadXdrip,
}));
vi.mock('@/data/hevy/secureStore', () => ({
  loadHevyConnection: mocks.loadHevy,
}));
vi.mock('@/data/glooko/glookoReportInbox', () => ({
  getGlookoReportInboxStatus: mocks.inboxStatus,
}));
vi.mock('@/data/glooko/glookoSyncState', () => ({
  loadGlookoSyncState: mocks.loadGlookoSync,
}));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  loadGlucoseAlertPreferences: mocks.loadAlerts,
}));
vi.mock('@/data/insights/insightReviewPreferences', () => ({
  loadInsightReviewPreferences: mocks.loadInsightReview,
}));
vi.mock('@/data/tarvis/secureStore', () => ({
  getTarvisStoredDataStatus: mocks.loadTarvisStatus,
}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: mocks.getFirst,
  })),
}));

const EMPTY_SUMMARY = {
  glucoseReadings: 0,
  insulinRecords: 0,
  contextRecords: 0,
  foodLogs: 0,
  foodRecipes: 0,
  healthConnectRecords: 0,
  retainedSourceExports: 0,
  notificationSourceEvents: 0,
  savedInsightReports: 0,
};

describe('local data reset state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSummary.mockResolvedValue(EMPTY_SUMMARY);
    mocks.loadLibre.mockResolvedValue(undefined);
    mocks.loadNightscout.mockResolvedValue(undefined);
    mocks.loadDexcom.mockResolvedValue(undefined);
    mocks.loadMedtrum.mockResolvedValue(undefined);
    mocks.loadXdrip.mockResolvedValue(undefined);
    mocks.loadHevy.mockResolvedValue(undefined);
    mocks.credentialStatus.mockResolvedValue({ configured: false });
    mocks.inboxStatus.mockResolvedValue({ configured: false });
    mocks.loadGlookoSync.mockResolvedValue({
      sessionStatus: 'unknown',
      automaticEnabled: false,
    });
    mocks.notificationStatus.mockResolvedValue({
      enabled: false,
      rules: [],
      pendingCount: 0,
    });
    mocks.displayStatus.mockResolvedValue({ enabled: false });
    mocks.loadAlerts.mockResolvedValue({ enabled: false });
    mocks.loadInsightReview.mockResolvedValue({
      weeklyNotificationEnabled: false,
    });
    mocks.loadTarvisStatus.mockResolvedValue({
      hasApiKey: false,
      hasUsage: false,
      hasSafetyIdentifier: false,
    });
    mocks.getFirst.mockResolvedValue({ configured: 0 });
  });

  it('returns an empty, reset state without guessing from defaults', async () => {
    await expect(getLocalDataResetState()).resolves.toEqual({
      summary: EMPTY_SUMMARY,
      hasResettableConfiguration: false,
    });
  });

  it('treats an explicitly saved paused Health Connect selection as configuration', async () => {
    mocks.getFirst.mockResolvedValue({ configured: 1 });

    await expect(getLocalDataResetState()).resolves.toMatchObject({
      hasResettableConfiguration: true,
    });
  });

  it('detects Tarv1s private state even when there is no health history', async () => {
    mocks.loadTarvisStatus.mockResolvedValue({
      hasApiKey: false,
      hasUsage: true,
      hasSafetyIdentifier: true,
    });

    await expect(getLocalDataResetState()).resolves.toMatchObject({
      hasResettableConfiguration: true,
    });
  });

  it('detects a retained Glooko account binding without native credentials', async () => {
    mocks.loadGlookoSync.mockResolvedValue({
      sessionStatus: 'unknown',
      automaticEnabled: false,
      verifiedAccountFingerprint: `af1_${'a'.repeat(64)}`,
    });

    await expect(getLocalDataResetState()).resolves.toMatchObject({
      hasResettableConfiguration: true,
    });
  });

  it('propagates an unreadable configuration store as an unknown state', async () => {
    mocks.loadLibre.mockRejectedValue(new Error('secure store unavailable'));

    await expect(getLocalDataResetState()).rejects.toThrow(
      'secure store unavailable',
    );
  });
});
