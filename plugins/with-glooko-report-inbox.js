const {
  AndroidConfig,
  withAndroidManifest,
  withMainActivity,
} = require('expo/config-plugins');

function withPdfIntents(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      androidConfig.modResults,
    );
    const filters = activity['intent-filter'] ?? [];
    for (const action of [
      'android.intent.action.VIEW',
      'android.intent.action.SEND',
    ]) {
      const exists = filters.some(
        (filter) =>
          filter.action?.some(
            (item) => item.$?.['android:name'] === action,
          ) &&
          filter.data?.some(
            (item) =>
              item.$?.['android:mimeType'] === 'application/pdf',
          ),
      );
      if (!exists) {
        filters.push({
          action: [{ $: { 'android:name': action } }],
          category: [
            {
              $: {
                'android:name': 'android.intent.category.DEFAULT',
              },
            },
          ],
          data: [{ $: { 'android:mimeType': 'application/pdf' } }],
        });
      }
    }
    activity['intent-filter'] = filters;
    return androidConfig;
  });
}

function withPdfIntentCapture(config) {
  return withMainActivity(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('The Glooko report inbox requires a Kotlin MainActivity.');
    }
    let source = androidConfig.modResults.contents;
    if (!source.includes('io.github.gregorgregor25.t1arc.glooko.GlookoSharedReportInbox')) {
      source = source.replace(
        /^(package\s+[^\r\n]+\r?\n)/,
        '$1\nimport android.content.Intent\nimport android.net.Uri\nimport io.github.gregorgregor25.t1arc.glooko.GlookoSharedReportInbox\n',
      );
    }
    if (!source.includes('private fun captureSharedGlookoReport')) {
      source = source.replace(
        /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/,
        `class MainActivity : ReactActivity() {
  private fun captureSharedGlookoReport(sharedIntent: Intent?) {
    if (GlookoSharedReportInbox.captureIntent(applicationContext, sharedIntent)) {
      sharedIntent?.action = Intent.ACTION_VIEW
      sharedIntent?.data = Uri.parse("t1arc://sources/glooko?shared-report=1")
      sharedIntent?.type = null
      sharedIntent?.removeExtra(Intent.EXTRA_STREAM)
    }
  }
`,
      );
      source = source.replace(
        /([ \t]*)super\.onCreate\(null\)/,
        '$1captureSharedGlookoReport(intent)\n$1super.onCreate(null)',
      );
      source = source.replace(
        /(\n\s*\/\*\*\s*\n\s*\* Returns the name)/,
        `
  override fun onNewIntent(intent: Intent) {
    captureSharedGlookoReport(intent)
    super.onNewIntent(intent)
  }
$1`,
      );
    }
    androidConfig.modResults.contents = source;
    return androidConfig;
  });
}

module.exports = function withGlookoReportInbox(config) {
  return withPdfIntentCapture(withPdfIntents(config));
};
