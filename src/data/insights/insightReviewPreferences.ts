import * as SecureStore from 'expo-secure-store';

import { DateKey } from '@/domain/time';

const REVIEW_PREFERENCES_KEY = 'daymark.insight-review-preferences.v1';

export interface InsightReviewPreferences {
  weeklyNotificationEnabled: boolean;
  lastNotifiedWeek?: DateKey;
}
export const DEFAULT_INSIGHT_REVIEW_PREFERENCES: InsightReviewPreferences = {
  weeklyNotificationEnabled: false,
};

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
    };
  } catch {
    return DEFAULT_INSIGHT_REVIEW_PREFERENCES;
  }
}

export async function loadInsightReviewPreferences() {
  return parsePreferences(
    await SecureStore.getItemAsync(REVIEW_PREFERENCES_KEY),
  );
}

async function saveInsightReviewPreferences(
  preferences: InsightReviewPreferences,
) {
  await SecureStore.setItemAsync(
    REVIEW_PREFERENCES_KEY,
    JSON.stringify(preferences),
  );
  return preferences;
}

export async function setWeeklyReviewNotificationEnabled(
  enabled: boolean,
) {
  const current = await loadInsightReviewPreferences();
  return saveInsightReviewPreferences({
    ...current,
    weeklyNotificationEnabled: enabled,
  });
}

export async function markWeeklyReviewNotified(weekKey: DateKey) {
  const current = await loadInsightReviewPreferences();
  return saveInsightReviewPreferences({
    ...current,
    lastNotifiedWeek: weekKey,
  });
}
