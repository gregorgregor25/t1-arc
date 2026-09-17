const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Optional food catalogues stream from compressed native assets, not JS arrays.
if (!config.resolver.assetExts.includes('gz')) config.resolver.assetExts.push('gz');

// Expo does not enable inline requires by default. Delaying module evaluation
// keeps the large regional/provider feature graph off the critical native-start
// path while preserving one production bundle and one runtime for every user.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
