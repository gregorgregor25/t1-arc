import { PermissionsAndroid, Platform } from 'react-native';
import T1ArcCommunityReminder, { type CommunityReminderStatus } from '../../../modules/t1arc-community-reminder';

async function requestNotificationPermissionIfNeeded(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!(await PermissionsAndroid.check(permission))) {
    await PermissionsAndroid.request(permission);
  }
}

/** Call after onboarding: default-on preference still respects Android's permission. */
export async function initializeCommunityReminderAsync(): Promise<CommunityReminderStatus> {
  if (await T1ArcCommunityReminder.shouldRequestPermissionAsync()) {
    await T1ArcCommunityReminder.markPermissionRequestedAsync();
    await requestNotificationPermissionIfNeeded();
  }
  return T1ArcCommunityReminder.reconcileAsync();
}

export async function setCommunityReminderEnabledAsync(enabled: boolean): Promise<CommunityReminderStatus> {
  if (enabled) await requestNotificationPermissionIfNeeded();
  return T1ArcCommunityReminder.setEnabledAsync(enabled);
}

export function getCommunityReminderStatusAsync(): Promise<CommunityReminderStatus> {
  return T1ArcCommunityReminder.getStatusAsync();
}

/** Full local-data erasure turns off the preference and removes its pending alarm. */
export function disableCommunityReminderForErasureAsync(): Promise<void> {
  return T1ArcCommunityReminder.eraseAsync();
}

export function copySupportEmailAsync(): Promise<void> {
  return T1ArcCommunityReminder.copySupportEmailAsync();
}
