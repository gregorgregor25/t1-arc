import { describe, expect, it } from 'vitest';

import {
  buildEvidenceQueryAccessibilitySummary,
  buildEvidenceQueryTimeTicks,
  buildEvidenceQueryValueTicks,
  compactEvidenceQueryVisualization,
  EvidenceQueryChartWindow,
  EvidenceQueryVisualizationReference,
  formatEvidenceQueryTick,
  isEvidenceQueryVisualizationReference,
  MAX_EVIDENCE_QUERY_CHART_POINTS,
  projectEvidenceQueryTimestamp,
  segmentEvidenceQueryPoints,
} from '../src/domain/evidenceQueryChart';

const START = Date.UTC(2026, 0, 1, 0, 0);
const END = Date.UTC(2026, 0, 2, 0, 0);

function window(
  overrides: Partial<EvidenceQueryChartWindow> = {},
): EvidenceQueryChartWindow {
  return {
    coveragePercent: 1.2,
    coverageStatus: 'limited',
    distribution: null,
    events: [],
    id: 'current',
    label: 'Requested period',
    meanMmolL: 7.25,
    points: [
      { mmolL: 7, recordId: 'g-1', timestamp: START },
      { mmolL: 7.5, recordId: 'g-2', timestamp: START + 5 * 60_000 },
    ],
    range: { end: END, start: START },
    recordCount: 2,
    ...overrides,
  };
}

function base(
  overrides: Partial<EvidenceQueryVisualizationReference> = {},
): EvidenceQueryVisualizationReference {
  return {
    gapThresholdMilliseconds: 12 * 60_000,
    kind: 'range-trace-v1',
    metric: 'glucose.mean',
    schemaVersion: 1,
    subtitle: 'Exact chronological trace',
    targetRange: { maximum: 10, minimum: 3.9 },
    timezone: 'Europe/London',
    title: 'Average glucose for the exact period',
    units: 'mmol/L',
    valueDomain: { maximum: 20, minimum: 0 },
    windows: [window()],
    ...overrides,
  } as EvidenceQueryVisualizationReference;
}

describe('exact-range evidence chart geometry', () => {
  it('anchors the x-axis to the requested scope, not the first or last reading', () => {
    const range = { start: START, end: END };
    const ticks = buildEvidenceQueryTimeTicks(range, 5);

    expect(ticks[0]).toBe(START);
    expect(ticks.at(-1)).toBe(END);
    expect(projectEvidenceQueryTimestamp(START, range, 400)).toBe(0);
    expect(projectEvidenceQueryTimestamp(END, range, 400)).toBe(400);
    expect(
      projectEvidenceQueryTimestamp(START + 12 * 60 * 60_000, range, 400),
    ).toBe(200);
  });

  it('keeps dates on rolling cross-day axes whose end time repeats', () => {
    const range = { start: START, end: END };
    expect(formatEvidenceQueryTick(START, range)).toMatch(/1 Jan.*00:00/);
    expect(formatEvidenceQueryTick(END, range)).toMatch(/2 Jan.*00:00/);
  });

  it('keeps every scoped point across more than seven days and splits gaps', () => {
    const range = { start: START, end: START + 10 * 24 * 60 * 60_000 };
    const points = Array.from({ length: 10 }, (_, index) => ({
      mmolL: 5 + index / 10,
      timestamp: START + index * 24 * 60 * 60_000,
    }));
    const segments = segmentEvidenceQueryPoints(
      points,
      range,
      12 * 60_000,
    );

    expect(segments).toHaveLength(10);
    expect(segments.flat()).toHaveLength(10);
    expect(segments[0]![0]!.timestamp).toBe(START);
    expect(segments.at(-1)![0]!.timestamp).toBe(
      START + 9 * 24 * 60 * 60_000,
    );
  });

  it('filters boundary-context points and never lets them extend the scope', () => {
    const segments = segmentEvidenceQueryPoints(
      [
        { mmolL: 3, timestamp: START - 60_000 },
        { mmolL: 5, timestamp: START },
        { mmolL: 6, timestamp: START + 5 * 60_000 },
        { mmolL: 7, timestamp: END },
      ],
      { start: START, end: END },
      12 * 60_000,
    );

    expect(segments.flat().map(({ timestamp }) => timestamp)).toEqual([
      START,
      START + 5 * 60_000,
    ]);
  });

  it('uses a persisted value domain instead of deriving ticks from sparse points', () => {
    expect(buildEvidenceQueryValueTicks({ minimum: 0, maximum: 20 }, 5)).toEqual([
      0,
      5,
      10,
      15,
      20,
    ]);
    expect(buildEvidenceQueryValueTicks({ minimum: 0, maximum: 20 }, 5)).toEqual(
      buildEvidenceQueryValueTicks({ minimum: 0, maximum: 20 }, 5),
    );
  });
});

describe('query-specific chart semantics', () => {
  it('describes exact periods, limited coverage, averages, and sensor gaps', () => {
    const visualization = base({
      windows: [
        window({
          coveragePercent: 41.5,
          coverageStatus: 'limited',
          points: [
            { mmolL: 7, recordId: 'g-1', timestamp: START },
            {
              mmolL: 8,
              recordId: 'g-2',
              timestamp: START + 30 * 60_000,
            },
          ],
        }),
      ],
    });
    const summary = buildEvidenceQueryAccessibilitySummary(visualization);

    expect(summary).toContain('exact period');
    expect(summary).toContain('Limited coverage is 41.5 percent');
    expect(summary).toContain('arithmetic mean is 7.3 mmol/L');
    expect(summary).toContain('1 sensor gap');
    expect(summary).toContain('lines stop across missing time');
  });

  it('announces every comparison period rather than a generic recent window', () => {
    const visualization = base({
      kind: 'period-comparison-v1',
      windows: [
        window(),
        window({
          id: 'previous',
          label: 'Previous period',
          range: {
            start: START - (END - START),
            end: START,
          },
        }),
      ],
    });
    const summary = buildEvidenceQueryAccessibilitySummary(visualization);

    expect(summary).toContain('compares 2 exact periods');
    expect(summary).toContain('Requested period');
    expect(summary).toContain('Previous period');
    expect(summary).not.toContain('recent window');
  });

  it('states the complete observed-duration distribution and missing-time rule', () => {
    const visualization: EvidenceQueryVisualizationReference = {
      ...base(),
      kind: 'range-distribution-v1',
      lowerBoundMmolL: 3.9,
      metric: 'glucose.time_in_range',
      upperBoundMmolL: 10,
      windows: [
        window({
          distribution: {
            abovePercent: 20.5,
            belowPercent: 4.5,
            inRangePercent: 75,
          },
        }),
      ],
    };
    const summary = buildEvidenceQueryAccessibilitySummary(visualization);

    expect(summary).toContain('4.5 percent was below range');
    expect(summary).toContain('75.0 percent was in range');
    expect(summary).toContain('20.5 percent was above range');
  });

  it('counts only events whose start is in the exact calculation scope', () => {
    const visualization: EvidenceQueryVisualizationReference = {
      ...base(),
      eventKind: 'high',
      kind: 'event-timeline-v1',
      metric: 'glucose.high_episodes',
      thresholdMmolL: 10,
      windows: [
        window({
          events: [
            {
              end: START + 20 * 60_000,
              extremeMmolL: 14,
              id: 'inside',
              kind: 'high',
              recordIds: ['g-1'],
              start: START,
            },
            {
              end: START,
              extremeMmolL: 13,
              id: 'context',
              kind: 'high',
              recordIds: ['context'],
              start: START - 15 * 60_000,
            },
          ],
        }),
      ],
    };
    const summary = buildEvidenceQueryAccessibilitySummary(visualization);

    expect(summary).toContain('1 sustained high event started');
    expect(summary).toContain('most extreme value was 14.0 mmol/L');
  });

  it('uses an explicit no-data statement instead of reporting zero', () => {
    const visualization = base({
      windows: [
        window({
          coveragePercent: 0,
          coverageStatus: 'unavailable',
          meanMmolL: null,
          points: [],
          recordCount: 0,
        }),
      ],
    });
    const summary = buildEvidenceQueryAccessibilitySummary(visualization);

    expect(summary).toContain('no glucose readings');
    expect(summary).toContain('average is unavailable');
    expect(summary).not.toContain('average is 0');
  });

  it('rejects stored specs whose points escape their declared range', () => {
    const valid = base();
    expect(isEvidenceQueryVisualizationReference(valid)).toBe(true);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [
          window({
            points: [
              { mmolL: 7, recordId: 'outside', timestamp: END },
            ],
          }),
        ],
      }),
    ).toBe(false);
  });

  it('rejects mismatched kind, metric, counts, and malformed percentages', () => {
    const valid = base();
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        metric: 'glucose.time_in_range',
      }),
    ).toBe(false);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [window({ recordCount: 99 })],
      }),
    ).toBe(false);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [
          window({ coveragePercent: 100, coverageStatus: 'sufficient' }),
        ],
      }),
    ).toBe(false);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        kind: 'range-distribution-v1',
        lowerBoundMmolL: 3.9,
        metric: 'glucose.time_in_range',
        upperBoundMmolL: 10,
        windows: [
          window({
            distribution: {
              abovePercent: 20,
              belowPercent: 10,
              inRangePercent: 60,
            },
          }),
        ],
      }),
    ).toBe(false);
  });

  it('recomputes the persisted mean using one averaged sample per timestamp', () => {
    const points = [
      { mmolL: 6, recordId: 'same-a', timestamp: START },
      { mmolL: 8, recordId: 'same-b', timestamp: START },
      { mmolL: 10, recordId: 'later', timestamp: START + 5 * 60_000 },
    ];
    const valid = base({
      windows: [window({ meanMmolL: 8.5, points, recordCount: 3 })],
    });

    expect(isEvidenceQueryVisualizationReference(valid)).toBe(true);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [window({ meanMmolL: 8, points, recordCount: 3 })],
      }),
    ).toBe(false);
  });

  it('accepts a bounded event spec and rejects context IDs or spans outside scope', () => {
    const event = {
      end: START + 5 * 60_000,
      extremeMmolL: 13,
      id: 'high-1',
      kind: 'high' as const,
      recordIds: ['g-1', 'g-2'],
      start: START,
    };
    const valid: EvidenceQueryVisualizationReference = {
      ...base(),
      eventKind: 'high',
      kind: 'event-timeline-v1',
      metric: 'glucose.high_episodes',
      thresholdMmolL: 10,
      windows: [window({
        events: [event],
        meanMmolL: 12.5,
        points: [
          { mmolL: 12, recordId: 'g-1', timestamp: START },
          { mmolL: 13, recordId: 'g-2', timestamp: START + 5 * 60_000 },
        ],
      })],
    };
    expect(isEvidenceQueryVisualizationReference(valid)).toBe(true);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [
          window({
            events: [{ ...event, recordIds: ['boundary-context'] }],
          }),
        ],
      }),
    ).toBe(false);
    expect(
      isEvidenceQueryVisualizationReference({
        ...valid,
        windows: [
          window({ events: [{ ...event, end: END + 1 }] }),
        ],
      }),
    ).toBe(false);
  });
});

describe('deterministic display compaction', () => {
  it('bounds a 12,000-sample chart before first render without losing exact-count disclosure', () => {
    const pointCount = 12_000;
    const step = 5 * 60_000;
    const points = Array.from({ length: pointCount }, (_, index) => ({
      mmolL: 4 + (index % 100) / 10,
      recordIds: [`large-${index}`],
      timestamp: START + index * step,
    }));
    const range = { start: START, end: START + pointCount * step };
    const exactMean =
      Math.round(
        ((points.reduce((sum, point) => sum + point.mmolL, 0) / pointCount) +
          Number.EPSILON) *
          100,
      ) / 100;
    const source = base({
      valueDomain: { minimum: 0, maximum: 20 },
      windows: [
        window({
          coveragePercent: 100,
          coverageStatus: 'sufficient',
          meanMmolL: exactMean,
          points,
          range,
          recordCount: pointCount,
        }),
      ],
    });

    const compacted = compactEvidenceQueryVisualization(source);
    const replay = compactEvidenceQueryVisualization(source);

    expect(compacted).not.toBeNull();
    expect(JSON.stringify(compacted)).toBe(JSON.stringify(replay));
    expect(compacted!.windows[0]!.points).toHaveLength(
      MAX_EVIDENCE_QUERY_CHART_POINTS,
    );
    expect(compacted!.windows[0]!.sampling).toMatchObject({
      displayedPointCount: MAX_EVIDENCE_QUERY_CHART_POINTS,
      sourceRecordCount: pointCount,
      sourceSampleCount: pointCount,
      sourceGapCount: 0,
    });
    expect(isEvidenceQueryVisualizationReference(compacted)).toBe(true);
    expect(buildEvidenceQueryAccessibilitySummary(compacted!)).toContain(
      `of ${pointCount} readings to stay clear`,
    );
    expect(buildEvidenceQueryAccessibilitySummary(compacted!)).toContain(
      `all ${pointCount} saved records`,
    );
    const excessiveMaximum = structuredClone(compacted!);
    excessiveMaximum.windows[0]!.sampling!.maximumDisplayedPoints =
      MAX_EVIDENCE_QUERY_CHART_POINTS + 1;
    expect(isEvidenceQueryVisualizationReference(excessiveMaximum)).toBe(false);

    const impossibleGapCount = structuredClone(compacted!);
    impossibleGapCount.windows[0]!.sampling!.sourceGapCount = pointCount;
    expect(isEvidenceQueryVisualizationReference(impossibleGapCount)).toBe(false);

    const excessiveTotal = {
      ...compacted!,
      kind: 'period-comparison-v1' as const,
      windows: [
        compacted!.windows[0]!,
        window({ id: 'extra-window', label: 'Extra period' }),
      ],
    };
    expect(isEvidenceQueryVisualizationReference(excessiveTotal)).toBe(false);
  });

  it('honours the global cap when many tiny comparison windows each need one point', () => {
    const windows = Array.from({ length: 16 }, (_, index) => {
      const start = START + index * 60 * 60_000;
      return window({
        id: `window-${index}`,
        label: `Window ${index + 1}`,
        points: [
          { mmolL: 6, recordIds: [`${index}-a`], timestamp: start },
          {
            mmolL: 8,
            recordIds: [`${index}-b`],
            timestamp: start + 5 * 60_000,
          },
        ],
        range: { start, end: start + 10 * 60_000 },
      });
    });
    const compacted = compactEvidenceQueryVisualization(
      base({ kind: 'period-comparison-v1', windows }),
      16,
    );

    expect(compacted).not.toBeNull();
    expect(
      compacted!.windows.reduce((sum, item) => sum + item.points.length, 0),
    ).toBe(16);
    expect(compacted!.windows.every((item) => item.points.length === 1)).toBe(
      true,
    );
  });

  it('preserves source gap segmentation after intermediate vertices are omitted', () => {
    const first = Array.from({ length: 1_500 }, (_, index) => ({
      mmolL: 6 + (index % 5) / 10,
      recordIds: [`before-${index}`],
      timestamp: START + index * 60_000,
    }));
    const secondStart = first.at(-1)!.timestamp + 60 * 60_000;
    const second = Array.from({ length: 1_500 }, (_, index) => ({
      mmolL: 7 + (index % 5) / 10,
      recordIds: [`after-${index}`],
      timestamp: secondStart + index * 60_000,
    }));
    const source = base({
      windows: [
        window({
          points: [...first, ...second],
          range: { start: START, end: second.at(-1)!.timestamp + 60_000 },
          recordCount: first.length + second.length,
        }),
      ],
    });
    const compacted = compactEvidenceQueryVisualization(source)!;
    const segments = segmentEvidenceQueryPoints(
      compacted.windows[0]!.points,
      compacted.windows[0]!.range,
      compacted.gapThresholdMilliseconds,
    );

    expect(compacted.windows[0]!.sampling?.sourceGapCount).toBe(1);
    expect(segments).toHaveLength(2);
  });

  it('suppresses a dense event timeline when the cap cannot retain one extreme per event', () => {
    const points = Array.from({ length: 64 }, (_, index) => ({
      mmolL: 12,
      recordIds: [`event-point-${index}`],
      timestamp: START + index * 60_000,
    }));
    const events = points.slice(0, 17).map((point, index) => ({
      end: point.timestamp + 30_000,
      extremeMmolL: point.mmolL,
      id: `event-${index}`,
      kind: 'high' as const,
      recordIds: [...point.recordIds],
      start: point.timestamp,
    }));
    const source: EvidenceQueryVisualizationReference = {
      ...base(),
      eventKind: 'high',
      kind: 'event-timeline-v1',
      metric: 'glucose.high_episodes',
      thresholdMmolL: 10,
      windows: [window({ events, meanMmolL: 12, points, recordCount: 64 })],
    };

    expect(compactEvidenceQueryVisualization(source, 16)).toBeNull();
  });
});
