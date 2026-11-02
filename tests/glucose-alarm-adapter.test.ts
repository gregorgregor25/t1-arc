import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeGlucoseAlarm,
  getGlucoseAlarmStatus,
  importGlucoseAlarmSound,
  loadGlucoseAlarmConfiguration,
  saveGlucoseAlarmConfiguration,
  snoozeGlucoseAlarm,
} from '@/data/glucoseAlerts/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALARM_CONFIGURATION } from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';

const mocks = vi.hoisted(() => ({
  native: {} as Record<string, unknown>,
  getConfig: vi.fn(), saveConfig: vi.fn(), getStatus: vi.fn(),
  legacyChannels: vi.fn(),
  snooze: vi.fn(), acknowledge: vi.fn(), importSound: vi.fn(), preview: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock('../modules/t1arc-glucose-display', () => ({ default: mocks.native }));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({ loadGlucoseAlertPreferences: mocks.legacy }));

describe('native alarm adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mocks.native)) delete mocks.native[key];
    Object.assign(mocks.native, {
      getGlucoseAlarmConfigurationAsync: mocks.getConfig,
      saveGlucoseAlarmConfigurationAsync: mocks.saveConfig,
      getGlucoseAlarmStatusAsync: mocks.getStatus,
      getGlucoseAlertChannelStatusesAsync: mocks.legacyChannels,
      snoozeGlucoseAlarmAsync: mocks.snooze,
      acknowledgeGlucoseAlarmAsync: mocks.acknowledge,
      importGlucoseAlarmSoundAsync: mocks.importSound,
      previewGlucoseAlarmSoundAsync: mocks.preview,
    });
    mocks.getConfig.mockResolvedValue(null);
    mocks.legacyChannels.mockResolvedValue([]);
    mocks.legacy.mockResolvedValue({ ...DEFAULT_GLUCOSE_ALERT_PREFERENCES, enabled: true });
    mocks.importSound.mockResolvedValue({ id: 'custom:12345678-1234-1234-1234-123456789abc', name: 'My audio' });
  });

  it('loads a legacy editing seed without saving or playing anything', async () => {
    const config = await loadGlucoseAlarmConfiguration();
    expect(config.enabled).toBe(true);
    expect(config.audioEnabled).toBe(false);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('treats the native configuration as authoritative', async () => {
    const config = { ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, lowThresholdMmolL: 4.1 };
    mocks.getConfig.mockResolvedValue(config);
    expect(await loadGlucoseAlarmConfiguration()).toEqual(config);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.legacyChannels).not.toHaveBeenCalled();
    mocks.getConfig.mockResolvedValue({ ...config, volume: Number.NaN });
    await expect(loadGlucoseAlarmConfiguration()).rejects.toThrow(/volume/);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('keeps individually blocked legacy Android channels off in the unsaved editing seed', async () => {
    mocks.legacy.mockResolvedValue({ ...DEFAULT_GLUCOSE_ALERT_PREFERENCES, enabled: true, staleEnabled: true });
    mocks.legacyChannels.mockResolvedValue([
      { kind: 'low', state: 'blocked' },
      { kind: 'high', state: 'allowed' },
      { kind: 'stale', state: 'blocked' },
    ]);
    expect(await loadGlucoseAlarmConfiguration()).toMatchObject({ enabled: true, lowEnabled: false, highEnabled: true, staleEnabled: false, audioEnabled: false });
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('preserves allowed legacy switches and does not mistake unavailable status for a blocked category', async () => {
    mocks.legacyChannels.mockResolvedValue([
      { kind: 'low', state: 'allowed' },
      { kind: 'high', state: 'unavailable' },
      { kind: 'stale', state: 'allowed' },
    ]);
    expect(await loadGlucoseAlarmConfiguration()).toMatchObject({ lowEnabled: true, highEnabled: true, staleEnabled: false, audioEnabled: false });
  });

  it('surfaces an unreadable legacy channel state instead of silently reviving a category', async () => {
    mocks.legacyChannels.mockRejectedValue(new Error('Android channel lookup failed'));
    await expect(loadGlucoseAlarmConfiguration()).rejects.toThrow(/existing Android alert choices could not be checked/);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('fails closed with a clear update message on old native builds', async () => {
    delete mocks.native.getGlucoseAlarmConfigurationAsync;
    delete mocks.native.saveGlucoseAlarmConfigurationAsync;
    delete mocks.native.getGlucoseAlarmStatusAsync;
    expect((await loadGlucoseAlarmConfiguration()).audioEnabled).toBe(false);
    expect(await getGlucoseAlarmStatus()).toMatchObject({ configured: false, playbackState: 'blocked', readinessIssues: [expect.stringMatching(/updated T1 Arc/)] });
    await expect(saveGlucoseAlarmConfiguration(DEFAULT_GLUCOSE_ALARM_CONFIGURATION)).rejects.toThrow(/updated T1 Arc/);
  });

  it('validates user choices before making an explicit native save', async () => {
    await expect(saveGlucoseAlarmConfiguration({ ...DEFAULT_GLUCOSE_ALARM_CONFIGURATION, veryHighEnabled: true })).rejects.toThrow(/threshold/);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    await saveGlucoseAlarmConfiguration(DEFAULT_GLUCOSE_ALARM_CONFIGURATION);
    expect(mocks.saveConfig).toHaveBeenCalledExactlyOnceWith(DEFAULT_GLUCOSE_ALARM_CONFIGURATION);
  });

  it('imports only local audio without automatically auditioning it', async () => {
    await expect(importGlucoseAlarmSound('https://example.test/audio.mp3', 'test')).rejects.toThrow(/stored on your phone/);
    expect(mocks.importSound).not.toHaveBeenCalled();
    expect(await importGlucoseAlarmSound('content://picker/audio/1', 'My audio')).toEqual({ id: 'custom:12345678-1234-1234-1234-123456789abc', name: 'My audio' });
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('passes the episode token and exact deadline, rejecting past snoozes locally', async () => {
    const until = Date.now() + 300_000;
    await snoozeGlucoseAlarm('episode-1', until);
    expect(mocks.snooze).toHaveBeenCalledWith('episode-1', until);
    await expect(snoozeGlucoseAlarm('episode-1', Date.now() - 1)).rejects.toThrow(/24 hours/);
    await expect(acknowledgeGlucoseAlarm('')).rejects.toThrow(/ended/);
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });
});
