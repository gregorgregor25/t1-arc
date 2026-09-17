import type {
  GlucoseAlertChannelStatus,
  GlucoseAlertKind,
} from '../../modules/t1arc-glucose-display';

export type GlucoseAlertChannelTone =
  'allowed' | 'attention' | 'blocked' | 'off';

export interface GlucoseAlertChannelPresentation {
  tone: GlucoseAlertChannelTone;
  summary: string;
  detail: string;
}

export function glucoseAlertSettingsDestination(
  status?: GlucoseAlertChannelStatus,
): 'app' | 'channel' {
  if (
    status &&
    (!status.permissionGranted ||
      !status.appNotificationsEnabled ||
      status.groupBlocked)
  ) {
    return 'app';
  }
  return 'channel';
}

export function glucoseAlertChannelLabel(kind: GlucoseAlertKind) {
  if (kind === 'low') return 'Low glucose';
  if (kind === 'high') return 'High glucose';
  return 'Data freshness';
}

function privacyCopy(status: GlucoseAlertChannelStatus) {
  const privacy = status.payloadGlucoseVisibleOnLockScreen
    ? 'Glucose visible on the lock screen'
    : 'Glucose hidden until unlock';
  const importance =
    status.importance >= 4
      ? 'high importance'
      : status.importance === 3
        ? 'default importance'
        : status.importance === 2
          ? 'low importance'
          : 'minimum importance';
  const dnd = status.bypassesDoNotDisturb
    ? 'can bypass Do Not Disturb'
    : 'follows Do Not Disturb';
  return `${privacy} · ${importance} · ${dnd}.`;
}

export function glucoseAlertChannelPresentation(
  status: GlucoseAlertChannelStatus,
  enabled = true,
): GlucoseAlertChannelPresentation {
  if (!enabled) {
    return {
      tone: 'off',
      summary: 'Off in T1 Arc',
      detail: 'Turn on this category before sending a test alert.',
    };
  }
  if (!status.permissionGranted) {
    return {
      tone: 'blocked',
      summary: 'Permission not allowed',
      detail:
        'T1 Arc does not have notification permission. Allow it before testing this channel.',
    };
  }
  if (!status.appNotificationsEnabled) {
    return {
      tone: 'blocked',
      summary: 'Blocked by Android',
      detail:
        'App notifications are off. Open Android settings to allow this channel.',
    };
  }
  if (status.groupBlocked) {
    return {
      tone: 'blocked',
      summary: 'Alert group blocked',
      detail: 'The T1 Arc glucose alert group is off in Android settings.',
    };
  }
  if (status.state === 'blocked') {
    return {
      tone: 'blocked',
      summary: 'Channel blocked',
      detail: 'This alert category is off in Android settings.',
    };
  }
  if (status.state === 'unavailable') {
    return {
      tone: 'blocked',
      summary: 'Channel unavailable',
      detail: 'Android did not return settings for this alert category.',
    };
  }

  const summary = `Allowed · sound ${status.soundConfigured ? 'configured' : 'not configured'} · vibration ${status.vibrationConfigured ? 'configured' : 'not configured'}`;
  return {
    tone:
      status.importance >= 4 &&
      status.soundConfigured &&
      status.vibrationConfigured
        ? 'allowed'
        : 'attention',
    summary,
    detail: privacyCopy(status),
  };
}
