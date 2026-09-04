import type { SQLiteDatabase } from 'expo-sqlite';

import {
  getIncludedPortablePreferenceGroups,
  PORTABLE_PREFERENCES_VERSION,
  PortablePreferences,
  validatePortablePreferences,
} from '@/domain/portablePreferences';

export interface PortablePreferenceAdapter {
  getDisplayStatus(): Promise<{
    lockScreenVisible: boolean;
    aodPosition: string;
    aodSize: string;
  }>;
  getGlucoseAppearance(): Promise<unknown>;
  getWeeklyReviewEnabled(): Promise<boolean>;
  getWeeklyReviewTiming(): Promise<{
    reviewWeekday: number;
    reviewHour: number;
    reviewMinute: number;
  }>;
  getGlucoseAlerts(): Promise<{
    lowEnabled: boolean;
    lowThresholdMmolL: number;
    highEnabled: boolean;
    highThresholdMmolL: number;
    staleEnabled: boolean;
    repeatMinutes: number;
  }>;
  getThemePreference(): Promise<PortablePreferences['themeMode']>;
  getStepGoal(): Promise<number | undefined>;
  getTreatmentProfile(): Promise<PortablePreferences['treatmentProfile']>;
  getRegionalProfile(): Promise<PortablePreferences['regionalProfile']>;
  setGlucoseAppearance(
    settings: PortablePreferences['glucoseAppearance'],
  ): Promise<unknown>;
  setLockScreenVisible(visible: boolean): Promise<unknown>;
  setAodPosition(
    position: PortablePreferences['glanceableDisplay']['aodPosition'],
  ): Promise<unknown>;
  setAodSize(
    size: PortablePreferences['glanceableDisplay']['aodSize'],
  ): Promise<unknown>;
  setWeeklyReviewEnabled(enabled: boolean): Promise<unknown>;
  setWeeklyReviewTiming(timing: {
    reviewWeekday: number;
    reviewHour: number;
    reviewMinute: number;
  }): Promise<unknown>;
  setGlucoseAlerts(
    settings: PortablePreferences['glucoseAlerts'],
  ): Promise<unknown>;
  setThemePreference(
    mode: NonNullable<PortablePreferences['themeMode']>,
  ): Promise<unknown>;
  setStepGoal(value?: number): Promise<unknown>;
  setTreatmentProfile(
    profile: PortablePreferences['treatmentProfile'],
  ): Promise<unknown>;
  setRegionalProfile(
    profile: NonNullable<PortablePreferences['regionalProfile']>,
  ): Promise<unknown>;
}

async function nativeAdapter(): Promise<PortablePreferenceAdapter> {
  const [
    { default: T1ArcGlucoseDisplay },
    {
      loadInsightReviewPreferences,
      setWeeklyReviewNotificationEnabled,
      setWeeklyReviewTiming,
    },
    {
      loadGlucoseAlertPreferences,
      resetGlucoseAlertState,
      saveGlucoseAlertPreferences,
    },
    { loadThemePreference, saveThemePreference },
    { loadStepGoal, saveStepGoal },
    {
      clearTarvisTreatmentProfile,
      loadTarvisTreatmentProfile,
      saveTarvisTreatmentProfile,
    },
    { loadRegionalProfile, saveRegionalProfile },
  ] = await Promise.all([
    import('../../../modules/t1arc-glucose-display'),
    import('@/data/insights/insightReviewPreferences'),
    import('@/data/glucoseAlerts/glucoseAlertPreferences'),
    import('@/data/themePreference'),
    import('@/data/healthGoals'),
    import('@/data/tarvis/treatmentProfile'),
    import('@/data/regionalProfile'),
  ]);
  return {
    getDisplayStatus: () => T1ArcGlucoseDisplay.getStatusAsync(),
    getGlucoseAppearance: () =>
      T1ArcGlucoseDisplay.getAppearanceSettingsAsync(),
    getWeeklyReviewEnabled: async () =>
      (await loadInsightReviewPreferences()).weeklyNotificationEnabled,
    getWeeklyReviewTiming: async () => {
      const [preferences, { getRuntimeRegionalDefaults }] = await Promise.all([
        loadInsightReviewPreferences(),
        import('@/domain/regionalProfileRuntime'),
      ]);
      return {
        reviewWeekday:
          preferences.reviewWeekday ??
          getRuntimeRegionalDefaults().firstDayOfWeek,
        reviewHour: preferences.reviewHour ?? 7,
        reviewMinute: preferences.reviewMinute ?? 0,
      };
    },
    getGlucoseAlerts: loadGlucoseAlertPreferences,
    getThemePreference: loadThemePreference,
    getStepGoal: loadStepGoal,
    getTreatmentProfile: async () =>
      (await loadTarvisTreatmentProfile()) ?? null,
    getRegionalProfile: loadRegionalProfile,
    setGlucoseAppearance: (settings) =>
      T1ArcGlucoseDisplay.setAppearanceSettingsAsync(settings),
    setLockScreenVisible: (visible) =>
      T1ArcGlucoseDisplay.setLockScreenVisibleAsync(visible),
    setAodPosition: (position) =>
      T1ArcGlucoseDisplay.setAodPositionAsync(position),
    setAodSize: (size) => T1ArcGlucoseDisplay.setAodSizeAsync(size),
    setWeeklyReviewEnabled: setWeeklyReviewNotificationEnabled,
    setWeeklyReviewTiming,
    setGlucoseAlerts: async (settings) => {
      await saveGlucoseAlertPreferences({ ...settings, enabled: false });
      await resetGlucoseAlertState();
    },
    setThemePreference: saveThemePreference,
    setStepGoal: saveStepGoal,
    setTreatmentProfile: (profile) =>
      profile
        ? saveTarvisTreatmentProfile(profile.carbRatioSchedule)
        : clearTarvisTreatmentProfile(),
    setRegionalProfile: saveRegionalProfile,
  };
}

export async function capturePortablePreferences(
  adapter?: PortablePreferenceAdapter,
) {
  const source = adapter ?? (await nativeAdapter());
  const [
    display,
    glucoseAppearance,
    weeklyNotificationEnabled,
    weeklyReviewTiming,
    glucoseAlerts,
    themeMode,
    dailyStepGoal,
    treatmentProfile,
    regionalProfile,
  ] = await Promise.all([
    source.getDisplayStatus(),
    source.getGlucoseAppearance(),
    source.getWeeklyReviewEnabled(),
    source.getWeeklyReviewTiming(),
    source.getGlucoseAlerts(),
    source.getThemePreference(),
    source.getStepGoal(),
    source.getTreatmentProfile(),
    source.getRegionalProfile(),
  ]);
  return validatePortablePreferences({
    version: PORTABLE_PREFERENCES_VERSION,
    glucoseAppearance,
    glanceableDisplay: {
      lockScreenVisible: display.lockScreenVisible,
      aodPosition: display.aodPosition,
      aodSize: display.aodSize,
    },
    insightReviews: { weeklyNotificationEnabled, ...weeklyReviewTiming },
    glucoseAlerts: {
      lowEnabled: glucoseAlerts.lowEnabled,
      lowThresholdMmolL: glucoseAlerts.lowThresholdMmolL,
      highEnabled: glucoseAlerts.highEnabled,
      highThresholdMmolL: glucoseAlerts.highThresholdMmolL,
      staleEnabled: glucoseAlerts.staleEnabled,
      repeatMinutes: glucoseAlerts.repeatMinutes,
    },
    themeMode,
    healthGoals: {
      dailyStepGoal: dailyStepGoal ?? null,
    },
    treatmentProfile,
    regionalProfile,
  });
}

export async function restorePortablePreferences(
  preferences: PortablePreferences,
  adapter?: PortablePreferenceAdapter,
) {
  const safe = validatePortablePreferences(preferences);
  const destination = adapter ?? (await nativeAdapter());
  return restoreValidatedPortablePreferences(safe, destination);
}

/**
 * Migration-only preference restoration that reuses the caller's active SQL
 * transaction for the SQLite-backed weekly-review settings. All remaining
 * preferences retain the same native/SecureStore path and are compensated by
 * the migration owner if its database transaction fails.
 */
export async function restorePortablePreferencesInTransaction(
  preferences: PortablePreferences,
  transaction: SQLiteDatabase,
) {
  const safe = validatePortablePreferences(preferences);
  const [destination, { restoreInsightReviewPreferencesInTransaction }] =
    await Promise.all([
      nativeAdapter(),
      import('@/data/insights/insightReviewPreferences'),
    ]);
  return restoreValidatedPortablePreferences(safe, destination, () =>
    restoreInsightReviewPreferencesInTransaction(
      transaction,
      safe.insightReviews,
    ),
  );
}

async function restoreValidatedPortablePreferences(
  safe: PortablePreferences,
  destination: PortablePreferenceAdapter,
  restoreInsightReviews?: () => Promise<unknown>,
) {
  const includedGroups = getIncludedPortablePreferenceGroups(safe);
  await destination.setGlucoseAppearance(safe.glucoseAppearance);
  await destination.setAodPosition(safe.glanceableDisplay.aodPosition);
  await destination.setAodSize(safe.glanceableDisplay.aodSize);
  await destination.setLockScreenVisible(
    safe.glanceableDisplay.lockScreenVisible,
  );
  if (restoreInsightReviews) {
    await restoreInsightReviews();
  } else {
    await destination.setWeeklyReviewEnabled(
      safe.insightReviews.weeklyNotificationEnabled,
    );
    if (
      safe.insightReviews.reviewWeekday !== null &&
      safe.insightReviews.reviewHour !== null &&
      safe.insightReviews.reviewMinute !== null
    ) {
      await destination.setWeeklyReviewTiming({
        reviewWeekday: safe.insightReviews.reviewWeekday,
        reviewHour: safe.insightReviews.reviewHour,
        reviewMinute: safe.insightReviews.reviewMinute,
      });
    }
  }
  if (includedGroups.includes('glucoseAlerts')) {
    await destination.setGlucoseAlerts(safe.glucoseAlerts);
  }
  if (includedGroups.includes('themeMode') && safe.themeMode !== null) {
    await destination.setThemePreference(safe.themeMode);
  }
  if (includedGroups.includes('healthGoals') && safe.healthGoals !== null) {
    await destination.setStepGoal(safe.healthGoals.dailyStepGoal ?? undefined);
  }
  if (includedGroups.includes('treatmentProfile')) {
    await destination.setTreatmentProfile(safe.treatmentProfile);
  }
  if (
    includedGroups.includes('regionalProfile') &&
    safe.regionalProfile !== null
  ) {
    await destination.setRegionalProfile(safe.regionalProfile);
  }
  return safe;
}
