import { expect, it, vi } from 'vitest';

import { createUnknownSourceOwnerPrivacyBoundary } from '@/data/live/sourceOwnerPrivacyBoundary';

const replacement = vi.hoisted(() => ({
  clearPreviousOwner: vi.fn(async () => undefined),
}));

vi.mock('@/data/live/verifiedSourceActivation', () => ({
  clearPreviousSourceOwnerInTransaction: replacement.clearPreviousOwner,
}));

it('routes an unknown-owner boundary through the exact source privacy purge', async () => {
  const transaction = {} as never;
  const boundary = createUnknownSourceOwnerPrivacyBoundary('nightscout', true);

  await boundary({
    transaction,
    localDataWriteLease: { epoch: 7 },
  });

  expect(replacement.clearPreviousOwner).toHaveBeenCalledWith({
    transaction,
    sourceId: 'nightscout',
    writeEpoch: 7,
    clearHealthRecords: true,
  });
});
