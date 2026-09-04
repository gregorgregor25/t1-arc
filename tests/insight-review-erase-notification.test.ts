import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runScheduledInsightReview } from '@/data/insights/scheduledInsightReview';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  loadPreferences: vi.fn(),
  publishNotification: vi.fn(),
  withLease: vi.fn(),
}));

vi.mock('@/data/insights/insightReviewGenerator', () => ({
  generateInsightReviewIfDue: mocks.generate,
}));

vi.mock('@/data/insights/insightReviewPreferences', () => ({
  publishWeeklyReviewNotificationIfDue: mocks.publishNotification,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(),
  withLocalDataWriteLeaseTransaction: mocks.withLease,
}));

function readyGeneration() {
  return {
    changed: true,
    saved: {
      report: { ready: true },
    },
  };
}

describe('scheduled insight notification erase fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generate.mockResolvedValue(readyGeneration());
    mocks.publishNotification.mockResolvedValue({ due: true, shown: true });
  });

  it('does not notify or record success when erase supersedes the publication transaction', async () => {
    const stale = new Error('superseded');
    stale.name = 'LocalDataWriteSupersededError';
    mocks.publishNotification.mockRejectedValue(stale);

    await expect(
      runScheduledInsightReview(
        Date.parse('2026-08-25T10:00:00+01:00'),
        { epoch: 8 },
      ),
    ).rejects.toBe(stale);

    expect(mocks.publishNotification).toHaveBeenCalledWith(
      Date.parse('2026-08-25T10:00:00+01:00'),
      { epoch: 8 },
    );
  });
});
