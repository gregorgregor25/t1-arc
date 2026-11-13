import { describe, expect, it } from 'vitest';
import {
  duePings,
  emptyUsageState,
  localDayKey,
  markSent,
  recordMonitoringDay,
  recordOpen,
} from '@/domain/usageReporting';

const at = (iso: string) => new Date(iso).getTime();

describe('usage reporting bookkeeping', () => {
  it('uses the local calendar day', () => {
    // TZ is Europe/London in tests; 23:30 UTC in summer is 00:30 local next day.
    expect(localDayKey(at('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
    expect(localDayKey(at('2026-12-01T23:30:00Z'))).toBe('2026-12-01');
  });

  it('sends nothing when reporting is switched off', () => {
    const now = at('2026-11-13T09:00:00Z');
    const s = recordOpen(emptyUsageState(), now);
    expect(duePings(s, { consent: false, appVersion: '1.7.20', now })).toEqual([]);
  });

  it('sends one daily ping per local day', () => {
    const now = at('2026-11-13T09:00:00Z');
    let s = recordOpen(emptyUsageState(), now);
    const first = duePings(s, { consent: true, appVersion: '1.7.20', now });
    expect(first.map((p) => p.kind)).toContain('day');
    s = markSent(s, 'day', now);
    const later = at('2026-11-13T18:00:00Z');
    s = recordOpen(s, later);
    expect(
      duePings(s, { consent: true, appVersion: '1.7.20', now: later }).map((p) => p.kind),
    ).not.toContain('day');
    const nextDay = at('2026-11-14T08:00:00Z');
    expect(
      duePings(s, { consent: true, appVersion: '1.7.20', now: nextDay }).map((p) => p.kind),
    ).toContain('day');
  });

  it('builds the weekly ping from the previous seven days only', () => {
    let s = emptyUsageState();
    for (const d of ['2026-11-01', '2026-11-07', '2026-11-08', '2026-11-12']) {
      s = recordOpen(s, at(`${d}T12:00:00Z`));
    }
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      s = recordMonitoringDay(s, at(`${d}T03:00:00Z`));
    }
    s = { ...s, lastWeekSentAt: at('2026-11-05T12:00:00Z') };
    const now = at('2026-11-13T09:00:00Z');
    // Today counts towards the next week; this one is the previous 06..12 Nov.
    s = recordOpen(s, now);
    const week = duePings(s, { consent: true, appVersion: '1.7.20', now }).find(
      (p) => p.kind === 'week',
    );
    expect(week).toEqual({
      schema: 1,
      kind: 'week',
      appVersion: '1.7.20',
      daysOpened: 3,
      daysMonitoring: 4,
    });
  });

  it('counts the previous seven local days across a clock change', () => {
    let s = emptyUsageState();
    // UK clocks went back on 25 Oct 2026.
    for (const d of ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']) {
      s = recordOpen(s, at(`${d}T12:00:00Z`));
    }
    const now = at('2026-10-29T00:30:00Z');
    const week = duePings(s, { consent: true, appVersion: '1.7.20', now }).find(
      (p) => p.kind === 'week',
    );
    expect(week).toMatchObject({ daysOpened: 7, daysMonitoring: 0 });
  });

  it('waits seven days between weekly pings and never sends an extra field', () => {
    const now = at('2026-11-13T09:00:00Z');
    const s = markSent(recordOpen(emptyUsageState(), now), 'week', now);
    expect(
      duePings(s, { consent: true, appVersion: '1.7.20', now: at('2026-11-19T09:00:00Z') }).some(
        (p) => p.kind === 'week',
      ),
    ).toBe(false);
    expect(
      duePings(s, { consent: true, appVersion: '1.7.20', now: at('2026-11-20T09:00:00Z') }).some(
        (p) => p.kind === 'week',
      ),
    ).toBe(true);
    const day = duePings(s, { consent: true, appVersion: '1.7.20', now })[0];
    expect(day).toBeDefined();
    expect(Object.keys(day ?? {}).sort()).toEqual(['appVersion', 'kind', 'schema']);
  });

  it('sends the first weekly ping straight away and with integer counts', () => {
    const now = at('2026-11-13T09:00:00Z');
    const pings = duePings(recordOpen(emptyUsageState(), now), {
      consent: true,
      appVersion: '1.7.20',
      now,
    });
    const week = pings.find((p) => p.kind === 'week');
    expect(week).toEqual({ schema: 1, kind: 'week', appVersion: '1.7.20', daysOpened: 0, daysMonitoring: 0 });
    expect(Object.keys(week ?? {}).sort()).toEqual(['appVersion', 'daysMonitoring', 'daysOpened', 'kind', 'schema']);
  });

  it('records each day once and keeps at most 14 days of local history', () => {
    let s = emptyUsageState();
    s = recordOpen(s, at('2026-10-01T08:00:00Z'));
    s = recordOpen(s, at('2026-10-01T20:00:00Z'));
    expect(s.openedDays).toEqual(['2026-10-01']);
    for (let i = 0; i < 30; i += 1) s = recordOpen(s, at('2026-10-01T12:00:00Z') + i * 86_400_000);
    expect(s.openedDays.length).toBe(14);
    expect(s.openedDays.at(-1)).toBe('2026-10-30');
  });

  it('returns the same state when the day is already recorded', () => {
    const s = recordMonitoringDay(emptyUsageState(), at('2026-11-13T09:00:00Z'));
    expect(recordMonitoringDay(s, at('2026-11-13T23:00:00Z'))).toBe(s);
  });
});
