import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  beginLibreVerification,
  createLibreVerificationGuard,
  invalidateLibreVerification,
  isCurrentLibreVerification,
  libreVerificationActionLabel,
  libreSetupErrorForDisplay,
  runLibreVerification,
} from '@/screens/libreSetupVerification';
import { sameLibreLinkUpCredentials } from '@/data/libreLinkUp/credentialIdentity';
import { LibreLinkUpError } from '@/data/libreLinkUp/types';
import {
  installRepositoryForVerifiedLibreOwner,
  libreActivationNeedsRefreshBarrier,
  publishVerifiedLibreSnapshotImmediately,
} from '@/providers/libreRepositoryActivation';
import { LocalDataWriteSupersededError } from '@/data/privacy/localDataWriteEpoch';
import { SourceConnectionSupersededError } from '@/data/live/sourceConnectionOwnership';

const accountA = {
  email: 'follower-a@example.com',
  password: 'account-a-password',
  topLevelDomain: 'io' as const,
};

const accountB = {
  email: 'follower-b@example.com',
  password: 'account-b-password',
  topLevelDomain: 'io' as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Libre setup verification lifecycle', () => {
  it('gives every connection stage an explicit accessible action label', () => {
    expect(libreVerificationActionLabel()).toBe(
      'Test, save and use connection',
    );
    expect(libreVerificationActionLabel('checking')).toBe(
      'Checking LibreLinkUp…',
    );
    expect(libreVerificationActionLabel('saving')).toBe('Saving securely…');
    expect(libreVerificationActionLabel('publishing')).toBe(
      'Updating your glucose…',
    );
    expect(libreVerificationActionLabel(undefined, 'Check connection')).toBe(
      'Check connection',
    );

    const source = readFileSync(
      new URL('../src/screens/SourcesScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('accessibilityLabel={libreActionLabel}');
    expect(source).toContain('accessibilityLabel={savedLibreActionLabel}');
    expect(source).not.toContain('busy: verificationBusy');
  });

  it('reuses a live repository only for the exact saved account', () => {
    expect(
      sameLibreLinkUpCredentials(accountA, {
        ...accountA,
        email: '  FOLLOWER-A@EXAMPLE.COM ',
      }),
    ).toBe(true);
    expect(
      sameLibreLinkUpCredentials(accountA, {
        ...accountA,
        password: 'different-password',
      }),
    ).toBe(false);
    expect(
      sameLibreLinkUpCredentials(accountA, {
        ...accountA,
        topLevelDomain: 'us',
      }),
    ).toBe(false);
    expect(sameLibreLinkUpCredentials(undefined, accountA)).toBe(false);
  });

  it('waits only when a known different live account could still write readings', () => {
    expect(
      libreActivationNeedsRefreshBarrier(
        { credentials: accountA, mode: 'live', ready: true },
        accountA,
      ),
    ).toBe(false);
    expect(
      libreActivationNeedsRefreshBarrier(
        { credentials: undefined, mode: 'live', ready: true },
        accountA,
      ),
    ).toBe(false);
    expect(
      libreActivationNeedsRefreshBarrier(
        { credentials: accountA, mode: 'live', ready: true },
        accountB,
      ),
    ).toBe(true);
    expect(
      libreActivationNeedsRefreshBarrier(
        { credentials: accountA, mode: 'demo', ready: true },
        accountB,
      ),
    ).toBe(false);
  });

  it('installs a repository for every newly rotated verified Libre lease', async () => {
    const configureLive = vi.fn(async () => undefined);

    await installRepositoryForVerifiedLibreOwner(configureLive);
    await installRepositoryForVerifiedLibreOwner(configureLive);

    expect(configureLive).toHaveBeenCalledTimes(2);
  });

  it('publishes a durable verified reading and awaits the fenced follow-up work', async () => {
    const persist = vi.fn(async () => undefined);
    const invalidateApp = vi.fn();
    const publishNative = vi.fn(async () => undefined);
    const refreshBounds = vi.fn(async () => undefined);

    await expect(
      publishVerifiedLibreSnapshotImmediately({
        persist,
        invalidateApp,
        publishNative,
        refreshBounds,
      }),
    ).resolves.toBeUndefined();

    expect(persist).toHaveBeenCalledOnce();
    expect(invalidateApp).toHaveBeenCalledOnce();
    expect(publishNative).toHaveBeenCalledOnce();
    expect(refreshBounds).toHaveBeenCalledOnce();
    expect(persist.mock.invocationCallOrder[0]!).toBeLessThan(
      invalidateApp.mock.invocationCallOrder[0]!,
    );
  });

  it('propagates erase supersession from native publication', async () => {
    await expect(
      publishVerifiedLibreSnapshotImmediately({
        persist: async () => undefined,
        invalidateApp: vi.fn(),
        publishNative: async () => {
          throw new LocalDataWriteSupersededError();
        },
        refreshBounds: vi.fn(async () => undefined),
      }),
    ).rejects.toBeInstanceOf(LocalDataWriteSupersededError);
  });

  it('does not report Libre activation success when native publication fails', async () => {
    const refreshBounds = vi.fn(async () => undefined);

    await expect(
      publishVerifiedLibreSnapshotImmediately({
        persist: async () => undefined,
        invalidateApp: vi.fn(),
        publishNative: async () => {
          throw new Error('native publication failed');
        },
        refreshBounds,
      }),
    ).rejects.toThrow('native publication failed');
    expect(refreshBounds).not.toHaveBeenCalled();
  });

  it('does not expose unexpected native database details in the UI', () => {
    const error = libreSetupErrorForDisplay(
      new Error(
        'NativeStatement.finalizeAsync rejected: database is locked',
      ),
    );

    expect(error.message).toBe(
      'T1 Arc could not finish saving this connection. Your existing data is safe. Please tap Check connection again.',
    );
    expect(error.message).not.toContain('database');
    expect(error.message).not.toContain('NativeStatement');
  });

  it('preserves actionable LibreLinkUp service errors', () => {
    const original = new LibreLinkUpError(
      'invalid-credentials',
      'Check the follower email and password.',
    );
    expect(libreSetupErrorForDisplay(original)).toBe(original);
  });

  it('invalidates a pending result as soon as the draft account changes', async () => {
    const guard = createLibreVerificationGuard(accountA);
    const request = beginLibreVerification(guard, accountA);
    const pending = deferred<{ account: string }>();
    const commit = vi.fn(async () => undefined);
    const activate = vi.fn(async () => undefined);
    const result = runLibreVerification({
      request,
      verify: () => pending.promise,
      commit,
      activate,
      isCurrent: (candidate) =>
        isCurrentLibreVerification(guard, candidate, accountB),
    });

    invalidateLibreVerification(guard, accountB);
    pending.resolve({ account: 'A' });

    await expect(result).resolves.toEqual({ kind: 'superseded' });
    expect(commit).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('finishes durable activation when navigation supersedes a committed result', async () => {
    const guard = createLibreVerificationGuard(accountA);
    const request = beginLibreVerification(guard, accountA);
    const committed = deferred<void>();
    const commit = vi.fn(() => committed.promise);
    const activated = deferred<void>();
    const activate = vi.fn(() => activated.promise);
    let currentDraft = accountA;
    const result = runLibreVerification({
      request,
      verify: async () => ({ account: 'A' }),
      commit,
      activate,
      isCurrent: (candidate) =>
        isCurrentLibreVerification(guard, candidate, currentDraft),
    });

    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    currentDraft = accountB;
    invalidateLibreVerification(guard, accountB);
    committed.resolve();

    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    activated.resolve();

    await expect(result).resolves.toEqual({ kind: 'superseded' });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('allows only the newest generation for the same credential key', () => {
    const guard = createLibreVerificationGuard(accountA);
    const first = beginLibreVerification(guard, accountA);
    const second = beginLibreVerification(guard, accountA);

    expect(isCurrentLibreVerification(guard, first, accountA)).toBe(false);
    expect(isCurrentLibreVerification(guard, second, accountA)).toBe(true);
  });

  it('commits and activates the current verified account exactly once', async () => {
    const guard = createLibreVerificationGuard(accountA);
    const request = beginLibreVerification(guard, accountA);
    const commit = vi.fn(async () => undefined);
    const activate = vi.fn(async () => undefined);

    await expect(
      runLibreVerification({
        request,
        verify: async () => ({ account: 'A' }),
        commit,
        activate,
        isCurrent: (candidate) =>
          isCurrentLibreVerification(guard, candidate, accountA),
      }),
    ).resolves.toEqual({ kind: 'success', value: { account: 'A' } });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('classifies a newer source owner as superseding setup', async () => {
    const guard = createLibreVerificationGuard(accountA);
    const request = beginLibreVerification(guard, accountA);

    await expect(
      runLibreVerification({
        request,
        verify: async () => ({ account: 'A' }),
        commit: async () => {
          throw new SourceConnectionSupersededError('t1arc-librelinkup');
        },
        activate: vi.fn(async () => undefined),
        isCurrent: (candidate) =>
          isCurrentLibreVerification(guard, candidate, accountA),
      }),
    ).resolves.toEqual({ kind: 'superseded' });
  });

  it('reports checking, saving and publishing as distinct truthful stages', async () => {
    const guard = createLibreVerificationGuard(accountA);
    const request = beginLibreVerification(guard, accountA);
    const stages: string[] = [];

    await expect(
      runLibreVerification({
        request,
        verify: async () => ({ account: 'A' }),
        commit: async () => undefined,
        activate: async () => undefined,
        isCurrent: (candidate) =>
          isCurrentLibreVerification(guard, candidate, accountA),
        onStage: (stage) => stages.push(stage),
      }),
    ).resolves.toMatchObject({ kind: 'success' });

    expect(stages).toEqual(['checking', 'saving', 'publishing']);
  });

  it('bounds a read-only connection check and never commits after timeout', async () => {
    vi.useFakeTimers();
    try {
      const guard = createLibreVerificationGuard(accountA);
      const request = beginLibreVerification(guard, accountA);
      const commit = vi.fn(async () => undefined);
      const activate = vi.fn(async () => undefined);
      const verify = vi.fn(
        (signal: AbortSignal) =>
          new Promise<{ account: string }>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true },
            );
          }),
      );
      const result = runLibreVerification({
        request,
        verify,
        commit,
        activate,
        isCurrent: (candidate) =>
          isCurrentLibreVerification(guard, candidate, accountA),
        verifyDeadlineMs: 50,
      });

      await vi.advanceTimersByTimeAsync(50);

      await expect(result).resolves.toMatchObject({
        kind: 'error',
        error: expect.objectContaining({
          code: 'network',
          message: expect.stringContaining('took too long'),
        }),
      });
      expect(commit).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
      expect(verify.mock.calls[0]?.[0].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
