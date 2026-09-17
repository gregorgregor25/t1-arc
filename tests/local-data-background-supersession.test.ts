import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runInsightReviewBackgroundTask } from '@/data/background/insightReviewTask';
import { runLibreBackgroundTask } from '@/data/background/libreSyncTask';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  assertLeaseCurrent: vi.fn(),
  beginRun: vi.fn(),
  finishRun: vi.fn(),
  refreshGlucose: vi.fn(),
  updateDisplay: vi.fn(),
  glucoseSummary: vi.fn(),
  runInsightReview: vi.fn(),
  hydrateProfile: vi.fn(),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Failed: 'failed', Success: 'success' },
}));

vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(() => true),
}));

vi.mock('@/data/background/backgroundTaskRegistration', () => ({
  backgroundTaskSchedulerAvailable: vi.fn(),
  reconcileBackgroundTaskRegistration: vi.fn(),
  shouldRegisterGlucoseBackgroundSync: vi.fn(),
}));

vi.mock('@/data/background/automationRunLog', () => ({
  beginAutomationRun: mocks.beginRun,
  finishAutomationRun: mocks.finishRun,
}));

vi.mock('@/data/live/configuredGlucoseSources', () => ({
  configuredGlucoseSources: vi.fn(),
  refreshConfiguredGlucoseSources: mocks.refreshGlucose,
}));

vi.mock('@/data/live/glucoseSourceRefresh', () => ({
  glucoseAutomationSummary: mocks.glucoseSummary,
}));

vi.mock('@/data/glucoseDisplay/glucoseDisplayCoordinator', () => ({
  updateGlucoseDisplayFromHistoryWithLease: mocks.updateDisplay,
}));

vi.mock('@/data/insights/scheduledInsightReview', () => ({
  runScheduledInsightReview: mocks.runInsightReview,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  assertLocalDataWriteLeaseCurrent: mocks.assertLeaseCurrent,
  isLocalDataWriteSupersededError: (error: unknown) =>
    error instanceof Error && error.name === 'LocalDataWriteSupersededError',
}));

vi.mock('@/data/regionalProfile', () => ({
  ensureRegionalProfileRuntimeHydrated: mocks.hydrateProfile,
}));

function supersededError() {
  const error = new Error(
    'This local-data operation was superseded by a privacy erase.',
  );
  error.name = 'LocalDataWriteSupersededError';
  return error;
}

describe('background local-data erase supersession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hydrateProfile.mockResolvedValue(undefined);
    mocks.acquireLease.mockResolvedValue({ epoch: 7 });
    mocks.assertLeaseCurrent.mockResolvedValue(undefined);
    mocks.beginRun.mockResolvedValue('run-id');
    mocks.finishRun.mockResolvedValue(undefined);
    mocks.refreshGlucose.mockResolvedValue([]);
    mocks.updateDisplay.mockResolvedValue(true);
    mocks.glucoseSummary.mockReturnValue({ outcome: 'success', detail: 'ok' });
    mocks.runInsightReview.mockResolvedValue({
      generated: false,
      notificationShown: false,
    });
  });

  it('hydrates the saved regional profile before either task touches local data', async () => {
    await expect(runLibreBackgroundTask()).resolves.toBe('success');
    const libreHydrationOrder = mocks.hydrateProfile.mock.invocationCallOrder[0]!;
    const libreLeaseOrder = mocks.acquireLease.mock.invocationCallOrder[0]!;
    expect(libreHydrationOrder).toBeLessThan(libreLeaseOrder);

    vi.clearAllMocks();
    mocks.hydrateProfile.mockResolvedValue(undefined);
    mocks.acquireLease.mockResolvedValue({ epoch: 7 });
    mocks.assertLeaseCurrent.mockResolvedValue(undefined);
    mocks.beginRun.mockResolvedValue('run-id');
    mocks.finishRun.mockResolvedValue(undefined);
    mocks.runInsightReview.mockResolvedValue({
      generated: false,
      notificationShown: false,
    });

    await expect(runInsightReviewBackgroundTask()).resolves.toBe('success');
    expect(mocks.hydrateProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireLease.mock.invocationCallOrder[0]!,
    );
  });

  it('treats an ordinary insight failure as benign when erase supersedes its failure audit', async () => {
    mocks.runInsightReview.mockRejectedValue(new Error('network failed'));
    mocks.finishRun.mockRejectedValue(supersededError());

    await expect(runInsightReviewBackgroundTask()).resolves.toBe('success');

    expect(mocks.finishRun).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ outcome: 'failed' }),
      { epoch: 7 },
    );
  });

  it('treats an ordinary glucose failure as benign when erase supersedes its failure audit', async () => {
    mocks.refreshGlucose.mockRejectedValue(new Error('network failed'));
    mocks.finishRun.mockRejectedValue(supersededError());

    await expect(runLibreBackgroundTask()).resolves.toBe('success');

    expect(mocks.updateDisplay).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ outcome: 'failed' }),
      { epoch: 7 },
    );
  });

  it('does not return a stale failed glucose summary after erase wins the completion audit', async () => {
    mocks.glucoseSummary.mockReturnValue({
      outcome: 'failed',
      detail: 'all sources failed',
    });
    mocks.finishRun.mockRejectedValue(supersededError());

    await expect(runLibreBackgroundTask()).resolves.toBe('success');

    expect(mocks.updateDisplay).toHaveBeenCalledWith({ epoch: 7 });
    expect(mocks.finishRun).toHaveBeenCalledWith(
      'run-id',
      expect.objectContaining({ outcome: 'failed' }),
      { epoch: 7 },
    );
  });

  it('contains lease acquisition failures instead of escaping TaskManager', async () => {
    mocks.acquireLease.mockRejectedValue(new Error('database unavailable'));

    await expect(runLibreBackgroundTask()).resolves.toBe('failed');
    await expect(runInsightReviewBackgroundTask()).resolves.toBe('failed');
    expect(mocks.beginRun).not.toHaveBeenCalled();
  });

  it('treats erase-intent lease acquisition rejection as benign', async () => {
    mocks.acquireLease.mockRejectedValue(supersededError());

    await expect(runLibreBackgroundTask()).resolves.toBe('success');
    await expect(runInsightReviewBackgroundTask()).resolves.toBe('success');
    expect(mocks.beginRun).not.toHaveBeenCalled();
  });
});
