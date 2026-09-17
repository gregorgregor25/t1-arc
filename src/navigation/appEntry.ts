export type AppEntryDestination = 'onboarding' | 'app';

interface AppEntryDependencies<Credentials> {
  loadOnboardingComplete(): Promise<boolean>;
  loadLegacyCredentials(): Promise<Credentials | undefined>;
  markOnboardingComplete(): Promise<void>;
}

/**
 * Resolve the first screen without letting an unrelated credential read
 * override a completed onboarding marker. A failed read is intentionally
 * allowed to reject so the shell can show a retry state rather than
 * presenting first-run setup to an existing user.
 */
export async function resolveAppEntry<Credentials>({
  loadOnboardingComplete,
  loadLegacyCredentials,
  markOnboardingComplete,
}: AppEntryDependencies<Credentials>): Promise<AppEntryDestination> {
  const completed = await loadOnboardingComplete();
  if (completed) return 'app';

  const credentials = await loadLegacyCredentials();
  if (!credentials) return 'onboarding';

  // Credentials pre-date the onboarding marker. Do not block entry if the
  // best-effort migration cannot write the marker on this launch.
  await markOnboardingComplete().catch(() => undefined);
  return 'app';
}
