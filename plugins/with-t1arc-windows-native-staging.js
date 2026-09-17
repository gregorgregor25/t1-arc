const { withAppBuildGradle } = require('expo/config-plugins');

const ANDROID_ANCHOR = 'android {';
const STAGING_MARKER = '// T1 Arc Windows native build staging';
const STAGING_CONFIGURATION = `${STAGING_MARKER}
    if (System.getProperty('os.name').toLowerCase().contains('windows')) {
        externalNativeBuild {
            cmake {
                buildStagingDirectory file(System.getenv('T1ARC_CMAKE_STAGING_DIR') ?: 'C:/t1arc-cxx')
            }
        }
    }`;

function injectT1ArcWindowsNativeStaging(contents) {
  if (contents.includes(STAGING_MARKER)) return contents;

  const anchorCount = contents.split(ANDROID_ANCHOR).length - 1;
  if (anchorCount !== 1) {
    throw new Error(
      'T1 Arc requires one unique generated Android configuration anchor.',
    );
  }

  return contents.replace(
    ANDROID_ANCHOR,
    `${ANDROID_ANCHOR}\n    ${STAGING_CONFIGURATION}`,
  );
}

function withT1ArcWindowsNativeStaging(config) {
  return withAppBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'groovy') {
      throw new Error(
        'T1 Arc Windows native staging currently expects a Groovy app build file.',
      );
    }
    androidConfig.modResults.contents = injectT1ArcWindowsNativeStaging(
      androidConfig.modResults.contents,
    );
    return androidConfig;
  });
}

module.exports = withT1ArcWindowsNativeStaging;
module.exports.injectT1ArcWindowsNativeStaging =
  injectT1ArcWindowsNativeStaging;
