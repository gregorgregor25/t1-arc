import { GlucoseReading } from './models';
import { formatGlucose, glucoseUnitLabel } from './regionalFormat';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';

export type GlucoseAlertZone = 'normal' | 'low' | 'high' | 'stale';
export type GlucoseAlertRepeatMinutes = 0 | 30 | 60 | 120;

export interface GlucoseAlertPreferences {
  enabled: boolean;
  lowEnabled: boolean;
  lowThresholdMmolL: number;
  highEnabled: boolean;
  highThresholdMmolL: number;
  staleEnabled: boolean;
  repeatMinutes: GlucoseAlertRepeatMinutes;
}

export interface GlucoseAlertState {
  activeZone: GlucoseAlertZone;
  lastNotifiedAt?: number;
}

export interface GlucoseAlertEvaluation {
  zone: GlucoseAlertZone;
  shouldCancelExisting: boolean;
  shouldNotify: boolean;
  nextState: GlucoseAlertState;
}

export const DEFAULT_GLUCOSE_ALERT_PREFERENCES: GlucoseAlertPreferences = {
  enabled: false,
  lowEnabled: true,
  lowThresholdMmolL: 3.9,
  highEnabled: true,
  highThresholdMmolL: 13.9,
  staleEnabled: false,
  repeatMinutes: 30,
};

export const DEFAULT_GLUCOSE_ALERT_STATE: GlucoseAlertState = {
  activeZone: 'normal',
};

export function validateGlucoseAlertPreferences(
  value: GlucoseAlertPreferences,
): string | undefined {
  if (
    typeof value.enabled !== 'boolean' ||
    typeof value.lowEnabled !== 'boolean' ||
    typeof value.highEnabled !== 'boolean' ||
    typeof value.staleEnabled !== 'boolean'
  ) {
    return 'Every glucose alert switch must be on or off.';
  }
  if (
    !Number.isFinite(value.lowThresholdMmolL) ||
    value.lowThresholdMmolL < 2 ||
    value.lowThresholdMmolL > 6
  ) {
    const regional = getRuntimeRegionalDefaults();
    return `The low alert must be between ${formatGlucose(2, regional, { withUnit: false })} and ${formatGlucose(6, regional, { withUnit: false })} ${glucoseUnitLabel(regional.glucoseUnit)}.`;
  }
  if (
    !Number.isFinite(value.highThresholdMmolL) ||
    value.highThresholdMmolL < 7 ||
    value.highThresholdMmolL > 25
  ) {
    const regional = getRuntimeRegionalDefaults();
    return `The high alert must be between ${formatGlucose(7, regional, { withUnit: false })} and ${formatGlucose(25, regional, { withUnit: false })} ${glucoseUnitLabel(regional.glucoseUnit)}.`;
  }
  if (value.lowThresholdMmolL + 1 > value.highThresholdMmolL) {
    return `Keep at least ${formatGlucose(1, getRuntimeRegionalDefaults())} between the low and high alerts.`;
  }
  if (![0, 30, 60, 120].includes(value.repeatMinutes)) {
    return 'Choose a supported alert repeat interval.';
  }
  return undefined;
}

export function evaluateGlucoseAlert(
  reading: GlucoseReading | undefined,
  preferences: GlucoseAlertPreferences,
  previous: GlucoseAlertState,
  now = Date.now(),
): GlucoseAlertEvaluation {
  const zone = alertZone(reading, preferences, previous, now);
  const changed = zone !== previous.activeZone;
  const repeatDue =
    zone !== 'normal' &&
    preferences.repeatMinutes > 0 &&
    previous.lastNotifiedAt !== undefined &&
    now - previous.lastNotifiedAt >= preferences.repeatMinutes * 60_000;
  const firstNotification =
    zone !== 'normal' &&
    (changed || previous.lastNotifiedAt === undefined);
  const shouldNotify =
    preferences.enabled && (firstNotification || repeatDue);

  return {
    zone,
    shouldCancelExisting: changed,
    shouldNotify,
    nextState: {
      activeZone: zone,
      lastNotifiedAt: shouldNotify
        ? now
        : changed
          ? undefined
          : previous.lastNotifiedAt,
    },
  };
}

function alertZone(
  reading: GlucoseReading | undefined,
  preferences: GlucoseAlertPreferences,
  previous: GlucoseAlertState,
  now: number,
): GlucoseAlertZone {
  if (!preferences.enabled) return 'normal';
  if (
    preferences.staleEnabled &&
    reading &&
    now - reading.timestamp > STALE_AFTER_MS
  ) {
    return 'stale';
  }
  if (!reading || now - reading.timestamp > STALE_AFTER_MS) return 'normal';

  if (
    preferences.lowEnabled &&
    (reading.mmolL <= preferences.lowThresholdMmolL ||
      (previous.activeZone === 'low' &&
        reading.mmolL <
          preferences.lowThresholdMmolL + LOW_RESOLUTION_HYSTERESIS))
  ) {
    return 'low';
  }
  if (
    preferences.highEnabled &&
    (reading.mmolL >= preferences.highThresholdMmolL ||
      (previous.activeZone === 'high' &&
        reading.mmolL >
          preferences.highThresholdMmolL - HIGH_RESOLUTION_HYSTERESIS))
  ) {
    return 'high';
  }
  return 'normal';
}

const STALE_AFTER_MS = 12 * 60_000;
const LOW_RESOLUTION_HYSTERESIS = 0.3;
const HIGH_RESOLUTION_HYSTERESIS = 0.5;
