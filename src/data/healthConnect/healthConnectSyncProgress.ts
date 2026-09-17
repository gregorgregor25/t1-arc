import type { HealthConnectCategoryId } from '../../../modules/t1arc-health-connect';

export interface HealthConnectSyncProgress {
  categories: HealthConnectCategoryId[];
  category?: HealthConnectCategoryId;
  completedCategories: HealthConnectCategoryId[];
  recordsChecked: number;
}

// Process-local state describes a running import, never a persisted promise
// that work survived process termination. It survives settings navigation.
let progress: HealthConnectSyncProgress | undefined;
let lastNotificationAt = 0;
const listeners = new Set<() => void>();

export function getHealthConnectSyncProgress() {
  return progress;
}

export function subscribeHealthConnectSyncProgress(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  lastNotificationAt = Date.now();
  for (const listener of listeners) listener();
}

export function beginHealthConnectSyncProgress(categories: HealthConnectCategoryId[]) {
  progress = { categories: [...categories], completedCategories: [], recordsChecked: 0 };
  notify();
}

export function setHealthConnectSyncCategory(category: HealthConnectCategoryId) {
  if (!progress) return;
  progress = { ...progress, category };
  notify();
}

export function advanceHealthConnectSyncProgress(recordsChecked: number) {
  if (!progress) return;
  progress = { ...progress, recordsChecked: progress.recordsChecked + recordsChecked };
  if (Date.now() - lastNotificationAt >= 500) notify();
}

export function completeHealthConnectSyncCategory(category: HealthConnectCategoryId) {
  if (!progress) return;
  progress = { ...progress, completedCategories: [...progress.completedCategories, category] };
  notify();
}

export function endHealthConnectSyncProgress() {
  progress = undefined;
  notify();
}
