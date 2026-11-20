import type { GlucoseAlertPreferences } from './glucoseAlerts';
import { addDays, getZonedDateTimeParts, toDateKey, zonedWallClockCandidates } from './time';

export type GlucoseAlarmKind = 'urgentLow' | 'low' | 'high' | 'veryHigh' | 'stale';
export type GlucoseAlarmRepeatMinutes = 0 | 5 | 10 | 15 | 20 | 30 | 60 | 120;
/** "Only alert if it stays out of range for N minutes". High and very high only. */
export type GlucoseAlarmHighPersistMinutes = 0 | 5 | 10 | 15 | 20 | 30;
/** Low-alert pause after a logged hypo treatment; 0 turns it off. */
export type GlucoseAlarmHypoTreatmentSnoozeMinutes = 0 | 10 | 15 | 20 | 30;
export interface GlucoseAlarmCustomSound { id: string; name: string }

export interface GlucoseAlarmConfiguration {
  schemaVersion: 2;
  enabled: boolean;
  audioEnabled: boolean;
  urgentLowEnabled: boolean;
  urgentLowThresholdMmolL: number;
  lowEnabled: boolean;
  lowThresholdMmolL: number;
  highEnabled: boolean;
  highThresholdMmolL: number;
  veryHighEnabled: boolean;
  veryHighThresholdMmolL: number | null;
  staleEnabled: boolean;
  repeatMinutes: GlucoseAlarmRepeatMinutes;
  highPersistMinutes: GlucoseAlarmHighPersistMinutes;
  hypoTreatmentSnoozeMinutes: GlucoseAlarmHypoTreatmentSnoozeMinutes;
  nightEnabled: boolean;
  nightStartMinutes: number;
  nightEndMinutes: number;
  urgentLowSound: string;
  lowSound: string;
  highSound: string;
  veryHighSound: string;
  staleSound: string;
  volume: number;
  rampSeconds: number;
}

/** Choices saved before urgent low, the high delay and the hypo pause existed. */
export type GlucoseAlarmConfigurationV1 = Omit<GlucoseAlarmConfiguration,
  'schemaVersion' | 'urgentLowEnabled' | 'urgentLowThresholdMmolL' | 'urgentLowSound' | 'highPersistMinutes' | 'hypoTreatmentSnoozeMinutes'> & {
  schemaVersion: 1;
};

export interface GlucoseAlarmStatus {
  configured: boolean;
  enabled: boolean;
  audioEnabled: boolean;
  /** Follows the saved choices only, so it survives restarts, reboots and app updates. */
  audioArmed: boolean;
  activeKind: GlucoseAlarmKind | null;
  episodeId: string | null;
  readingTimestampMs: number | null;
  snoozedUntilMs: number | null;
  /** End of the automatic low pause after a logged hypo treatment. */
  lowPausedUntilMs: number | null;
  /** Longest snooze allowed for the active alert (30 for urgent low). */
  maxSnoozeMinutes: number;
  acknowledged: boolean;
  missing: boolean;
  playbackState: 'idle' | 'playing' | 'blocked';
  readinessIssues: string[];
  customSounds: GlucoseAlarmCustomSound[];
}

export const GLUCOSE_ALARM_KINDS: readonly GlucoseAlarmKind[] = ['urgentLow', 'low', 'high', 'veryHigh', 'stale'];
export const GLUCOSE_ALARM_SOUND_KEYS = {
  urgentLow: 'urgentLowSound',
  low: 'lowSound',
  high: 'highSound',
  veryHigh: 'veryHighSound',
  stale: 'staleSound',
} as const satisfies Record<GlucoseAlarmKind, keyof GlucoseAlarmConfiguration>;
/** Built-in sound used when a custom sound is unavailable. */
export const GLUCOSE_ALARM_BUILT_IN_SOUND: Record<GlucoseAlarmKind, 'pulse' | 'notes'> = {
  urgentLow: 'pulse', low: 'pulse', high: 'notes', veryHigh: 'notes', stale: 'pulse',
};
export const GLUCOSE_ALARM_SNOOZE_MINUTES = [5, 10, 15, 20, 30, 60] as const;
export const MAX_GLUCOSE_ALARM_SNOOZE_MS = 24 * 60 * 60_000;
const MAX_SNOOZE_MINUTES = MAX_GLUCOSE_ALARM_SNOOZE_MS / 60_000;
export const URGENT_LOW_MAX_SNOOZE_MINUTES = 30;
export const DEFAULT_URGENT_LOW_MMOL_L = 3.0;
export const GLUCOSE_ALARM_HIGH_PERSIST_MINUTES: readonly GlucoseAlarmHighPersistMinutes[] = [0, 5, 10, 15, 20, 30];
export const GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES: readonly GlucoseAlarmHypoTreatmentSnoozeMinutes[] = [0, 10, 15, 20, 30];
export const DEFAULT_GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES: GlucoseAlarmHypoTreatmentSnoozeMinutes = 15;

/**
 * Quiet by default: the master switch and the sound switch are off. Urgent low
 * is ready at 3.0 mmol/L (54 mg/dL) for when the user turns alerts on.
 * Ordinary high stays at a loose 13.9 mmol/L with no delay.
 */
export const DEFAULT_GLUCOSE_ALARM_CONFIGURATION: GlucoseAlarmConfiguration = {
  schemaVersion: 2,
  enabled: false,
  audioEnabled: false,
  urgentLowEnabled: true,
  urgentLowThresholdMmolL: DEFAULT_URGENT_LOW_MMOL_L,
  lowEnabled: true,
  lowThresholdMmolL: 3.9,
  highEnabled: true,
  highThresholdMmolL: 13.9,
  veryHighEnabled: false,
  veryHighThresholdMmolL: null,
  staleEnabled: false,
  repeatMinutes: 30,
  highPersistMinutes: 0,
  hypoTreatmentSnoozeMinutes: DEFAULT_GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES,
  nightEnabled: false,
  nightStartMinutes: 23 * 60,
  nightEndMinutes: 7 * 60,
  urgentLowSound: 'pulse',
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

/** Lowest urgent-low level the settings accept. */
const MIN_URGENT_LOW_MMOL_L = 2;
const MG_DL_PER_MMOL_L = 18.0182;

/**
 * Mirrors the native GlucoseAlarmPolicy.suggestedUrgentLowThreshold. The level
 * offered to someone whose choices predate urgent low: 3.0 mmol/L, or 0.2 mmol/L
 * below a low level already at or under 3.0. Undefined when no level of at
 * least 2.0 mmol/L fits below the low level.
 */
export function suggestedUrgentLowThreshold(lowThresholdMmolL: number): number | undefined {
  if (!Number.isFinite(lowThresholdMmolL)) return undefined;
  const threshold = lowThresholdMmolL > DEFAULT_URGENT_LOW_MMOL_L
    ? DEFAULT_URGENT_LOW_MMOL_L
    : Math.round((lowThresholdMmolL - 0.2) * 10) / 10;
  return threshold >= MIN_URGENT_LOW_MMOL_L && threshold < lowThresholdMmolL ? threshold : undefined;
}

/** True while urgent low is off and a valid level fits below the chosen low level. */
export function urgentLowOfferApplies(configuration: GlucoseAlarmConfiguration): boolean {
  return !configuration.urgentLowEnabled && suggestedUrgentLowThreshold(configuration.lowThresholdMmolL) !== undefined;
}

/** "3.0 mmol/L (54 mg/dL)": both units, as used in the urgent low wording. */
export function urgentLowLevelLabel(thresholdMmolL: number): string {
  return `${thresholdMmolL.toFixed(1)} mmol/L (${Math.round(thresholdMmolL * MG_DL_PER_MMOL_L)} mg/dL)`;
}

/** What "Silence this alert" means for the active alert, including the urgent low repeat override. */
export function glucoseAlarmSilenceExplanation(kind: GlucoseAlarmKind): string {
  return kind === 'urgentLow'
    ? `Silencing is not a recovery. While urgent low lasts it reminds you again at least every ${URGENT_LOW_MAX_SNOOZE_MINUTES} minutes, even if reminders are set to Never or a longer interval. A new low or very high alert is separate.`
    : 'Silencing is not a recovery. If the alert remains unresolved, your repeat setting controls reminders. A new urgent low, low or very high alert is separate.';
}

/**
 * The small on-screen alert card. A snoozed or silenced alert has nothing to
 * act on until it sounds again, so the card would only cover the screen
 * (for example the Tarv1s message box). The alert notification keeps its
 * controls, and the alert sounds again when the snooze or reminder is due.
 */
export function glucoseAlarmBannerVisible(state: { panelOpen: boolean; snoozed: boolean; silenced: boolean }): boolean {
  return !state.panelOpen && !state.snoozed && !state.silenced;
}

export function validateGlucoseAlarmConfiguration(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'The alarm choices could not be read.';
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== 2) return 'This version of the alarm choices is not supported.';
  const booleans = ['enabled', 'audioEnabled', 'urgentLowEnabled', 'lowEnabled', 'highEnabled', 'veryHighEnabled', 'staleEnabled', 'nightEnabled'];
  if (booleans.some(key => typeof config[key] !== 'boolean')) return 'Every alarm switch must be on or off.';
  const urgentLow = config.urgentLowThresholdMmolL;
  const low = config.lowThresholdMmolL;
  const high = config.highThresholdMmolL;
  const veryHigh = config.veryHighThresholdMmolL;
  if (typeof low !== 'number' || !Number.isFinite(low) || low < 2 || low > 6) return 'Choose a valid low glucose threshold.';
  if (typeof urgentLow !== 'number' || !Number.isFinite(urgentLow) || urgentLow < 2 || urgentLow > 4) return 'Choose an urgent low level between 2.0 and 4.0 mmol/L.';
  if (config.urgentLowEnabled && config.lowEnabled && urgentLow >= low) return 'The urgent low level must be below the low level.';
  if (typeof high !== 'number' || !Number.isFinite(high) || high < 7 || high > 25 || high < low + 1) return 'Choose a high glucose threshold above the low threshold.';
  if (veryHigh !== null && (typeof veryHigh !== 'number' || !Number.isFinite(veryHigh) || veryHigh <= high || veryHigh > 33.3)) return 'The very high glucose threshold must be above high glucose.';
  if (config.veryHighEnabled && veryHigh === null) return 'Choose a very high glucose threshold before enabling it.';
  if (typeof config.repeatMinutes !== 'number' || ![0, 5, 10, 15, 20, 30, 60, 120].includes(config.repeatMinutes)) return 'Choose a supported reminder interval.';
  if (typeof config.highPersistMinutes !== 'number' || !(GLUCOSE_ALARM_HIGH_PERSIST_MINUTES as readonly number[]).includes(config.highPersistMinutes)) return 'Choose a supported delay for high alerts.';
  if (typeof config.hypoTreatmentSnoozeMinutes !== 'number' || !(GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES as readonly number[]).includes(config.hypoTreatmentSnoozeMinutes)) return 'Choose a supported pause after a logged hypo treatment.';
  const clockMinutes = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440;
  if (!clockMinutes(config.nightStartMinutes) || !clockMinutes(config.nightEndMinutes)) return 'Choose valid start and end times for night alerts.';
  if (config.nightEnabled && config.nightStartMinutes === config.nightEndMinutes) return 'Choose different start and end times for night alerts.';
  if (Object.values(GLUCOSE_ALARM_SOUND_KEYS).some(key => !isGlucoseAlarmSoundId(config[key]))) return 'Choose an available sound for each alarm.';
  if (typeof config.volume !== 'number' || !Number.isFinite(config.volume) || config.volume < 0 || config.volume > 1) return 'Choose an alarm volume between 0% and 100%.';
  if (typeof config.rampSeconds !== 'number' || !Number.isFinite(config.rampSeconds) || config.rampSeconds < 0 || config.rampSeconds > 15) return 'Choose an alarm volume ramp between 0 and 15 seconds.';
  return undefined;
}

/**
 * Accepts version 1 or 2 choices and returns version 2, or undefined when
 * invalid. Mirrors the native upgrade: existing alarms behave exactly as
 * before. Urgent low stays off (settings offer it once; only the user can add
 * it), with the suggested level kept ready; there is no high delay and no
 * automatic low pause after a logged hypo treatment. The master switch and the
 * sound switch are never changed.
 */
export function upgradeGlucoseAlarmConfiguration(value: unknown): GlucoseAlarmConfiguration | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as Record<string, unknown>;
  let candidate: Record<string, unknown> = config;
  if (config.schemaVersion === 1) {
    const lowThreshold = typeof config.lowThresholdMmolL === 'number' ? config.lowThresholdMmolL : Number.NaN;
    candidate = {
      ...config,
      schemaVersion: 2,
      urgentLowEnabled: false,
      urgentLowThresholdMmolL: suggestedUrgentLowThreshold(lowThreshold) ?? MIN_URGENT_LOW_MMOL_L,
      urgentLowSound: config.lowSound,
      highPersistMinutes: 0,
      hypoTreatmentSnoozeMinutes: 0,
    };
  }
  if (validateGlucoseAlarmConfiguration(candidate)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_GLUCOSE_ALARM_CONFIGURATION)) result[key] = candidate[key];
  return result as unknown as GlucoseAlarmConfiguration;
}

/** Older in-app alerts that were turned on predate urgent low, like version 1 native choices. */
export function legacyAlertsPredateUrgentLow(legacy: GlucoseAlertPreferences): boolean {
  return legacy.enabled;
}

/**
 * Seeds the editing form only. Calling this must never persist or arm audio.
 * Older in-app alerts that were on keep behaving as before (urgent low off,
 * no automatic low pause); otherwise this is a new install and the quiet
 * defaults apply, with urgent low ready for when alerts are turned on.
 */
export function glucoseAlarmConfigurationFromLegacy(legacy: GlucoseAlertPreferences): GlucoseAlarmConfiguration {
  const suggested = suggestedUrgentLowThreshold(legacy.lowThresholdMmolL);
  const existing = legacyAlertsPredateUrgentLow(legacy);
  return {
    ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION,
    urgentLowEnabled: !existing && suggested !== undefined,
    urgentLowThresholdMmolL: suggested ?? MIN_URGENT_LOW_MMOL_L,
    hypoTreatmentSnoozeMinutes: existing ? 0 : DEFAULT_GLUCOSE_ALARM_HYPO_TREATMENT_SNOOZE_MINUTES,
    enabled: legacy.enabled,
    lowEnabled: legacy.lowEnabled,
    lowThresholdMmolL: legacy.lowThresholdMmolL,
    highEnabled: legacy.highEnabled,
    highThresholdMmolL: legacy.highThresholdMmolL,
    staleEnabled: legacy.staleEnabled,
    repeatMinutes: legacy.repeatMinutes,
  };
}

/** Longest snooze for an alert kind. Urgent low is capped at 30 minutes. */
export function maxGlucoseAlarmSnoozeMinutes(kind: GlucoseAlarmKind | null | undefined): number {
  return kind === 'urgentLow' ? URGENT_LOW_MAX_SNOOZE_MINUTES : MAX_SNOOZE_MINUTES;
}

/** Snooze presets offered for an alert whose longest snooze is maxMinutes. */
export function glucoseAlarmSnoozeOptions(maxMinutes = MAX_SNOOZE_MINUTES): number[] {
  return GLUCOSE_ALARM_SNOOZE_MINUTES.filter(minutes => minutes <= maxMinutes);
}

export function validateGlucoseAlarmSnoozeUntil(untilMs: number, now = Date.now(), maxMinutes = MAX_SNOOZE_MINUTES): string | undefined {
  const maxMs = Math.min(MAX_GLUCOSE_ALARM_SNOOZE_MS, Math.max(0, maxMinutes) * 60_000);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(untilMs) || untilMs <= now || untilMs - now > maxMs) {
    return maxMs < MAX_GLUCOSE_ALARM_SNOOZE_MS
      ? `Urgent low alerts can be snoozed for up to ${Math.round(maxMs / 60_000)} minutes.`
      : 'Choose a snooze end time within the next 24 hours.';
  }
  return undefined;
}

export function glucoseAlarmSnoozeUntil(minutes: number, now = Date.now(), maxMinutes = MAX_SNOOZE_MINUTES): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new Error('Choose a snooze duration of up to 24 hours.');
  const until = now + minutes * 60_000;
  const error = validateGlucoseAlarmSnoozeUntil(until, now, maxMinutes);
  if (error) throw new Error(error);
  return until;
}

/** Device clock picker: choose the next real occurrence; never normalize a DST gap. */
export function customClockSnoozeUntil(
  hours: number,
  minutes: number,
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  maxMinutes = MAX_SNOOZE_MINUTES,
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
  const error = validateGlucoseAlarmSnoozeUntil(candidate, now, maxMinutes);
  if (error) throw new Error(error);
  return candidate;
}

export const nextGlucoseAlarmSnoozeTime = customClockSnoozeUntil;

/** Confirmation text after a logged hypo treatment paused ordinary low alerts. */
export function hypoTreatmentPauseNotice(pausedUntilMs: number | null, now: number, clock: (timestamp: number) => string): string | undefined {
  if (pausedUntilMs === null || !Number.isFinite(pausedUntilMs) || pausedUntilMs <= now) return undefined;
  const minutes = Math.max(1, Math.ceil((pausedUntilMs - now) / 60_000));
  return `Low glucose alerts are paused for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, until ${clock(pausedUntilMs)}. Urgent low alerts still sound.`;
}
