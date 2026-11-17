import * as SecureStore from 'expo-secure-store';

import {
  isExpectedSensorLifeDays,
  type ExpectedSensorLifeDays,
} from '@/domain/deviceAge';
import type { DateKey } from '@/domain/time';

/**
 * Small display preferences for Today cards. They hold no health readings:
 * only the date of the night whose summary was dismissed and the optional
 * expected sensor life chosen by the person. Both are cleared by local erase.
 */
const OVERNIGHT_DISMISSED_KEY = 't1arc.overnight-summary-dismissed.v1';
const EXPECTED_SENSOR_LIFE_KEY = 't1arc.expected-sensor-life-days.v1';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export async function loadDismissedOvernightDate(): Promise<DateKey | undefined> {
  const saved = await SecureStore.getItemAsync(OVERNIGHT_DISMISSED_KEY);
  return saved && DATE_KEY.test(saved) ? (saved as DateKey) : undefined;
}

export async function saveDismissedOvernightDate(date: DateKey) {
  await SecureStore.setItemAsync(OVERNIGHT_DISMISSED_KEY, date);
}

export async function loadExpectedSensorLifeDays(): Promise<ExpectedSensorLifeDays | null> {
  const saved = Number(await SecureStore.getItemAsync(EXPECTED_SENSOR_LIFE_KEY));
  return isExpectedSensorLifeDays(saved) ? saved : null;
}

export async function saveExpectedSensorLifeDays(days: ExpectedSensorLifeDays | null) {
  if (days === null) await SecureStore.deleteItemAsync(EXPECTED_SENSOR_LIFE_KEY);
  else await SecureStore.setItemAsync(EXPECTED_SENSOR_LIFE_KEY, String(days));
}

export async function clearTodayCardPreferences() {
  await Promise.all([
    SecureStore.deleteItemAsync(OVERNIGHT_DISMISSED_KEY),
    SecureStore.deleteItemAsync(EXPECTED_SENSOR_LIFE_KEY),
  ]);
}
