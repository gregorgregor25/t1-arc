const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Barcode scanning uses the camera when one is available, but the rest of the
 * app remains useful on camera-less Android devices (including Chromebooks).
 */
module.exports = function withOptionalCameraHardware(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const features = manifest['uses-feature'] ?? [];
    const cameraFeature = features.find(
      (feature) => feature.$?.['android:name'] === 'android.hardware.camera',
    );

    if (cameraFeature) {
      cameraFeature.$ = cameraFeature.$ || {};
      cameraFeature.$['android:required'] = 'false';
    } else {
      features.push({
        $: {
          'android:name': 'android.hardware.camera',
          'android:required': 'false',
        },
      });
    }

    manifest['uses-feature'] = features;
    return androidConfig;
  });
};
