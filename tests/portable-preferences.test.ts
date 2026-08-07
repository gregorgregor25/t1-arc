import { describe, expect, it, vi } from 'vitest';

import {
  capturePortablePreferences,
  PortablePreferenceAdapter,
  restorePortablePreferences,
} from '@/data/backup/portablePreferences';
import { DEFAULT_GLUCOSE_APPEARANCE } from '@/domain/glucoseAppearance';
import {
  PORTABLE_PREFERENCES_VERSION,
  validatePortablePreferences,
} from '@/domain/portablePreferences';

function adapter(): PortablePreferenceAdapter {
  return {
    getDisplayStatus: vi.fn(async () => ({
      lockScreenVisible: false,
      aodPosition: 'topRight',
      aodSize: 'large',
    })),
    getGlucoseAppearance: vi.fn(async () => DEFAULT_GLUCOSE_APPEARANCE),
    getWeeklyReviewEnabled: vi.fn(async () => true),
    getGlucoseAlerts: vi.fn(async () => ({
      lowEnabled: true,
      lowThresholdMmolL: 3.7,
      highEnabled: true,
      highThresholdMmolL: 14,
      staleEnabled: true,
      repeatMinutes: 60,
    })),
    setGlucoseAppearance: vi.fn(async () => undefined),
    setLockScreenVisible: vi.fn(async () => undefined),
    setAodPosition: vi.fn(async () => undefined),
    setAodSize: vi.fn(async () => undefined),
    setWeeklyReviewEnabled: vi.fn(async () => undefined),
    setGlucoseAlerts: vi.fn(async () => undefined),
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
    expect(destination.setGlucoseAlerts).toHaveBeenCalledWith({
      lowEnabled: true,
      lowThresholdMmolL: 3.7,
      highEnabled: true,
      highThresholdMmolL: 14,
      staleEnabled: true,
      repeatMinutes: 60,
    });
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
      insightReviews: { weeklyNotificationEnabled: false },
      glucoseAlerts: {
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      },
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
  });
});
