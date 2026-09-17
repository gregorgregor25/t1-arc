import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceHealthConnectSyncProgress,
  beginHealthConnectSyncProgress,
  completeHealthConnectSyncCategory,
  endHealthConnectSyncProgress,
  getHealthConnectSyncProgress,
  setHealthConnectSyncCategory,
  subscribeHealthConnectSyncProgress,
} from '@/data/healthConnect/healthConnectSyncProgress';
import { healthConnectReadError, presentHealthConnectState } from '@/components/healthConnect/presentation';

afterEach(() => { endHealthConnectSyncProgress(); vi.useRealTimers(); });

describe('Health Connect import progress across navigation', () => {
  it('retains active work for a reopened screen and clears it when the run ends', () => {
    vi.useFakeTimers();
    const firstScreen = vi.fn();
    const leave = subscribeHealthConnectSyncProgress(firstScreen);
    beginHealthConnectSyncProgress(['workouts', 'heart_rate']);
    setHealthConnectSyncCategory('workouts');
    advanceHealthConnectSyncProgress(25);
    leave();
    advanceHealthConnectSyncProgress(25);
    completeHealthConnectSyncCategory('workouts');
    setHealthConnectSyncCategory('heart_rate');
    const reopenedScreen = vi.fn();
    const unsubscribe = subscribeHealthConnectSyncProgress(reopenedScreen);
    expect(getHealthConnectSyncProgress()).toEqual({
      categories: ['workouts', 'heart_rate'], category: 'heart_rate',
      completedCategories: ['workouts'], recordsChecked: 50,
    });
    const previousCalls = firstScreen.mock.calls.length;
    vi.advanceTimersByTime(500);
    advanceHealthConnectSyncProgress(25);
    expect(reopenedScreen).toHaveBeenCalledTimes(1);
    expect(firstScreen).toHaveBeenCalledTimes(previousCalls);
    endHealthConnectSyncProgress();
    expect(getHealthConnectSyncProgress()).toBeUndefined();
    expect(reopenedScreen).toHaveBeenCalledTimes(2);
    unsubscribe();
    // Ordinary writes outside an import must not invent a running import.
    advanceHealthConnectSyncProgress(100);
    expect(getHealthConnectSyncProgress()).toBeUndefined();
  });

  it('shows active recovery instead of a previous permission failure', () => {
    const view = presentHealthConnectState({
      allSelectedCategoriesSynced: false, availability: 'available', connected: true,
      importsPaused: false, initialLoading: false, loadFailed: false,
      latestHealthData: 0, latestSuccessfulSync: 0, syncFailureCount: 2,
      syncing: true, syncCategory: 'Heart rate',
    });
    expect(view).toEqual({statusLabel: 'Importing', summaryTitle: 'Importing heart rate'});
    expect(healthConnectReadError('java.lang.SecurityException: READ_SLEEP denied'))
      .toBe('Access needs a check. Manage access, then retry.');
    expect(healthConnectReadError('native stack containing private values'))
      .toBe('Could not update. Try health update again.');
  });
});
