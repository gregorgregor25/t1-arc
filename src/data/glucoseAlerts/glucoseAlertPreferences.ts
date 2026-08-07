import * as SecureStore from 'expo-secure-store';

import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';
import {
  DEFAULT_GLUCOSE_ALERT_PREFERENCES,
  DEFAULT_GLUCOSE_ALERT_STATE,
  evaluateGlucoseAlert,
  GlucoseAlertPreferences,
  GlucoseAlertState,
  validateGlucoseAlertPreferences,
} from '@/domain/glucoseAlerts';
import { GlucoseReading, TrendDirection } from '@/domain/models';

const PREFERENCES_KEY = 'daymark.glucose-alert-preferences.v1';
const STATE_KEY = 'daymark.glucose-alert-state.v1';

export async function loadGlucoseAlertPreferences() {
  const raw = await SecureStore.getItemAsync(PREFERENCES_KEY);
  if (!raw) return DEFAULT_GLUCOSE_ALERT_PREFERENCES;
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
    return validateGlucoseAlertPreferences(candidate)
      ? DEFAULT_GLUCOSE_ALERT_PREFERENCES
      : candidate;
  } catch {
    return DEFAULT_GLUCOSE_ALERT_PREFERENCES;
  }
}

export async function saveGlucoseAlertPreferences(
  preferences: GlucoseAlertPreferences,
) {
  const error = validateGlucoseAlertPreferences(preferences);
  if (error) throw new Error(error);
  await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(preferences));
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
  const [preferences, previous] = await Promise.all([
    loadGlucoseAlertPreferences(),
    loadAlertState(),
  ]);
  const evaluation = evaluateGlucoseAlert(
    reading,
    preferences,
    previous,
    now,
  );
  if (evaluation.shouldCancelExisting) {
    await DaymarkGlucoseDisplay.cancelGlucoseAlertsAsync().catch(
      () => false,
    );
  }

  let notified = false;
  if (evaluation.shouldNotify && reading && evaluation.zone !== 'normal') {
    notified = await DaymarkGlucoseDisplay.showGlucoseAlertAsync(
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
  await Promise.all([
    SecureStore.deleteItemAsync(STATE_KEY),
    DaymarkGlucoseDisplay.cancelGlucoseAlertsAsync().catch(() => false),
  ]);
}
