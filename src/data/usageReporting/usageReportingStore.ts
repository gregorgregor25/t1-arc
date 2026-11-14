import * as SecureStore from 'expo-secure-store';

import { emptyUsageState, type UsageState } from '@/domain/usageReporting';

/**
 * Anonymous usage-count bookkeeping lives in Android secure storage. These
 * keys are not part of encrypted portable backups. Full local-data erasure
 * removes the activity state and keeps the switch position.
 */
export const USAGE_STATE_KEY = 't1arc.usage-reporting.state.v1';
export const USAGE_CONSENT_KEY = 't1arc.usage-reporting.consent.v1';

export type UsageConsent = 'enabled' | 'disabled';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDayList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((d) => typeof d === 'string' && DAY_KEY.test(d));
}

function isUsageState(value: unknown): value is UsageState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isDayList(v.openedDays) &&
    isDayList(v.monitoringDays) &&
    (v.lastDaySent === undefined || (typeof v.lastDaySent === 'string' && DAY_KEY.test(v.lastDaySent))) &&
    (v.lastWeekSentAt === undefined ||
      (typeof v.lastWeekSentAt === 'number' && Number.isFinite(v.lastWeekSentAt)))
  );
}

export async function loadUsageState(): Promise<UsageState> {
  try {
    const parsed: unknown = JSON.parse((await SecureStore.getItemAsync(USAGE_STATE_KEY)) ?? 'null');
    return isUsageState(parsed) ? parsed : emptyUsageState();
  } catch {
    return emptyUsageState();
  }
}

export async function saveUsageState(state: UsageState): Promise<void> {
  await SecureStore.setItemAsync(USAGE_STATE_KEY, JSON.stringify(state));
}

/** Default is enabled; only the explicit off switch disables reporting. */
export async function loadUsageConsent(): Promise<UsageConsent> {
  return (await SecureStore.getItemAsync(USAGE_CONSENT_KEY)) === 'disabled' ? 'disabled' : 'enabled';
}

export async function saveUsageConsent(consent: UsageConsent): Promise<void> {
  await SecureStore.setItemAsync(USAGE_CONSENT_KEY, consent);
}

export async function clearUsageState(): Promise<void> {
  await SecureStore.deleteItemAsync(USAGE_STATE_KEY);
}
