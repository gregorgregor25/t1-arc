import { relativeAge } from '@/domain/time';

export const HEALTH_CONNECT_RECENT_CHECK_MS = 15 * 60 * 1000;

export interface HealthConnectPresentationInput {
  allSelectedCategoriesSynced: boolean;
  availability?: 'available' | 'unavailable' | 'update_required';
  connected: boolean;
  importsPaused: boolean;
  initialLoading: boolean;
  loadFailed: boolean;
  latestHealthData: number;
  latestSuccessfulSync: number;
  oldestSelectedSuccessfulSync?: number;
  now?: number;
  syncFailureCount: number;
  syncing?: boolean;
  syncCategory?: string;
}

export function presentHealthConnectState({
  allSelectedCategoriesSynced,
  availability,
  connected,
  importsPaused,
  initialLoading,
  loadFailed,
  latestHealthData,
  latestSuccessfulSync,
  oldestSelectedSuccessfulSync = latestSuccessfulSync,
  now = Date.now(),
  syncFailureCount,
  syncing = false,
  syncCategory,
}: HealthConnectPresentationInput) {
  const recentlyChecked =
    allSelectedCategoriesSynced &&
    oldestSelectedSuccessfulSync > 0 &&
    oldestSelectedSuccessfulSync <= now &&
    now - oldestSelectedSuccessfulSync <= HEALTH_CONNECT_RECENT_CHECK_MS;
  const statusLabel = syncing
    ? 'Importing'
    : initialLoading
    ? 'Checking'
    : loadFailed
      ? availability
        ? 'Refresh failed'
        : 'Unavailable'
      : availability === 'update_required'
        ? 'Update needed'
        : availability === 'unavailable'
          ? 'Unavailable'
          : connected && importsPaused
            ? 'Paused'
            : connected
              ? 'Connected'
              : 'Not connected';

  const summaryTitle = syncing
    ? syncCategory ? `Importing ${syncCategory.toLowerCase()}` : 'Preparing health import'
    : loadFailed
    ? 'Health Connect could not be refreshed'
    : importsPaused
      ? 'Health imports are paused'
      : syncFailureCount > 0
        ? 'Some health data needs attention'
        : latestSuccessfulSync <= 0
          ? 'Ready for the first health import'
          : !allSelectedCategoriesSynced
            ? 'Some health data has not been checked'
            : recentlyChecked
              ? 'Health Connect is up to date'
              : latestHealthData > 0
                ? `Latest health data ${relativeAge(latestHealthData, now)}`
                : `Last checked ${relativeAge(latestSuccessfulSync, now)}`;

  return { statusLabel, summaryTitle };
}

export function healthConnectReadError(message?: string) {
  if (/permission|SecurityException/i.test(message ?? '')) {
    return 'Access needs a check. Manage access, then retry.';
  }
  if (/configuration changed/i.test(message ?? '')) {
    return 'Choices changed. Retry with your new choices.';
  }
  return 'Could not update. Try health update again.';
}
