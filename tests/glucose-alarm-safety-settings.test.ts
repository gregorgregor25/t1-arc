import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGlucoseAlarmStatus,
  normalizeGlucoseAlarmStatus,
  pauseLowGlucoseAlarmAfterHypoTreatment,
  snoozeGlucoseAlarm,
} from '@/data/glucoseAlerts/glucoseAlarms';
import {
  portableGlucoseAlarmSettings,
  restorableGlucoseAlarmConfiguration,
} from '@/data/backup/portablePreferences';
import {
  DEFAULT_GLUCOSE_ALARM_CONFIGURATION as defaults,
  GLUCOSE_ALARM_HIGH_PERSIST_MINUTES,
  GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES,
  customClockSnoozeUntil,
  glucoseAlarmConfigurationFromLegacy,
  glucoseAlarmSnoozeOptions,
  glucoseAlarmSnoozeUntil,
  hypoTreatmentPauseNotice,
  maxGlucoseAlarmSnoozeMinutes,
  migratedUrgentLow,
  type GlucoseAlarmConfiguration,
  type GlucoseAlarmStatus,
  upgradeGlucoseAlarmConfiguration,
  validateGlucoseAlarmConfiguration,
} from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import {
  getIncludedPortablePreferenceGroups,
  PORTABLE_PREFERENCES_VERSION,
  validatePortablePreferences,
} from '@/domain/portablePreferences';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';

const mocks = vi.hoisted(() => ({ native: {} as Record<string, unknown> }));
vi.mock('../modules/t1arc-glucose-display', () => ({ default: mocks.native }));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({ loadGlucoseAlertPreferences: vi.fn() }));

const CUSTOM = 'custom:12345678-1234-1234-1234-123456789abc';
const OTHER = 'custom:abcdefab-1234-1234-1234-123456789abc';

function v1(config: GlucoseAlarmConfiguration = defaults): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...config, schemaVersion: 1 };
  for (const key of ['urgentLowEnabled', 'urgentLowThresholdMmolL', 'urgentLowSound', 'highPersistMinutes', 'hypoTreatmentSnoozeMinutes']) delete legacy[key];
  return legacy;
}

const STATUS: GlucoseAlarmStatus = {
  configured: true, enabled: true, audioEnabled: true, audioArmed: true, activeKind: null, episodeId: null,
  readingTimestampMs: null, snoozedUntilMs: null, lowPausedUntilMs: null, maxSnoozeMinutes: 1440,
  acknowledged: false, missing: false, playbackState: 'idle', readinessIssues: [], customSounds: [],
};

describe('quiet alarm defaults', () => {
  it('keeps every new alarm quiet until the user turns it on', () => {
    expect(defaults).toMatchObject({
      schemaVersion: 2, enabled: false, audioEnabled: false,
      urgentLowEnabled: true, urgentLowThresholdMmolL: 3,
      highThresholdMmolL: 13.9, veryHighEnabled: false, highPersistMinutes: 0, hypoTreatmentSnoozeMinutes: 15,
    });
    expect(validateGlucoseAlarmConfiguration(defaults)).toBeUndefined();
  });

  it('offers the agreed delay and pause choices', () => {
    expect(GLUCOSE_ALARM_HIGH_PERSIST_MINUTES).toEqual([0, 5, 10, 15, 20, 30]);
    expect(GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES).toEqual([0, 10, 15, 20, 30]);
  });

  it('requires urgent low below low only when both are on', () => {
    expect(validateGlucoseAlarmConfiguration({ ...defaults, urgentLowThresholdMmolL: 3.9 })).toMatch(/below the low level/);
    expect(validateGlucoseAlarmConfiguration({ ...defaults, urgentLowThresholdMmolL: 3.9, urgentLowEnabled: false })).toBeUndefined();
    expect(validateGlucoseAlarmConfiguration({ ...defaults, urgentLowThresholdMmolL: 3.9, lowEnabled: false })).toBeUndefined();
  });
});

describe('upgrading older alarm choices', () => {
  it('matches the native urgent-low upgrade rule', () => {
    expect(migratedUrgentLow(true, 3.9)).toEqual({ enabled: true, thresholdMmolL: 3 });
    expect(migratedUrgentLow(false, 3.9)).toEqual({ enabled: false, thresholdMmolL: 3 });
    expect(migratedUrgentLow(true, 3)).toEqual({ enabled: true, thresholdMmolL: 2.8 });
    expect(migratedUrgentLow(true, 2.5)).toEqual({ enabled: true, thresholdMmolL: 2.3 });
    expect(migratedUrgentLow(true, 2.1)).toEqual({ enabled: false, thresholdMmolL: 2 });
    expect(migratedUrgentLow(true, Number.NaN)).toEqual({ enabled: false, thresholdMmolL: 2 });
  });

  it('upgrades version 1 without changing the master or sound switch', () => {
    for (const [enabled, audioEnabled] of [[false, false], [true, false], [true, true]] as const) {
      const upgraded = upgradeGlucoseAlarmConfiguration(v1({ ...defaults, enabled, audioEnabled, lowSound: CUSTOM }));
      expect(upgraded).toMatchObject({
        schemaVersion: 2, enabled, audioEnabled, urgentLowEnabled: true, urgentLowThresholdMmolL: 3,
        urgentLowSound: CUSTOM, highPersistMinutes: 0, hypoTreatmentSnoozeMinutes: 15,
      });
      expect(validateGlucoseAlarmConfiguration(upgraded)).toBeUndefined();
    }
  });

  it('leaves urgent low off when low alerts were off', () => {
    expect(upgradeGlucoseAlarmConfiguration(v1({ ...defaults, lowEnabled: false }))).toMatchObject({ urgentLowEnabled: false, lowEnabled: false });
  });

  it('drops unknown fields and rejects invalid choices', () => {
    expect(upgradeGlucoseAlarmConfiguration({ ...defaults, extra: 'x' })).not.toHaveProperty('extra');
    expect(upgradeGlucoseAlarmConfiguration({ ...defaults, volume: 4 })).toBeUndefined();
    expect(upgradeGlucoseAlarmConfiguration({ ...v1(), lowThresholdMmolL: 'low' })).toBeUndefined();
    expect(upgradeGlucoseAlarmConfiguration(null)).toBeUndefined();
  });

  it('seeds urgent low from older in-app alert choices without turning on sound', () => {
    const seeded = glucoseAlarmConfigurationFromLegacy({ ...DEFAULT_GLUCOSE_ALERT_PREFERENCES, enabled: true, lowThresholdMmolL: 3 });
    expect(seeded).toMatchObject({ enabled: true, audioEnabled: false, urgentLowEnabled: true, urgentLowThresholdMmolL: 2.8 });
  });
});

describe('urgent low snooze cap', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  it('caps urgent low at 30 minutes and leaves other levels at 24 hours', () => {
    expect(maxGlucoseAlarmSnoozeMinutes('urgentLow')).toBe(30);
    expect(maxGlucoseAlarmSnoozeMinutes('low')).toBe(1440);
    expect(glucoseAlarmSnoozeOptions(30)).toEqual([5, 10, 15, 20, 30]);
    expect(glucoseAlarmSnoozeOptions()).toEqual([5, 10, 15, 20, 30, 60]);
    expect(glucoseAlarmSnoozeUntil(30, now, 30)).toBe(now + 30 * 60_000);
    expect(() => glucoseAlarmSnoozeUntil(60, now, 30)).toThrow(/up to 30 minutes/);
    expect(() => customClockSnoozeUntil(13, 0, now, 'UTC', 30)).toThrow(/up to 30 minutes/);
    expect(customClockSnoozeUntil(12, 30, now, 'UTC', 30)).toBe(now + 30 * 60_000);
  });
});

describe('hypo treatment confirmation', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const clock = (timestamp: number) => new Date(timestamp).toISOString().slice(11, 16);
  it('says how long low alerts are paused and that urgent low still sounds', () => {
    expect(hypoTreatmentPauseNotice(now + 15 * 60_000, now, clock)).toBe('Low glucose alerts are paused for 15 minutes, until 12:15. Urgent low alerts still sound.');
    expect(hypoTreatmentPauseNotice(now + 30_000, now, clock)).toMatch(/for 1 minute,/);
    expect(hypoTreatmentPauseNotice(null, now, clock)).toBeUndefined();
    expect(hypoTreatmentPauseNotice(now, now, clock)).toBeUndefined();
  });
});

describe('native alarm wrappers', () => {
  beforeEach(() => { for (const key of Object.keys(mocks.native)) delete mocks.native[key]; });

  it('fills status fields that an older native build does not report', () => {
    const { audioArmed, lowPausedUntilMs, maxSnoozeMinutes, ...old } = { ...STATUS, activeKind: 'urgentLow' as const };
    expect([audioArmed, lowPausedUntilMs, maxSnoozeMinutes]).toHaveLength(3);
    expect(normalizeGlucoseAlarmStatus(old as GlucoseAlarmStatus)).toMatchObject({ audioArmed: true, lowPausedUntilMs: null, maxSnoozeMinutes: 30 });
  });

  it('reports arming from the saved choices after a restart', async () => {
    mocks.native.getGlucoseAlarmStatusAsync = vi.fn(async () => ({ ...STATUS, audioArmed: true }));
    expect((await getGlucoseAlarmStatus()).audioArmed).toBe(true);
    delete mocks.native.getGlucoseAlarmStatusAsync;
    expect(await getGlucoseAlarmStatus()).toMatchObject({ audioArmed: false, enabled: false });
  });

  it('refuses an urgent low snooze beyond the cap before calling native code', async () => {
    const snooze = vi.fn(async () => STATUS);
    mocks.native.snoozeGlucoseAlarmAsync = snooze;
    await expect(snoozeGlucoseAlarm('episode', Date.now() + 45 * 60_000, 30)).rejects.toThrow(/up to 30 minutes/);
    expect(snooze).not.toHaveBeenCalled();
  });

  it('pauses only through the native owner and never invents a pause', async () => {
    await expect(pauseLowGlucoseAlarmAfterHypoTreatment(Date.now())).resolves.toEqual({ pausedUntilMs: null, minutes: 0 });
    const pause = vi.fn(async (): Promise<{ pausedUntilMs: number | null; minutes: number }> => ({ pausedUntilMs: 1_800_000_000_000, minutes: 15 }));
    mocks.native.pauseGlucoseLowAlarmAfterHypoTreatmentAsync = pause;
    await expect(pauseLowGlucoseAlarmAfterHypoTreatment(1_799_999_100_000)).resolves.toEqual({ pausedUntilMs: 1_800_000_000_000, minutes: 15 });
    expect(pause).toHaveBeenCalledWith(1_799_999_100_000);
    pause.mockResolvedValueOnce({ pausedUntilMs: null, minutes: 15 });
    await expect(pauseLowGlucoseAlarmAfterHypoTreatment(1_799_999_100_000)).resolves.toEqual({ pausedUntilMs: null, minutes: 0 });
    await expect(pauseLowGlucoseAlarmAfterHypoTreatment(Number.NaN)).rejects.toThrow(/not valid/);
  });
});

describe('alarm choices in encrypted backups', () => {
  const base = {
    glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
    glanceableDisplay: { lockScreenVisible: false, aodPosition: 'topRight', aodSize: 'large' },
    insightReviews: { weeklyNotificationEnabled: false, reviewWeekday: 1, reviewHour: 7, reviewMinute: 0 },
    glucoseAlerts: { lowEnabled: true, lowThresholdMmolL: 3.9, highEnabled: true, highThresholdMmolL: 13.9, staleEnabled: false, repeatMinutes: 30 },
    themeMode: 'dark',
    healthGoals: { dailyStepGoal: null },
    treatmentProfile: null,
    regionalProfile: DEFAULT_REGIONAL_PROFILE,
  };
  const armed: GlucoseAlarmConfiguration = {
    ...defaults, enabled: true, audioEnabled: true, lowSound: CUSTOM, urgentLowSound: OTHER,
    highPersistMinutes: 15, nightEnabled: true, repeatMinutes: 10,
  };

  it('stores choices without the master or sound switch and keeps only used sound names', () => {
    const settings = portableGlucoseAlarmSettings(armed, [
      { id: CUSTOM, name: 'Kitchen bell' }, { id: OTHER, name: 'Loud horn' },
      { id: 'custom:00000000-0000-0000-0000-000000000000', name: 'Unused' },
    ]);
    expect(settings.configuration).not.toHaveProperty('enabled');
    expect(settings.configuration).not.toHaveProperty('audioEnabled');
    expect(settings.customSounds.map(sound => sound.name)).toEqual(['Kitchen bell', 'Loud horn']);
  });

  it('round-trips version 7 and restores alarms switched off', () => {
    const glucoseAlarms = portableGlucoseAlarmSettings(armed, [{ id: CUSTOM, name: 'Kitchen bell' }, { id: OTHER, name: 'Loud horn' }]);
    const parsed = validatePortablePreferences(JSON.parse(JSON.stringify({ version: PORTABLE_PREFERENCES_VERSION, ...base, glucoseAlarms })));
    expect(PORTABLE_PREFERENCES_VERSION).toBe(7);
    expect(parsed.glucoseAlarms).toEqual(glucoseAlarms);
    expect(getIncludedPortablePreferenceGroups(parsed)).toContain('glucoseAlarms');
    const restored = restorableGlucoseAlarmConfiguration(parsed.glucoseAlarms!, new Set([CUSTOM, OTHER]));
    expect(restored.configuration).toEqual({ ...armed, enabled: false, audioEnabled: false });
    expect(restored.notices).toEqual([]);
  });

  it('falls back to built-in sounds for missing custom sounds and says which', () => {
    const glucoseAlarms = portableGlucoseAlarmSettings({ ...armed, highSound: OTHER }, [{ id: CUSTOM, name: 'Kitchen bell' }]);
    const restored = restorableGlucoseAlarmConfiguration(glucoseAlarms, new Set());
    expect(restored.configuration).toMatchObject({ urgentLowSound: 'pulse', lowSound: 'pulse', highSound: 'notes', enabled: false, audioEnabled: false });
    expect(restored.notices).toEqual([
      'A custom alarm sound is not on this phone, so urgent low alerts use the built-in Steady pulse sound.',
      'The sound “Kitchen bell” is not on this phone, so low alerts use the built-in Steady pulse sound.',
      'A custom alarm sound is not on this phone, so high alerts use the built-in Two notes sound.',
    ]);
    expect(validateGlucoseAlarmConfiguration(restored.configuration)).toBeUndefined();
  });

  it('rejects a backup that tries to carry the master or sound switch, or unsafe sound data', () => {
    const glucoseAlarms = portableGlucoseAlarmSettings(armed, []);
    const payload = (alarms: unknown) => ({ version: 7, ...base, glucoseAlarms: alarms });
    expect(() => validatePortablePreferences(payload({ ...glucoseAlarms, configuration: { ...glucoseAlarms.configuration, enabled: true } }))).toThrow(/alarm settings/);
    expect(() => validatePortablePreferences(payload({ ...glucoseAlarms, configuration: { ...glucoseAlarms.configuration, audioEnabled: true } }))).toThrow(/alarm settings/);
    expect(() => validatePortablePreferences(payload({ ...glucoseAlarms, customSounds: [{ id: 'file:///sdcard/a.mp3', name: 'a' }] }))).toThrow(/alarm settings/);
    expect(() => validatePortablePreferences(payload({ ...glucoseAlarms, customSounds: [{ id: CUSTOM, name: 'a', audio: 'AAAA' }] }))).toThrow(/alarm settings/);
    expect(() => validatePortablePreferences(payload({ ...glucoseAlarms, configuration: { ...glucoseAlarms.configuration, urgentLowThresholdMmolL: 1 } }))).toThrow(/urgent low/);
    expect(validatePortablePreferences(payload(null)).glucoseAlarms).toBeNull();
  });

  it.each([1, 2, 3, 4, 5, 6])('keeps a version %i backup restorable without inventing alarm choices', version => {
    const keys: Record<number, string[]> = {
      1: ['glucoseAppearance', 'glanceableDisplay'],
      2: ['glucoseAppearance', 'glanceableDisplay', 'glucoseAlerts'],
      3: ['glucoseAppearance', 'glanceableDisplay', 'glucoseAlerts', 'themeMode', 'healthGoals'],
      4: ['glucoseAppearance', 'glanceableDisplay', 'glucoseAlerts', 'themeMode', 'healthGoals', 'treatmentProfile'],
      5: ['glucoseAppearance', 'glanceableDisplay', 'glucoseAlerts', 'themeMode', 'healthGoals', 'treatmentProfile', 'regionalProfile'],
      6: ['glucoseAppearance', 'glanceableDisplay', 'glucoseAlerts', 'themeMode', 'healthGoals', 'treatmentProfile', 'regionalProfile'],
    };
    const legacy: Record<string, unknown> = {
      version,
      insightReviews: version >= 6 ? base.insightReviews : { weeklyNotificationEnabled: false },
    };
    for (const key of keys[version] ?? []) legacy[key] = base[key as keyof typeof base];
    const parsed = validatePortablePreferences(legacy);
    expect(parsed.version).toBe(7);
    expect(parsed.glucoseAlarms).toBeNull();
    expect(getIncludedPortablePreferenceGroups(parsed)).not.toContain('glucoseAlarms');
    // A version 6 payload with the new field is not a valid version 6 backup.
    if (version === 6) expect(() => validatePortablePreferences({ ...legacy, glucoseAlarms: null })).toThrow(/unsupported format/);
  });
});

describe('automatic re-arming and wording (source checks)', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const nativeDir = 'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay';

  it('restarts alarm monitoring after a reboot or an app update from the saved choices', () => {
    const manifest = read('modules/t1arc-glucose-display/android/src/main/AndroidManifest.xml');
    const receiver = manifest.match(/<receiver\s+android:name="\.T1ArcGlucoseAlarmRestartReceiver"[\s\S]*?<\/receiver>/)?.[0];
    expect(receiver).toContain('android:exported="true"');
    expect(receiver).toContain('android.intent.action.BOOT_COMPLETED');
    expect(receiver).toContain('android.intent.action.MY_PACKAGE_REPLACED');
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    const engine = read(`${nativeDir}/GlucoseAlarmEngine.kt`);
    expect(engine).not.toContain('armedInProcess');
    expect(engine).toContain('class T1ArcGlucoseAlarmRestartReceiver');
    expect(engine).toMatch(/Intent\.ACTION_BOOT_COMPLETED/);
    expect(engine).toMatch(/Intent\.ACTION_MY_PACKAGE_REPLACED/);
    expect(engine).toContain('resumeMonitoring(');
  });

  it('keeps the back-up wording and never offers a dose or treatment suggestion', () => {
    const card = read('src/components/GlucoseAlertSettingsCard.tsx');
    expect(card).toContain('T1 Arc’s alarms are a back-up. Keep your sensor maker’s alarms, or your AAPS alarms, turned on as well.');
    expect(card).toContain('Urgent low alerts still sound.');
    expect(card).not.toMatch(/units? of insulin|take \d+ ?g|eat \d+/i);
  });
});
