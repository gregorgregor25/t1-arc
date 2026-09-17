import { describe, expect, it, vi } from 'vitest';

import { updateInsightReviewBackgroundRegistration } from '@/data/background/insightReviewTask';
import { INSIGHT_REVIEW_BACKGROUND_TASK } from '@/data/background/backgroundTaskNames';

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  defineTask: vi.fn(),
  hydrateProfile: vi.fn(async () => undefined),
  isTaskDefined: vi.fn(() => false),
  reconcile: vi.fn(async (_task: string, enabled: boolean) => enabled),
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Failed: 2, Success: 1 },
}));

vi.mock('expo-task-manager', () => ({
  defineTask: mocks.defineTask,
  isTaskDefined: mocks.isTaskDefined,
}));

vi.mock('@/data/background/backgroundTaskRegistration', () => ({
  backgroundTaskSchedulerAvailable: mocks.available,
  reconcileBackgroundTaskRegistration: mocks.reconcile,
}));

vi.mock('@/data/background/automationRunLog', () => ({
  beginAutomationRun: vi.fn(),
  finishAutomationRun: vi.fn(),
}));

vi.mock('@/data/insights/scheduledInsightReview', () => ({
  runScheduledInsightReview: vi.fn(),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(),
  assertLocalDataWriteLeaseCurrent: vi.fn(),
  isLocalDataWriteSupersededError: vi.fn(() => false),
}));

vi.mock('@/data/regionalProfile', () => ({
  ensureRegionalProfileRuntimeHydrated: mocks.hydrateProfile,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('insight-review background registration ownership', () => {
  it('keeps a newer disable behind and after an older delayed enable', async () => {
    const firstAvailability = deferred<boolean>();
    mocks.available
      .mockReturnValueOnce(firstAvailability.promise)
      .mockResolvedValue(true);

    const enable = updateInsightReviewBackgroundRegistration(true);
    await vi.waitFor(() => expect(mocks.available).toHaveBeenCalledOnce());
    const disable = updateInsightReviewBackgroundRegistration(false);
    await Promise.resolve();
    expect(mocks.available).toHaveBeenCalledOnce();

    firstAvailability.resolve(true);
    await Promise.all([enable, disable]);

    expect(mocks.reconcile.mock.calls).toEqual([
      [INSIGHT_REVIEW_BACKGROUND_TASK, true],
      [INSIGHT_REVIEW_BACKGROUND_TASK, false],
    ]);
  });
});
