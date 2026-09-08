import { describe, expect, it } from 'vitest';
import { connectionIssues, connectionSettingsTarget } from '@/domain/connectionSummary';
import type { DataSourceStatus } from '@/domain/models';

const source = (patch: Partial<DataSourceStatus> = {}): DataSourceStatus => ({
  id: 'librelinkup', label: 'LibreLinkUp', detail: 'Connected', freshness: 'current',
  origin: 'live', isLive: true, ...patch,
});

describe('quiet connection summary', () => {
  it('does not turn unconfigured optional sources into unfinished tasks', () => {
    expect(connectionIssues([source({ id: 'nightscout', freshness: 'missing', isLive: false })])).toEqual([]);
  });

  it.each(['manual', 'synthetic'] as const)('does not treat %s history as a connection to repair', origin => {
    expect(connectionIssues([source({ origin, freshness: 'stale', errorCode: 'fixture-error', dataThrough: 1000 })])).toEqual([]);
  });

  it('keeps a healthy connection quiet', () => {
    expect(connectionIssues([source({ dataThrough: 2000 })])).toEqual([]);
  });

  it('does not call normal delayed Glooko imports a connection problem', () => {
    expect(connectionIssues([source({ id: 'glooko-export', label: 'Insulin', origin: 'imported',
      isLive: false, freshness: 'delayed', dataThrough: 1000, lastUpdatedAt: 2000,
      detail: 'Glooko pump delivery history' })])).toEqual([]);
  });

  it.each(['stale', 'missing'] as const)('shows %s data for a configured live source', freshness => {
    const record = source({ freshness });
    expect(connectionIssues([record])).toEqual([record]);
  });

  it('keeps a reported connection error visible even when old data looks current', () => {
    const record = source({ errorCode: 'authentication-required', dataThrough: 1000 });
    expect(connectionIssues([record])).toEqual([record]);
  });

  it('does not hide errors from a source that has not received its first reading', () => {
    const record = source({ freshness: 'missing', isLive: false, errorCode: 'network-error' });
    expect(connectionIssues([record])).toEqual([record]);
  });

  it('deduplicates overlapping live and timeline snapshots before judging freshness', () => {
    const fresh = source({ lastUpdatedAt: 2000, dataThrough: 2000 });
    const old = source({ freshness: 'stale', lastUpdatedAt: 1000, dataThrough: 1000 });
    expect(connectionIssues([fresh, old])).toEqual([]);
    expect(connectionIssues([old, fresh])).toEqual([]);
  });

  it('uses the latest failed attempt rather than hiding it behind an older success', () => {
    const old = source({ lastAttemptAt: 1000, dataThrough: 1000 });
    const failed = source({ lastAttemptAt: 3000, dataThrough: 1000, errorCode: 'authentication-required' });
    expect(connectionIssues([old, failed])).toEqual([failed]);
  });

  it('returns one row per issue and does not mutate source snapshots', () => {
    const first = source({ freshness: 'stale', lastUpdatedAt: 1000 });
    const second = source({ id: 'nightscout', freshness: 'missing' });
    const sources = Object.freeze([first, first, second]);
    expect(connectionIssues(sources)).toEqual([first, second]);
    expect(sources).toEqual([first, first, second]);
  });

  it('routes known providers without guessing the provider behind an aggregate', () => {
    expect(connectionSettingsTarget('t1arc-librelinkup')).toBe('libre');
    expect(connectionSettingsTarget('dexcom-share')).toBe('dexcom');
    expect(connectionSettingsTarget('android-notification')).toBe('notification');
    expect(connectionSettingsTarget('health-connect:com.example.app')).toBe('health');
    expect(connectionSettingsTarget('t1arc-live-glucose')).toBeUndefined();
    expect(connectionSettingsTarget('glooko-export')).toBeUndefined();
    expect(connectionSettingsTarget('some-record-labelled-nightscout')).toBeUndefined();
    expect(connectionSettingsTarget('constructor')).toBeUndefined();
  });
});
