import * as SecureStore from 'expo-secure-store';

import T1ArcGlucoseDisplay from '../../../modules/t1arc-glucose-display';
import {
  DEFAULT_GLUCOSE_ALERT_PREFERENCES,
  DEFAULT_GLUCOSE_ALERT_STATE,
  evaluateGlucoseAlert,
  GlucoseAlertPreferences,
  GlucoseAlertState,
  validateGlucoseAlertPreferences,
} from '@/domain/glucoseAlerts';
import { GlucoseReading, TrendDirection } from '@/domain/models';

const PREFERENCES_KEY = 't1arc.glucose-alert-preferences.v1';
const STATE_KEY = 't1arc.glucose-alert-state.v1';

function mirrorAlertMonitoringOwnership(enabled: boolean) {
  return (
    T1ArcGlucoseDisplay.setGlucoseAlertMonitoringEnabledAsync?.(enabled) ??
    Promise.resolve(true)
  );
}

let glucoseAlertOperationTail: Promise<void> = Promise.resolve();
let glucoseAlertPreferenceTail: Promise<void> = Promise.resolve();

function enqueueGlucoseAlertOperation<T>(operation: () => Promise<T>) {
  const result = glucoseAlertOperationTail.then(operation);
  glucoseAlertOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function enqueueGlucoseAlertPreferenceOperation<T>(
  operation: () => Promise<T>,
) {
  const result = glucoseAlertPreferenceTail.then(operation);
  glucoseAlertPreferenceTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function loadGlucoseAlertPreferences() {
  return enqueueGlucoseAlertPreferenceOperation(
    loadGlucoseAlertPreferencesOperation,
  );
}

async function loadGlucoseAlertPreferencesOperation() {
  const raw = await SecureStore.getItemAsync(PREFERENCES_KEY);
  let preferences = DEFAULT_GLUCOSE_ALERT_PREFERENCES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<GlucoseAlertPreferences>;
      const candidate: GlucoseAlertPreferences = {
        enabled: parsed.enabled === true,
        lowEnabled: parsed.lowEnabled !== false,
        lowThresholdMmolL:
          typeof parsed.lowThresholdMmolL === 'number'
            ? parsed.lowThresholdMmolL
            : DEFAULT_GLUCOSE_ALERT_PREFERENCES.lowThresholdMmolL,
        highEnabled: parsed.highEnabled !== false,
        highThresholdMmolL:
          typeof parsed.highThresholdMmolL === 'number'
            ? parsed.highThresholdMmolL
            : DEFAULT_GLUCOSE_ALERT_PREFERENCES.highThresholdMmolL,
        staleEnabled: parsed.staleEnabled === true,
        repeatMinutes:
          parsed.repeatMinutes === 0 ||
          parsed.repeatMinutes === 30 ||
          parsed.repeatMinutes === 60 ||
          parsed.repeatMinutes === 120
            ? parsed.repeatMinutes
            : DEFAULT_GLUCOSE_ALERT_PREFERENCES.repeatMinutes,
      };
      if (!validateGlucoseAlertPreferences(candidate)) preferences = candidate;
    } catch {
      // Corrupt legacy preferences fail closed.
    }
  }
  // Loading can run in an obsolete foreground or Headless JS runtime. It must
  // stay read-only: repairing native ownership here could re-enable alerts
  // after a newer runtime has durably disabled and cancelled them.
  return preferences;
}

export function saveGlucoseAlertPreferences(
  preferences: GlucoseAlertPreferences,
) {
  return enqueueGlucoseAlertPreferenceOperation(() =>
    saveGlucoseAlertPreferencesOperation(preferences),
  );
}

async function saveGlucoseAlertPreferencesOperation(
  preferences: GlucoseAlertPreferences,
) {
  const error = validateGlucoseAlertPreferences(preferences);
  if (error) throw new Error(error);
  if (!preferences.enabled) {
    // Disable the native owner and cancel its notifications before publishing
    // the canonical JS preference. A failed native disk commit must not leave
    // SecureStore claiming alerts are safely off while the old owner survives.
    await mirrorAlertMonitoringOwnership(false);
    await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(preferences));
  } else {
    // Enabling stays fail-closed: publish the validated preference before
    // allowing Android to restore the owner across boot or process recreation.
    await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(preferences));
    await mirrorAlertMonitoringOwnership(true);
  }
  return preferences;
}

async function loadAlertState(): Promise<GlucoseAlertState> {
  const raw = await SecureStore.getItemAsync(STATE_KEY);
  if (!raw) return DEFAULT_GLUCOSE_ALERT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<GlucoseAlertState>;
    const activeZone =
      parsed.activeZone === 'low' ||
      parsed.activeZone === 'high' ||
      parsed.activeZone === 'stale'
        ? parsed.activeZone
        : 'normal';
    return {
      activeZone,
      lastNotifiedAt:
        typeof parsed.lastNotifiedAt === 'number' &&
        Number.isFinite(parsed.lastNotifiedAt) &&
        parsed.lastNotifiedAt > 0
          ? parsed.lastNotifiedAt
          : undefined,
    };
  } catch {
    return DEFAULT_GLUCOSE_ALERT_STATE;
  }
}

async function saveAlertState(state: GlucoseAlertState) {
  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
}

export async function reconcileGlucoseAlerts(
  reading: GlucoseReading | undefined,
  trend: TrendDirection = reading?.trend ?? 'unknown',
  now = Date.now(),
) {
  return enqueueGlucoseAlertOperation(() =>
    reconcileGlucoseAlertsOperation(reading, trend, now),
  );
}

async function reconcileGlucoseAlertsOperation(
  reading: GlucoseReading | undefined,
  trend: TrendDirection,
  now: number,
) {
  const [preferences, previous] = await Promise.all([
    loadGlucoseAlertPreferences(),
    loadAlertState(),
  ]);
  const evaluation = evaluateGlucoseAlert(reading, preferences, previous, now);
  if (evaluation.shouldCancelExisting) {
    await T1ArcGlucoseDisplay.cancelGlucoseAlertsAsync().catch(() => false);
  }

  let notified = false;
  if (evaluation.shouldNotify && reading && evaluation.zone !== 'normal') {
    notified = await T1ArcGlucoseDisplay.showGlucoseAlertAsync(
      evaluation.zone,
      reading.mmolL,
      trend,
      reading.timestamp,
    ).catch(() => false);
  }

  const nextState =
    evaluation.shouldNotify && !notified
      ? {
          activeZone: evaluation.zone,
          lastNotifiedAt:
            evaluation.zone === previous.activeZone
              ? previous.lastNotifiedAt
              : undefined,
        }
      : evaluation.nextState;
  await saveAlertState(nextState);
  return { preferences, evaluation, notified };
}

export async function resetGlucoseAlertState() {
  return enqueueGlucoseAlertOperation(resetGlucoseAlertStateOperation);
}

/**
 * Invalidates both halves of the alert owner boundary. Replacement must not
 * clear hysteresis until native cancellation succeeds: retaining the state on
 * failure prevents a partially invalidated owner from being published.
 */
export async function invalidateGlucoseAlertsForSourceReplacement() {
  return enqueueGlucoseAlertOperation(async () => {
    const cancelled = await T1ArcGlucoseDisplay.cancelGlucoseAlertsAsync();
    if (!cancelled) {
      throw new Error('Existing glucose alerts could not be cancelled.');
    }
    await SecureStore.deleteItemAsync(STATE_KEY);
  });
}

async function resetGlucoseAlertStateOperation() {
  await Promise.all([
    SecureStore.deleteItemAsync(STATE_KEY),
    T1ArcGlucoseDisplay.cancelGlucoseAlertsAsync().catch(() => false),
  ]);
}
