import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePortablePreferences, restorePortablePreferences } from '@/data/backup/portablePreferences';
import { DEFAULT_GLUCOSE_ALARM_CONFIGURATION, type GlucoseAlarmConfiguration } from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';

const mocks = vi.hoisted(() => ({
  configuration: null as GlucoseAlarmConfiguration | null,
  events: [] as string[],
  saveNative: vi.fn(), getNative: vi.fn(), getAppearance: vi.fn(), getStatus: vi.fn(),
  setAppearance: vi.fn(), saveLegacy: vi.fn(), resetLegacy: vi.fn(),
}));
vi.mock('../modules/t1arc-glucose-display', () => ({ default: {
  getGlucoseAlarmConfigurationAsync: mocks.getNative,
  saveGlucoseAlarmConfigurationAsync: mocks.saveNative,
  getGlucoseAlarmStatusAsync: mocks.getStatus,
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

const CUSTOM = 'custom:12345678-1234-1234-1234-123456789abc';
const STATUS = {
  configured: true, enabled: true, audioEnabled: true, audioArmed: true, activeKind: null, episodeId: null,
  readingTimestampMs: null, snoozedUntilMs: null, lowPausedUntilMs: null, maxSnoozeMinutes: 1440,
  acknowledged: false, missing: false, playbackState: 'idle', readinessIssues: [], customSounds: [],
};

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
    mocks.getStatus.mockResolvedValue({ ...STATUS, customSounds: [{ id: CUSTOM, name: 'Kitchen bell' }] });
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
    // A version 6 backup carries no full alarm choices.
    preferences.glucoseAlarms = null;
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

  it('captures full alarm choices without the master or sound switch and with sound names only', async () => {
    const result = await capturePortablePreferences();
    expect(result.version).toBe(7);
    expect(result.glucoseAlarms?.configuration).toMatchObject({
      schemaVersion: 2, urgentLowEnabled: true, urgentLowThresholdMmolL: 3, lowThresholdMmolL: 4.1,
      veryHighEnabled: true, veryHighThresholdMmolL: 18, nightEnabled: true, lowSound: CUSTOM,
      highPersistMinutes: 0, hypoTreatmentSnoozeMinutes: 15,
    });
    expect(result.glucoseAlarms?.configuration).not.toHaveProperty('enabled');
    expect(result.glucoseAlarms?.configuration).not.toHaveProperty('audioEnabled');
    expect(result.glucoseAlarms?.customSounds).toEqual([{ id: CUSTOM, name: 'Kitchen bell' }]);
    expect(JSON.stringify(result.glucoseAlarms)).not.toMatch(/file:|content:|\/data\//);
    expect(mocks.saveNative).not.toHaveBeenCalled();
  });

  it('restores full alarm choices switched off and keeps an available custom sound', async () => {
    const preferences = await capturePortablePreferences();
    const outcome = await restorePortablePreferences(preferences);
    expect(mocks.events).toEqual(['native disabled', 'legacy saved', 'native disabled']);
    expect(mocks.configuration).toMatchObject({
      enabled: false, audioEnabled: false, lowThresholdMmolL: 4.1, highThresholdMmolL: 12,
      veryHighEnabled: true, veryHighThresholdMmolL: 18, nightEnabled: true, lowSound: CUSTOM,
      urgentLowEnabled: true, urgentLowThresholdMmolL: 3,
    });
    expect(outcome.notices).toEqual([expect.stringMatching(/restored switched off/)]);
  });

  it('falls back to the built-in sound when a custom sound is not on this phone, and says so', async () => {
    const preferences = await capturePortablePreferences();
    mocks.getStatus.mockResolvedValue({ ...STATUS, customSounds: [] });
    const outcome = await restorePortablePreferences(preferences);
    expect(mocks.configuration).toMatchObject({ enabled: false, audioEnabled: false, lowSound: 'pulse' });
    expect(outcome.notices).toContainEqual(expect.stringMatching(/“Kitchen bell” is not on this phone, so low alerts use the built-in Steady pulse sound/));
  });

  it('upgrades version 1 native choices on an older native build before backing them up', async () => {
    const v1: Record<string, unknown> = { ...mocks.configuration!, schemaVersion: 1 };
    for (const key of ['urgentLowEnabled', 'urgentLowThresholdMmolL', 'urgentLowSound', 'highPersistMinutes', 'hypoTreatmentSnoozeMinutes']) delete v1[key];
    mocks.getNative.mockResolvedValue(v1);
    const result = await capturePortablePreferences();
    expect(result.glucoseAlarms?.configuration).toMatchObject({
      schemaVersion: 2, urgentLowEnabled: true, urgentLowThresholdMmolL: 3, urgentLowSound: CUSTOM,
      highPersistMinutes: 0, hypoTreatmentSnoozeMinutes: 15,
    });
  });

  it('retains the legacy-only restore path before explicit native configuration', async () => {
    mocks.configuration = null;
    const preferences = await capturePortablePreferences();
    expect(preferences.glucoseAlerts.lowThresholdMmolL).toBe(DEFAULT_GLUCOSE_ALERT_PREFERENCES.lowThresholdMmolL);
    expect(preferences.glucoseAlarms).toBeNull();
    await restorePortablePreferences(preferences);
    expect(mocks.saveNative).not.toHaveBeenCalled();
    expect(mocks.saveLegacy).toHaveBeenCalledWith({ ...preferences.glucoseAlerts, enabled: false });
  });
});
