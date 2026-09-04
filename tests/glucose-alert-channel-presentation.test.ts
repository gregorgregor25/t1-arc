import { describe, expect, it } from 'vitest';

import {
  glucoseAlertChannelLabel,
  glucoseAlertChannelPresentation,
  glucoseAlertSettingsDestination,
} from '@/components/glucoseAlertChannelPresentation';
import type { GlucoseAlertChannelStatus } from '../modules/t1arc-glucose-display';

function status(
  overrides: Partial<GlucoseAlertChannelStatus> = {},
): GlucoseAlertChannelStatus {
  return {
    kind: 'low',
    channelId: 't1arc_low_glucose_alerts_v1',
    state: 'allowed',
    permissionGranted: true,
    appNotificationsEnabled: true,
    appNotificationsAllowed: true,
    channelExists: true,
    groupBlocked: false,
    importance: 4,
    soundConfigured: true,
    vibrationConfigured: true,
    lockScreenVisibility: 'private',
    payloadGlucoseVisibleOnLockScreen: false,
    bypassesDoNotDisturb: false,
    ...overrides,
  };
}

describe('glucose alert channel presentation', () => {
  it('names each independently controlled alert category', () => {
    expect(glucoseAlertChannelLabel('low')).toBe('Low glucose');
    expect(glucoseAlertChannelLabel('high')).toBe('High glucose');
    expect(glucoseAlertChannelLabel('stale')).toBe('Data freshness');
  });

  it('does not describe a category disabled in T1 Arc as active', () => {
    expect(glucoseAlertChannelPresentation(status(), false)).toEqual({
      tone: 'off',
      summary: 'Off in T1 Arc',
      detail: 'Turn on this category before sending a test alert.',
    });
  });

  it('reports an app-wide notification block truthfully', () => {
    expect(
      glucoseAlertChannelPresentation(
        status({
          state: 'blocked',
          appNotificationsAllowed: false,
          appNotificationsEnabled: false,
        }),
      ),
    ).toEqual({
      tone: 'blocked',
      summary: 'Blocked by Android',
      detail:
        'App notifications are off. Open Android settings to allow this channel.',
    });
  });

  it('reports configured interruption settings and the actual payload privacy policy', () => {
    expect(
      glucoseAlertChannelPresentation(
        status({ soundConfigured: false, vibrationConfigured: false }),
      ),
    ).toEqual({
      tone: 'attention',
      summary: 'Allowed · sound not configured · vibration not configured',
      detail:
        'Glucose hidden until unlock · high importance · follows Do Not Disturb.',
    });
    expect(glucoseAlertChannelPresentation(status())).toEqual({
      tone: 'allowed',
      summary: 'Allowed · sound configured · vibration configured',
      detail:
        'Glucose hidden until unlock · high importance · follows Do Not Disturb.',
    });
    expect(
      glucoseAlertChannelPresentation(
        status({ payloadGlucoseVisibleOnLockScreen: true }),
      ).detail,
    ).toContain('Glucose visible on the lock screen');
  });

  it('treats a blocked group and non-interruptive importance as attention states', () => {
    expect(
      glucoseAlertChannelPresentation(
        status({ state: 'blocked', groupBlocked: true }),
      ),
    ).toEqual({
      tone: 'blocked',
      summary: 'Alert group blocked',
      detail: 'The T1 Arc glucose alert group is off in Android settings.',
    });
    expect(glucoseAlertChannelPresentation(status({ importance: 2 }))).toEqual({
      tone: 'attention',
      summary: 'Allowed · sound configured · vibration configured',
      detail:
        'Glucose hidden until unlock · low importance · follows Do Not Disturb.',
    });
  });

  it('opens the upstream app settings for permission app and group blocks', () => {
    expect(
      glucoseAlertSettingsDestination(status({ permissionGranted: false })),
    ).toBe('app');
    expect(
      glucoseAlertSettingsDestination(
        status({ appNotificationsEnabled: false }),
      ),
    ).toBe('app');
    expect(
      glucoseAlertSettingsDestination(status({ groupBlocked: true })),
    ).toBe('app');
    expect(glucoseAlertSettingsDestination(status({ state: 'blocked' }))).toBe(
      'channel',
    );
    expect(glucoseAlertSettingsDestination()).toBe('channel');
  });
});
