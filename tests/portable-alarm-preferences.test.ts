import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePortablePreferences, restorePortablePreferences } from '@/data/backup/portablePreferences';
import { DEFAULT_GLUCOSE_ALARM_CONFIGURATION, type GlucoseAlarmConfiguration } from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';
import { validatePortablePreferences } from '@/domain/portablePreferences';
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
    // Switched off on its own first, then the merged choices, then legacy.
    expect(mocks.events).toEqual(['native disabled', 'native disabled', 'legacy saved']);
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
      schemaVersion: 2, urgentLowEnabled: false, urgentLowThresholdMmolL: 3, urgentLowSound: CUSTOM,
      highPersistMinutes: 0, hypoTreatmentSnoozeMinutes: 0,
    });
  });

  describe('switching existing alarms off before restoring', () => {
    beforeEach(() => {
      // An armed phone with urgent low on at 3.0 mmol/L.
      mocks.configuration = {
        ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, enabled: true, audioEnabled: true,
        urgentLowEnabled: true, urgentLowThresholdMmolL: 3, lowThresholdMmolL: 3.9, highThresholdMmolL: 12,
      };
    });

    async function backupWith(change: (preferences: Awaited<ReturnType<typeof capturePortablePreferences>>) => void) {
      const preferences = await capturePortablePreferences();
      change(preferences);
      const raw = JSON.parse(JSON.stringify(preferences)) as Record<string, unknown> & { version: number };
      // Review timing was added in version 6.
      if (raw.version < 6) raw.insightReviews = { weeklyNotificationEnabled: preferences.insightReviews.weeklyNotificationEnabled };
      return validatePortablePreferences(raw);
    }

    it('switches alarms off even when an older backup’s low level conflicts with urgent low here', async () => {
      // A version 6 backup with a valid low level of 2.5 mmol/L and no urgent low.
      const preferences = await backupWith(p => {
        p.version = 6 as typeof p.version;
        delete (p as Partial<typeof p>).glucoseAlarms;
        p.glucoseAlerts.lowThresholdMmolL = 2.5;
      });
      const outcome = await restorePortablePreferences(preferences);
      expect(mocks.events[0]).toBe('native disabled');
      expect(mocks.configuration).toMatchObject({
        enabled: false, audioEnabled: false, urgentLowEnabled: true, urgentLowThresholdMmolL: 3, lowThresholdMmolL: 3.9,
      });
      expect(outcome.notices).toContainEqual(expect.stringMatching(/could not be combined[\s\S]*urgent low level must be below the low level[\s\S]*switched off/));
      expect(mocks.saveLegacy).toHaveBeenCalledWith({ ...preferences.glucoseAlerts, enabled: false });
      expect(mocks.setAppearance).toHaveBeenCalled();
    });

    it('applies an older backup’s choices when they fit, after first switching alarms off', async () => {
      const preferences = await backupWith(p => {
        p.version = 6 as typeof p.version;
        delete (p as Partial<typeof p>).glucoseAlarms;
        p.glucoseAlerts.lowThresholdMmolL = 3.6;
      });
      const saved: GlucoseAlarmConfiguration[] = [];
      mocks.saveNative.mockImplementation(async (config: GlucoseAlarmConfiguration) => {
        mocks.events.push('native disabled'); saved.push(config); mocks.configuration = config; return {};
      });
      const outcome = await restorePortablePreferences(preferences);
      expect(saved[0]).toMatchObject({ enabled: false, audioEnabled: false, lowThresholdMmolL: 3.9 });
      expect(mocks.configuration).toMatchObject({ enabled: false, audioEnabled: false, lowThresholdMmolL: 3.6, urgentLowThresholdMmolL: 3 });
      expect(outcome.notices).toEqual([]);
    });

    it('restores a full backup with its own urgent low of 2.3 below a low of 2.5 in one save', async () => {
      const preferences = await backupWith(p => {
        p.glucoseAlerts.lowThresholdMmolL = 2.5;
        p.glucoseAlarms!.configuration.lowThresholdMmolL = 2.5;
        p.glucoseAlarms!.configuration.urgentLowThresholdMmolL = 2.3;
      });
      const saved: GlucoseAlarmConfiguration[] = [];
      mocks.saveNative.mockImplementation(async (config: GlucoseAlarmConfiguration) => {
        mocks.events.push('native disabled'); saved.push(config); mocks.configuration = config; return {};
      });
      const outcome = await restorePortablePreferences(preferences);
      // First the phone's own choices switched off, then the complete restored choices.
      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({ enabled: false, audioEnabled: false, urgentLowThresholdMmolL: 3, lowThresholdMmolL: 3.9 });
      expect(saved[1]).toMatchObject({
        enabled: false, audioEnabled: false, urgentLowEnabled: true, urgentLowThresholdMmolL: 2.3, lowThresholdMmolL: 2.5,
      });
      expect(outcome.notices).toEqual([expect.stringMatching(/restored switched off/)]);
    });

    it('switches alarms off for a version 1 backup that carries no alert choices', async () => {
      const preferences = await backupWith(p => {
        p.version = 1 as typeof p.version;
        for (const key of ['glucoseAlerts', 'themeMode', 'healthGoals', 'treatmentProfile', 'regionalProfile', 'glucoseAlarms']) {
          delete (p as unknown as Record<string, unknown>)[key];
        }
      });
      await restorePortablePreferences(preferences);
      expect(mocks.events).toEqual(['native disabled']);
      expect(mocks.configuration).toMatchObject({ enabled: false, audioEnabled: false, lowThresholdMmolL: 3.9, urgentLowThresholdMmolL: 3 });
      expect(mocks.saveLegacy).not.toHaveBeenCalled();
    });

    it('switches alarms off for version 2 to 5 backups with a conflicting low level', async () => {
      for (const version of [2, 3, 4, 5] as const) {
        mocks.configuration = { ...mocks.configuration!, enabled: true, audioEnabled: true };
        mocks.events.length = 0;
        const preferences = await backupWith(p => {
          p.version = version as typeof p.version;
          const raw = p as unknown as Record<string, unknown>;
          delete raw.glucoseAlarms;
          if (version < 5) delete raw.regionalProfile;
          if (version < 4) delete raw.treatmentProfile;
          if (version < 3) { delete raw.themeMode; delete raw.healthGoals; }
          p.glucoseAlerts.lowThresholdMmolL = 2.5;
        });
        const outcome = await restorePortablePreferences(preferences);
        expect(mocks.configuration, `version ${version}`).toMatchObject({ enabled: false, audioEnabled: false });
        expect(outcome.notices).toContainEqual(expect.stringMatching(/could not be combined/));
      }
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
