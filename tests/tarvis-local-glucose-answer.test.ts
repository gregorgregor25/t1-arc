import { describe, expect, it } from 'vitest';

import {
  buildLocalGlucoseAnswer,
  localGlucoseClockBoundaryCapability,
  rangeForLocalGlucoseIntent,
  UnsupportedLocalGlucoseIntentError,
} from '@/data/tarvis/localGlucoseAnswer';
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisIntentV1,
} from '@/data/tarvis/intent';
import type { GlucoseReading } from '@/domain/models';
import type { EvidenceClockWindowVisualizationReference } from '@/domain/insights';

const AS_OF = Date.parse('2026-08-07T20:00:00+01:00');

function ready(question: string, now = AS_OF) {
  const resolution = resolveTarvisIntent(question, { now });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(
      `Expected ready intent, got ${resolution.outcome.code}: ${'message' in resolution.outcome ? resolution.outcome.message : ''}`,
    );
  }
  return resolution.intent;
}

function reading(id: string, timestamp: string, mmolL: number): GlucoseReading {
  const instant = Date.parse(timestamp);
  return {
    id,
    timestamp: instant,
    receivedAt: instant,
    mmolL,
    trend: 'unknown',
    quality: 'measured',
    sourceId: 'test-cgm',
  };
}

function clockVisualizationOf(
  result: ReturnType<typeof buildLocalGlucoseAnswer>,
): EvidenceClockWindowVisualizationReference {
  const visualization = result.evidence.visualization;
  if (visualization?.kind !== 'recurring-clock-overlay-v1') {
    throw new Error('Expected recurring clock-window visualization evidence.');
  }
  return visualization;
}

const OVERNIGHT_MEAN_QUESTION =
  'What were my average readings over the last three days between midnight and 7 a.m.?';

describe('local Tarv1s recurring-window glucose answers', () => {
  it('answers the screenshot question from only the exact three completed windows', () => {
    const intent = ready(OVERNIGHT_MEAN_QUESTION);
    const readings = [
      reading('wed-0000', '2026-08-05T00:00:00+01:00', 6),
      reading('wed-0015', '2026-08-05T00:15:00+01:00', 8),
      reading('thu-0000', '2026-08-06T00:00:00+01:00', 7),
      reading('thu-0015', '2026-08-06T00:15:00+01:00', 9),
      reading('excluded-at-0700', '2026-08-06T07:00:00+01:00', 20),
      reading('excluded-midday', '2026-08-06T12:00:00+01:00', 18),
    ];

    expect(rangeForLocalGlucoseIntent(intent, AS_OF)).toEqual({
      start: Date.parse('2026-08-05T00:00:00+01:00'),
      end: Date.parse('2026-08-07T07:00:00+01:00'),
    });

    const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });

    expect(result.answer.headline).toBe('Observed average glucose: 7.5 mmol/L');
    expect(result.answer.answer).toContain('2 of the 3 requested overnight windows');
    expect(result.answer.answer).toContain('observed arithmetic mean was 7.5 mmol/L');
    expect(result.evidence.recordIds).toEqual([
      'wed-0000',
      'wed-0015',
      'thu-0000',
      'thu-0015',
    ]);
    expect(result.evidence.recordIds).not.toContain('excluded-at-0700');
    expect(result.evidence.recordIds).not.toContain('excluded-midday');
    expect(result.answer.evidenceIds).toEqual([result.evidence.id]);
    const visualization = clockVisualizationOf(result);
    expect(visualization).toMatchObject({
      kind: 'recurring-clock-overlay-v1',
      domain: { startMinute: 0, endMinuteUnwrapped: 7 * 60 },
      minimumAggregateContributors: 2,
      overallMeanMmolL: 7.5,
      targetRangePolicy: 'persisted-only',
      traceSemantics: {
        aggregate: 'equal-occurrence-profile-average',
        binMinutes: 15,
        occurrence: 'clock-bin-average',
      },
      valueDomain: expect.objectContaining({
        minimum: expect.any(Number),
        maximum: expect.any(Number),
      }),
    });
    expect(visualization.windows.map(({ status }) => status)).toEqual([
      'partial',
      'partial',
      'missing',
    ]);
    expect(visualization.missingOccurrenceLabels).toHaveLength(1);
    expect(result.presentation.windows[0]).toMatchObject({
      recordCount: 4,
      metrics: [
        expect.objectContaining({ id: 'average-glucose', value: 7.5 }),
      ],
    });

    expect(
      buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings }),
    ).toEqual(result);
  });

  it('executes the named overnight question as exactly two 00:00–07:00 windows', () => {
    const intent = ready(
      'What were my average overnight readings for the last two nights?',
    );
    const readings = [
      reading('excluded-prior-night', '2026-08-05T01:00:00+01:00', 20),
      reading('thu-overnight', '2026-08-06T01:00:00+01:00', 6),
      reading('fri-overnight', '2026-08-07T06:59:00+01:00', 8),
      reading('excluded-at-end', '2026-08-07T07:00:00+01:00', 18),
      reading('excluded-midday', '2026-08-07T12:00:00+01:00', 16),
    ];

    expect(rangeForLocalGlucoseIntent(intent, AS_OF)).toEqual({
      start: Date.parse('2026-08-06T00:00:00+01:00'),
      end: Date.parse('2026-08-07T07:00:00+01:00'),
    });

    const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });

    expect(result.bundle.result.requestedWindowCount).toBe(2);
    expect(result.bundle.windows).toHaveLength(2);
    expect(result.evidence.recordIds).toEqual([
      'thu-overnight',
      'fri-overnight',
    ]);
    expect(result.evidence.visualization).toMatchObject({
      domain: { startMinute: 0, endMinuteUnwrapped: 7 * 60 },
      windows: expect.any(Array),
    });
    expect(result.evidence.visualization?.windows).toHaveLength(2);
  });

  it('calculates custom-threshold time in range from 12-minute capped duration', () => {
    const intent = structuredClone(
      ready(
        'What was my TIR over the last three days between midnight and 7 a.m.?',
      ),
    );
    intent.thresholds = intent.thresholds.map((field) => ({
      ...field,
      value: {
        ...field.value,
        value: field.value.role === 'range_lower' ? 4 : 8,
      },
    }));
    const readings = [
      reading('in-range', '2026-08-07T00:00:00+01:00', 6),
      reading('above-range', '2026-08-07T00:30:00+01:00', 12),
      reading('below-range', '2026-08-07T01:00:00+01:00', 3),
    ];

    const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });

    expect(result.bundle.result.coverage.observedMinutes).toBe(36);
    expect(result.answer.headline).toBe('Observed time in range: 33.3%');
    expect(result.answer.answer).toContain('requested 4.0–8.0 mmol/L range');
    expect(result.presentation.windows[0]?.metrics).toEqual([
      expect.objectContaining({ id: 'time-below-range', value: 33.3 }),
      expect.objectContaining({ id: 'time-in-range', value: 33.3 }),
      expect.objectContaining({ id: 'time-above-range', value: 33.3 }),
    ]);
    expect(result.evidence.calculation?.thresholds).toEqual([
      expect.objectContaining({ role: 'range_lower', value: 4 }),
      expect.objectContaining({ role: 'range_upper', value: 8 }),
    ]);
  });

  it.each([
    {
      question:
        'How many low-glucose events did I have over the last three days between midnight and 7 a.m.?',
      role: 'low' as const,
      threshold: 4.2,
      episodeValue: 4,
      recoveryValue: 6,
      headline: 'Observed low-glucose events: 1',
    },
    {
      question:
        'How many high-glucose events did I have over the last three days between midnight and 7 a.m.?',
      role: 'high' as const,
      threshold: 9.5,
      episodeValue: 9.8,
      recoveryValue: 6,
      headline: 'Observed high-glucose events: 1',
    },
  ])('uses the shared episode semantics with an exact custom $role threshold', (fixture) => {
    const intent = structuredClone(ready(fixture.question));
    intent.thresholds = intent.thresholds.map((field) => ({
      ...field,
      value: { ...field.value, value: fixture.threshold },
    }));
    const readings = [0, 5, 10, 15].map((minute) =>
      reading(
        `${fixture.role}-episode-${minute}`,
        `2026-08-06T00:${String(minute).padStart(2, '0')}:00+01:00`,
        fixture.episodeValue,
      ),
    );
    [20, 25, 30, 35].forEach((minute) => {
      readings.push(
        reading(
          `${fixture.role}-recovery-${minute}`,
          `2026-08-06T00:${minute}:00+01:00`,
          fixture.recoveryValue,
        ),
      );
    });

    const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });

    expect(result.answer.headline).toBe(fixture.headline);
    expect(result.evidence.calculation?.metrics[0]?.value).toBe(1);
    expect(result.evidence.calculation?.episodeDefinitionVersion).toBeTruthy();
    expect(result.evidence.calculation?.thresholds[0]?.value).toBe(
      fixture.threshold,
    );
  });

  it('uses per-occurrence boundary context without recounting an ongoing event', () => {
    const intent = ready(
      'How many high-glucose events did I have over the last one day between midnight and 7 a.m.?',
    );
    expect(rangeForLocalGlucoseIntent(intent, AS_OF)).toEqual({
      start: Date.parse('2026-08-06T23:45:00+01:00'),
      end: Date.parse('2026-08-07T07:15:00+01:00'),
    });
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading('before-start', '2026-08-06T23:50:00+01:00', 12),
        reading('at-start', '2026-08-07T00:00:00+01:00', 12),
        reading('confirmed-inside', '2026-08-07T00:05:00+01:00', 12),
      ],
    });

    expect(result.evidence.calculation?.metrics[0]?.value).toBe(0);
    expect(result.answerBundle.scope.windows[0]).toMatchObject({
      evidenceContextRange: {
        start: Date.parse('2026-08-06T23:45:00+01:00'),
        end: Date.parse('2026-08-07T07:15:00+01:00'),
      },
      contextRecordIds: ['before-start'],
      calculationRecordIds: ['at-start', 'confirmed-inside'],
    });
    expect(result.answerBundle.claims[0]).toMatchObject({
      value: 0,
      contextPolicy: 'episode-boundary-classification-only',
      contextRecordIds: ['before-start'],
    });
    expect(result.evidence.recordIds).not.toContain('before-start');
  });

  it('counts a start inside the window when post-window context confirms it', () => {
    const intent = ready(
      'How many high-glucose events did I have over the last one day between midnight and 7 a.m.?',
    );
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading('start-inside', '2026-08-07T06:55:00+01:00', 12),
        reading('after-five', '2026-08-07T07:00:00+01:00', 12),
        reading('confirm-after', '2026-08-07T07:10:00+01:00', 12),
      ],
    });

    expect(result.evidence.calculation?.metrics[0]?.value).toBe(1);
    expect(result.answerBundle.scope.windows[0]).toMatchObject({
      calculationRecordIds: ['start-inside'],
      contextRecordIds: ['after-five', 'confirm-after'],
    });
    expect(result.answerBundle.claims[0]?.value).toBe(1);
    expect(result.evidence.recordIds).toEqual(['start-inside']);
    expect(result.evidence.visualization).toBeUndefined();
  });

  it('detects adjacent recurring occurrences independently without recounting one crossing event', () => {
    const intent = structuredClone(
      ready(
        'How many high-glucose events did I have over the last two days between midnight and 7 a.m.?',
      ),
    );
    intent.clockWindow!.value = {
      start: { hour: 0, minute: 0 },
      end: { hour: 23, minute: 59 },
      crossesMidnight: false,
      occurrenceAnchor: 'start_date',
    };
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading('first-start', '2026-08-05T23:50:00+01:00', 12),
        reading('first-still-high', '2026-08-05T23:55:00+01:00', 12),
        reading('second-at-start', '2026-08-06T00:00:00+01:00', 12),
        reading('second-still-high', '2026-08-06T00:05:00+01:00', 12),
      ],
    });

    expect(result.evidence.calculation?.metrics[0]?.value).toBe(1);
    expect(result.answerBundle.claims[0]?.value).toBe(1);
    expect(result.answerBundle.scope.windows).toHaveLength(2);
  });

  it('averages duplicate sources once for events and is input-order invariant', () => {
    const intent = ready(
      'How many high-glucose events did I have over the last one day between midnight and 7 a.m.?',
    );
    const readings = [
      reading('start-low-source', '2026-08-07T01:00:00+01:00', 9),
      reading('start-high-source', '2026-08-07T01:00:00+01:00', 13),
      reading('middle-low-source', '2026-08-07T01:05:00+01:00', 9),
      reading('middle-high-source', '2026-08-07T01:05:00+01:00', 13),
      reading('confirm-low-source', '2026-08-07T01:15:00+01:00', 9),
      reading('confirm-high-source', '2026-08-07T01:15:00+01:00', 13),
    ];
    const forward = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });
    const reverse = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [...readings].reverse(),
    });

    expect(reverse).toEqual(forward);
    expect(forward.evidence.calculation?.metrics[0]?.value).toBe(1);
    expect(forward.answerBundle.claims[0]?.calculationRecordIds).toEqual([
      'start-high-source',
      'start-low-source',
      'middle-high-source',
      'middle-low-source',
      'confirm-high-source',
      'confirm-low-source',
    ]);
  });

  it('does not turn a no-data episode result into zero events', () => {
    const intent = ready(
      'How many lows did I have over the last three days between midnight and 7 a.m.?',
    );
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [],
    });

    expect(result.answer.headline).toBe('Glucose result unavailable');
    expect(result.evidence.calculation?.metrics[0]?.value).toBeNull();
    expect(result.presentation.windows[0]?.metrics[0]?.value).toBeNull();
  });

  it.each([
    {
      asOf: Date.parse('2026-03-29T20:00:00+01:00'),
      message:
        'The start boundary 2026-03-29 01:30 does not exist because of a daylight-saving clock change.',
      wording: 'did not exist',
    },
    {
      asOf: Date.parse('2026-10-25T20:00:00Z'),
      message:
        'The start boundary 2026-10-25 01:30 occurs more than once because of a daylight-saving clock change.',
      wording: 'occurred twice',
    },
  ])('turns a DST boundary failure into a safe capability answer', ({ asOf, message, wording }) => {
    const intent = structuredClone(ready(OVERNIGHT_MEAN_QUESTION, asOf));
    intent.temporalScope.value = {
      kind: 'recent_local_days',
      count: 1,
      include: 'most_recent_completed_windows',
    };
    intent.clockWindow!.value = {
      start: { hour: 1, minute: 30 },
      end: { hour: 3, minute: 0 },
      crossesMidnight: false,
      occurrenceAnchor: 'start_date',
    };
    let failure: unknown;
    try {
      rangeForLocalGlucoseIntent(intent, asOf);
    } catch (reason) {
      failure = reason;
    }
    expect(failure).toBeInstanceOf(RangeError);
    expect((failure as Error).message).toBe(message);
    const capability = localGlucoseClockBoundaryCapability(failure);
    expect(capability?.answer).toContain(wording);
    expect(capability?.evidenceIds).toEqual([]);
  });

  it('keeps a valid nonempty sparse observation distinct from zero coverage', () => {
    const intent = ready(
      'What was my average glucose over the last one day between midnight and 7 a.m.?',
    );
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading('one-millisecond', '2026-08-07T06:59:59.999+01:00', 6),
      ],
    });
    expect(result.bundle.result.coverage).toMatchObject({
      observedMilliseconds: 1,
      percent: 0.1,
    });
    expect(result.answerBundle.coverage.percent).toBe(0.1);
    expect(result.answer.headline).toBe('Observed average glucose: 6.0 mmol/L');
  });

  it('fails closed when a nominally ready intent lacks an executable clock window', () => {
    const intent: TarvisIntentV1 = {
      ...ready(OVERNIGHT_MEAN_QUESTION),
      clockWindow: null,
    };

    expect(() => rangeForLocalGlucoseIntent(intent, AS_OF)).toThrow(
      UnsupportedLocalGlucoseIntentError,
    );
    expect(() =>
      buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);
  });

  it('fails closed rather than weakening an inclusive episode threshold', () => {
    const intent = structuredClone(
      ready(
        'How many lows did I have over the last three days between midnight and 7 a.m.?',
      ),
    );
    intent.thresholds[0]!.value.operator = 'lte';

    expect(() =>
      buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);
  });

  it('persists daylight-saving fold wording separately from missing sensor data', () => {
    const asOf = Date.parse('2026-10-25T12:00:00Z');
    const intent = structuredClone(ready(OVERNIGHT_MEAN_QUESTION, asOf));
    if (intent.temporalScope.value.kind !== 'recent_local_days') {
      throw new Error('Expected local-day intent');
    }
    intent.temporalScope.value.count = 1;
    const result = buildLocalGlucoseAnswer({ asOf, intent, readings: [] });

    const visualization = clockVisualizationOf(result);
    expect(visualization.coverageSummary).toContain(
      'repeats 60 local minutes',
    );
    expect(visualization.coverageSummary).toContain(
      'not missing sensor data',
    );
  });
});
