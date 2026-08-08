import { describe, expect, it } from 'vitest';

import {
  assertGlucoseAnswerBundleV2,
  isGlucoseAnswerBundleV2,
} from '@/data/tarvis/glucoseAnswerBundleV2';
import { buildLocalGlucoseAnswer } from '@/data/tarvis/localGlucoseAnswer';
import { buildLocalGlucoseRangeAnswer } from '@/data/tarvis/localGlucoseRangeAnswer';
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
} from '@/data/tarvis/intent';
import type { GlucoseReading } from '@/domain/models';

const AS_OF = Date.parse('2026-08-07T20:00:00+01:00');

function ready(question: string) {
  const resolution = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: 'Europe/London',
  });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected a ready intent, got ${resolution.outcome.code}.`);
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
    sourceId: id.split(':')[0] ?? 'test-cgm',
  };
}

function mutableClone(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

describe('GlucoseAnswerBundleV2', () => {
  it('is deterministic, deeply immutable, and de-skews same-instant sources', () => {
    const intent = ready(
      'What were my average readings over the last one day between midnight and 7 a.m.?',
    );
    const readings = [
      reading('live:a', '2026-08-07T01:00:00+01:00', 6),
      reading('import:a', '2026-08-07T01:00:00+01:00', 8),
      reading('live:b', '2026-08-07T01:05:00+01:00', 10),
    ];
    const result = buildLocalGlucoseAnswer({ asOf: AS_OF, intent, readings });

    expect(isGlucoseAnswerBundleV2(result.answerBundle)).toBe(true);
    expect(result.answerBundle.claims[0]).toMatchObject({
      metric: 'glucose.mean',
      status: 'available',
      value: 8.5,
    });
    expect(result.answer.headline).toContain('8.5 mmol/L');
    expect(result.answerBundle.records.map(({ id }) => id)).toEqual([
      'import:a',
      'live:a',
      'live:b',
    ]);
    expect(result.answerBundle.charts[0]!.recordIds).toEqual(
      result.answerBundle.records.map(({ id }) => id),
    );
    expect(Object.isFrozen(result.answerBundle)).toBe(true);
    expect(Object.isFrozen(result.answerBundle.scope.windows[0])).toBe(true);
    expect(Object.isFrozen(result.answerBundle.records[0])).toBe(true);
    expect(() =>
      assertGlucoseAnswerBundleV2(mutableClone(result.answerBundle)),
    ).not.toThrow();

    const reversed = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [...readings].reverse(),
    });
    expect(reversed.answerBundle).toEqual(result.answerBundle);

    const revised = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: readings.map((value) =>
        value.id === 'import:a' ? { ...value, mmolL: 12 } : value,
      ),
    });
    expect(revised.answerBundle.identity.queryId).toBe(
      result.answerBundle.identity.queryId,
    );
    expect(revised.answerBundle.identity.dataRevisionId).not.toBe(
      result.answerBundle.identity.dataRevisionId,
    );
    expect(revised.answerBundle.identity.integrityId).not.toBe(
      result.answerBundle.identity.integrityId,
    );
  });

  it('links a comparison chart to a dedicated union evidence reference', () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready(
        'Compare my average glucose over the last 24 hours with the previous period.',
      ),
      readings: [
        reading('previous', '2026-08-06T08:00:00+01:00', 6),
        reading('current', '2026-08-07T08:00:00+01:00', 9),
      ],
    });

    assertGlucoseAnswerBundleV2(result.answerBundle);
    expect(result.answerBundle.claims).toHaveLength(2);
    expect(result.answerBundle.charts).toHaveLength(1);
    const chart = result.answerBundle.charts[0]!;
    const chartEvidence = result.evidence.find(
      ({ id }) => id === chart.sourceReferenceId,
    );
    expect(chartEvidence).toBeDefined();
    expect(chartEvidence?.recordIds).toEqual(chart.recordIds);
    expect(chartEvidence?.visualization).toMatchObject({
      kind: 'period-comparison-v1',
      windows: [
        { id: 'requested-period', points: [{ recordIds: ['current'] }] },
        { id: 'comparison-period', points: [{ recordIds: ['previous'] }] },
      ],
    });
    expect(result.evidence.slice(0, 2).every(
      ({ visualization }) => visualization === undefined,
    )).toBe(true);
  });

  it('keeps event boundary context out of claims and chart points', () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready('How many high-glucose events did I have yesterday?'),
      readings: [
        reading('start-inside', '2026-08-06T23:50:00+01:00', 12),
        reading('still-inside', '2026-08-06T23:55:00+01:00', 12),
        reading('confirm-after', '2026-08-07T00:05:00+01:00', 20),
      ],
    });

    const window = result.answerBundle.scope.windows[0]!;
    const claim = result.answerBundle.claims[0]!;
    const chart = result.answerBundle.charts[0]!;
    expect(claim).toMatchObject({
      value: 1,
      status: 'available',
      contextPolicy: 'episode-boundary-classification-only',
      calculationRecordIds: ['start-inside', 'still-inside'],
      contextRecordIds: ['confirm-after'],
    });
    expect(window.calculationRange).not.toEqual(window.evidenceContextRange);
    expect(chart.range).toEqual(window.calculationRange);
    expect(chart.recordIds).toEqual(['start-inside', 'still-inside']);
    expect(chart.recordIds).not.toContain('confirm-after');
    expect(result.evidence[0]?.visualization).toMatchObject({
      kind: 'event-timeline-v1',
      windows: [{
        range: window.calculationRange,
        points: [
          { recordIds: ['start-inside'] },
          { recordIds: ['still-inside'] },
        ],
        events: [{
          extremeMmolL: 12,
          recordIds: ['start-inside', 'still-inside'],
        }],
      }],
    });
    assertGlucoseAnswerBundleV2(result.answerBundle);
  });

  it('distinguishes an observed zero from unavailable data', () => {
    const intent = ready('How many high-glucose events have I had today?');
    const observed = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [reading('normal', '2026-08-07T12:00:00+01:00', 6)],
    });
    const unavailable = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [],
    });

    expect(observed.answerBundle.claims[0]).toMatchObject({
      status: 'available',
      value: 0,
    });
    expect(unavailable.answerBundle.claims[0]).toMatchObject({
      status: 'unavailable',
      value: null,
    });

    const forgedZero = mutableClone(unavailable.answerBundle);
    forgedZero.claims[0].status = 'available';
    forgedZero.claims[0].value = 0;
    expect(() => assertGlucoseAnswerBundleV2(forgedZero)).toThrow(
      /zero with unavailable/i,
    );
  });

  it('fails closed when records, coverage, claims, charts, or identity are altered', () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready('What was my average glucose today?'),
      readings: [
        reading('first', '2026-08-07T08:00:00+01:00', 6),
        reading('second', '2026-08-07T08:05:00+01:00', 8),
      ],
    });

    const changedClaim = mutableClone(result.answerBundle);
    changedClaim.claims[0].value = 99;
    expect(() => assertGlucoseAnswerBundleV2(changedClaim)).toThrow(
      /not reproducible/i,
    );

    const missingClaimValue = mutableClone(result.answerBundle);
    delete missingClaimValue.claims[0].value;
    expect(() => assertGlucoseAnswerBundleV2(missingClaimValue)).toThrow();

    const unsupportedMetric = mutableClone(result.answerBundle);
    unsupportedMetric.intent.normalized.metrics[0] = 'glucose.current';
    expect(() => assertGlucoseAnswerBundleV2(unsupportedMetric)).toThrow();

    const incompleteChart = mutableClone(result.answerBundle);
    incompleteChart.charts[0].recordIds.pop();
    expect(() => assertGlucoseAnswerBundleV2(incompleteChart)).toThrow(
      /chart.*incomplete/i,
    );

    const changedCoverage = mutableClone(result.answerBundle);
    changedCoverage.scope.windows[0].coverage.percent = 100;
    expect(() => assertGlucoseAnswerBundleV2(changedCoverage)).toThrow(
      /coverage is not reproducible/i,
    );

    const outOfScopeRecord = mutableClone(result.answerBundle);
    outOfScopeRecord.records[0].timestamp =
      outOfScopeRecord.scope.windows[0].calculationRange.end;
    expect(() => assertGlucoseAnswerBundleV2(outOfScopeRecord)).toThrow(
      /outside window|canonical order/i,
    );

    const forgedIdentity = mutableClone(result.answerBundle);
    forgedIdentity.identity.integrityId = 'forged';
    expect(() => assertGlucoseAnswerBundleV2(forgedIdentity)).toThrow(
      /integrity/i,
    );
  });

  it('does not emit a misleading single-kind chart for low-and-high answers', () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready(
        'How many lows and how many highs did I have over the last 14 days?',
      ),
      readings: [],
    });

    expect(result.answerBundle.claims.map(({ metric }) => metric)).toEqual([
      'glucose.low_episodes',
      'glucose.high_episodes',
    ]);
    expect(result.answerBundle.charts).toEqual([]);
    expect(result.evidence.every(({ visualization }) =>
      visualization === undefined,
    )).toBe(true);
    assertGlucoseAnswerBundleV2(result.answerBundle);
  });
});
