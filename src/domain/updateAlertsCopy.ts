export const UPDATE_ALERTS_COPY = {
  settingLabel: 'Tell me when an update is out',
  settingHint:
    'On by default. Once a day, T1 Arc asks GitHub whether a newer public version exists and shows one quiet notification for each new version. ' +
    'It sends no health records, account details or device identifier; GitHub sees your network address, as with any website. ' +
    'Nothing downloads or installs automatically.',
  testBuildNote:
    'This is a test build, so T1 Arc does not check for updates automatically. A public release may not include features that only this build has.',
  foundByDailyCheck: 'Found by the daily update check. Tap Check for updates to ask GitHub again.',
  loadError: 'Could not load this setting. Tap to retry.',
  saveErrorTitle: 'Setting not changed',
  saveErrorBody: 'Please try again.',
} as const;
