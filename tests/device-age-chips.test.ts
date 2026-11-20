import { describe, expect, it } from 'vitest';

import {
  deviceAgeChips,
  deviceChangeKind,
  latestDeviceChanges,
} from '@/domain/deviceAge';
import type { ContextNoteEvent } from '@/domain/models';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LONDON = { locale: 'en-GB', timeZone: 'Europe/London' };

function note(overrides: Partial<ContextNoteEvent>): ContextNoteEvent {
  return { id: `n-${overrides.start ?? 0}-${overrides.title ?? ''}`, kind: 'note', start: 0, title: 'Note', category: 'other', sourceId: 't1arc-manual', origin: 'manual', ...overrides };
}

const sensorStart = (start: number) => note({ start, title: 'New sensor', category: 'sensor', sensorStarted: true });
const siteChange = (start: number) => note({ start, title: 'Site change', category: 'pump', observation: { kind: 'site-change', device: 'pump', location: { side: 'front', label: 'Abdomen' } } });
const imported = (start: number, title: string, category: ContextNoteEvent['category']) =>
  note({ start, title, category, origin: 'imported', sourceId: 'nightscout' });

describe('device change records', () => {
  it('counts only explicit sensor starts, site changes and imported therapy events', () => {
    expect(deviceChangeKind(sensorStart(1))).toBe('sensor');
    expect(deviceChangeKind(siteChange(1))).toBe('site');
    expect(deviceChangeKind(imported(1, 'Site Change', 'pump'))).toBe('site');
    expect(deviceChangeKind(imported(1, 'Sensor Change', 'sensor'))).toBe('sensor');
    expect(deviceChangeKind(imported(1, 'Sensor Start', 'sensor'))).toBe('sensor');
    expect(deviceChangeKind(imported(1, 'Insulin Change', 'pump'))).toBeUndefined();
    expect(deviceChangeKind(imported(1, 'Pump Battery Change', 'pump'))).toBeUndefined();
    expect(deviceChangeKind(note({ title: 'Sensor fell off?', category: 'sensor' }))).toBeUndefined();
  });

  it('chooses the most recent change that has already happened', () => {
    const now = Date.parse('2026-11-17T09:00:00Z');
    const latest = latestDeviceChanges([
      sensorStart(now - 9 * DAY),
      imported(now - 2 * DAY, 'Sensor Change', 'sensor'),
      sensorStart(now + HOUR),
    ], now);
    expect(latest.sensor?.start).toBe(now - 2 * DAY);
    expect(latest.site).toBeUndefined();
  });
});

describe('device age chips', () => {
  const now = Date.parse('2026-11-17T09:00:00Z');

  it('shows sensor day N, with day 1 for the first 24 hours', () => {
    expect(deviceAgeChips([sensorStart(now - HOUR)], now, LONDON)[0]!.label).toBe('Sensor day 1');
    expect(deviceAgeChips([sensorStart(now - DAY + 1)], now, LONDON)[0]!.label).toBe('Sensor day 1');
    expect(deviceAgeChips([sensorStart(now - DAY)], now, LONDON)[0]!.label).toBe('Sensor day 2');
    expect(deviceAgeChips([sensorStart(now - 7.5 * DAY)], now, LONDON)[0]!.label).toBe('Sensor day 8');
  });

  it('adds the optional expected sensor life', () => {
    expect(deviceAgeChips([sensorStart(now - 7.5 * DAY)], now, LONDON, 10)[0]!.label).toBe('Sensor day 8 of 10');
    expect(deviceAgeChips([sensorStart(now - 10.5 * DAY)], now, LONDON, 10)[0]!.label).toBe('Sensor day 11 · past 10 days');
  });

  it('shows site age in days, or hours under one day', () => {
    expect(deviceAgeChips([siteChange(now - 20 * 60 * 1000)], now, LONDON)[0]!.label).toBe('Site under 1 hour');
    expect(deviceAgeChips([siteChange(now - HOUR)], now, LONDON)[0]!.label).toBe('Site 1 hour');
    expect(deviceAgeChips([siteChange(now - 5.9 * HOUR)], now, LONDON)[0]!.label).toBe('Site 5 hours');
    expect(deviceAgeChips([siteChange(now - 1.5 * DAY)], now, LONDON)[0]!.label).toBe('Site 1 day');
    expect(deviceAgeChips([imported(now - 2.2 * DAY, 'Site Change', 'pump')], now, LONDON)[0]!.label).toBe('Site 2 days');
  });

  it('names the source record for each chip', () => {
    const [sensor, site] = deviceAgeChips([sensorStart(Date.parse('2026-11-10T08:15:00Z')), imported(Date.parse('2026-11-15T19:40:00Z'), 'Site Change', 'pump')], now, LONDON);
    expect(sensor!.source).toBe('Sensor change recorded by you in T1 Arc for 10 Nov 2026, 08:15.');
    expect(site!.source).toBe('“Site Change” imported from Nightscout for 15 Nov 2026, 19:40.');
  });

  it('is hidden without a record or when the record is over 30 days old', () => {
    expect(deviceAgeChips([], now, LONDON)).toEqual([]);
    expect(deviceAgeChips([sensorStart(now - 31 * DAY)], now, LONDON)).toEqual([]);
  });

  it('uses elapsed time, so the autumn clock change does not add a day', () => {
    // Started 12:00 BST on 24 Oct (11:00 UTC). At 11:30 GMT on 26 Oct,
    // 48.5 hours have passed even though the wall clock moved back an hour.
    const start = Date.parse('2026-10-24T11:00:00Z');
    const at = Date.parse('2026-10-26T11:30:00Z');
    expect(deviceAgeChips([sensorStart(start)], at, LONDON)[0]!.label).toBe('Sensor day 3');
    expect(deviceAgeChips([siteChange(start)], at, LONDON)[0]!.label).toBe('Site 2 days');
    // 47 elapsed hours across the spring change stays day 2.
    expect(deviceAgeChips([sensorStart(Date.parse('2026-03-28T10:00:00Z'))], Date.parse('2026-03-30T09:00:00Z'), LONDON)[0]!.label).toBe('Sensor day 2');
  });

  it('gives the same age in any time zone; only the source time changes', () => {
    const events = [sensorStart(Date.parse('2026-11-10T08:15:00Z'))];
    const london = deviceAgeChips(events, now, LONDON)[0]!;
    const tokyo = deviceAgeChips(events, now, { locale: 'en-GB', timeZone: 'Asia/Tokyo' })[0]!;
    expect(tokyo.label).toBe(london.label);
    expect(tokyo.source).toContain('10 Nov 2026, 17:15');
  });
});
