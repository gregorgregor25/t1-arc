import {
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
  getGlucoseAlerts(): Promise<{
    lowEnabled: boolean;
    lowThresholdMmolL: number;
    highEnabled: boolean;
    highThresholdMmolL: number;
    staleEnabled: boolean;
    repeatMinutes: number;
  }>;
  setGlucoseAppearance(settings: PortablePreferences['glucoseAppearance']): Promise<unknown>;
  setLockScreenVisible(visible: boolean): Promise<unknown>;
  setAodPosition(position: PortablePreferences['glanceableDisplay']['aodPosition']): Promise<unknown>;
  setAodSize(size: PortablePreferences['glanceableDisplay']['aodSize']): Promise<unknown>;
  setWeeklyReviewEnabled(enabled: boolean): Promise<unknown>;
  setGlucoseAlerts(
    settings: PortablePreferences['glucoseAlerts'],
  ): Promise<unknown>;
}

async function nativeAdapter(): Promise<PortablePreferenceAdapter> {
  const [
    { default: DaymarkGlucoseDisplay },
    {
      loadInsightReviewPreferences,
      setWeeklyReviewNotificationEnabled,
    },
    {
      loadGlucoseAlertPreferences,
      resetGlucoseAlertState,
      saveGlucoseAlertPreferences,
    },
  ] = await Promise.all([
    import('../../../modules/daymark-glucose-display'),
    import('@/data/insights/insightReviewPreferences'),
    import('@/data/glucoseAlerts/glucoseAlertPreferences'),
  ]);
  return {
    getDisplayStatus: () => DaymarkGlucoseDisplay.getStatusAsync(),
    getGlucoseAppearance: () =>
      DaymarkGlucoseDisplay.getAppearanceSettingsAsync(),
    getWeeklyReviewEnabled: async () =>
      (await loadInsightReviewPreferences()).weeklyNotificationEnabled,
    getGlucoseAlerts: loadGlucoseAlertPreferences,
    setGlucoseAppearance: (settings) =>
      DaymarkGlucoseDisplay.setAppearanceSettingsAsync(settings),
    setLockScreenVisible: (visible) =>
      DaymarkGlucoseDisplay.setLockScreenVisibleAsync(visible),
    setAodPosition: (position) =>
      DaymarkGlucoseDisplay.setAodPositionAsync(position),
    setAodSize: (size) => DaymarkGlucoseDisplay.setAodSizeAsync(size),
    setWeeklyReviewEnabled: setWeeklyReviewNotificationEnabled,
    setGlucoseAlerts: async (settings) => {
      await saveGlucoseAlertPreferences({ ...settings, enabled: false });
      await resetGlucoseAlertState();
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
    glucoseAlerts,
  ] =
    await Promise.all([
      source.getDisplayStatus(),
      source.getGlucoseAppearance(),
      source.getWeeklyReviewEnabled(),
      source.getGlucoseAlerts(),
    ]);
  return validatePortablePreferences({
    version: PORTABLE_PREFERENCES_VERSION,
    glucoseAppearance,
    glanceableDisplay: {
      lockScreenVisible: display.lockScreenVisible,
      aodPosition: display.aodPosition,
      aodSize: display.aodSize,
    },
    insightReviews: { weeklyNotificationEnabled },
    glucoseAlerts: {
      lowEnabled: glucoseAlerts.lowEnabled,
      lowThresholdMmolL: glucoseAlerts.lowThresholdMmolL,
      highEnabled: glucoseAlerts.highEnabled,
      highThresholdMmolL: glucoseAlerts.highThresholdMmolL,
      staleEnabled: glucoseAlerts.staleEnabled,
      repeatMinutes: glucoseAlerts.repeatMinutes,
    },
  });
}

export async function restorePortablePreferences(
  preferences: PortablePreferences,
  adapter?: PortablePreferenceAdapter,
) {
  const safe = validatePortablePreferences(preferences);
  const destination = adapter ?? (await nativeAdapter());
  await destination.setGlucoseAppearance(safe.glucoseAppearance);
  await destination.setAodPosition(safe.glanceableDisplay.aodPosition);
  await destination.setAodSize(safe.glanceableDisplay.aodSize);
  await destination.setLockScreenVisible(
    safe.glanceableDisplay.lockScreenVisible,
  );
  await destination.setWeeklyReviewEnabled(
    safe.insightReviews.weeklyNotificationEnabled,
  );
  await destination.setGlucoseAlerts(safe.glucoseAlerts);
  return safe;
}
