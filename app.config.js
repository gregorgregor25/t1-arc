const { expo } = require('./app.json');

// A separately installed hardware beta protects the tester's normal app/data.
// Regular builds keep the app.json identity and signing policy unchanged.
module.exports = () => process.env.T1ARC_GARMIN_BETA === '1'
  ? {
      ...expo,
      name: 'T1 Arc Garmin Beta',
      scheme: 't1arc-garmin-beta',
      android: { ...expo.android, package: 'app.daymark.garminbeta' },
    }
  : expo;
