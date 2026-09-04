const { readBuildSource } = require("./scripts/build-source.cjs");

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    t1arcBuild: readBuildSource(__dirname),
  },
});
