const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const RESOURCE_NAME = 'daymark_network_security_config.xml';

const RELEASE_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

const DEVELOPMENT_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function withNetworkManifest(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const application =
      androidConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error('T1 Arc could not find the Android application manifest.');
    }
    application.$ = application.$ ?? {};
    application.$['android:networkSecurityConfig'] =
      '@xml/daymark_network_security_config';
    application.$['android:usesCleartextTraffic'] = 'false';
    return androidConfig;
  });
}

function writeNetworkConfig(root, sourceSet, contents) {
  const xmlRoot = path.join(
    root,
    'app',
    'src',
    sourceSet,
    'res',
    'xml',
  );
  fs.mkdirSync(xmlRoot, { recursive: true });
  fs.writeFileSync(path.join(xmlRoot, RESOURCE_NAME), contents);
}

function withNetworkResources(config) {
  return withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const root = androidConfig.modRequest.platformProjectRoot;
      writeNetworkConfig(root, 'main', RELEASE_CONFIG);
      // Expo development builds need cleartext Metro access. Android selects
      // these source-set resources only for the corresponding debug variant.
      writeNetworkConfig(root, 'debug', DEVELOPMENT_CONFIG);
      writeNetworkConfig(root, 'debugOptimized', DEVELOPMENT_CONFIG);
      return androidConfig;
    },
  ]);
}

module.exports = function withXdripLocalNetwork(config) {
  return withNetworkResources(withNetworkManifest(config));
};
