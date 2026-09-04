const {
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

const COMPILE_SDK_MARKER =
  'compileSdk rootProject.ext.compileSdkVersion';
const EXTENSION_LINE = 'compileSdkExtension 19';

/**
 * Health Connect 1.2 alpha03 exposes Android 14 extension APIs while remaining
 * compatible with Expo's AGP/compileSdk 36 toolchain. Gradle must opt into the
 * matching SDK extension when validating the AAR.
 */
module.exports = function withHealthConnectAndroid(config) {
  config = withGradleProperties(config, (androidConfig) => {
    const property = androidConfig.modResults.find(
      (item) =>
        item.type === 'property' && item.key === 'android.minSdkVersion',
    );
    if (property) {
      property.value = '26';
    } else {
      androidConfig.modResults.push({
        type: 'property',
        key: 'android.minSdkVersion',
        value: '26',
      });
    }
    return androidConfig;
  });

  return withAppBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'groovy') {
      throw new Error(
        'Health Connect configuration currently expects a Groovy app build file.',
      );
    }

    let contents = androidConfig.modResults.contents;
    if (!contents.includes(EXTENSION_LINE)) {
      if (!contents.includes(COMPILE_SDK_MARKER)) {
        throw new Error(
          'Could not locate compileSdk in Android app build.gradle.',
        );
      }
      contents = contents.replace(
        COMPILE_SDK_MARKER,
        `${COMPILE_SDK_MARKER}\n    ${EXTENSION_LINE}`,
      );
    }
    androidConfig.modResults.contents = contents;
    return androidConfig;
  });
};
