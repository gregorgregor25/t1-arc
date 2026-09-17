import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function text(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), 'utf8');
}

describe('Android notification configuration', () => {
  it('allows vibration for user-enabled glucose alerts', () => {
    const appConfig = JSON.parse(text('app.json')) as {
      expo: { android: { blockedPermissions?: string[] } };
    };
    const moduleManifest = text(
      'modules',
      't1arc-glucose-display',
      'android',
      'src',
      'main',
      'AndroidManifest.xml',
    );
    expect(appConfig.expo.android.blockedPermissions ?? []).not.toContain(
      'android.permission.VIBRATE',
    );
    expect(moduleManifest).toContain(
      '<uses-permission android:name="android.permission.VIBRATE" />',
    );
  });

  it('keeps alert delivery high importance with sound and vibration enabled', () => {
    const nativeModule = text(
      'modules',
      't1arc-glucose-display',
      'android',
      'src',
      'main',
      'java',
      'io',
      'github',
      'gregorgregor25',
      't1arc',
      'glucosedisplay',
      'T1ArcGlucoseDisplayModule.kt',
    );
    const alertChannel = nativeModule.match(
      /private object T1ArcGlucoseAlertNotification \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(alertChannel).toBeDefined();
    expect(alertChannel).toContain('NotificationManager.IMPORTANCE_HIGH');
    expect(alertChannel).toContain('enableVibration(true)');
    expect(alertChannel).not.toContain('setSound(null');
    expect(alertChannel).toContain(
      'lockscreenVisibility = Notification.VISIBILITY_PRIVATE',
    );
  });

  it('uses separate stable channels and exposes their real settings plus a user-triggered test', () => {
    const policy = text(
      'modules',
      't1arc-glucose-display',
      'android',
      'src',
      'main',
      'java',
      'io',
      'github',
      'gregorgregor25',
      't1arc',
      'glucosedisplay',
      'GlucoseAlertChannelPolicy.kt',
    );
    const nativeModule = text(
      'modules',
      't1arc-glucose-display',
      'android',
      'src',
      'main',
      'java',
      'io',
      'github',
      'gregorgregor25',
      't1arc',
      'glucosedisplay',
      'T1ArcGlucoseDisplayModule.kt',
    );
    const bridge = text(
      'modules',
      't1arc-glucose-display',
      'src',
      'T1ArcGlucoseDisplayModule.ts',
    );
    const settingsCard = text(
      'src',
      'components',
      'GlucoseAlertSettingsCard.tsx',
    );
    const webBridge = text(
      'modules',
      't1arc-glucose-display',
      'src',
      'T1ArcGlucoseDisplayModule.web.ts',
    );
    const preferences = text(
      'src',
      'data',
      'glucoseAlerts',
      'glucoseAlertPreferences.ts',
    );

    expect(policy).toContain('t1arc_low_glucose_alerts_v1');
    expect(policy).toContain('t1arc_high_glucose_alerts_v1');
    expect(policy).toContain('t1arc_glucose_freshness_alerts_v1');
    expect(nativeModule).toContain('val channelId = kind.channelId');
    expect(nativeModule).toContain('NotificationManager.IMPORTANCE_HIGH');
    expect(nativeModule).toContain('fun statuses(context: Context)');
    expect(nativeModule).toContain(
      'fun showTest(context: Context, kind: String)',
    );
    expect(bridge).toContain('getGlucoseAlertChannelStatusesAsync');
    expect(bridge).toContain('showGlucoseTestAlertAsync');
    expect(bridge).toContain('openGlucoseAlertChannelSettingsAsync');
    expect(bridge).toContain('openGlucoseAlertAppSettingsAsync');
    expect(bridge).toContain('setGlucoseAlertMonitoringEnabledAsync?');
    expect(webBridge).toContain('setGlucoseAlertMonitoringEnabledAsync');
    expect(settingsCard).toContain('getGlucoseAlertChannelStatusesAsync');
    expect(settingsCard).toContain('showGlucoseTestAlertAsync');
    expect(settingsCard).toContain('openGlucoseAlertChannelSettingsAsync');
    expect(settingsCard).toContain('openGlucoseAlertAppSettingsAsync');
    expect(settingsCard).toContain('setCategoryEnabled');
    expect(settingsCard).toContain('await requestNotificationPermission()');
    expect(settingsCard).toContain('channelStatusError');
    const alertPreferencePersist = settingsCard.match(
      /async function persist[\s\S]*?\n  }/,
    )?.[0];
    expect(alertPreferencePersist).toBeDefined();
    expect(alertPreferencePersist).toContain(
      'updateGlucoseDisplayFromHistory({ allowUnchangedSkip: true })',
    );
    expect(alertPreferencePersist).not.toContain(
      'await updateGlucoseDisplayFromHistory();',
    );
    expect(settingsCard).not.toContain('.catch(\n        () => [],\n      )');
    expect(preferences).not.toContain('type GlucoseAlertMonitoringBridge');

    const masterToggle = settingsCard.match(
      /async function setMasterEnabled[\s\S]*?\n  }/,
    )?.[0];
    expect(masterToggle).toBeDefined();
    expect(masterToggle).toContain(
      'persist({ ...preferences, enabled }, true)',
    );
    expect(masterToggle).not.toContain('enableAsync');
    expect(masterToggle).not.toContain('getStatusAsync');
  });

  it('does not change lock-screen privacy when the glance is enabled', () => {
    const nativeModule = text(
      'modules',
      't1arc-glucose-display',
      'android',
      'src',
      'main',
      'java',
      'io',
      'github',
      'gregorgregor25',
      't1arc',
      'glucosedisplay',
      'T1ArcGlucoseDisplayModule.kt',
    );
    const enableFunction = nativeModule.match(
      /AsyncFunction\("enableAsync"\)([\s\S]*?)AsyncFunction\("disableAsync"\)/,
    )?.[1];

    expect(enableFunction).toBeDefined();
    expect(enableFunction).toContain('setEnabled(context, true)');
    expect(enableFunction).not.toContain('setLockScreenVisible');
  });

  it('uses the atomic native disable-and-clear barrier before deleting local data', () => {
    const provider = text('src', 'providers', 'DataProvider.tsx');
    const start = provider.indexOf('const eraseAllLocalHealthData');
    const end = provider.indexOf('const deleteManualContext', start);
    const erase = provider.slice(start, end);

    expect(erase).toContain(
      'runExclusiveLocalDataMutation("erase", async () =>',
    );
    const nativeBarrier = erase.indexOf(
      'await T1ArcNotificationSource.disableAndClearAsync()',
    );
    const databaseErase = erase.indexOf(
      'const removed = await eraseLocalHealthData()',
    );
    expect(nativeBarrier).toBeGreaterThanOrEqual(0);
    expect(nativeBarrier).toBeLessThan(databaseErase);
    expect(erase).not.toContain(
      'T1ArcNotificationSource.setConfigurationAsync',
    );
    expect(erase).not.toContain('T1ArcNotificationSource.clearPendingAsync');
  });
});
