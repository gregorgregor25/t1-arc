export const USAGE_REPORTING_COPY = {
  settingLabel: 'Share anonymous usage counts',
  settingHint:
    'On by default. Sends one small message a day and a weekly count of the days the app was opened or monitoring, with the app version. ' +
    "No health records, readings, account details, device details or identifiers. It goes to the developer's own server; network addresses are not stored. " +
    'Turning this off stops sending and deletes the local activity history.',
  loadError: 'Could not load this setting. Tap to retry.',
  saveErrorTitle: 'Setting not changed',
  saveErrorBody: 'Please try again.',
} as const;
