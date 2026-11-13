import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGlucoseDisplayForegroundSync } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';

const mocks = vi.hoisted(() => ({
  refreshConfiguredSources: vi.fn(),
  noteMonitoringDay: vi.fn(),
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    getStatusAsync: vi.fn().mockResolvedValue({ supported: false }),
    updatePrivateGlucoseForWriteEpochAsync: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn().mockResolvedValue({ epoch: 3 }),
  withLocalDataWriteLeaseTransaction: vi.fn(
    async (_lease: unknown, task: (transaction: unknown) => Promise<unknown>) =>
      task({ getFirstAsync: vi.fn(), getAllAsync: vi.fn().mockResolvedValue([]) }),
  ),
}));
vi.mock('@/data/live/configuredGlucoseSources', () => ({
  configuredGlucoseSources: vi.fn().mockResolvedValue([]),
  refreshConfiguredGlucoseSources: mocks.refreshConfiguredSources,
}));
vi.mock('@/data/live/sourceConnectionOwnership', () => ({
  assertSourceConnectionWriteLeaseInTransaction: vi.fn(),
}));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  reconcileGlucoseAlerts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {
    initialize = vi.fn();
    getLatestReading = vi.fn();
    getSyncState = vi.fn();
    getReadings = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock('@/data/usageReporting/monitoringDay', () => ({
  noteMonitoringDay: mocks.noteMonitoringDay,
}));

describe('collector monitoring day', () => {
  beforeEach(() => {
    mocks.refreshConfiguredSources.mockReset();
    mocks.noteMonitoringDay.mockReset();
  });

  it('notes a monitoring day after the collector completes a sync', async () => {
    mocks.refreshConfiguredSources.mockResolvedValue([]);
    await runGlucoseDisplayForegroundSync({ reason: 'glucose-display' });
    expect(mocks.noteMonitoringDay).toHaveBeenCalledTimes(1);
  });

  it('does not note a day when every source failed', async () => {
    mocks.refreshConfiguredSources.mockRejectedValue(new Error('Offline'));
    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();
    expect(mocks.noteMonitoringDay).not.toHaveBeenCalled();
  });

  it('keeps the sync path working if the usage hook throws', async () => {
    mocks.refreshConfiguredSources.mockResolvedValue([]);
    mocks.noteMonitoringDay.mockImplementation(() => {
      throw new Error('unexpected');
    });
    await expect(runGlucoseDisplayForegroundSync()).resolves.toBeUndefined();
  });
});
