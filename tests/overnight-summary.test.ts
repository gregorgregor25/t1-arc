import { describe, expect, it } from 'vitest';

import type { ContextNoteEvent, GlucoseReading } from '@/domain/models';
import {
  buildOvernightSummary,
  isRecordedAlarmEvent,
  OVERNIGHT_LOW_COVERAGE_MESSAGE,
  overnightSummaryText,
} from '@/domain/overnightSummary';
import { isMorningSummaryTime, lastNightWindow } from '@/domain/overnightWindow';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MMOL = { locale: 'en-GB', timeZone: 'Europe/London', glucoseUnit: 'mmolL' } as const;
const MG_DL = { ...MMOL, glucoseUnit: 'mgDl' } as const;

function series(start: number, end: number, value: (index: number) => number): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  for (let timestamp = start, index = 0; timestamp < end; timestamp += 5 * MINUTE, index += 1) {
    readings.push({ id: `g-${timestamp}`, timestamp, receivedAt: timestamp, mmolL: value(index), trend: 'flat', quality: 'measured', sourceId: 'test-cgm' });
  }
  return readings;
}

function note(overrides: Partial<ContextNoteEvent>): ContextNoteEvent {
  return { id: `n-${overrides.start}`, kind: 'note', start: 0, title: 'Note', category: 'other', sourceId: 'glooko-export', origin: 'imported', ...overrides };
}

describe('morning window edges', () => {
  it('is offered from 05:00 up to but not including 12:00 local time', () => {
    expect(isMorningSummaryTime(Date.parse('2026-11-17T04:59:59Z'), 'Europe/London')).toBe(false);
    expect(isMorningSummaryTime(Date.parse('2026-11-17T05:00:00Z'), 'Europe/London')).toBe(true);
    expect(isMorningSummaryTime(Date.parse('2026-11-17T11:59:59Z'), 'Europe/London')).toBe(true);
    expect(isMorningSummaryTime(Date.parse('2026-11-17T12:00:00Z'), 'Europe/London')).toBe(false);
    // 05:00 in summer time is 04:00 UTC.
    expect(isMorningSummaryTime(Date.parse('2026-07-01T04:00:00Z'), 'Europe/London')).toBe(true);
    expect(isMorningSummaryTime(Date.parse('2026-11-17T10:00:00Z'), 'America/New_York')).toBe(true);
  });

  it('uses 00:00–06:00 by default and the night alert hours when set', () => {
    const now = Date.parse('2026-11-17T07:30:00Z');
    expect(lastNightWindow(now, 'Europe/London').range).toEqual({ start: Date.parse('2026-11-17T00:00:00Z'), end: Date.parse('2026-11-17T06:00:00Z') });
    const custom = lastNightWindow(now, 'Europe/London', { startMinutes: 22 * 60 + 30, endMinutes: 7 * 60 });
    expect(custom.range).toEqual({ start: Date.parse('2026-11-16T22:30:00Z'), end: Date.parse('2026-11-17T07:00:00Z') });
    expect(custom.source).toBe('alarm-schedule');
  });

  it('marks a night still in progress at 05:30 with a 07:00 end', () => {
    const now = Date.parse('2026-11-17T05:30:00Z');
    const window = lastNightWindow(now, 'Europe/London', { startMinutes: 23 * 60, endMinutes: 7 * 60 });
    expect(window.inProgress).toBe(true);
    expect(window.range.end).toBe(now);
  });

  it('keeps the night length on clock-change nights', () => {
    const autumn = lastNightWindow(Date.parse('2026-10-25T08:00:00Z'), 'Europe/London');
    expect(autumn.range.end - autumn.range.start).toBe(7 * HOUR);
    const spring = lastNightWindow(Date.parse('2026-03-29T08:00:00Z'), 'Europe/London');
    expect(spring.range.end - spring.range.start).toBe(5 * HOUR);
  });
});

describe('overnight summary', () => {
  const now = Date.parse('2026-11-17T07:30:00Z');
  const window = lastNightWindow(now, 'Europe/London');

  it('describes coverage, bands, extremes, low episodes and recorded alarms', () => {
    const readings = series(window.range.start, window.range.end, (index) => (index >= 20 && index < 26 ? 3.4 : index === 40 ? 11.2 : 6));
    const alarm = note({ start: Date.parse('2026-11-17T01:50:00Z'), title: 'Low glucose alarm', detail: 'Recorded by Glooko from the connected diabetes device.' });
    const ownNote = note({ start: Date.parse('2026-11-17T02:00:00Z'), title: 'Alarm woke me', origin: 'manual', sourceId: 't1arc-manual' });
    const summary = buildOvernightSummary(window, readings, [alarm, ownNote]);
    expect(summary.status).toBe('shown');
    if (summary.status !== 'shown') return;
    expect(summary.lowest).toEqual({ mmolL: 3.4, timestamp: window.range.start + 20 * 5 * MINUTE });
    expect(summary.highest).toEqual({ mmolL: 11.2, timestamp: window.range.start + 40 * 5 * MINUTE });
    expect(summary.lowEpisodes).toBe(1);
    expect(summary.alarms.map(({ title }) => title)).toEqual(['Low glucose alarm']);
    const text = overnightSummaryText(summary, MMOL);
    expect(text.title).toBe('Last night');
    expect(text.period).toBe('00:00–06:00');
    expect(text.lines[0]).toBe('Sensor coverage: 100% (72 readings).');
    expect(text.lines[1]).toMatch(/^Time in each band: very low 0%, low 8\.3%, in range 90\.3%, high 1\.4%, very high 0%\.$/);
    expect(text.lines[2]).toBe('Lowest 3.4 mmol/L at 01:40. Highest 11.2 mmol/L at 03:20.');
    expect(text.lines[3]).toBe('Low episodes (below 3.9 mmol/L for at least 15 minutes): 1.');
    expect(text.lines[4]).toBe('Alarms recorded: 1 (Low glucose alarm at 01:50).');
    expect(text.lines.join(' ')).not.toMatch(/\b(good|bad|great|poor|should|recommend)\b/i);
  });

  it('uses mg/dL when chosen', () => {
    const summary = buildOvernightSummary(window, series(window.range.start, window.range.end, () => 6), []);
    const text = overnightSummaryText(summary, MG_DL);
    expect(text.lines[2]).toBe('Lowest 108 mg/dL at 00:00. Highest 108 mg/dL at 00:00.');
    expect(text.lines[3]).toBe('Low episodes (below 70 mg/dL for at least 15 minutes): 0.');
    expect(text.lines.some((line) => line.startsWith('Alarms recorded'))).toBe(false);
  });

  it('withholds the summary below 70% coverage', () => {
    const readings = series(window.range.start, window.range.start + 4 * HOUR, () => 6); // 66.7%
    const summary = buildOvernightSummary(window, readings, []);
    expect(summary.status).toBe('withheld');
    expect(overnightSummaryText(summary, MMOL).lines).toEqual([`${OVERNIGHT_LOW_COVERAGE_MESSAGE}.`]);
    expect(buildOvernightSummary(window, [], []).status).toBe('withheld');
  });

  it('ignores readings and alarms outside the night window', () => {
    const readings = [
      ...series(window.range.start, window.range.end, () => 6),
      ...series(window.range.end, window.range.end + HOUR, () => 2.5),
    ];
    const late = note({ start: window.range.end + MINUTE, title: 'Urgent low alarm', detail: 'Recorded by Glooko from the connected diabetes device.' });
    const summary = buildOvernightSummary(window, readings, [late]);
    expect(summary.status === 'shown' && summary.lowest.mmolL).toBe(6);
    expect(summary.status === 'shown' && summary.alarms).toEqual([]);
  });

  it('treats only device or imported alarm records as alarms', () => {
    expect(isRecordedAlarmEvent(note({ title: 'Sensor Change' }))).toBe(false);
    expect(isRecordedAlarmEvent(note({ title: 'High alert' }))).toBe(true);
    expect(isRecordedAlarmEvent(note({ title: 'High alert', origin: 'manual' }))).toBe(false);
  });
});
