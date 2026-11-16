import { describe, expect, it } from 'vitest';

import { CombinedDiabetesRepository, type GlucoseSource, type InsulinSource } from '@/data/contracts';
import { CompositeGlucoseSource } from '@/data/live/CompositeGlucoseSource';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { describeTimeZone } from '@/domain/exportTime';
import type { DataSourceStatus, GlucoseReading } from '@/domain/models';
import {
  attemptOutcome,
  buildSourceHealthReport,
  findRecordGaps,
  isConfiguredSource,
  NOTABLE_GLUCOSE_GAP_MS,
  summarizeExactDuplicates,
  type SourceHealthSnapshot,
} from '@/domain/sourceHealth';

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-16T14:10:00Z');
const WINDOW = { start: NOW - 24 * 60 * MINUTE, end: NOW };
const SETTINGS = { locale: 'en-GB', timeZone: 'Europe/London' };

function status(partial: Partial<DataSourceStatus> = {}): DataSourceStatus {
  return { id: 'nightscout', label: 'Nightscout', detail: '', freshness: 'current', origin: 'live', isLive: true, ...partial };
}

function everyFiveMinutes(start: number, end: number, sourceId = 'nightscout') {
  const records: { timestamp: number; sourceId: string }[] = [];
  for (let timestamp = start; timestamp < end; timestamp += 5 * MINUTE) records.push({ timestamp, sourceId });
  return records;
}

describe('gap detection', () => {
  it('lists pauses of at least 30 minutes between records', () => {
    const times = [
      ...everyFiveMinutes(WINDOW.start, Date.parse('2026-11-16T02:10:00Z')),
      ...everyFiveMinutes(Date.parse('2026-11-16T03:40:00Z'), NOW),
    ].map((record) => record.timestamp);
    expect(findRecordGaps(times, WINDOW, NOTABLE_GLUCOSE_GAP_MS)).toEqual([
      { start: Date.parse('2026-11-16T02:05:00Z'), end: Date.parse('2026-11-16T03:40:00Z') },
    ]);
  });

  it('ignores shorter pauses, duplicate times and records outside the window', () => {
    const times = [WINDOW.start - MINUTE, WINDOW.start + MINUTE, WINDOW.start + MINUTE, WINDOW.start + 25 * MINUTE, NOW + MINUTE];
    expect(findRecordGaps(times, WINDOW, NOTABLE_GLUCOSE_GAP_MS)).toEqual([]);
  });

  it('reports a pause at the start of the window only when older records exist', () => {
    const times = [WINDOW.start + 3 * 60 * MINUTE];
    expect(findRecordGaps(times, WINDOW, NOTABLE_GLUCOSE_GAP_MS)).toEqual([]);
    expect(findRecordGaps(times, WINDOW, NOTABLE_GLUCOSE_GAP_MS, WINDOW.start - 86_400_000)).toEqual([
      { start: WINDOW.start, end: WINDOW.start + 3 * 60 * MINUTE },
    ]);
  });

  it('uses elapsed time across the autumn clock change', () => {
    const autumnWindow = { start: Date.parse('2026-10-24T12:00:00Z'), end: Date.parse('2026-10-25T12:00:00Z') };
    // 00:50 BST (23:50 UTC) to 01:10 GMT (01:10 UTC) is 80 minutes, not 20.
    const times = [Date.parse('2026-10-24T23:50:00Z'), Date.parse('2026-10-25T01:10:00Z')];
    expect(findRecordGaps(times, autumnWindow, NOTABLE_GLUCOSE_GAP_MS)).toHaveLength(1);
  });
});

describe('sync outcomes in plain words', () => {
  it('classifies attempts from stored sync metadata', () => {
    expect(attemptOutcome(status({ lastAttemptAt: 10, lastUpdatedAt: 10 }))).toBe('worked');
    expect(attemptOutcome(status({ lastAttemptAt: 20, lastUpdatedAt: 10 }))).toBe('unfinished');
    expect(attemptOutcome(status({ lastAttemptAt: 20, lastUpdatedAt: 10, errorCode: 'network' }))).toBe('failed');
    expect(attemptOutcome(status())).toBe('none');
  });

  it('skips unconfigured optional sources', () => {
    expect(isConfiguredSource(status({ isLive: false }))).toBe(false);
    expect(isConfiguredSource(status({ isLive: false, recordCount: 3 }))).toBe(true);
    expect(isConfiguredSource(status({ origin: 'synthetic', recordCount: 3 }))).toBe(false);
  });
});

describe('source health report', () => {
  const snapshot: SourceHealthSnapshot = {
    generatedAt: NOW,
    window: WINDOW,
    sources: [
      {
        kind: 'glucose',
        status: status({ lastAttemptAt: NOW - 2 * MINUTE, lastUpdatedAt: NOW - 7 * MINUTE, errorCode: 'authentication', dataThrough: NOW - 5 * MINUTE }),
        recentRecords: [
          ...everyFiveMinutes(WINDOW.start, Date.parse('2026-11-16T02:10:00Z')),
          ...everyFiveMinutes(Date.parse('2026-11-16T03:40:00Z'), NOW - 4 * MINUTE),
        ],
        earliestRecordAt: WINDOW.start - 86_400_000,
      },
      {
        kind: 'insulin',
        status: status({ id: 'glooko-export', label: 'Insulin', lastAttemptAt: NOW - 60 * MINUTE, lastUpdatedAt: NOW - 60 * MINUTE, dataThrough: Date.parse('2026-11-16T13:00:00Z'), isLive: false, origin: 'imported', recordCount: 40 }),
        recentRecords: [
          { timestamp: Date.parse('2026-11-16T08:00:00Z'), sourceId: 'glooko-export' },
          { timestamp: Date.parse('2026-11-16T13:00:00Z'), sourceId: 't1arc-manual' },
        ],
      },
      { kind: 'glucose', status: status({ id: 'android-notification', label: 'Notifications', isLive: false }), recentRecords: [] },
    ],
    duplicates: [{ keptSourceId: 'nightscout', otherSourceId: 'glooko-cgm', count: 12 }],
  };

  it('describes each configured source without technical terms', () => {
    const report = buildSourceHealthReport(snapshot, SETTINGS);
    expect(report.rows.map((row) => row.label)).toEqual(['Nightscout', 'Insulin']);
    const glucose = report.rows[0]!;
    expect(glucose.lines).toEqual([
      'Last successful update: 14:03.',
      'Last check at 14:08: the sign-in was not accepted.',
      'Records through 14:05.',
      `${glucose.recordsLast24h} records in the last 24 hours.`,
      'No glucose 02:05–03:40.',
    ]);
    expect(glucose.recordsLast24h).toBe(270);
    const insulin = report.rows[1]!;
    expect(insulin.lines).toContain('Records through 13:00.');
    expect(insulin.lines).toContain('2 records in the last 24 hours.');
    expect(insulin.lines).toContain('From: Glooko, Entered in T1 Arc.');
    expect(insulin.gaps).toEqual([]);
    expect(report.duplicateLines).toEqual([
      'Same glucose readings also from Glooko glucose history (12 in the last 24 hours); kept Nightscout.',
    ]);
    expect(report.timeZoneLine).toContain('London');
    const all = [report.timeZoneLine, ...report.duplicateLines, ...report.rows.flatMap((row) => row.lines)].join(' ');
    expect(all).not.toMatch(/HTTP|SGV|IANA|Europe\/London|\b40[13]\b|undefined|NaN/);
  });

  it('says when nothing has arrived and caps the list of gaps', () => {
    const many = Array.from({ length: 10 }, (_, index) => WINDOW.start + index * 60 * MINUTE);
    const report = buildSourceHealthReport({
      ...snapshot,
      duplicates: [],
      sources: [
        { kind: 'glucose', status: status({ id: 'a', label: 'xDrip', lastAttemptAt: NOW }), recentRecords: [] },
        { kind: 'glucose', status: status({ id: 'b', label: 'Medtrum' }), recentRecords: many.map((timestamp) => ({ timestamp, sourceId: 'b' })) },
      ],
    }, SETTINGS);
    expect(report.rows[0]!.lines).toEqual([
      'No successful update recorded yet.',
      'Last check at 14:10 has not finished or did not save a result.',
      'No records have arrived yet.',
      'No records received in the last 24 hours.',
    ]);
    expect(report.rows[1]!.gaps).toHaveLength(9);
    expect(report.rows[1]!.lines.at(-1)).toBe('3 more gaps in the last 24 hours.');
  });

  it('shows dates for times on another day', () => {
    const report = buildSourceHealthReport({
      ...snapshot,
      sources: [{ kind: 'glucose', status: status({ lastUpdatedAt: Date.parse('2026-11-14T09:30:00Z'), dataThrough: Date.parse('2026-11-14T09:25:00Z') }), recentRecords: [] }],
    }, SETTINGS);
    expect(report.rows[0]!.lines[0]).toBe('Last successful update: 14 Nov 2026, 09:30.');
  });
});

describe('time zone wording', () => {
  it('names the place and the local zone name, not the identifier', () => {
    expect(describeTimeZone('Europe/London', 'en-GB', Date.parse('2026-07-01T12:00:00Z'))).toBe('London (British Summer Time)');
    expect(describeTimeZone('Europe/London', 'en-GB', Date.parse('2026-12-01T12:00:00Z'))).toBe('London (Greenwich Mean Time)');
    expect(describeTimeZone('America/New_York', 'en-GB', Date.parse('2026-12-01T12:00:00Z'))).toContain('New York');
  });
});

describe('exact duplicates', () => {
  it('keeps the higher-priority source for each shared timestamp', () => {
    const rank = (sourceId: string) => ({ nightscout: 0, 'glooko-cgm': 5 } as Record<string, number>)[sourceId] ?? 99;
    expect(summarizeExactDuplicates([
      { timestamp: 1, sourceId: 'glooko-cgm' },
      { timestamp: 1, sourceId: 'nightscout' },
      { timestamp: 2, sourceId: 'nightscout' },
      { timestamp: 3, sourceId: 'glooko-cgm' },
      { timestamp: 3, sourceId: 'nightscout' },
      { timestamp: 3, sourceId: 'nightscout' },
    ], rank)).toEqual([{ keptSourceId: 'nightscout', otherSourceId: 'glooko-cgm', count: 2 }]);
  });
});

describe('repository snapshot', () => {
  function stored(id: string, timestamp: number, sourceId: string): GlucoseReading {
    return { id, timestamp, receivedAt: timestamp, mmolL: 6, trend: 'flat', quality: 'measured', sourceId };
  }

  it('reads per-source metadata, recent record times and duplicates from local storage only', async () => {
    const history = new MemoryGlucoseHistoryStore();
    await history.upsertReadings([
      stored('n1', NOW - 10 * MINUTE, 'nightscout'),
      stored('n2', NOW - 5 * MINUTE, 'nightscout'),
      stored('g1', NOW - 5 * MINUTE, 'glooko-cgm'),
      stored('old', NOW - 3 * 86_400_000, 'nightscout'),
    ]);
    let refreshed = false;
    const source: GlucoseSource = {
      sourceId: 'nightscout',
      refresh: async () => { refreshed = true; },
      getReadings: async () => [],
      getLatestReading: async () => undefined,
      getStatus: async () => status({ lastAttemptAt: NOW - MINUTE, lastUpdatedAt: NOW - MINUTE, dataThrough: NOW - 5 * MINUTE }),
    };
    const insulin: InsulinSource = {
      sourceId: 'glooko-export',
      getBasalDeliveries: async () => [],
      getBolusDeliveries: async () => [{ id: 'b1', timestamp: NOW - 60 * MINUTE, units: 2, sourceId: 'glooko-export' }],
      getStatus: async () => status({ id: 'glooko-export', label: 'Insulin', isLive: false, origin: 'imported', recordCount: 1 }),
    };
    const repository = new CombinedDiabetesRepository(new CompositeGlucoseSource([source], history), insulin);
    const snapshot = await repository.getSourceHealthSnapshot(NOW);
    expect(refreshed).toBe(false);
    expect(snapshot.sources.map((entry) => [entry.kind, entry.status.id, entry.recentRecords.length])).toEqual([
      ['glucose', 'nightscout', 2],
      ['insulin', 'glooko-export', 1],
    ]);
    expect(snapshot.sources[0]!.earliestRecordAt).toBe(NOW - 3 * 86_400_000);
    expect(snapshot.duplicates).toEqual([{ keptSourceId: 'nightscout', otherSourceId: 'glooko-cgm', count: 1 }]);
  });
});
