const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const SHORTCUTS_META_DATA = 'android.app.shortcuts';

function withShortcutManifest(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      androidConfig.modResults,
    );
    const metadata = activity['meta-data'] ?? [];
    const entry = metadata.find(
      (item) => item.$?.['android:name'] === SHORTCUTS_META_DATA,
    );
    if (entry) {
      entry.$['android:resource'] = '@xml/t1arc_shortcuts';
    } else {
      metadata.push({
        $: {
          'android:name': SHORTCUTS_META_DATA,
          'android:resource': '@xml/t1arc_shortcuts',
        },
      });
    }
    activity['meta-data'] = metadata;
    return androidConfig;
  });
}

function withShortcutResources(config) {
  return withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const appRoot = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
      );
      const xmlRoot = path.join(appRoot, 'xml');
      const valuesRoot = path.join(appRoot, 'values');
      fs.mkdirSync(xmlRoot, { recursive: true });
      fs.mkdirSync(valuesRoot, { recursive: true });
      fs.writeFileSync(
        path.join(xmlRoot, 't1arc_shortcuts.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:shortcutId="log_food"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/t1arc_shortcut_log_food_short"
    android:shortcutLongLabel="@string/t1arc_shortcut_log_food_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="t1arc://today/log-food"
      android:targetPackage="@string/t1arc_application_id"
      android:targetClass="${androidConfig.android?.package}.MainActivity" />
  </shortcut>
  <shortcut
    android:shortcutId="log_context"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/t1arc_shortcut_log_context_short"
    android:shortcutLongLabel="@string/t1arc_shortcut_log_context_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="t1arc://today/log-context"
      android:targetPackage="@string/t1arc_application_id"
      android:targetClass="${androidConfig.android?.package}.MainActivity" />
  </shortcut>
</shortcuts>
`,
      );
      fs.writeFileSync(
        path.join(valuesRoot, 't1arc_shortcut_strings.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="t1arc_shortcut_log_food_short">Log food</string>
  <string name="t1arc_shortcut_log_food_long">Log a meal in T1 Arc</string>
  <string name="t1arc_shortcut_log_context_short">Log context</string>
  <string name="t1arc_shortcut_log_context_long">Log health context in T1 Arc</string>
</resources>
`,
      );
      return androidConfig;
    },
  ]);
}

function withT1ArcShortcuts(config) {
  return withShortcutResources(withShortcutManifest(config));
}

module.exports = withT1ArcShortcuts;
