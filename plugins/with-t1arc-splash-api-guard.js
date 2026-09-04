const { existsSync } = require('node:fs');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

const {
  AndroidConfig,
  withFinalizedMod,
  XML,
} = require('expo/config-plugins');

const SPLASH_STYLE = 'Theme.App.SplashScreen';
const SPLASH_BEHAVIOUR = 'android:windowSplashScreenBehavior';

function emptyResources() {
  return { resources: { style: [] } };
}

function splitSplashScreenBehaviour(baseStyles, api33Styles) {
  const splash = (baseStyles.resources.style ?? []).find(
    (style) => style.$?.name === SPLASH_STYLE,
  );
  const behaviour = (splash?.item ?? []).find(
    (item) => item.$?.name === SPLASH_BEHAVIOUR,
  );
  if (!splash || !behaviour) return false;

  const api33Splash = structuredClone(splash);
  splash.item = (splash.item ?? []).filter(
    (item) => item.$?.name !== SPLASH_BEHAVIOUR,
  );

  const versionedStyles = api33Styles.resources.style ?? [];
  api33Styles.resources.style = [
    ...versionedStyles.filter((style) => style.$?.name !== SPLASH_STYLE),
    api33Splash,
  ];
  return true;
}

async function guardGeneratedSplashStyles(projectRoot) {
  const resourceRoot = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
  );
  const basePath = path.join(resourceRoot, 'values', 'styles.xml');
  const api33Path = path.join(resourceRoot, 'values-v33', 'styles.xml');
  const baseStyles = await AndroidConfig.Resources.readResourcesXMLAsync({
    path: basePath,
  });
  const api33Styles = existsSync(api33Path)
    ? await AndroidConfig.Resources.readResourcesXMLAsync({ path: api33Path })
    : emptyResources();

  if (!splitSplashScreenBehaviour(baseStyles, api33Styles)) return false;

  await mkdir(path.dirname(api33Path), { recursive: true });
  await Promise.all([
    XML.writeXMLAsync({ path: basePath, xml: baseStyles }),
    XML.writeXMLAsync({ path: api33Path, xml: api33Styles }),
  ]);
  return true;
}

function withT1ArcSplashApiGuard(config) {
  return withFinalizedMod(config, [
    'android',
    async (androidConfig) => {
      await guardGeneratedSplashStyles(androidConfig.modRequest.projectRoot);
      return androidConfig;
    },
  ]);
}

module.exports = withT1ArcSplashApiGuard;
module.exports.guardGeneratedSplashStyles = guardGeneratedSplashStyles;
module.exports.splitSplashScreenBehaviour = splitSplashScreenBehaviour;
