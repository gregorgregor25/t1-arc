import T1ArcGlucoseDisplay, { type GlucoseAlertChannelStatus } from '../../../modules/t1arc-glucose-display';
import {
  glucoseAlarmConfigurationFromLegacy,
  isGlucoseAlarmSoundId,
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

export async function loadGlucoseAlarmConfiguration(): Promise<GlucoseAlarmConfiguration> {
  const native = await T1ArcGlucoseDisplay.getGlucoseAlarmConfigurationAsync?.();
  if (native !== null && native !== undefined) {
    const error = validateGlucoseAlarmConfiguration(native);
    if (error) throw new Error(error);
    return native;
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
  return glucoseAlarmConfigurationFromLegacy({
    ...legacy,
    lowEnabled: legacy.lowEnabled && !blocked('low'),
    highEnabled: legacy.highEnabled && !blocked('high'),
    staleEnabled: legacy.staleEnabled && !blocked('stale'),
  });
}

export async function saveGlucoseAlarmConfiguration(configuration: GlucoseAlarmConfiguration): Promise<GlucoseAlarmStatus> {
  const error = validateGlucoseAlarmConfiguration(configuration);
  if (error) throw new Error(error);
  if (!T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync) return unsupported();
  return T1ArcGlucoseDisplay.saveGlucoseAlarmConfigurationAsync(configuration);
}

export async function getGlucoseAlarmStatus(): Promise<GlucoseAlarmStatus> {
  if (T1ArcGlucoseDisplay.getGlucoseAlarmStatusAsync) return T1ArcGlucoseDisplay.getGlucoseAlarmStatusAsync();
  return {
    configured: false,
    enabled: false,
    audioEnabled: false,
    activeKind: null,
    episodeId: null,
    readingTimestampMs: null,
    snoozedUntilMs: null,
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

export async function snoozeGlucoseAlarm(episodeId: string, untilMs: number): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  const error = validateGlucoseAlarmSnoozeUntil(untilMs);
  if (error) throw new Error(error);
  if (!T1ArcGlucoseDisplay.snoozeGlucoseAlarmAsync) return unsupported();
  return T1ArcGlucoseDisplay.snoozeGlucoseAlarmAsync(episodeId, untilMs);
}

export async function cancelGlucoseAlarmSnooze(episodeId: string): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  if (!T1ArcGlucoseDisplay.cancelGlucoseAlarmSnoozeAsync) return unsupported();
  return T1ArcGlucoseDisplay.cancelGlucoseAlarmSnoozeAsync(episodeId);
}

export async function acknowledgeGlucoseAlarm(episodeId: string): Promise<GlucoseAlarmStatus> {
  validateEpisodeId(episodeId);
  if (!T1ArcGlucoseDisplay.acknowledgeGlucoseAlarmAsync) return unsupported();
  return T1ArcGlucoseDisplay.acknowledgeGlucoseAlarmAsync(episodeId);
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
