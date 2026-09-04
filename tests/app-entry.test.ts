import { describe, expect, it, vi } from 'vitest';

import { resolveAppEntry } from '@/navigation/appEntry';

describe('app entry resolution', () => {
  it('does not read unrelated credentials after completed onboarding', async () => {
    const loadLegacyCredentials = vi
      .fn()
      .mockRejectedValue(new Error('locked'));

    await expect(
      resolveAppEntry({
        loadOnboardingComplete: async () => true,
        loadLegacyCredentials,
        markOnboardingComplete: async () => undefined,
      }),
    ).resolves.toBe('app');
    expect(loadLegacyCredentials).not.toHaveBeenCalled();
  });

  it('surfaces an indeterminate secure-store read instead of onboarding', async () => {
    await expect(
      resolveAppEntry({
        loadOnboardingComplete: async () => false,
        loadLegacyCredentials: async () => {
          throw new Error('secure store unavailable');
        },
        markOnboardingComplete: async () => undefined,
      }),
    ).rejects.toThrow('secure store unavailable');
  });

  it('migrates an existing credential user into the app', async () => {
    const markOnboardingComplete = vi.fn().mockResolvedValue(undefined);
    await expect(
      resolveAppEntry({
        loadOnboardingComplete: async () => false,
        loadLegacyCredentials: async () => ({ email: 'saved@example.com' }),
        markOnboardingComplete,
      }),
    ).resolves.toBe('app');
    expect(markOnboardingComplete).toHaveBeenCalledOnce();
  });

  it('shows onboarding only after both reads succeed with no prior setup', async () => {
    await expect(
      resolveAppEntry({
        loadOnboardingComplete: async () => false,
        loadLegacyCredentials: async () => undefined,
        markOnboardingComplete: async () => undefined,
      }),
    ).resolves.toBe('onboarding');
  });
});
