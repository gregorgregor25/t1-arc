import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLUCOSE_ALARM_CONFIGURATION as defaults,
  customClockSnoozeUntil,
  glucoseAlarmConfigurationFromLegacy,
  glucoseAlarmSnoozeUntil,
  isGlucoseAlarmSoundId,
  validateGlucoseAlarmConfiguration,
  validateGlucoseAlarmSnoozeUntil,
} from '@/domain/glucoseAlarms';
import { DEFAULT_GLUCOSE_ALERT_PREFERENCES } from '@/domain/glucoseAlerts';

describe('glucose alarm choices', () => {
  it('keeps upgrades silent and retains the chosen legacy thresholds', () => {
    const migrated = glucoseAlarmConfigurationFromLegacy({
      ...DEFAULT_GLUCOSE_ALERT_PREFERENCES,
      enabled: true,
      lowThresholdMmolL: 4.2,
      highThresholdMmolL: 12.5,
      staleEnabled: true,
      repeatMinutes: 60,
    });
    expect(migrated).toMatchObject({ enabled: true, audioEnabled: false, lowThresholdMmolL: 4.2, highThresholdMmolL: 12.5, staleEnabled: true, repeatMinutes: 60, veryHighEnabled: false, veryHighThresholdMmolL: null, nightEnabled: false });
    expect(validateGlucoseAlarmConfiguration(migrated)).toBeUndefined();
  });

  it('requires an explicit separate very high level', () => {
    expect(validateGlucoseAlarmConfiguration({ ...defaults, veryHighEnabled: true })).toMatch(/before enabling/);
    expect(validateGlucoseAlarmConfiguration({ ...defaults, veryHighEnabled: true, veryHighThresholdMmolL: defaults.highThresholdMmolL })).toMatch(/above high/);
    expect(validateGlucoseAlarmConfiguration({ ...defaults, veryHighEnabled: true, veryHighThresholdMmolL: 18 })).toBeUndefined();
  });

  it.each([
    { volume: Number.NaN }, { volume: 1.01 }, { rampSeconds: Infinity },
    { lowThresholdMmolL: Number.NaN }, { highThresholdMmolL: 2 },
    { veryHighThresholdMmolL: undefined }, { lowEnabled: 'yes' },
    { nightStartMinutes: -1 }, { nightEndMinutes: 1440 },
    { nightEnabled: true, nightStartMinutes: 420, nightEndMinutes: 420 },
    { repeatMinutes: 7 }, { lowSound: 'file:///private/audio.wav' },
    { lowSound: 'custom:../file' }, { schemaVersion: 2 },
  ])('rejects malformed or unsafe choices %j', patch => {
    expect(validateGlucoseAlarmConfiguration({ ...defaults, ...patch })).toBeTypeOf('string');
  });

  it('allows built-ins and opaque custom IDs without exposing paths', () => {
    expect(['pulse', 'notes', 'custom:12345678-1234-1234-1234-123456789abc'].map(isGlucoseAlarmSoundId)).toEqual([true, true, true]);
    expect(isGlucoseAlarmSoundId('https://host/audio.mp3')).toBe(false);
    expect(isGlucoseAlarmSoundId('custom:')).toBe(false);
    expect(isGlucoseAlarmSoundId('custom:sound-1')).toBe(false);
  });
});

describe('snooze deadlines', () => {
  const now = Date.parse('2026-11-02T23:50:30Z');
  it('keeps preset durations exact and rejects invalid or unbounded durations', () => {
    expect(glucoseAlarmSnoozeUntil(5, now)).toBe(now + 300_000);
    expect(glucoseAlarmSnoozeUntil(60, now)).toBe(now + 3_600_000);
    for (const minutes of [0, -5, Number.NaN, Infinity, 1441]) expect(() => glucoseAlarmSnoozeUntil(minutes, now)).toThrow();
    expect(validateGlucoseAlarmSnoozeUntil(now, now)).toBeTypeOf('string');
    expect(validateGlucoseAlarmSnoozeUntil(now + 86_400_001, now)).toBeTypeOf('string');
    expect(validateGlucoseAlarmSnoozeUntil(now + 10_000, now)).toBeUndefined();
    expect(validateGlucoseAlarmSnoozeUntil(now + 10_000.5, now)).toBeTypeOf('string');
  });

  it('chooses tomorrow across midnight without carrying picker seconds', () => {
    expect(customClockSnoozeUntil(0, 5, now, 'Europe/London')).toBe(Date.parse('2026-11-03T00:05:00Z'));
  });

  it('treats a clock time already reached as tomorrow, bounded by 24 hours', () => {
    expect(customClockSnoozeUntil(23, 50, now, 'Europe/London')).toBe(Date.parse('2026-11-03T23:50:00Z'));
  });

  it('uses the explicitly selected device zone, including non-hour offsets', () => {
    const time = Date.parse('2026-11-02T12:00:00Z');
    expect(customClockSnoozeUntil(18, 0, time, 'Asia/Kathmandu')).toBe(Date.parse('2026-11-02T12:15:00Z'));
  });

  it('rejects a nonexistent clock time instead of silently normalizing it', () => {
    expect(() => customClockSnoozeUntil(1, 30, Date.parse('2026-03-29T00:30:00Z'), 'Europe/London')).toThrow(/does not exist/);
  });

  it('can choose tomorrow after a nonexistent clock time has already passed today', () => {
    expect(customClockSnoozeUntil(1, 30, Date.parse('2026-03-29T14:00:00Z'), 'Europe/London')).toBe(Date.parse('2026-03-30T00:30:00Z'));
  });

  it('selects the next future occurrence in a repeated hour', () => {
    expect(customClockSnoozeUntil(1, 30, Date.parse('2026-10-25T00:45:00Z'), 'Europe/London')).toBe(Date.parse('2026-10-25T01:30:00Z'));
  });

  it('does not allow a fall-back clock change to create a snooze over 24 hours', () => {
    expect(() => customClockSnoozeUntil(10, 0, Date.parse('2026-10-24T09:30:00Z'), 'Europe/London')).toThrow(/24 hours/);
  });
});
