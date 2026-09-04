const {
  AndroidConfig,
  withAndroidManifest,
} = require('expo/config-plugins');

/**
 * Android lint can lose ReactActivity's superclass while analysing a generated
 * Kotlin activity and report the Instantiatable check incorrectly. Compilation
 * still verifies the real inheritance. Suppress only that manifest check while
 * leaving every other release lint enabled.
 *
 * Android issue: https://issuetracker.google.com/issues/196406778
 */
module.exports = function withMainActivityLintWorkaround(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      androidConfig.modResults,
    );
    const mainActivity = application.activity?.find((activity) =>
      activity.$?.['android:name']?.endsWith('MainActivity'),
    );

    if (mainActivity) {
      mainActivity.$ = mainActivity.$ || {};
      const existing = mainActivity.$['tools:ignore']
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
      mainActivity.$['tools:ignore'] = [
        ...new Set([...existing, 'Instantiatable']),
      ].join(',');
    }

    return androidConfig;
  });
};
