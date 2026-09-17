import { describe, expect, it, vi } from 'vitest';

import {
  capturePortablePreferences,
  PortablePreferenceAdapter,
  restorePortablePreferences,
} from '@/data/backup/portablePreferences';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import {
  getIncludedPortablePreferenceGroups,
  PORTABLE_PREFERENCES_VERSION,
  validatePortablePreferences,
} from '@/domain/portablePreferences';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';

function adapter(): PortablePreferenceAdapter {
  return {
    getDisplayStatus: vi.fn(async () => ({
      lockScreenVisible: false,
      aodPosition: 'topRight',
      aodSize: 'large',
    })),
    getGlucoseAppearance: vi.fn(async () => DEFAULT_GLUCOSE_APPEARANCE),
    getWeeklyReviewEnabled: vi.fn(async () => true),
    getWeeklyReviewTiming: vi.fn(async () => ({
      reviewWeekday: 0,
      reviewHour: 8,
      reviewMinute: 30,
    })),
    getGlucoseAlerts: vi.fn(async () => ({
      lowEnabled: true,
      lowThresholdMmolL: 3.7,
      highEnabled: true,
      highThresholdMmolL: 14,
      staleEnabled: true,
      repeatMinutes: 60,
    })),
    getThemePreference: vi.fn(async () => 'dark' as const),
    getStepGoal: vi.fn(async () => 8_500),
    getTreatmentProfile: vi.fn(async () => null),
    getRegionalProfile: vi.fn(async () => DEFAULT_REGIONAL_PROFILE),
    setGlucoseAppearance: vi.fn(async () => undefined),
    setLockScreenVisible: vi.fn(async () => undefined),
    setAodPosition: vi.fn(async () => undefined),
    setAodSize: vi.fn(async () => undefined),
    setWeeklyReviewEnabled: vi.fn(async () => undefined),
    setWeeklyReviewTiming: vi.fn(async () => undefined),
    setGlucoseAlerts: vi.fn(async () => undefined),
    setThemePreference: vi.fn(async () => undefined),
    setStepGoal: vi.fn(async () => undefined),
    setTreatmentProfile: vi.fn(async () => undefined),
    setRegionalProfile: vi.fn(async () => undefined),
  };
}

describe('portable preferences', () => {
  it('captures only non-secret display and review choices', async () => {
    const result = await capturePortablePreferences(adapter());

    expect(result).toEqual({
      version: PORTABLE_PREFERENCES_VERSION,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: false,
        aodPosition: 'topRight',
        aodSize: 'large',
      },
      insightReviews: {
        weeklyNotificationEnabled: true,
        reviewWeekday: 0,
        reviewHour: 8,
        reviewMinute: 30,
      },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.7,
        highEnabled: true,
        highThresholdMmolL: 14,
        staleEnabled: true,
        repeatMinutes: 60,
      },
      themeMode: 'dark',
      healthGoals: { dailyStepGoal: 8_500 },
      treatmentProfile: null,
      regionalProfile: DEFAULT_REGIONAL_PROFILE,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /credential|password|cookie|token|email/i,
    );
  });

  it('restores settings but never activates a service or OS permission', async () => {
    const destination = adapter();
    const preferences = await capturePortablePreferences(adapter());

    await restorePortablePreferences(preferences, destination);

    expect(destination.setGlucoseAppearance).toHaveBeenCalledWith(
      DEFAULT_GLUCOSE_APPEARANCE,
    );
    expect(destination.setAodPosition).toHaveBeenCalledWith('topRight');
    expect(destination.setAodSize).toHaveBeenCalledWith('large');
    expect(destination.setLockScreenVisible).toHaveBeenCalledWith(false);
    expect(destination.setWeeklyReviewEnabled).toHaveBeenCalledWith(true);
    expect(destination.setWeeklyReviewTiming).toHaveBeenCalledWith({
      reviewWeekday: 0,
      reviewHour: 8,
      reviewMinute: 30,
    });
    expect(destination.setGlucoseAlerts).toHaveBeenCalledWith({
      lowEnabled: true,
      lowThresholdMmolL: 3.7,
      highEnabled: true,
      highThresholdMmolL: 14,
      staleEnabled: true,
      repeatMinutes: 60,
    });
    expect(destination.setThemePreference).toHaveBeenCalledWith('dark');
    expect(destination.setStepGoal).toHaveBeenCalledWith(8_500);
    expect(destination.setTreatmentProfile).toHaveBeenCalledWith(null);
    expect(destination.setRegionalProfile).toHaveBeenCalledWith(
      DEFAULT_REGIONAL_PROFILE,
    );
    expect(Object.keys(destination)).not.toContain('setEnabled');
    expect(Object.keys(destination)).not.toContain('requestPermission');
  });

  it('rejects unknown fields and unsupported presentation values', () => {
    const valid = {
      version: PORTABLE_PREFERENCES_VERSION,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: true,
        aodPosition: 'bottomCenter',
        aodSize: 'standard',
      },
      insightReviews: {
        weeklyNotificationEnabled: false,
        reviewWeekday: 1,
        reviewHour: 7,
        reviewMinute: 0,
      },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      },
      themeMode: 'system',
      healthGoals: { dailyStepGoal: null },
      treatmentProfile: null,
      regionalProfile: DEFAULT_REGIONAL_PROFILE,
    };
    expect(() =>
      validatePortablePreferences({ ...valid, accessToken: 'secret' }),
    ).toThrow(/unsupported format/i);
    expect(() =>
      validatePortablePreferences({
        ...valid,
        glanceableDisplay: {
          ...valid.glanceableDisplay,
          aodPosition: 'random',
        },
      }),
    ).toThrow(/display settings/i);
    expect(() =>
      validatePortablePreferences({
        ...valid,
        glucoseAppearance: {
          ...valid.glucoseAppearance,
          colors: {
            ...valid.glucoseAppearance.colors,
            target: '#ffffff',
          },
        },
      }),
    ).toThrow(/appearance settings/i);
  });

  it('upgrades version 1 settings with alerts safely off by default', () => {
    const legacy = {
      version: 1,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: true,
        aodPosition: 'bottomCenter',
        aodSize: 'standard',
      },
      insightReviews: { weeklyNotificationEnabled: false },
    };

    const upgraded = validatePortablePreferences(legacy);

    expect(upgraded.version).toBe(PORTABLE_PREFERENCES_VERSION);
    expect(upgraded.glucoseAlerts).toMatchObject({
      lowThresholdMmolL: 3.9,
      highThresholdMmolL: 13.9,
      staleEnabled: false,
    });
    expect(upgraded.themeMode).toBeNull();
    expect(upgraded.healthGoals).toBeNull();
    expect(getIncludedPortablePreferenceGroups(upgraded)).toEqual([
      'glucoseAppearance',
      'glanceableDisplay',
      'insightReviews',
    ]);
  });

  it('upgrades version 2 without inventing a theme or health goal', () => {
    const upgraded = validatePortablePreferences({
      version: 2,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: false,
        aodPosition: 'topRight',
        aodSize: 'large',
      },
      insightReviews: { weeklyNotificationEnabled: true },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.7,
        highEnabled: true,
        highThresholdMmolL: 14,
        staleEnabled: true,
        repeatMinutes: 60,
      },
    });

    expect(upgraded.version).toBe(PORTABLE_PREFERENCES_VERSION);
    expect(upgraded.themeMode).toBeNull();
    expect(upgraded.healthGoals).toBeNull();
    expect(getIncludedPortablePreferenceGroups(upgraded)).toEqual([
      'glucoseAppearance',
      'glanceableDisplay',
      'insightReviews',
      'glucoseAlerts',
    ]);
  });

  it('rejects unsafe theme and health-goal values', () => {
    const valid = {
      version: PORTABLE_PREFERENCES_VERSION,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: true,
        aodPosition: 'bottomCenter',
        aodSize: 'standard',
      },
      insightReviews: {
        weeklyNotificationEnabled: false,
        reviewWeekday: 1,
        reviewHour: 7,
        reviewMinute: 0,
      },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      },
      themeMode: 'system',
      healthGoals: { dailyStepGoal: null },
      treatmentProfile: null,
      regionalProfile: DEFAULT_REGIONAL_PROFILE,
    };

    expect(() =>
      validatePortablePreferences({ ...valid, themeMode: 'neon' }),
    ).toThrow(/theme preference/i);
    expect(() =>
      validatePortablePreferences({
        ...valid,
        healthGoals: { dailyStepGoal: 100 },
      }),
    ).toThrow(/step goal/i);
  });

  it('does not overwrite newer settings omitted by a legacy backup', async () => {
    const destination = adapter();
    const legacy = validatePortablePreferences({
      version: 1,
      glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
      glanceableDisplay: {
        lockScreenVisible: true,
        aodPosition: 'bottomCenter',
        aodSize: 'standard',
      },
      insightReviews: { weeklyNotificationEnabled: false },
    });

    await restorePortablePreferences(legacy, destination);

    expect(destination.setGlucoseAlerts).not.toHaveBeenCalled();
    expect(destination.setThemePreference).not.toHaveBeenCalled();
    expect(destination.setStepGoal).not.toHaveBeenCalled();
    expect(destination.setTreatmentProfile).not.toHaveBeenCalled();
  });

  it('round-trips a validated manual insulin-to-carb schedule', async () => {
    const source = adapter();
    const profile = {
      schemaVersion: 1 as const,
      source: 'manual' as const,
      confirmedAt: 1_780_000_000_000,
      carbRatioSchedule: [
        { id: 'morning', startMinute: 420, gramsPerUnit: 8.5 },
        { id: 'evening', startMinute: 1_080, gramsPerUnit: 11 },
      ],
    };
    vi.mocked(source.getTreatmentProfile).mockResolvedValue(profile);

    const captured = await capturePortablePreferences(source);
    expect(captured.treatmentProfile).toEqual(profile);

    const destination = adapter();
    await restorePortablePreferences(captured, destination);
    expect(destination.setTreatmentProfile).toHaveBeenCalledWith(profile);
  });
});
