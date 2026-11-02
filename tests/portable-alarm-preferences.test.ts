import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePortablePreferences, restorePortablePreferences } from '@/data/backup/portablePreferences';
import { DEFAULT_GLUCOSE_ALARM_CONFIGURATION, type GlucoseAlarmConfiguration } from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';

const mocks = vi.hoisted(() => ({
  configuration: null as GlucoseAlarmConfiguration | null,
  events: [] as string[],
  saveNative: vi.fn(), getNative: vi.fn(), getAppearance: vi.fn(),
  setAppearance: vi.fn(), saveLegacy: vi.fn(), resetLegacy: vi.fn(),
}));
vi.mock('../modules/t1arc-glucose-display', () => ({ default: {
  getGlucoseAlarmConfigurationAsync: mocks.getNative,
  saveGlucoseAlarmConfigurationAsync: mocks.saveNative,
  getStatusAsync: async () => ({ lockScreenVisible: false, aodPosition: 'topRight', aodSize: 'large' }),
  getAppearanceSettingsAsync: mocks.getAppearance,
  setAppearanceSettingsAsync: mocks.setAppearance,
  setLockScreenVisibleAsync: async () => true,
  setAodPositionAsync: async () => true,
  setAodSizeAsync: async () => true,
} }));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  loadGlucoseAlertPreferences: async () => DEFAULT_GLUCOSE_ALERT_PREFERENCES,
  saveGlucoseAlertPreferences: mocks.saveLegacy,
  resetGlucoseAlertState: mocks.resetLegacy,
}));
vi.mock('@/data/insights/insightReviewPreferences', () => ({
  loadInsightReviewPreferences: async () => ({ weeklyNotificationEnabled: false, reviewWeekday: 1, reviewHour: 7, reviewMinute: 0 }),
  setWeeklyReviewNotificationEnabled: async () => undefined,
  setWeeklyReviewTiming: async () => undefined,
}));
vi.mock('@/data/themePreference', () => ({ loadThemePreference: async () => 'dark', saveThemePreference: async () => undefined }));
vi.mock('@/data/healthGoals', () => ({ loadStepGoal: async () => undefined, saveStepGoal: async () => undefined }));
vi.mock('@/data/tarvis/treatmentProfile', () => ({ loadTarvisTreatmentProfile: async () => null, clearTarvisTreatmentProfile: async () => undefined, saveTarvisTreatmentProfile: async () => undefined }));
vi.mock('@/data/regionalProfile', () => ({ loadRegionalProfile: async () => DEFAULT_REGIONAL_PROFILE, saveRegionalProfile: async () => undefined }));

describe('portable preferences with a configured native alarm owner', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.events.length = 0;
    mocks.configuration = {
      ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION,
      enabled: true,
      audioEnabled: true,
      lowThresholdMmolL: 4.1,
      highThresholdMmolL: 12,
      veryHighEnabled: true,
      veryHighThresholdMmolL: 18,
      nightEnabled: true,
      lowSound: 'custom:12345678-1234-1234-1234-123456789abc',
    };
    mocks.getNative.mockImplementation(async () => mocks.configuration);
    mocks.getAppearance.mockResolvedValue(DEFAULT_GLUCOSE_APPEARANCE);
    mocks.saveNative.mockImplementation(async (config: GlucoseAlarmConfiguration) => {
      mocks.events.push('native disabled');
      mocks.configuration = config;
      return {};
    });
    mocks.saveLegacy.mockImplementation(async () => { mocks.events.push('legacy saved'); });
  });

  it('captures current common levels instead of the obsolete legacy choices without arming audio', async () => {
    const result = await capturePortablePreferences();
    expect(result.glucoseAlerts).toMatchObject({ lowThresholdMmolL: 4.1, highThresholdMmolL: 12, repeatMinutes: 30 });
    expect(JSON.stringify(result.glucoseAlerts)).not.toMatch(/custom:|audioEnabled|veryHigh|nightEnabled/);
    expect(mocks.saveNative).not.toHaveBeenCalled();
  });

  it('exports an unsupported short native cadence as no automatic portable reminder', async () => {
    mocks.configuration!.repeatMinutes = 5;
    expect((await capturePortablePreferences()).glucoseAlerts.repeatMinutes).toBe(0);
  });

  it('disarms native alarms before legacy restore while retaining local sounds and night choices', async () => {
    const preferences = await capturePortablePreferences();
    preferences.glucoseAlerts.highThresholdMmolL = 20;
    await restorePortablePreferences(preferences);
    expect(mocks.events).toEqual(['native disabled', 'legacy saved']);
    expect(mocks.configuration).toMatchObject({
      enabled: false, audioEnabled: false, highThresholdMmolL: 20,
      veryHighEnabled: false, veryHighThresholdMmolL: null,
      nightEnabled: true, lowSound: 'custom:12345678-1234-1234-1234-123456789abc',
    });
    expect(mocks.saveLegacy).toHaveBeenCalledWith({ ...preferences.glucoseAlerts, enabled: false });
  });

  it('rejects restore if native disarming fails instead of falling through to legacy writes', async () => {
    const preferences = await capturePortablePreferences();
    mocks.saveNative.mockRejectedValue(new Error('Native alarm store unavailable'));
    await expect(restorePortablePreferences(preferences)).rejects.toThrow(/Native alarm store unavailable/);
    expect(mocks.saveLegacy).not.toHaveBeenCalled();
    expect(mocks.resetLegacy).not.toHaveBeenCalled();
    expect(mocks.setAppearance).not.toHaveBeenCalled();
  });

  it('rejects a failed native configuration lookup before legacy restore', async () => {
    const preferences = await capturePortablePreferences();
    mocks.getNative.mockRejectedValue(new Error('Native owner lookup failed'));
    await expect(restorePortablePreferences(preferences)).rejects.toThrow(/lookup failed/);
    expect(mocks.saveNative).not.toHaveBeenCalled();
    expect(mocks.saveLegacy).not.toHaveBeenCalled();
  });

  it('retains the legacy-only restore path before explicit native configuration', async () => {
    mocks.configuration = null;
    const preferences = await capturePortablePreferences();
    expect(preferences.glucoseAlerts.lowThresholdMmolL).toBe(DEFAULT_GLUCOSE_ALERT_PREFERENCES.lowThresholdMmolL);
    await restorePortablePreferences(preferences);
    expect(mocks.saveNative).not.toHaveBeenCalled();
    expect(mocks.saveLegacy).toHaveBeenCalledWith({ ...preferences.glucoseAlerts, enabled: false });
  });
});
