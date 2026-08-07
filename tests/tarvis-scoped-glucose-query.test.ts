import { describe, expect, it } from 'vitest';

import type { GlucoseReading } from '@/domain/models';
import { zonedDateTimeToTimestamp } from '@/domain/time';
import {
  executeScopedGlucoseQuery,
  resolveMostRecentCompletedRecurringWindows,
  type ScopedGlucoseQuery,
} from '@/data/tarvis/query';

function reading(
  id: string,
  timestamp: number,
  mmolL: number,
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test-cgm',
  };
}

function london(
  date: `${number}-${number}-${number}`,
  hour: number,
  minute = 0,
) {
  return zonedDateTimeToTimestamp(date, hour, minute);
}

function overnightQuery(
  overrides: Partial<ScopedGlucoseQuery> = {},
): ScopedGlucoseQuery {
  return {
    timezone: 'Europe/London',
    asOf: london('2026-08-06', 20, 14),
    windowCount: 3,
    clockWindow: {
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
    },
    ...overrides,
  };
}

describe('resolveMostRecentCompletedRecurringWindows', () => {
  it('resolves the latest completed half-open local windows chronologically', () => {
    const windows = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-08-06', 20),
      count: 3,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });

    expect(windows.map((window) => window.anchorDate)).toEqual([
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
    ]);
    expect(windows.every((window) => window.elapsedMinutes === 420)).toBe(
      true,
    );
    expect(windows[2]!.range).toEqual({
      start: london('2026-08-06', 0),
      end: london('2026-08-06', 7),
    });
  });

  it('does not select a currently incomplete same-day window', () => {
    const [window] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-08-06', 6, 59),
      count: 1,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });

    expect(window!.anchorDate).toBe('2026-08-05');
  });

  it('includes a window when asOf is exactly its exclusive end boundary', () => {
    const [window] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-08-06', 7),
      count: 1,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });

    expect(window!.anchorDate).toBe('2026-08-06');
  });

  it('resolves completed cross-midnight windows by their start date', () => {
    const [window] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-08-07', 4),
      count: 1,
      clockWindow: {
        start: { hour: 22, minute: 0 },
        end: { hour: 3, minute: 0 },
        crossesMidnight: true,
      },
    });

    expect(window!.anchorDate).toBe('2026-08-06');
    expect(window!.range).toEqual({
      start: london('2026-08-06', 22),
      end: london('2026-08-07', 3),
    });
    expect(window!.elapsedMinutes).toBe(300);
  });

  it('uses actual elapsed duration through both London DST transitions', () => {
    const [spring] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-03-29', 8),
      count: 1,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });
    const [autumn] = resolveMostRecentCompletedRecurringWindows({
      timezone: 'Europe/London',
      asOf: london('2026-10-25', 8),
      count: 1,
      clockWindow: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
    });

    expect(spring!.anchorDate).toBe('2026-03-29');
    expect(spring!.elapsedMinutes).toBe(360);
    expect(spring!.clockTransitions).toEqual([
      {
        kind: 'gap',
        atTimestamp: Date.parse('2026-03-29T01:00:00Z'),
        utcOffsetBeforeMinutes: 0,
        utcOffsetAfterMinutes: 60,
        changeMinutes: 60,
        affectedStartMinute: 60,
        affectedEndMinute: 120,
      },
    ]);
    expect(autumn!.anchorDate).toBe('2026-10-25');
    expect(autumn!.elapsedMinutes).toBe(480);
    expect(autumn!.clockTransitions).toEqual([
      {
        kind: 'fold',
        atTimestamp: Date.parse('2026-10-25T01:00:00Z'),
        utcOffsetBeforeMinutes: 60,
        utcOffsetAfterMinutes: 0,
        changeMinutes: 60,
        affectedStartMinute: 60,
        affectedEndMinute: 120,
      },
    ]);
  });

  it('fails closed when a requested boundary is nonexistent or repeated', () => {
    expect(() =>
      resolveMostRecentCompletedRecurringWindows({
        timezone: 'Europe/London',
        asOf: london('2026-03-29', 8),
        count: 1,
        clockWindow: {
          start: { hour: 1, minute: 30 },
          end: { hour: 3, minute: 0 },
        },
      }),
    ).toThrow(/does not exist because of a daylight-saving clock change/);

    expect(() =>
      resolveMostRecentCompletedRecurringWindows({
        timezone: 'Europe/London',
        asOf: london('2026-10-25', 8),
        count: 1,
        clockWindow: {
          start: { hour: 1, minute: 30 },
          end: { hour: 3, minute: 0 },
        },
      }),
    ).toThrow(/occurs more than once because of a daylight-saving clock change/);
  });
});

describe('executeScopedGlucoseQuery', () => {
  it('answers the screenshot case from exactly three windows, two with data', () => {
    const readings = [
      reading('wed-a', london('2026-08-05', 0, 1), 6),
      reading('wed-b', london('2026-08-05', 0, 6), 8),
      reading('thu-a', london('2026-08-06', 0, 1), 10),
      reading('thu-b', london('2026-08-06', 0, 6), 12),
      reading('forbidden-0816', london('2026-08-06', 8, 16), 19),
      reading('old', london('2026-08-03', 2), 2),
    ];

    const bundle = executeScopedGlucoseQuery(overnightQuery(), readings);

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.result.observedMeanMmolL).toBe(9);
    expect(bundle.result.requestedWindowCount).toBe(3);
    expect(bundle.result.windowsWithData).toBe(2);
    expect(bundle.result.missingWindowCount).toBe(1);
    expect(bundle.result.recordIds).toEqual([
      'wed-a',
      'wed-b',
      'thu-a',
      'thu-b',
    ]);
    expect(bundle.result.recordIds).not.toContain('forbidden-0816');
    expect(bundle.evidence.records.every((item) => item.timestamp < london('2026-08-06', 7))).toBe(true);
    expect(bundle.evidence.missingWindows.map((item) => item.anchorDate)).toEqual([
      '2026-08-04',
    ]);
    expect(bundle.chart.domain).toEqual({
      startMinute: 0,
      endMinuteUnwrapped: 420,
      binMinutes: 15,
    });
    expect(bundle.chart.aggregatePoints).toHaveLength(1);
    expect(bundle.chart.aggregatePoints[0]).toMatchObject({
      minute: 7.5,
      mmolL: 9,
      contributingWindowCount: 2,
    });
  });

  it('enforces start-inclusive and end-exclusive record boundaries', () => {
    const start = london('2026-08-06', 0);
    const end = london('2026-08-06', 7);
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({ windowCount: 1 }),
      [
        reading('before', start - 1, 3),
        reading('at-start', start, 4),
        reading('before-end', end - 1, 5),
        reading('at-end', end, 6),
      ],
    );

    expect(bundle.result.recordIds).toEqual(['at-start', 'before-end']);
    expect(bundle.result.observedMeanMmolL).toBe(4.5);
  });

  it('represents no data as null and missing, never as zero', () => {
    const bundle = executeScopedGlucoseQuery(overnightQuery(), []);

    expect(bundle.result.observedMeanMmolL).toBeNull();
    expect(bundle.result.readingCount).toBe(0);
    expect(bundle.result.coverage.observedMinutes).toBe(0);
    expect(bundle.result.coverage.percent).toBe(0);
    expect(bundle.evidence.records).toEqual([]);
    expect(bundle.evidence.missingWindows).toHaveLength(3);
    expect(bundle.chart.aggregatePoints).toEqual([]);
    expect(bundle.windows.every((window) => window.points.length === 0)).toBe(
      true,
    );
  });

  it('reports sparse coverage using capped elapsed observation time', () => {
    const start = london('2026-08-06', 0);
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({ windowCount: 1 }),
      [
        reading('a', start, 6),
        reading('b', start + 5 * 60_000, 7),
      ],
    );

    // First reading represents five minutes until b; b represents at most
    // another twelve minutes. Nothing is inferred across the rest of the night.
    expect(bundle.result.coverage.expectedMinutes).toBe(420);
    expect(bundle.result.coverage.observedMinutes).toBe(17);
    expect(bundle.result.coverage.percent).toBe(4);
    expect(bundle.windows[0]!.status).toBe('partial');
  });

  it('combines coverage denominators using actual elapsed DST durations', () => {
    const query = overnightQuery({
      asOf: london('2026-10-25', 8),
      windowCount: 211,
    });
    const bundle = executeScopedGlucoseQuery(query, []);
    const spring = bundle.windows.find(
      (window) => window.anchorDate === '2026-03-29',
    );
    const autumn = bundle.windows.find(
      (window) => window.anchorDate === '2026-10-25',
    );

    expect(spring?.coverage.expectedMinutes).toBe(360);
    expect(autumn?.coverage.expectedMinutes).toBe(480);
    expect(bundle.result.coverage.expectedMilliseconds).toBe(
      bundle.windows.reduce(
        (total, window) => total + window.range.end - window.range.start,
        0,
      ),
    );
  });

  it('preserves both occurrences of an autumn repeated clock bin', () => {
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({
        asOf: london('2026-10-25', 8),
        windowCount: 1,
      }),
      [
        reading('first-0130', Date.parse('2026-10-25T00:30:00Z'), 6),
        reading('second-0130', Date.parse('2026-10-25T01:30:00Z'), 8),
      ],
    );

    expect(bundle.result.recordIds).toEqual(['first-0130', 'second-0130']);
    expect(bundle.evidence.records.map((item) => item.minute)).toEqual([90, 90]);
    expect(bundle.windows[0]!.points).toEqual([
      expect.objectContaining({
        clockBinKey: '90:occurrence:1',
        minute: 97.5,
        mmolL: 6,
        readingCount: 1,
        clockOccurrence: 1,
        utcOffsetMinutes: 60,
        elapsedMinute: 90,
      }),
      expect.objectContaining({
        clockBinKey: '90:occurrence:2',
        minute: 97.5,
        mmolL: 8,
        readingCount: 1,
        clockOccurrence: 2,
        utcOffsetMinutes: 0,
        elapsedMinute: 150,
      }),
    ]);
    expect(bundle.windows[0]!.segments).toHaveLength(2);
    expect(bundle.windows[0]!.segments[1]!.startsAfter).toEqual({
      sensorGap: true,
      clockTransition: 'fold',
    });
    expect(bundle.chart.windows[0]!.clockTransitions[0]).toMatchObject({
      kind: 'fold',
      affectedStartMinute: 60,
      affectedEndMinute: 120,
    });
    expect(bundle.chart.aggregatePoints.map((point) => point.clockBinKey)).toEqual([
      '90:occurrence:1',
      '90:occurrence:2',
    ]);
    expect(bundle.safeguards.repeatedClockBins).toBe(
      'preserved-by-occurrence',
    );
  });

  it('annotates a spring clock gap without treating it as missing sensor coverage', () => {
    const query = overnightQuery({
      asOf: london('2026-03-29', 8),
      windowCount: 1,
    });
    const start = london('2026-03-29', 0);
    const end = london('2026-03-29', 7);
    const continuousReadings: GlucoseReading[] = [];
    for (let timestamp = start; timestamp < end; timestamp += 5 * 60_000) {
      continuousReadings.push(reading(`spring:${timestamp}`, timestamp, 7));
    }

    const bundle = executeScopedGlucoseQuery(query, continuousReadings);

    expect(bundle.windows[0]!.coverage).toMatchObject({
      expectedMinutes: 360,
      observedMinutes: 360,
      percent: 100,
    });
    expect(bundle.windows[0]!.status).toBe('complete');
    expect(bundle.result.missingWindowCount).toBe(0);
    expect(bundle.windows[0]!.clockTransitions).toEqual([
      expect.objectContaining({
        kind: 'gap',
        affectedStartMinute: 60,
        affectedEndMinute: 120,
      }),
    ]);
    expect(
      bundle.windows[0]!.points.some(
        (point) => point.binStartMinute >= 60 && point.binStartMinute < 120,
      ),
    ).toBe(false);
    expect(bundle.windows[0]!.segments).toHaveLength(2);
    expect(bundle.windows[0]!.segments[1]!.startsAfter).toEqual({
      sensorGap: false,
      clockTransition: 'gap',
    });
    expect(bundle.safeguards.clockChanges).toBe(
      'annotated-not-sensor-missingness',
    );
  });

  it('uses an unwrapped clock domain for cross-midnight chart data', () => {
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({
        asOf: london('2026-08-07', 4),
        windowCount: 1,
        clockWindow: {
          start: { hour: 22, minute: 0 },
          end: { hour: 3, minute: 0 },
          crossesMidnight: true,
        },
      }),
      [
        reading('late', london('2026-08-06', 23, 55), 6),
        reading('early', london('2026-08-07', 0, 5), 8),
        reading('too-late', london('2026-08-07', 3), 10),
      ],
    );

    expect(bundle.chart.domain).toEqual({
      startMinute: 1320,
      endMinuteUnwrapped: 1620,
      binMinutes: 15,
    });
    expect(bundle.result.recordIds).toEqual(['late', 'early']);
    expect(bundle.evidence.records.map((item) => item.minute)).toEqual([
      1435,
      1445,
    ]);
  });

  it('pre-segments chart lines across gaps instead of bridging them', () => {
    const start = london('2026-08-06', 0);
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({ windowCount: 1 }),
      [
        reading('a', start, 6),
        reading('b', start + 5 * 60_000, 6.2),
        reading('c', start + 60 * 60_000, 8),
        reading('d', start + 65 * 60_000, 8.2),
      ],
    );

    expect(bundle.windows[0]!.segments).toHaveLength(2);
    expect(bundle.windows[0]!.segments[1]!.startsAfter).toEqual({
      sensorGap: true,
      clockTransition: null,
    });
    expect(bundle.windows[0]!.segments.map((segment) => segment.points.length)).toEqual([
      1,
      1,
    ]);
    expect(bundle.safeguards.lineGaps).toBe(
      'pre-segmented-never-bridged',
    );
  });

  it('withholds aggregate bins until distinct-window contribution is sufficient', () => {
    const bundle = executeScopedGlucoseQuery(
      overnightQuery({ minimumAggregateContributors: 2 }),
      [
        reading('tue-bin-0-a', london('2026-08-04', 0, 1), 6),
        reading('tue-bin-0-b', london('2026-08-04', 0, 6), 8),
        reading('wed-bin-0', london('2026-08-05', 0, 2), 10),
        reading('tue-bin-1', london('2026-08-04', 0, 16), 12),
      ],
    );

    expect(bundle.chart.aggregatePoints).toHaveLength(1);
    expect(bundle.chart.aggregatePoints[0]).toMatchObject({
      binStartMinute: 0,
      contributingWindowCount: 2,
      mmolL: 8.5,
    });
    expect(bundle.chart.aggregatePoints[0]!.contributingWindowIds).toHaveLength(
      2,
    );
  });

  it('is deterministic regardless of input record order', () => {
    const records = [
      reading('z', london('2026-08-05', 2), 9),
      reading('a', london('2026-08-05', 1), 7),
      reading('m', london('2026-08-06', 3), 8),
    ];

    const forward = executeScopedGlucoseQuery(overnightQuery(), records);
    const reverse = executeScopedGlucoseQuery(
      overnightQuery(),
      [...records].reverse(),
    );

    expect(reverse).toEqual(forward);
    expect(JSON.parse(JSON.stringify(forward))).toEqual(forward);
  });

  it('derives distinct default query IDs from every calculation option', () => {
    const base = overnightQuery();
    const ordinary = executeScopedGlucoseQuery(base, []);
    const differentGap = executeScopedGlucoseQuery(
      { ...base, maximumObservedGapMinutes: 10 },
      [],
    );
    const differentBins = executeScopedGlucoseQuery(
      { ...base, binMinutes: 30 },
      [],
    );
    const differentContributors = executeScopedGlucoseQuery(
      { ...base, minimumAggregateContributors: 3 },
      [],
    );

    expect(
      new Set([
        ordinary.queryId,
        differentGap.queryId,
        differentBins.queryId,
        differentContributors.queryId,
      ]).size,
    ).toBe(4);
  });

  it('rejects contradictory or unsafe query/input shapes', () => {
    expect(() =>
      executeScopedGlucoseQuery(
        overnightQuery({
          clockWindow: {
            start: { hour: 22, minute: 0 },
            end: { hour: 3, minute: 0 },
            crossesMidnight: false,
          },
        }),
        [],
      ),
    ).toThrow(/conflicts/);
    expect(() =>
      executeScopedGlucoseQuery(overnightQuery(), [
        reading('duplicate', london('2026-08-05', 1), 6),
        reading('duplicate', london('2026-08-06', 1), 7),
      ]),
    ).toThrow(/Duplicate glucose record ID/);
    expect(() =>
      executeScopedGlucoseQuery(overnightQuery({ binMinutes: 17 }), []),
    ).toThrow(/binMinutes/);
  });
});
