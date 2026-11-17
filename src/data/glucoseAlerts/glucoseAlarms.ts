import T1ArcGlucoseDisplay, { type GlucoseAlertChannelStatus } from '../../../modules/t1arc-glucose-display';
import {
  glucoseAlarmConfigurationFromLegacy,
  isGlucoseAlarmSoundId,
  legacyAlertsPredateUrgentLow,
  maxGlucoseAlarmSnoozeMinutes,
  upgradeGlucoseAlarmConfiguration,
  validateGlucoseAlarmConfiguration,
  validateGlucoseAlarmSnoozeUntil,
  type GlucoseAlarmConfiguration,
  type GlucoseAlarmCustomSound,
  type GlucoseAlarmStatus,
} from '@/domain/glucoseAlarms';
import { loadGlucoseAlertPreferences } from './glucoseAlertPreferences';

const UPDATE_REQUIRED = 'Install the updated T1 Arc Android app to use these alarm controls.';

function unsupported(): never { throw new Error(UPDATE_REQUIRED); }

export function glucoseAlarmSupportAvailable() {
  return typeof T1ArcGlucoseDisplay.getGlucoseAlarmConfigurationAsync === 'function' &&
    typeof T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync === 'function' &&
    typeof T1ArcGlucoseDisplay.getGlucoseAlarmStatusAsync === 'function';
}

export interface GlucoseAlarmSettingsLoad {
  configuration: GlucoseAlarmConfiguration;
  /** The saved choices predate urgent low, so settings may offer it once. */
  upgradedFromEarlierChoices: boolean;
}

export async function loadGlucoseAlarmConfiguration(): Promise<GlucoseAlarmConfiguration> {
  return (await loadGlucoseAlarmSettings()).configuration;
}

export async function loadGlucoseAlarmSettings(): Promise<GlucoseAlarmSettingsLoad> {
  const native = await T1ArcGlucoseDisplay.getGlucoseAlarmConfigurationAsync?.();
  if (native !== null && native !== undefined) {
    // An older native build may still return version 1 choices; a newer one
    // upgrades in memory and says so with upgradedFromVersion.
    const upgraded = upgradeGlucoseAlarmConfiguration(native);
    if (!upgraded) throw new Error(validateGlucoseAlarmConfiguration(native) ?? 'The alarm choices could not be read.');
    const raw = native as unknown as Record<string, unknown>;
    return {
      configuration: upgraded,
      upgradedFromEarlierChoices: raw.schemaVersion === 1 || raw.upgradedFromVersion === 1,
    };
  }
  // This is only an editing seed. No save, native ownership update or audio
  // arming may happen merely because settings or a headless runtime loaded.
  const legacy = await loadGlucoseAlertPreferences();
  let channels: GlucoseAlertChannelStatus[];
  try {
    channels = await T1ArcGlucoseDisplay.getGlucoseAlertChannelStatusesAsync();
  } catch {
    throw new Error('Your existing Android alert choices could not be checked. Try loading the alarm settings again.');
  }
  const blocked = (kind: 'low' | 'high' | 'stale') => channels.some(channel => channel.kind === kind && channel.state === 'blocked');
  // A newly created channel must not revive a category that the user had
  // explicitly blocked in Android. The editing form can re-enable it only
  // through another deliberate category toggle before the first native save.
  return {
    configuration: glucoseAlarmConfigurationFromLegacy({
      ...legacy,
      lowEnabled: legacy.lowEnabled && !blocked('low'),
      highEnabled: legacy.highEnabled && !blocked('high'),
      staleEnabled: legacy.staleEnabled && !blocked('stale'),
    }),
    upgradedFromEarlierChoices: legacyAlertsPredateUrgentLow(legacy),
  };
}

/** Fills fields that an older native build does not report yet. */
export function normalizeGlucoseAlarmStatus(status: GlucoseAlarmStatus): GlucoseAlarmStatus {
  // Never invent a status the native layer did not return.
  if (!status || typeof status !== 'object') return status;
  const partial: Partial<GlucoseAlarmStatus> = status;
  return {
    ...status,
    audioArmed: typeof partial.audioArmed === 'boolean' ? partial.audioArmed : status.enabled && status.audioEnabled,
    lowPausedUntilMs: typeof partial.lowPausedUntilMs === 'number' ? partial.lowPausedUntilMs : null,
    maxSnoozeMinutes: typeof partial.maxSnoozeMinutes === 'number' && partial.maxSnoozeMinutes > 0
      ? partial.maxSnoozeMinutes
      : maxGlucoseAlarmSnoozeMinutes(status.activeKind),
  };
}

export async function saveGlucoseAlarmConfiguration(configuration: GlucoseAlarmConfiguration): Promise<GlucoseAlarmStatus> {
  const error = validateGlucoseAlarmConfiguration(configuration);
  if (error) throw new Error(error);
  if (!T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync) return unsupported();
  return normalizeGlucoseAlarmStatus(await T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync(configuration));
}

export async function getGlucoseAlarmStatus(): Promise<GlucoseAlarmStatus> {
  if (T1ArcGlucoseDisplay.getGlucoseAlarmStatusAsync) return normalizeGlucoseAlarmStatus(await T1ArcGlucoseDisplay.getGlucoseAlarmStatusAsync());
  return {
    configured: false,
    enabled: false,
    audioEnabled: false,
    audioArmed: false,
    activeKind: null,
    episodeId: null,
    readingTimestampMs: null,
    snoozedUntilMs: null,
    lowPausedUntilMs: null,
    maxSnoozeMinutes: maxGlucoseAlarmSnoozeMinutes(null),
    acknowledged: false,
    missing: true,
    playbackState: 'blocked',
    readinessIssues: [UPDATE_REQUIRED],
    customSounds: [],
  };
}

function validateEpisodeId(episodeId: string) {
  if (!episodeId || episodeId.length > 200) throw new Error('This alarm has ended. Refresh the alarm controls.');
}

/** maxSnoozeMinutes comes from the alarm status; native enforces the same cap. */
export async function snoozeGlucoseAlarm(episodeId: string, untilMs: number, maxSnoozeMinutes?: number): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  const error = validateGlucoseAlarmSnoozeUntil(untilMs, Date.now(), maxSnoozeMinutes);
  if (error) throw new Error(error);
  if (!T1ArcGlucoseDisplay.snoozeGlucoseAlarmAsync) return unsupported();
  return normalizeGlucoseAlarmStatus(await T1ArcGlucoseDisplay.snoozeGlucoseAlarmAsync(episodeId, untilMs));
}

export async function cancelGlucoseAlarmSnooze(episodeId: string): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  if (!T1ArcGlucoseDisplay.cancelGlucoseAlarmSnoozeAsync) return unsupported();
  return normalizeGlucoseAlarmStatus(await T1ArcGlucoseDisplay.cancelGlucoseAlarmSnoozeAsync(episodeId));
}

export async function acknowledgeGlucoseAlarm(episodeId: string): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  if (!T1ArcGlucoseDisplay.acknowledgeGlucoseAlarmAsync) return unsupported();
  return normalizeGlucoseAlarmStatus(await T1ArcGlucoseDisplay.acknowledgeGlucoseAlarmAsync(episodeId));
}

export interface GlucoseLowAlarmPause { pausedUntilMs: number | null; minutes: number }

/**
 * Pauses ordinary low alerts after a logged "Treating a hypo" entry, for the
 * minutes chosen in alarm settings (0 turns this off). Urgent low alerts are
 * never paused. Resolves with no pause when unsupported or turned off.
 */
export async function pauseLowGlucoseAlarmAfterHypoTreatment(treatedAtMs: number): Promise<GlucoseLowAlarmPause> {
  if (!Number.isSafeInteger(treatedAtMs) || treatedAtMs <= 0) throw new Error('The hypo treatment time is not valid.');
  if (!T1ArcGlucoseDisplay.pauseGlucoseLowAlarmAfterHypoTreatmentAsync) return { pausedUntilMs: null, minutes: 0 };
  const result = await T1ArcGlucoseDisplay.pauseGlucoseLowAlarmAfterHypoTreatmentAsync(treatedAtMs);
  const pausedUntilMs = typeof result?.pausedUntilMs === 'number' && Number.isFinite(result.pausedUntilMs) ? result.pausedUntilMs : null;
  const minutes = pausedUntilMs !== null && typeof result?.minutes === 'number' && Number.isFinite(result.minutes) ? result.minutes : 0;
  return { pausedUntilMs, minutes };
}

export async function importGlucoseAlarmSound(uri: string, displayName: string): Promise<GlucoseAlarmCustomSound> {
  if (!/^(file|content):\/\//i.test(uri)) throw new Error('Choose an audio file stored on your phone.');
  if (!T1ArcGlucoseDisplay.importGlucoseAlarmSoundAsync) return unsupported();
  const result = await T1ArcGlucoseDisplay.importGlucoseAlarmSoundAsync(uri, displayName.trim().slice(0, 160) || 'Custom sound');
  if (!isGlucoseAlarmSoundId(result.id) || !result.id.startsWith('custom:') || !result.name) throw new Error('The selected sound could not be imported.');
  return result;
}

/** Call only from a deliberate Play/Test action. Never from load or selection. */
export async function previewGlucoseAlarmSound(soundId: string, volume: number): Promise<boolean> {
  if (!isGlucoseAlarmSoundId(soundId) || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Choose a valid sound and preview volume.');
  if (!T1ArcGlucoseDisplay.previewGlucoseAlarmSoundAsync) return unsupported();
  return T1ArcGlucoseDisplay.previewGlucoseAlarmSoundAsync(soundId, volume);
}

export async function stopGlucoseAlarmPreview(): Promise<boolean> {
  return T1ArcGlucoseDisplay.stopGlucoseAlarmPreviewAsync?.() ?? false;
}

/** Open the system page only from a deliberate user button press. */
export async function openGlucoseAlarmExactAlarmSettings(): Promise<boolean> {
  if (!T1ArcGlucoseDisplay.openGlucoseAlarmExactAlarmSettingsAsync) return unsupported();
  return T1ArcGlucoseDisplay.openGlucoseAlarmExactAlarmSettingsAsync();
}
