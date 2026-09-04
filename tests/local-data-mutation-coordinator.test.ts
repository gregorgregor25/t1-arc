import { describe, expect, it, vi } from 'vitest';

import {
  LocalDataMutationInProgressError,
  runExclusiveLocalDataMutation,
} from '@/data/privacy/localDataMutationCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('local data mutation coordinator', () => {
  it('rejects rather than queues a restore that begins during an erase', async () => {
    const releaseErase = deferred();
    const restore = vi.fn(async () => 'restored');
    const erase = runExclusiveLocalDataMutation('erase', async () => {
      await releaseErase.promise;
      return 'erased';
    });

    await expect(
      runExclusiveLocalDataMutation('restore', restore),
    ).rejects.toBeInstanceOf(LocalDataMutationInProgressError);
    expect(restore).not.toHaveBeenCalled();

    releaseErase.resolve();
    await expect(erase).resolves.toBe('erased');
    await expect(
      runExclusiveLocalDataMutation('restore', restore),
    ).resolves.toBe('restored');
  });

  it('rejects an erase while a restore owns the mutation boundary', async () => {
    const releaseRestore = deferred();
    const restore = runExclusiveLocalDataMutation('restore', async () => {
      await releaseRestore.promise;
    });

    await expect(
      runExclusiveLocalDataMutation('erase', async () => undefined),
    ).rejects.toThrow(/restore.*already in progress/i);

    releaseRestore.resolve();
    await restore;
  });

  it('always releases ownership when the protected operation fails', async () => {
    await expect(
      runExclusiveLocalDataMutation('restore', async () => {
        throw new Error('broken backup');
      }),
    ).rejects.toThrow('broken backup');

    await expect(
      runExclusiveLocalDataMutation('erase', async () => 'safe'),
    ).resolves.toBe('safe');
  });
});
