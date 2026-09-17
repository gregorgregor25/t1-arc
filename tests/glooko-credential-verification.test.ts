import { describe, expect, it, vi } from 'vitest';

import {
  needsGlookoExistingDataBindingConfirmation,
  runSavedGlookoConnectionCheck,
} from '@/data/glooko/glookoCredentialVerification';

const ACCOUNT_FINGERPRINT = `af1_${'a'.repeat(64)}`;

describe('saved Glooko connection routing', () => {
  it('requires explicit same-person confirmation for restored unbound Glooko data', () => {
    expect(
      needsGlookoExistingDataBindingConfirmation(
        {
          automaticEnabled: false,
          sessionStatus: 'needs-sign-in',
          consecutiveFailures: 0,
        },
        true,
      ),
    ).toBe(true);
  });

  it('does not request existing-data binding for an empty or already bound store', () => {
    expect(
      needsGlookoExistingDataBindingConfirmation(
        {
          automaticEnabled: false,
          sessionStatus: 'needs-sign-in',
          consecutiveFailures: 0,
        },
        false,
      ),
    ).toBe(false);
    expect(
      needsGlookoExistingDataBindingConfirmation(
        {
          automaticEnabled: true,
          sessionStatus: 'ready',
          consecutiveFailures: 0,
          verifiedAccountFingerprint: ACCOUNT_FINGERPRINT,
        },
        true,
      ),
    ).toBe(false);
  });

  it('uses explicit first-binding verification after imported data is removed', async () => {
    const verify = vi.fn(async () => 'verified');
    const refresh = vi.fn(async () => 'refreshed');

    await expect(
      runSavedGlookoConnectionCheck(
        { configured: true, credentialGeneration: 7 },
        {
          automaticEnabled: false,
          sessionStatus: 'ready',
          consecutiveFailures: 0,
        },
        verify,
        refresh,
      ),
    ).resolves.toBe('verified');
    expect(verify).toHaveBeenCalledWith(7, false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses an ordinary check once the store is bound', async () => {
    const verify = vi.fn(async () => 'verified');
    const refresh = vi.fn(async () => 'refreshed');

    await expect(
      runSavedGlookoConnectionCheck(
        { configured: true, credentialGeneration: 7 },
        {
          automaticEnabled: true,
          sessionStatus: 'ready',
          consecutiveFailures: 0,
          verifiedAccountFingerprint: ACCOUNT_FINGERPRINT,
        },
        verify,
        refresh,
      ),
    ).resolves.toBe('refreshed');
    expect(refresh).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
  });

  it('uses explicit recovery for a bound connection paused by an actionable failure', async () => {
    const verify = vi.fn(async () => 'recovered');
    const refresh = vi.fn(async () => 'refreshed');

    await expect(
      runSavedGlookoConnectionCheck(
        { configured: true, credentialGeneration: 8 },
        {
          automaticEnabled: false,
          sessionStatus: 'needs-sign-in',
          consecutiveFailures: 1,
          verifiedAccountFingerprint: ACCOUNT_FINGERPRINT,
          lastErrorCode: 'session-required',
        },
        verify,
        refresh,
      ),
    ).resolves.toBe('recovered');
    expect(verify).toHaveBeenCalledWith(8, false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps an existing-data binding approval across a failed first attempt', async () => {
    const verify = vi.fn(async () => 'recovered');
    const refresh = vi.fn(async () => 'refreshed');

    await runSavedGlookoConnectionCheck(
      { configured: true, credentialGeneration: 4 },
      {
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
        consecutiveFailures: 1,
        pendingExistingDataBinding: true,
        lastErrorCode: 'network',
      },
      verify,
      refresh,
    );

    expect(verify).toHaveBeenCalledWith(4, true);
    expect(refresh).not.toHaveBeenCalled();
  });
});
