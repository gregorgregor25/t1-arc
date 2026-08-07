import { describe, expect, it } from 'vitest';

import {
  buildLocalGlucoseAnswer,
  rangeForLocalGlucoseIntent,
  UnsupportedLocalGlucoseIntentError,
} from '@/data/tarvis/localGlucoseAnswer';
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisIntentV1,
} from '@/data/tarvis/intent';
import type { GlucoseReading } from '@/domain/models';

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
    expect(result.evidence.visualization).toMatchObject({
      kind: 'recurring-clock-overlay-v1',
      domain: { startMinute: 0, endMinuteUnwrapped: 7 * 60 },
      minimumAggregateContributors: 2,
    });
    expect(result.evidence.visualization?.windows.map(({ status }) => status)).toEqual([
      'partial',
      'partial',
      'missing',
    ]);
    expect(result.evidence.visualization?.missingOccurrenceLabels).toHaveLength(1);
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

    expect(result.evidence.visualization?.coverageSummary).toContain(
      'repeats 60 local minutes',
    );
    expect(result.evidence.visualization?.coverageSummary).toContain(
      'not missing sensor data',
    );
  });
});
