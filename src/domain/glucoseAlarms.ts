import type { GlucoseAlertPreferences } from './glucoseAlerts';
import { addDays, getZonedDateTimeParts, toDateKey, zonedWallClockCandidates } from './time';

export type GlucoseAlarmKind = 'low' | 'high' | 'veryHigh' | 'stale';
export type GlucoseAlarmRepeatMinutes = 0 | 5 | 10 | 15 | 20 | 30 | 60 | 120;
export interface GlucoseAlarmCustomSound { id: string; name: string }

export interface GlucoseAlarmConfiguration {
  schemaVersion: 1;
  enabled: boolean;
  audioEnabled: boolean;
  lowEnabled: boolean;
  lowThresholdMmolL: number;
  highEnabled: boolean;
  highThresholdMmolL: number;
  veryHighEnabled: boolean;
  veryHighThresholdMmolL: number | null;
  staleEnabled: boolean;
  repeatMinutes: GlucoseAlarmRepeatMinutes;
  nightEnabled: boolean;
  nightStartMinutes: number;
  nightEndMinutes: number;
  lowSound: string;
  highSound: string;
  veryHighSound: string;
  staleSound: string;
  volume: number;
  rampSeconds: number;
}

export interface GlucoseAlarmStatus {
  configured: boolean;
  enabled: boolean;
  audioEnabled: boolean;
  activeKind: GlucoseAlarmKind | null;
  episodeId: string | null;
  readingTimestampMs: number | null;
  snoozedUntilMs: number | null;
  acknowledged: boolean;
  missing: boolean;
  playbackState: 'idle' | 'playing' | 'blocked';
  readinessIssues: string[];
  customSounds: GlucoseAlarmCustomSound[];
}

export const GLUCOSE_ALARM_SNOOZE_MINUTES = [5, 10, 15, 20, 30, 60] as const;
export const MAX_GLUCOSE_ALARM_SNOOZE_MS = 24 * 60 * 60_000;

export const DEFAULT_GLUCOSE_ALARM_CONFIGURATION: GlucoseAlarmConfiguration = {
  schemaVersion: 1,
  enabled: false,
  audioEnabled: false,
  lowEnabled: true,
  lowThresholdMmolL: 3.9,
  highEnabled: true,
  highThresholdMmolL: 13.9,
  veryHighEnabled: false,
  veryHighThresholdMmolL: null,
  staleEnabled: false,
  repeatMinutes: 30,
  nightEnabled: false,
  nightStartMinutes: 23 * 60,
  nightEndMinutes: 7 * 60,
  lowSound: 'pulse',
  highSound: 'notes',
  veryHighSound: 'notes',
  staleSound: 'pulse',
  volume: 0.35,
  rampSeconds: 5,
};

export function isGlucoseAlarmSoundId(value: unknown): value is string {
  return typeof value === 'string' &&
    (value === 'pulse' || value === 'notes' || /^custom:[a-f0-9-]{36}$/.test(value));
}

export function validateGlucoseAlarmConfiguration(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'The alarm choices could not be read.';
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== 1) return 'This version of the alarm choices is not supported.';
  const booleans = ['enabled', 'audioEnabled', 'lowEnabled', 'highEnabled', 'veryHighEnabled', 'staleEnabled', 'nightEnabled'];
  if (booleans.some(key => typeof config[key] !== 'boolean')) return 'Every alarm switch must be on or off.';
  const low = config.lowThresholdMmolL;
  const high = config.highThresholdMmolL;
  const veryHigh = config.veryHighThresholdMmolL;
  if (typeof low !== 'number' || !Number.isFinite(low) || low < 2 || low > 6) return 'Choose a valid low glucose threshold.';
  if (typeof high !== 'number' || !Number.isFinite(high) || high < 7 || high > 25 || high < low + 1) return 'Choose a high glucose threshold above the low threshold.';
  if (veryHigh !== null && (typeof veryHigh !== 'number' || !Number.isFinite(veryHigh) || veryHigh <= high || veryHigh > 33.3)) return 'The very high glucose threshold must be above high glucose.';
  if (config.veryHighEnabled && veryHigh === null) return 'Choose a very high glucose threshold before enabling it.';
  if (typeof config.repeatMinutes !== 'number' || ![0, 5, 10, 15, 20, 30, 60, 120].includes(config.repeatMinutes)) return 'Choose a supported reminder interval.';
  const clockMinutes = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440;
  if (!clockMinutes(config.nightStartMinutes) || !clockMinutes(config.nightEndMinutes)) return 'Choose valid start and end times for night alerts.';
  if (config.nightEnabled && config.nightStartMinutes === config.nightEndMinutes) return 'Choose different start and end times for night alerts.';
  if (['lowSound', 'highSound', 'veryHighSound', 'staleSound'].some(key => !isGlucoseAlarmSoundId(config[key]))) return 'Choose an available sound for each alarm.';
  if (typeof config.volume !== 'number' || !Number.isFinite(config.volume) || config.volume < 0 || config.volume > 1) return 'Choose an alarm volume between 0% and 100%.';
  if (typeof config.rampSeconds !== 'number' || !Number.isFinite(config.rampSeconds) || config.rampSeconds < 0 || config.rampSeconds > 15) return 'Choose an alarm volume ramp between 0 and 15 seconds.';
  return undefined;
}

/** Seeds the editing form only. Calling this must never persist or arm audio. */
export function glucoseAlarmConfigurationFromLegacy(legacy: GlucoseAlertPreferences): GlucoseAlarmConfiguration {
  return {
    ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION,
    enabled: legacy.enabled,
    lowEnabled: legacy.lowEnabled,
    lowThresholdMmolL: legacy.lowThresholdMmolL,
    highEnabled: legacy.highEnabled,
    highThresholdMmolL: legacy.highThresholdMmolL,
    staleEnabled: legacy.staleEnabled,
    repeatMinutes: legacy.repeatMinutes,
  };
}

export function validateGlucoseAlarmSnoozeUntil(untilMs: number, now = Date.now()): string | undefined {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(untilMs) || untilMs <= now || untilMs - now > MAX_GLUCOSE_ALARM_SNOOZE_MS) {
    return 'Choose a snooze end time within the next 24 hours.';
  }
  return undefined;
}

export function glucoseAlarmSnoozeUntil(minutes: number, now = Date.now()): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new Error('Choose a snooze duration of up to 24 hours.');
  const until = now + minutes * 60_000;
  const error = validateGlucoseAlarmSnoozeUntil(until, now);
  if (error) throw new Error(error);
  return until;
}

/** Device clock picker: choose the next real occurrence; never normalize a DST gap. */
export function customClockSnoozeUntil(
  hours: number,
  minutes: number,
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): number {
  if (!Number.isFinite(now)) throw new Error('The current time is not available.');
  const today = toDateKey(now, timeZone);
  const todayCandidates = zonedWallClockCandidates(today, hours, minutes, 0, timeZone);
  const localNow = getZonedDateTimeParts(now, timeZone);
  // Reject a future DST gap rather than moving the selected clock time. A
  // clock time already passed today still means tomorrow, even on gap day.
  if (!todayCandidates.length && hours * 60 + minutes > localNow.hour * 60 + localNow.minute) throw new Error('That time does not exist today because the clocks change. Choose another time.');
  let candidate = todayCandidates.find(timestamp => timestamp > now);
  if (candidate === undefined) {
    const tomorrowCandidates = zonedWallClockCandidates(addDays(today, 1), hours, minutes, 0, timeZone);
    candidate = tomorrowCandidates.find(timestamp => timestamp > now);
    if (candidate === undefined) throw new Error('That time does not exist tomorrow because the clocks change. Choose another time.');
  }
  const error = validateGlucoseAlarmSnoozeUntil(candidate, now);
  if (error) throw new Error(error);
  return candidate;
}

export const nextGlucoseAlarmSnoozeTime = customClockSnoozeUntil;
