import { describe, expect, it } from 'vitest';

import {
  applyTarvisCoverageGuardrail,
  buildTarvisEvidencePresentation,
  isTarvisEvidencePresentation,
} from '@/data/tarvis/evidencePresentation';
import {
  buildTarvisEvidencePacket,
  toTarvisInsightWindowSummary,
} from '@/data/tarvis/evidencePacket';
import {
  TarvisAnswer,
  TarvisConversationTurn,
  TarvisEvidencePacket,
} from '@/data/tarvis/types';
import {
  buildInsightReport,
  InsightWindowSummary,
} from '@/domain/insights';
import { GlucoseReading, TimelineData } from '@/domain/models';

const currentRange = {
  start: Date.parse('2026-07-08T00:00:00+01:00'),
  end: Date.parse('2026-08-07T00:00:00+01:00'),
};
const previousRange = {
  start: Date.parse('2026-06-08T00:00:00+01:00'),
  end: currentRange.start,
};

function summary(
  overrides: Partial<InsightWindowSummary> = {},
): InsightWindowSummary {
  return {
    glucoseAverage: 7.4,
    glucoseStandardDeviation: 2.1,
    glucoseCvPercent: 28.4,
    timeInRangePercent: 72.3,
    timeAbovePercent: 24.5,
    timeBelowPercent: 3.2,
    coveragePercent: 96.8,
    glucoseReadings: 8_212,
    highGlucoseRuns: 18,
    lowGlucoseRuns: 4,
    insulinUnits: null,
    mealCarbsPerDay: null,
    lateMeals: 0,
    sleepMinutesPerNight: null,
    activityMinutes: null,
    ...overrides,
  };
}

function packet(): TarvisEvidencePacket {
  return {
    schemaVersion: 1,
    timezone: 'Europe/London',
    units: { glucose: 'mmol/L', weight: 'kg', distance: 'km' },
    generatedAt: Date.parse('2026-08-07T12:00:00+01:00'),
    comparison: {
      currentRange,
      previousRange,
      headline: 'Glucose comparison',
      summary: 'A deterministic comparison.',
      current: summary(),
      previous: summary({
        glucoseAverage: 7.8,
        highGlucoseRuns: 22,
        lowGlucoseRuns: 6,
        coveragePercent: 94.1,
        glucoseReadings: 7_980,
      }),
    },
    findings: [],
    evidence: [
      {
        id: 'current-glucose',
        label: 'Recent 30 days',
        description: '8,212 normalised glucose readings',
        range: currentRange,
        recordCount: 8_212,
        examples: [],
      },
      {
        id: 'previous-glucose',
        label: 'Previous 30 days',
        description: '7,980 normalised glucose readings',
        range: previousRange,
        recordCount: 7_980,
        examples: [],
      },
    ],
  };
}

function answer(): TarvisAnswer {
  return {
    headline: 'A supported answer',
    answer: 'This answer uses the recent glucose evidence.',
    confidence: 'high',
    evidenceIds: ['current-glucose'],
    limitations: [],
  };
}

describe('Tarv1s response-card evidence presentation', () => {
  it('shows the exact window and full-period inputs for an average question', () => {
    const presentation = buildTarvisEvidencePresentation(
      'What has been my average glucose over the last 30 days?',
      packet(),
      answer(),
    );

    expect(presentation).toMatchObject({
      kind: 'average-glucose',
      windows: [
        {
          label: 'Requested period',
          range: currentRange,
          recordCount: 8_212,
          coveragePercent: 96.8,
          coverageStatus: 'sufficient',
          metrics: [
            {
              id: 'average-glucose',
              value: 7.4,
              unit: 'mmol/L',
            },
          ],
        },
      ],
    });
    expect(presentation?.detail).toContain(
      'weighted across observed sensor time',
    );
  });

  it('keeps low and high event questions semantically separate', () => {
    const low = buildTarvisEvidencePresentation(
      'How many low-glucose events have I had in the last 30 days?',
      packet(),
      answer(),
    );
    const high = buildTarvisEvidencePresentation(
      'How many high-glucose events have I had in the last 30 days?',
      packet(),
      answer(),
    );

    expect(low?.kind).toBe('low-events');
    expect(low?.windows[0]?.metrics).toEqual([
      {
        id: 'low-events',
        label: 'Sustained lows',
        value: 4,
        decimals: 0,
      },
    ]);
    expect(low?.detail).toContain('below 3.9 mmol/L');
    expect(low?.detail).not.toContain('above 10.0 mmol/L');
    expect(high?.kind).toBe('high-events');
    expect(high?.windows[0]?.metrics[0]).toMatchObject({
      id: 'high-events',
      value: 18,
    });
    expect(high?.detail).toContain('above 10.0 mmol/L');
    expect(high?.detail).not.toContain('below 3.9 mmol/L');
  });

  it('recognises lows and highs as event-count aliases', () => {
    const presentation = buildTarvisEvidencePresentation(
      'How many lows and highs have I had?',
      packet(),
      answer(),
    );

    expect(presentation?.windows[0]?.metrics.map((metric) => metric.id)).toEqual(
      ['low-events', 'high-events'],
    );
  });

  it('uses a semantic range breakdown and labels comparison windows', () => {
    const presentation = buildTarvisEvidencePresentation(
      'Compare my time in range with the previous 30 days',
      packet(),
      answer(),
    );

    expect(presentation?.kind).toBe('time-in-range');
    expect(presentation?.windows).toHaveLength(2);
    expect(presentation?.windows.map((window) => window.label)).toEqual([
      'Recent period',
      'Previous period',
    ]);
    expect(presentation?.windows[0]?.metrics.map((metric) => metric.id)).toEqual(
      ['time-below-range', 'time-in-range', 'time-above-range'],
    );
    expect(presentation?.windows[1]).toMatchObject({
      range: previousRange,
      recordCount: 7_980,
      coveragePercent: 94.1,
    });
  });

  it('shows zero-reading event and range summaries as unavailable', () => {
    const noDataPacket = packet();
    noDataPacket.comparison.current = summary({
      glucoseAverage: null,
      glucoseReadings: 0,
      coveragePercent: 0,
      highGlucoseRuns: 0,
      lowGlucoseRuns: 0,
      timeBelowPercent: 0,
      timeInRangePercent: 0,
      timeAbovePercent: 0,
    });

    const events = buildTarvisEvidencePresentation(
      'How many low-glucose events and high-glucose events have I had?',
      noDataPacket,
      answer(),
    );
    const range = buildTarvisEvidencePresentation(
      'What was my time in range?',
      noDataPacket,
      answer(),
    );

    expect(events?.windows[0]?.metrics.map((metric) => metric.value)).toEqual([
      null,
      null,
    ]);
    expect(range?.windows[0]?.metrics.map((metric) => metric.value)).toEqual([
      null,
      null,
      null,
    ]);
    expect(events?.windows[0]?.coverageStatus).toBe('unavailable');

    const modelSummary = toTarvisInsightWindowSummary(
      summary({
        glucoseReadings: 0,
        coveragePercent: 0,
        highGlucoseRuns: 0,
        lowGlucoseRuns: 0,
        timeBelowPercent: 0,
        timeInRangePercent: 0,
        timeAbovePercent: 0,
      }),
    );
    expect(modelSummary).toMatchObject({
      highGlucoseRuns: null,
      lowGlucoseRuns: null,
      timeBelowPercent: null,
      timeInRangePercent: null,
      timeAbovePercent: null,
    });

    const guarded = applyTarvisCoverageGuardrail(
      'How many low-glucose events have I had?',
      noDataPacket,
      { ...answer(), evidenceIds: [] },
    );
    expect(guarded).toMatchObject({
      headline: 'Glucose result unavailable',
      confidence: 'limited',
      evidenceIds: ['current-glucose'],
    });
    expect(guarded.answer).toContain('no glucose readings');
    expect(guarded.answer).not.toContain('0 sustained');
  });

  it('keeps low-coverage values explicitly observed in the card and answer', () => {
    const sparsePacket = packet();
    sparsePacket.comparison.current = summary({
      glucoseReadings: 240,
      coveragePercent: 42.5,
    });

    const presentation = buildTarvisEvidencePresentation(
      'What was my average glucose and how many low-glucose events did I have?',
      sparsePacket,
      answer(),
    );

    expect(presentation?.windows[0]?.metrics).toMatchObject([
      {
        id: 'average-glucose',
        label: 'Observed average glucose',
        value: 7.4,
      },
      {
        id: 'low-events',
        label: 'Observed sustained lows',
        value: 4,
      },
    ]);
    expect(presentation?.windows[0]?.recordCount).toBe(240);
    expect(presentation?.windows[0]?.coveragePercent).toBe(42.5);
    expect(presentation?.windows[0]?.coverageStatus).toBe('limited');

    const guarded = applyTarvisCoverageGuardrail(
      'What was my average glucose and how many low-glucose events did I have?',
      sparsePacket,
      { ...answer(), evidenceIds: [] },
    );
    expect(guarded).toMatchObject({
      headline: 'Observed glucose results',
      confidence: 'limited',
      evidenceIds: ['current-glucose'],
    });
    expect(guarded.answer).toContain('42.5% sensor coverage');
    expect(guarded.answer).toContain('average glucose was 7.4 mmol/L');
    expect(guarded.answer).toContain(
      '4 sustained low-glucose events were observed',
    );
    expect(guarded.answer).toContain('not complete-period estimates');
    expect(guarded.limitations[0]).toContain('less than 70%');
  });

  it('carries the previous metric into a contextual comparison follow-up', () => {
    const sparsePacket = packet();
    sparsePacket.comparison.current = summary({
      glucoseReadings: 240,
      coveragePercent: 42.5,
    });
    sparsePacket.comparison.previous = toTarvisInsightWindowSummary(
      summary({
        glucoseAverage: null,
        glucoseReadings: 0,
        coveragePercent: 0,
        lowGlucoseRuns: 0,
      }),
    );
    const history: TarvisConversationTurn[] = [
      { role: 'user', text: 'How many lows have I had?' },
      { role: 'assistant', text: 'The recent period had four observed lows.' },
    ];
    const guarded = applyTarvisCoverageGuardrail(
      'What about the previous period?',
      sparsePacket,
      { ...answer(), evidenceIds: [] },
      history,
    );
    const presentation = buildTarvisEvidencePresentation(
      'What about the previous period?',
      sparsePacket,
      guarded,
      history,
    );

    expect(guarded.confidence).toBe('limited');
    expect(guarded.evidenceIds).toEqual([
      'current-glucose',
      'previous-glucose',
    ]);
    expect(guarded.answer).toContain('4 sustained low-glucose events');
    expect(guarded.answer).toContain('Previous period has no glucose readings');
    expect(presentation?.kind).toBe('low-events');
    expect(presentation?.windows).toMatchObject([
      { coverageStatus: 'limited' },
      { coverageStatus: 'unavailable' },
    ]);
  });

  it('does not inherit a previous metric through an ordinary and', () => {
    const history: TarvisConversationTurn[] = [
      { role: 'user', text: 'How many high-glucose events have I had?' },
      { role: 'assistant', text: 'Twelve highs were observed.' },
    ];
    const presentation = buildTarvisEvidencePresentation(
      'What were my average readings over the last three days between midnight and 7 a.m.?',
      packet(),
      answer(),
      history,
    );

    expect(presentation?.kind).toBe('average-glucose');
    expect(presentation?.windows[0]?.metrics.map((metric) => metric.id)).toEqual([
      'average-glucose',
    ]);
  });

  it('uses real coverage evidence IDs for a low and zero-data report', () => {
    const end = Date.parse('2026-08-07T00:00:00+01:00');
    const duration = 30 * 86_400_000;
    const timeline = (
      start: number,
      finish: number,
      glucose: GlucoseReading[],
    ): TimelineData => ({
      range: { start, end: finish },
      glucose,
      basal: [],
      boluses: [],
      context: [],
      sources: [],
    });
    const currentStart = end - duration;
    const previousStart = currentStart - duration;
    const sparseReadings: GlucoseReading[] = [0, 5].map((minutes, index) => ({
      id: `sparse-${index}`,
      sourceId: 'daymark-librelinkup',
      timestamp: currentStart + minutes * 60_000,
      receivedAt: currentStart + minutes * 60_000,
      mmolL: 7 + index,
      trend: 'flat',
      quality: 'measured',
    }));
    const report = buildInsightReport(
      timeline(currentStart, end, sparseReadings),
      timeline(previousStart, currentStart, []),
      end,
    );
    const realPacket = buildTarvisEvidencePacket(report).packet;
    const guarded = applyTarvisCoverageGuardrail(
      'Compare my average glucose with the previous period',
      realPacket,
      { ...answer(), evidenceIds: [] },
    );

    expect(report.ready).toBe(false);
    expect(realPacket.comparison.current.coveragePercent).toBeLessThan(70);
    expect(realPacket.comparison.current.glucoseReadings).toBe(2);
    expect(realPacket.comparison.previous.glucoseReadings).toBe(0);
    expect(guarded.evidenceIds).toEqual([
      'current-coverage',
      'previous-coverage',
    ]);
    expect(
      guarded.evidenceIds.every((id) =>
        realPacket.evidence.some((evidence) => evidence.id === id),
      ),
    ).toBe(true);
    expect(guarded.answer).toContain('observed values');
    expect(guarded.answer).toContain('requested glucose result is unavailable');
  });

  it('leaves high-coverage model answers and card labels unchanged', () => {
    const highCoveragePacket = packet();
    const original = answer();
    const presentation = buildTarvisEvidencePresentation(
      'What was my average glucose?',
      highCoveragePacket,
      original,
    );

    expect(presentation?.windows[0]).toMatchObject({
      coverageStatus: 'sufficient',
      metrics: [{ label: 'Average glucose', value: 7.4 }],
    });
    expect(
      applyTarvisCoverageGuardrail(
        'What was my average glucose?',
        highCoveragePacket,
        original,
      ),
    ).toBe(original);
  });

  it('does not force a generic glucose visual onto unrelated answers', () => {
    expect(
      buildTarvisEvidencePresentation(
        'What patterns are worth reviewing?',
        packet(),
        answer(),
      ),
    ).toBeUndefined();
    expect(
      buildTarvisEvidencePresentation(
        'What was my average glucose?',
        packet(),
        { ...answer(), evidenceIds: ['invented'] },
      ),
    ).toBeUndefined();
  });

  it('validates the compact presentation saved with a conversation', () => {
    const presentation = buildTarvisEvidencePresentation(
      'What was my average glucose?',
      packet(),
      answer(),
    );
    expect(isTarvisEvidencePresentation(presentation)).toBe(true);
    expect(
      isTarvisEvidencePresentation({ ...presentation, windows: [] }),
    ).toBe(false);
  });
});
