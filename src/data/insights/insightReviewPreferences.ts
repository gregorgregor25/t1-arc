import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';

import T1ArcGlucoseDisplay from '../../../modules/t1arc-glucose-display';

import { DateKey } from '@/domain/time';
import { weeklyReviewSchedule } from '@/domain/weeklyReviewSchedule';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from '@/data/privacy/localDataWriteEpoch';
import { INSIGHT_REVIEW_PREFERENCES_DB_KEY } from '@/data/insights/insightReviewMetadata';

export { INSIGHT_REVIEW_PREFERENCES_DB_KEY } from '@/data/insights/insightReviewMetadata';

const REVIEW_PREFERENCES_KEY = 't1arc.insight-review-preferences.v1';

export interface InsightReviewPreferences {
  weeklyNotificationEnabled: boolean;
  lastNotifiedWeek?: DateKey;
  /** Sunday is 0 through Saturday 6. Undefined follows the regional default. */
  reviewWeekday?: number;
  reviewHour?: number;
  reviewMinute?: number;
}
export const DEFAULT_INSIGHT_REVIEW_PREFERENCES: InsightReviewPreferences = {
  weeklyNotificationEnabled: false,
};

let preferenceOperationTail: Promise<void> = Promise.resolve();

function enqueuePreferenceOperation<T>(task: () => Promise<T>) {
  const operation = preferenceOperationTail.then(task, task);
  preferenceOperationTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function parsePreferences(
  value: string | null,
): InsightReviewPreferences {
  if (!value) return DEFAULT_INSIGHT_REVIEW_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Partial<InsightReviewPreferences>;
    return {
      weeklyNotificationEnabled:
        parsed.weeklyNotificationEnabled === true,
      lastNotifiedWeek:
        typeof parsed.lastNotifiedWeek === 'string'
          ? (parsed.lastNotifiedWeek as DateKey)
          : undefined,
      reviewWeekday:
        Number.isInteger(parsed.reviewWeekday) &&
        Number(parsed.reviewWeekday) >= 0 &&
        Number(parsed.reviewWeekday) <= 6
          ? Number(parsed.reviewWeekday)
          : undefined,
      reviewHour:
        Number.isInteger(parsed.reviewHour) &&
        Number(parsed.reviewHour) >= 0 &&
        Number(parsed.reviewHour) <= 23
          ? Number(parsed.reviewHour)
          : undefined,
      reviewMinute:
        Number.isInteger(parsed.reviewMinute) &&
        Number(parsed.reviewMinute) >= 0 &&
        Number(parsed.reviewMinute) <= 59
          ? Number(parsed.reviewMinute)
          : undefined,
    };
  } catch {
    return DEFAULT_INSIGHT_REVIEW_PREFERENCES;
  }
}

async function loadInsightReviewPreferencesInTransaction(
  transaction: SQLiteDatabase,
) {
  const row = await transaction.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    INSIGHT_REVIEW_PREFERENCES_DB_KEY,
  );
  if (row) {
    return { preferences: parsePreferences(row.value), migrated: false };
  }
  const legacy = await SecureStore.getItemAsync(REVIEW_PREFERENCES_KEY);
  const preferences = parsePreferences(legacy);
  await saveInsightReviewPreferencesInTransaction(transaction, preferences);
  return { preferences, migrated: legacy !== null };
}

async function saveInsightReviewPreferencesInTransaction(
  transaction: SQLiteDatabase,
  preferences: InsightReviewPreferences,
) {
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    INSIGHT_REVIEW_PREFERENCES_DB_KEY,
    JSON.stringify(preferences),
  );
  return preferences;
}

/**
 * Restores the portable review settings through a transaction already owned
 * by an exact data migration. Calling the public setters here would enqueue a
 * second T1 Arc transaction behind the active one and deadlock both promises.
 * This narrow entry point must only be used by a caller that owns the supplied
 * writer transaction and has already serialized restore/erase operations.
 */
export async function restoreInsightReviewPreferencesInTransaction(
  transaction: SQLiteDatabase,
  preferences: {
    weeklyNotificationEnabled: boolean;
    reviewWeekday: number | null;
    reviewHour: number | null;
    reviewMinute: number | null;
  },
) {
  const current = await loadInsightReviewPreferencesInTransaction(transaction);
  const hasCompleteTiming =
    preferences.reviewWeekday !== null &&
    preferences.reviewHour !== null &&
    preferences.reviewMinute !== null;
  const saved = await saveInsightReviewPreferencesInTransaction(transaction, {
    ...current.preferences,
    weeklyNotificationEnabled: preferences.weeklyNotificationEnabled,
    ...(hasCompleteTiming
      ? {
          reviewWeekday: preferences.reviewWeekday!,
          reviewHour: preferences.reviewHour!,
          reviewMinute: preferences.reviewMinute!,
        }
      : {}),
  });
  if (current.migrated) {
    await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
      () => undefined,
    );
  }
  if (!preferences.weeklyNotificationEnabled) {
    await T1ArcGlucoseDisplay.cancelReviewReadyNotificationAsync();
  }
  return saved;
}

export function loadInsightReviewPreferences() {
  return enqueuePreferenceOperation(async () => {
    const lease = await acquireLocalDataWriteLease();
    const result = await withLocalDataWriteLeaseTransaction(
      lease,
      loadInsightReviewPreferencesInTransaction,
    );
    if (result.migrated) {
      await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
        () => undefined,
      );
    }
    return result.preferences;
  });
}

export async function setWeeklyReviewNotificationEnabled(
  enabled: boolean,
) {
  return enqueuePreferenceOperation(async () => {
    const lease = await acquireLocalDataWriteLease();
    let saved: InsightReviewPreferences | undefined;
    let saveError: unknown;
    let migrated = false;
    try {
      saved = await withLocalDataWriteLeaseTransaction(
        lease,
        async (transaction) => {
          const current = await loadInsightReviewPreferencesInTransaction(
            transaction,
          );
          migrated = current.migrated;
          return saveInsightReviewPreferencesInTransaction(transaction, {
            ...current.preferences,
            weeklyNotificationEnabled: enabled,
          });
        },
      );
    } catch (error) {
      saveError = error;
    }
    if (migrated) {
      await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
        () => undefined,
      );
    }
    if (!enabled) {
      try {
        await T1ArcGlucoseDisplay.cancelReviewReadyNotificationAsync();
      } catch (error) {
        if (!saveError) saveError = error;
      }
    }
    if (saveError) throw saveError;
    return saved!;
  });
}

export async function setWeeklyReviewTiming(
  timing: Pick<
    InsightReviewPreferences,
    'reviewWeekday' | 'reviewHour' | 'reviewMinute'
  >,
) {
  return enqueuePreferenceOperation(async () => {
    const lease = await acquireLocalDataWriteLease();
    let migrated = false;
    const saved = await withLocalDataWriteLeaseTransaction(
      lease,
      async (transaction) => {
        const current = await loadInsightReviewPreferencesInTransaction(
          transaction,
        );
        migrated = current.migrated;
        return saveInsightReviewPreferencesInTransaction(transaction, {
          ...current.preferences,
          reviewWeekday: timing.reviewWeekday,
          reviewHour: timing.reviewHour,
          reviewMinute: timing.reviewMinute,
        });
      },
    );
    if (migrated) {
      await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
        () => undefined,
      );
    }
    return saved;
  });
}

export async function markWeeklyReviewNotified(weekKey: DateKey) {
  return enqueuePreferenceOperation(async () => {
    const lease = await acquireLocalDataWriteLease();
    let migrated = false;
    const saved = await withLocalDataWriteLeaseTransaction(
      lease,
      async (transaction) => {
        const current = await loadInsightReviewPreferencesInTransaction(
          transaction,
        );
        migrated = current.migrated;
        return saveInsightReviewPreferencesInTransaction(transaction, {
          ...current.preferences,
          lastNotifiedWeek: weekKey,
        });
      },
    );
    if (migrated) {
      await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
        () => undefined,
      );
    }
    return saved;
  });
}

/**
 * Serializes the final enabled/due check, notification publication, and
 * last-notified write with preference changes. A disable invoked while a show
 * is active runs next and cancels that notification before disable resolves.
 */
export function publishWeeklyReviewNotificationIfDue(
  now: number,
  writeLease: LocalDataWriteLease,
) {
  return enqueuePreferenceOperation(async () => {
    let migrated = false;
    const publication = await withLocalDataWriteLeaseTransaction(
      writeLease,
      async (transaction) => {
        const current = await loadInsightReviewPreferencesInTransaction(
          transaction,
        );
        migrated = current.migrated;
        const schedule = weeklyReviewSchedule(
          now,
          current.preferences.lastNotifiedWeek,
          {
            weekday: current.preferences.reviewWeekday,
            hour: current.preferences.reviewHour,
            minute: current.preferences.reviewMinute,
          },
        );
        if (!current.preferences.weeklyNotificationEnabled || !schedule.due) {
          return { due: false, shown: false };
        }
        const shown =
          await T1ArcGlucoseDisplay.showReviewReadyNotificationAsync();
        if (shown) {
          await saveInsightReviewPreferencesInTransaction(transaction, {
            ...current.preferences,
            lastNotifiedWeek: schedule.weekKey,
          });
        }
        return { due: true, shown };
      },
    );
    if (migrated) {
      await SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY).catch(
        () => undefined,
      );
    }
    return publication;
  });
}

export function clearInsightReviewPreferences() {
  return enqueuePreferenceOperation(async () => {
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(REVIEW_PREFERENCES_KEY),
      T1ArcGlucoseDisplay.cancelReviewReadyNotificationAsync(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  });
}

export function resetInsightReviewPreferencesCoordinatorForTests() {
  preferenceOperationTail = Promise.resolve();
}
