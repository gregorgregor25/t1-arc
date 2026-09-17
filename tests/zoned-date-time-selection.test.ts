import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

import {
  dayRange,
  getZonedDateTimeParts,
  resolveZonedWallClock,
  zonedDateTimeToTimestamp,
  ZonedWallClockError,
} from '@/domain/time';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import {
  dateKeyFromPickerDate,
  pickerDateForDateKey,
  pickerDateForZonedTimestamp,
  pickerTimeForWallClock,
  pickerTimeForZonedTimestamp,
  wallClockFromPickerDate,
} from '@/components/zonedDateTimePicker';

afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

describe('regional date and time selection', () => {
  it('uses numeric zoned fields instead of parsing 12-hour presentation text', () => {
    const timestamp = Date.UTC(2026, 6, 25, 17, 30);
    expect(getZonedDateTimeParts(timestamp, 'America/New_York')).toMatchObject({
      year: 2026,
      month: 7,
      day: 25,
      hour: 13,
      minute: 30,
    });

    const pickerDate = pickerDateForZonedTimestamp(
      timestamp,
      'America/New_York',
    );
    expect(dateKeyFromPickerDate(pickerDate)).toBe('2026-07-25');
    expect(wallClockFromPickerDate(pickerDate)).toMatchObject({
      hour: 13,
      minute: 30,
    });
  });

  it('keeps calendar-only picker dates stable in every device zone', () => {
    const pickerDate = pickerDateForDateKey('2026-01-02');
    expect(dateKeyFromPickerDate(pickerDate)).toBe('2026-01-02');
    expect(pickerDate.getHours()).toBe(12);
  });

  it('keeps a valid selected-zone time out of a mismatched device DST gap', () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `const pickerTimeForWallClock = ${pickerTimeForWallClock.toString()}; const value = pickerTimeForWallClock(1, 30); process.stdout.write(JSON.stringify([value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes()]));`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, TZ: 'Europe/London' },
      },
    );

    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual([2000, 6, 1, 1, 30]);
  });

  it('uses the safe time-only anchor in the current device zone too', () => {
    const timestamp = Date.UTC(2026, 6, 25, 17, 30);
    const value = pickerTimeForZonedTimestamp(timestamp, 'America/New_York');
    expect([value.getFullYear(), value.getMonth(), value.getDate()]).toEqual([
      2000,
      6,
      1,
    ]);
    expect(wallClockFromPickerDate(value)).toMatchObject({
      hour: 13,
      minute: 30,
    });
  });

  it('rejects a daylight-saving gap instead of silently changing the time', () => {
    try {
      resolveZonedWallClock(
        '2026-03-29',
        1,
        30,
        0,
        'Europe/London',
      );
      throw new Error('Expected a nonexistent wall-clock error.');
    } catch (error) {
      expect(error).toBeInstanceOf(ZonedWallClockError);
      expect((error as ZonedWallClockError).kind).toBe('nonexistent');
      expect((error as Error).message).toContain('does not exist');
    }
  });

  it('requires an explicit choice for a repeated daylight-saving hour', () => {
    expect(() =>
      resolveZonedWallClock(
        '2026-10-25',
        1,
        30,
        0,
        'Europe/London',
      ),
    ).toThrow('occurs twice');

    const earlier = resolveZonedWallClock(
      '2026-10-25',
      1,
      30,
      0,
      'Europe/London',
      'earlier',
    );
    const later = resolveZonedWallClock(
      '2026-10-25',
      1,
      30,
      0,
      'Europe/London',
      'later',
    );
    expect(later - earlier).toBe(60 * 60 * 1_000);
    expect(getZonedDateTimeParts(earlier, 'Europe/London')).toMatchObject({
      hour: 1,
      minute: 30,
    });
    expect(getZonedDateTimeParts(later, 'Europe/London')).toMatchObject({
      hour: 1,
      minute: 30,
    });
  });

  it('round-trips half-hour zones without assuming a whole-hour offset', () => {
    const timestamp = resolveZonedWallClock(
      '2026-08-28',
      9,
      45,
      0,
      'Australia/Adelaide',
    );
    expect(getZonedDateTimeParts(timestamp, 'Australia/Adelaide')).toMatchObject({
      year: 2026,
      month: 8,
      day: 28,
      hour: 9,
      minute: 45,
    });
  });

  it.each([
    ['America/Santiago', '2026-09-06'],
    ['America/Havana', '2026-03-08'],
  ])(
    'keeps a calendar-day boundary inside %s when DST skips midnight',
    (timeZone, dateKey) => {
      const start = zonedDateTimeToTimestamp(
        dateKey as `${number}-${number}-${number}`,
        0,
        0,
        0,
        timeZone,
      );
      expect(getZonedDateTimeParts(start, timeZone)).toMatchObject({
        year: Number(dateKey.slice(0, 4)),
        month: Number(dateKey.slice(5, 7)),
        day: Number(dateKey.slice(8, 10)),
        hour: 1,
        minute: 0,
      });
    },
  );

  it('moves a lightweight range timestamp forward by a DST gap', () => {
    const timestamp = zonedDateTimeToTimestamp(
      '2026-03-08',
      2,
      30,
      0,
      'America/New_York',
    );
    expect(getZonedDateTimeParts(timestamp, 'America/New_York')).toMatchObject({
      year: 2026,
      month: 3,
      day: 8,
      hour: 3,
      minute: 30,
    });
  });

  it('builds a 23-hour Santiago day without including the previous date', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'other',
      countryCode: 'CL',
      languageTag: 'en-GB',
      analysisTimeZone: 'America/Santiago',
      followDeviceTimeZone: false,
    });
    const now = zonedDateTimeToTimestamp(
      '2026-09-07',
      12,
      0,
      0,
      'America/Santiago',
    );
    const range = dayRange('2026-09-06', now);
    expect(getZonedDateTimeParts(range.start, 'America/Santiago')).toMatchObject({
      year: 2026,
      month: 9,
      day: 6,
      hour: 1,
    });
    expect(getZonedDateTimeParts(range.end, 'America/Santiago')).toMatchObject({
      year: 2026,
      month: 9,
      day: 7,
      hour: 0,
    });
    expect(range.end - range.start).toBe(23 * 60 * 60 * 1_000);
  });
});
