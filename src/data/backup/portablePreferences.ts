import type { SQLiteDatabase } from 'expo-sqlite';
import {
  GLUCOSE_ALARM_BUILT_IN_SOUND,
  GLUCOSE_ALARM_KINDS,
  GLUCOSE_ALARM_SOUND_KEYS,
  type GlucoseAlarmConfiguration,
  type GlucoseAlarmKind,
  upgradeGlucoseAlarmConfiguration,
  validateGlucoseAlarmConfiguration,
} from '@/domain/glucoseAlarms';

import {
  getIncludedPortablePreferenceGroups,
  PORTABLE_GLUCOSE_ALARM_CONFIGURATION_KEYS,
  PORTABLE_PREFERENCES_VERSION,
  type PortableGlucoseAlarmConfiguration,
  type PortableGlucoseAlarmSettings,
  PortablePreferences,
  validatePortablePreferences,
} from '@/domain/portablePreferences';

export interface PortablePreferenceRestoreOutcome {
  preferences: PortablePreferences;
  /** Plain-language notes for the restore summary, such as a replaced sound. */
  notices: string[];
}

const ALARM_KIND_LABELS: Record<GlucoseAlarmKind, string> = {
  urgentLow: 'urgent low', low: 'low', high: 'high', veryHigh: 'very high', stale: 'missing readings',
};

/** Alarm choices without the master or sound switch, plus names of the custom sounds they use. */
export function portableGlucoseAlarmSettings(
  configuration: GlucoseAlarmConfiguration,
  customSounds: readonly { id: string; name: string }[],
): PortableGlucoseAlarmSettings {
  const portable = Object.fromEntries(
    PORTABLE_GLUCOSE_ALARM_CONFIGURATION_KEYS.map((key) => [key, configuration[key]]),
  ) as unknown as PortableGlucoseAlarmConfiguration;
  const used = new Set(Object.values(GLUCOSE_ALARM_SOUND_KEYS).map((key) => configuration[key]));
  return {
    configuration: portable,
    customSounds: customSounds
      .filter((sound) => used.has(sound.id))
      .map((sound) => ({ id: sound.id, name: sound.name.slice(0, 160) })),
  };
}

/**
 * Builds the configuration to save on this phone. Alarms always arrive off.
 * A custom sound that is not on this phone falls back to the built-in sound
 * for that level, and a notice says so.
 */
export function restorableGlucoseAlarmConfiguration(
  settings: PortableGlucoseAlarmSettings,
  availableSoundIds: ReadonlySet<string>,
): { configuration: GlucoseAlarmConfiguration; notices: string[] } {
  const configuration: GlucoseAlarmConfiguration = { ...settings.configuration, enabled: false, audioEnabled: false };
  const notices: string[] = [];
  for (const kind of GLUCOSE_ALARM_KINDS) {
    const key = GLUCOSE_ALARM_SOUND_KEYS[kind];
    const id = configuration[key];
    if (!id.startsWith('custom:') || availableSoundIds.has(id)) continue;
    const fallback = GLUCOSE_ALARM_BUILT_IN_SOUND[kind];
    configuration[key] = fallback;
    const name = settings.customSounds.find((sound) => sound.id === id)?.name.trim();
    notices.push(`${name ? `The sound “${name}”` : 'A custom alarm sound'} is not on this phone, so ${ALARM_KIND_LABELS[kind]} alerts use the built-in ${fallback === 'pulse' ? 'Steady pulse' : 'Two notes'} sound.`);
  }
  return { configuration, notices };
}

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
  getGlucoseAlarms(): Promise<PortablePreferences['glucoseAlarms']>;
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
  /** Saves alarm choices switched off. Resolves with notices for the restore summary. */
  setGlucoseAlarms(
    settings: PortableGlucoseAlarmSettings,
  ): Promise<{ notices: string[] }>;
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
    { getGlucoseAlarmStatus, saveGlucoseAlarmConfiguration },
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
    import('@/data/glucoseAlerts/glucoseAlarms'),
    import('@/data/themePreference'),
    import('@/data/healthGoals'),
    import('@/data/tarvis/treatmentProfile'),
    import('@/data/regionalProfile'),
  ]);
  async function nativeAlarmConfiguration() {
    const configuration = await T1ArcGlucoseDisplay.getGlucoseAlarmConfigurationAsync?.();
    if (configuration === undefined || configuration === null) return undefined;
    const upgraded = upgradeGlucoseAlarmConfiguration(configuration);
    if (!upgraded) throw new Error(validateGlucoseAlarmConfiguration(configuration) ?? 'The alarm choices could not be read.');
    return upgraded;
  }
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
    getGlucoseAlerts: async () => {
      const configuration = await nativeAlarmConfiguration();
      if (!configuration) return loadGlucoseAlertPreferences();
      return {
        lowEnabled: configuration.lowEnabled,
        lowThresholdMmolL: configuration.lowThresholdMmolL,
        highEnabled: configuration.highEnabled,
        highThresholdMmolL: configuration.highThresholdMmolL,
        staleEnabled: configuration.staleEnabled,
        // The portable legacy schema cannot represent the new short reminder
        // intervals. Export no automatic reminder rather than substitute an
        // invented cadence. Native sounds/night/very-high/arming stay local.
        repeatMinutes: [0, 30, 60, 120].includes(configuration.repeatMinutes)
          ? configuration.repeatMinutes
          : 0,
      };
    },
    getThemePreference: loadThemePreference,
    getStepGoal: loadStepGoal,
    getTreatmentProfile: async () =>
      (await loadTarvisTreatmentProfile()) ?? null,
    getRegionalProfile: loadRegionalProfile,
    getGlucoseAlarms: async () => {
      const configuration = await nativeAlarmConfiguration();
      if (!configuration) return null;
      const status = await getGlucoseAlarmStatus();
      return portableGlucoseAlarmSettings(configuration, status.customSounds);
    },
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
      const configuration = await nativeAlarmConfiguration();
      if (configuration) {
        const veryHighConflicts = configuration.veryHighThresholdMmolL !== null &&
          configuration.veryHighThresholdMmolL <= settings.highThresholdMmolL;
        // An additive restore does not pass through the full-erasure epoch.
        // Explicitly disarm the native owner before writing legacy preferences;
        // its ownership fence deliberately ignores legacy enable/disable calls.
        await saveGlucoseAlarmConfiguration({
          ...configuration,
          ...settings,
          enabled: false,
          audioEnabled: false,
          ...(veryHighConflicts ? {
            veryHighEnabled: false,
            veryHighThresholdMmolL: null,
          } : {}),
        });
      }
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
    setGlucoseAlarms: async (settings) => {
      if (!T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync) {
        return { notices: ['Alarm choices in this backup need the updated T1 Arc Android app, so they were not restored.'] };
      }
      const status = await getGlucoseAlarmStatus();
      const { configuration, notices } = restorableGlucoseAlarmConfiguration(
        settings,
        new Set(status.customSounds.map((sound) => sound.id)),
      );
      await saveGlucoseAlarmConfiguration(configuration);
      return {
        notices: [
          'Alarm choices were restored switched off. Check them in alert settings and turn them on when you are ready.',
          ...notices,
        ],
      };
    },
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
    glucoseAlarms,
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
    source.getGlucoseAlarms(),
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
    glucoseAlarms,
  });
}

export async function restorePortablePreferences(
  preferences: PortablePreferences,
  adapter?: PortablePreferenceAdapter,
): Promise<PortablePreferenceRestoreOutcome> {
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
): Promise<PortablePreferenceRestoreOutcome> {
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
): Promise<PortablePreferenceRestoreOutcome> {
  const includedGroups = getIncludedPortablePreferenceGroups(safe);
  const notices: string[] = [];
  // Disarm alarms first. A later preference failure must never mean the
  // restore has silently left the prior native audible owner running.
  if (includedGroups.includes('glucoseAlerts')) {
    await destination.setGlucoseAlerts(safe.glucoseAlerts);
  }
  // Full alarm choices (version 7 and later) always arrive switched off.
  if (includedGroups.includes('glucoseAlarms') && safe.glucoseAlarms !== null) {
    notices.push(...(await destination.setGlucoseAlarms(safe.glucoseAlarms)).notices);
  }
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
  return { preferences: safe, notices };
}
