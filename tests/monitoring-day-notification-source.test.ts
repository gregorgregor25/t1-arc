import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshConfiguredGlucoseSources } from '@/data/live/configuredGlucoseSources';

// The collector counts a monitoring day only when at least one configured
// glucose source was checked (see glucoseDisplayCoordinator). This proves a
// phone whose only source is notification capture is part of that set.
const mocks = vi.hoisted(() => ({
  notificationConfigured: false,
  notificationRefresh: vi.fn(),
  noConnection: async () => ({ values: {}, sourceWriteLease: undefined }),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn().mockResolvedValue({ epoch: 1 }),
}));
vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {
    withWriteLease() {
      return this;
    }
  },
}));
vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({ SqliteHealthRecordStore: class {} }));
vi.mock('@/data/notification/NotificationGlucoseSource', () => ({
  NotificationGlucoseSource: class {
    sourceId = 'notification-source';
    isConfigured = async () => mocks.notificationConfigured;
    refresh = mocks.notificationRefresh;
  },
}));
vi.mock('@/data/libreLinkUp/secureStore', () => ({ loadOwnedLibreLinkUpConnection: mocks.noConnection }));
vi.mock('@/data/nightscout/secureStore', () => ({ loadOwnedNightscoutConnection: mocks.noConnection }));
vi.mock('@/data/xdrip/secureStore', () => ({ loadOwnedXdripConnection: mocks.noConnection }));
vi.mock('@/data/dexcomShare/secureStore', () => ({ loadOwnedDexcomShareConnection: mocks.noConnection }));
vi.mock('@/data/medtrum/secureStore', () => ({ loadOwnedMedtrumConnection: mocks.noConnection }));
vi.mock('@/data/libreLinkUp/DirectLibreLinkUpSource', () => ({ DirectLibreLinkUpSource: class {} }));
vi.mock('@/data/nightscout/NightscoutGlucoseSource', () => ({ NightscoutGlucoseSource: class {} }));
vi.mock('@/data/nightscout/NightscoutTreatmentImporter', () => ({ NightscoutTreatmentImporter: class {} }));
vi.mock('@/data/nightscout/historySync', () => ({ syncNightscoutHistoryIfDue: vi.fn() }));
vi.mock('@/data/xdrip/XdripGlucoseSource', () => ({ XdripGlucoseSource: class {} }));
vi.mock('@/data/dexcomShare/DexcomShareGlucoseSource', () => ({ DexcomShareGlucoseSource: class {} }));
vi.mock('@/data/medtrum/MedtrumGlucoseSource', () => ({ MedtrumGlucoseSource: class {} }));

describe('monitoring day with notification capture', () => {
  beforeEach(() => {
    mocks.notificationConfigured = false;
    mocks.notificationRefresh.mockReset().mockResolvedValue(undefined);
  });

  it('includes an enabled notification source as a checked glucose source', async () => {
    mocks.notificationConfigured = true;
    const results = await refreshConfiguredGlucoseSources();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sourceId: 'notification-source', status: 'fulfilled' });
    expect(mocks.notificationRefresh).toHaveBeenCalledTimes(1);
  });

  it('has no checked source when notification capture is off and nothing else is connected', async () => {
    await expect(refreshConfiguredGlucoseSources()).resolves.toEqual([]);
    expect(mocks.notificationRefresh).not.toHaveBeenCalled();
  });
});
