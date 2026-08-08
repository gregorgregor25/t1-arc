import { describe, expect, it } from 'vitest';

import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type ResolveTarvisIntentOptions,
  type TarvisIntentResolution,
} from '@/data/tarvis/intent';
import {
  buildLocalGlucoseAnswer,
  rangeForLocalGlucoseIntent,
} from '@/data/tarvis/localGlucoseAnswer';
import {
  routeTarvisIntent,
  type TarvisOnDeviceRoute,
} from '@/data/tarvis/onDeviceRouting';
import type { GlucoseReading } from '@/domain/models';

const NOW = Date.parse('2026-08-07T22:54:00+01:00');
const OPTIONS = {
  now: NOW,
  timezone: 'Europe/London',
} satisfies ResolveTarvisIntentOptions;

function resolve(
  question: string,
  options: ResolveTarvisIntentOptions = OPTIONS,
) {
  return resolveTarvisIntent(question, options);
}

function ready(
  question: string,
  options: ResolveTarvisIntentOptions = OPTIONS,
) {
  const resolution = resolve(question, options);
  if (!isReadyTarvisIntent(resolution)) {
    const detail =
      'message' in resolution.outcome ? `: ${resolution.outcome.message}` : '';
    throw new Error(
      `Expected an exact ready intent for ${JSON.stringify(question)}, got ${resolution.outcome.code}${detail}`,
    );
  }
  return resolution;
}

function route(
  question: string,
  options: ResolveTarvisIntentOptions = OPTIONS,
) {
  return routeTarvisIntent(resolve(question, options));
}

function semanticSignature(question: string) {
  const resolution = ready(question);
  return {
    domain: resolution.intent.domain.value,
    metrics: resolution.intent.metrics.map(({ value }) => value),
    operation: resolution.intent.operation.value,
    temporalScope: resolution.intent.temporalScope.value,
    clockWindow: resolution.intent.clockWindow?.value,
    route: routeTarvisIntent(resolution).kind,
  };
}

function expectExactCompletedOvernights(question: string, count: number) {
  const resolution = ready(question);
  expect(
    {
      domain: resolution.intent.domain.value,
      metrics: resolution.intent.metrics.map(({ value }) => value),
      operation: resolution.intent.operation.value,
      scope: resolution.intent.temporalScope.value,
      window: resolution.intent.clockWindow?.value,
      route: routeTarvisIntent(resolution).kind,
    },
    question,
  ).toEqual({
    domain: 'glucose',
    metrics: ['glucose.mean'],
    operation: 'aggregate',
    scope: {
      kind: 'recent_local_days',
      count,
      include: 'most_recent_completed_windows',
    },
    window: {
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
      crossesMidnight: false,
      occurrenceAnchor: 'start_date',
    },
    route: 'scoped-glucose',
  });
  return resolution;
}

function reading(
  id: string,
  timestamp: string,
  mmolL: number,
): GlucoseReading {
  const instant = Date.parse(timestamp);
  return {
    id,
    timestamp: instant,
    receivedAt: instant,
    mmolL,
    trend: 'unknown',
    quality: 'measured',
    sourceId: 'adversarial-cgm',
  };
}

function expectCapability(
  question: string,
  resolution: TarvisIntentResolution = resolve(question),
  routed: TarvisOnDeviceRoute = routeTarvisIntent(resolution),
) {
  expect(routed.kind, question).toBe('capability');
  if (routed.kind !== 'capability') {
    throw new Error(`Expected fail-closed capability route for ${question}`);
  }
  expect(routed.answer.evidenceIds, question).toEqual([]);
  expect(routed.answer.limitations.join(' '), question).toMatch(
    /No calculation|No OpenAI request/i,
  );
}

describe('Tarv1s adversarial natural-language matrix', () => {
  const naturalParaphrases = [
    'What were my average overnight readings for the last two nights?',
    'What was the average of my overnight glucose readings across the last 2 nights?',
    'Across the past two nights, what was the mean of my overnight glucose?',
    'For the last two nights, average my overnight CGM readings.',
    'Average overnight glucose for the last two nights.',
    'Mean of the readings overnight, covering the past two nights.',
    'What was the average of the readings for the last two nights?',
    'Average readings for the past 2 nights.',
    'For the past 2 nights, what were my readings overnight on average?',
    'What were my overnight readings averaged over the last two nights?',
    'How did my readings average overnight across the last two nights?',
    "What's my average for overnight readings over the last two nights?",
    'What was the mean for my overnight readings in the last two nights?',
    'On average, what were my glucose readings overnight during the last two nights?',
  ];

  it.each(naturalParaphrases)(
    'preserves the exact two-night meaning across wording: %s',
    (question) => {
      expectExactCompletedOvernights(question, 2);
    },
  );

  const equivalentSurfaceForms = [
    'What were my average overnight readings for the last two nights?',
    'WHAT WERE MY AVERAGE OVERNIGHT READINGS FOR THE LAST TWO NIGHTS?',
    '  What   were my average overnight readings for the last two nights  ',
    'What were my average overnight readings for the last two nights!!!',
    'Please, what were my average overnight readings for the last two nights?',
    'Could you please tell me what were my average overnight readings for the last two nights?',
  ];

  it('is invariant to case, punctuation, whitespace, and harmless polite filler', () => {
    const baseline = semanticSignature(equivalentSurfaceForms[0]!);
    for (const question of equivalentSurfaceForms.slice(1)) {
      expect(semanticSignature(question), question).toEqual(baseline);
    }
  });

  it.each([
    [1, 'one'],
    [2, 'two'],
    [3, 'three'],
    [7, 'seven'],
    [12, 'twelve'],
    [21, 'twenty-one'],
  ] as const)(
    'treats digit and written count %i as the same exact request',
    (count, word) => {
      const digit = semanticSignature(
        `Average overnight readings for the last ${count} nights.`,
      );
      const written = semanticSignature(
        `Average overnight readings for the last ${word} nights.`,
      );
      expect(digit).toEqual(written);
      expect(digit.temporalScope).toEqual({
        kind: 'recent_local_days',
        count,
        include: 'most_recent_completed_windows',
      });
    },
  );

  it('understands singular last night as one completed overnight occurrence', () => {
    expectExactCompletedOvernights(
      'What was my average overnight reading last night?',
      1,
    );
  });
});

describe('Tarv1s completed-window boundary matrix', () => {
  const question =
    'What were my average overnight readings for the last two nights?';

  it('selects exactly the two latest completed 00:00-07:00 windows at 22:54', () => {
    const intent = expectExactCompletedOvernights(question, 2).intent;
    expect(rangeForLocalGlucoseIntent(intent, NOW)).toEqual({
      start: Date.parse('2026-08-06T00:00:00+01:00'),
      end: Date.parse('2026-08-07T07:00:00+01:00'),
    });
  });

  it.each([
    [1, '2026-08-07'],
    [2, '2026-08-06'],
    [3, '2026-08-05'],
    [7, '2026-08-01'],
  ] as const)(
    'keeps all %i requested windows and never substitutes an earlier count',
    (count, firstDate) => {
      const intent = ready(
        `What were my average overnight readings for the last ${count} nights?`,
      ).intent;
      expect(rangeForLocalGlucoseIntent(intent, NOW)).toEqual({
        start: Date.parse(`${firstDate}T00:00:00+01:00`),
        end: Date.parse('2026-08-07T07:00:00+01:00'),
      });
    },
  );

  it('does not include the current overnight one millisecond before it completes', () => {
    const asOf = Date.parse('2026-08-07T06:59:59.999+01:00');
    const intent = ready(question, { ...OPTIONS, now: asOf }).intent;
    expect(rangeForLocalGlucoseIntent(intent, asOf)).toEqual({
      start: Date.parse('2026-08-05T00:00:00+01:00'),
      end: Date.parse('2026-08-06T07:00:00+01:00'),
    });
  });

  it('includes the current overnight exactly at its exclusive end instant', () => {
    const asOf = Date.parse('2026-08-07T07:00:00+01:00');
    const intent = ready(question, { ...OPTIONS, now: asOf }).intent;
    expect(rangeForLocalGlucoseIntent(intent, asOf)).toEqual({
      start: Date.parse('2026-08-06T00:00:00+01:00'),
      end: Date.parse('2026-08-07T07:00:00+01:00'),
    });
  });

  it('uses explicit clock bounds instead of silently applying the overnight profile', () => {
    const question =
      'What were my average overnight readings for the last two nights between 01:30 and 05:45?';
    const resolution = ready(question, {
      ...OPTIONS,
      overnightProfile: {
        id: 'personal-overnight',
        start: { hour: 22, minute: 0 },
        end: { hour: 8, minute: 0 },
      },
    });

    expect(resolution.intent.clockWindow).toMatchObject({
      value: {
        start: { hour: 1, minute: 30 },
        end: { hour: 5, minute: 45 },
        crossesMidnight: false,
      },
      provenance: { kind: 'explicit' },
    });
    expect(resolution.intent.temporalScope.value).toEqual({
      kind: 'recent_local_days',
      count: 2,
      include: 'most_recent_completed_windows',
    });
    expect(rangeForLocalGlucoseIntent(resolution.intent, NOW)).toEqual({
      start: Date.parse('2026-08-06T01:30:00+01:00'),
      end: Date.parse('2026-08-07T05:45:00+01:00'),
    });
  });

  it('anchors completed cross-midnight explicit windows by their start date', () => {
    const resolution = ready(
      'What were my average overnight readings for the last two nights between 22:00 and 06:00?',
    );
    expect(resolution.intent.clockWindow?.value).toMatchObject({
      start: { hour: 22, minute: 0 },
      end: { hour: 6, minute: 0 },
      crossesMidnight: true,
      occurrenceAnchor: 'start_date',
    });
    expect(rangeForLocalGlucoseIntent(resolution.intent, NOW)).toEqual({
      start: Date.parse('2026-08-05T22:00:00+01:00'),
      end: Date.parse('2026-08-07T06:00:00+01:00'),
    });
  });
});

describe('Tarv1s fail-closed routing matrix', () => {
  it.each([
    'Moonlit-smoothed readings across the last two nights?',
    'Seasonally adjusted readings for the last two nights?',
    'Noise-corrected levels over the past seven days?',
    'Dream-adjusted numbers for the last two nights?',
    'Compare readings across alternating weekdays.',
  ])(
    'never routes an unrecognised personal analytics modifier to legacy/OpenAI: %s',
    (question) => {
      expectCapability(question);
    },
  );

  it.each([
    'What was my average glucose over the last three days between 10 and 3?',
    'What was my average glucose around 6 over the last three days?',
    'What was my average glucose in the morning over the last three days?',
    'What was my average glucose during the night over the last three days?',
    'What was my average glucose at bedtime over the last three days?',
  ])('does not ignore an ambiguous clock or named daypart: %s', (question) => {
    expectCapability(question);
  });

  it.each([
    'What was my average glucose on Tuesdays over the last 30 days?',
    'What was my average glucose on weekdays over the last month?',
    'What was my average glucose on weekends over the last month?',
    'What was my average glucose on weeknights over the last month?',
  ])('does not widen a named-day filter to the whole period: %s', (question) => {
    expectCapability(question);
  });

  it.each([
    'What was my average glucose over the last 7 days excluding yesterday?',
    'What was my average glucose over the last 7 days except weekends?',
    'What was my average glucose over the last 7 days excluding readings below 4 mmol/L?',
    'What was my average glucose over the last 7 days excluding calibration readings?',
  ])('does not silently discard an exclusion: %s', (question) => {
    expectCapability(question);
  });

  it.each([
    'What was my average glucose in the two hours after breakfast over the last week?',
    'What was my average glucose after meals over the last week?',
    'What was my average glucose after waking over the last week?',
    'What was my average glucose after a correction bolus over the last week?',
    'What was my average glucose while exercising over the last week?',
  ])('does not ignore an event-relative filter: %s', (question) => {
    expectCapability(question);
  });
});

describe('Tarv1s screenshot path end to end', () => {
  it('resolves, routes, ranges, calculates, and cites only exact overnight records', () => {
    const question =
      'What were my average overnight readings for the last two nights?';
    const resolution = ready(question);
    expect(routeTarvisIntent(resolution)).toEqual({ kind: 'scoped-glucose' });

    const repositoryRange = rangeForLocalGlucoseIntent(resolution.intent, NOW);
    expect(repositoryRange).toEqual({
      start: Date.parse('2026-08-06T00:00:00+01:00'),
      end: Date.parse('2026-08-07T07:00:00+01:00'),
    });

    const readings = [
      reading('before-range', '2026-08-05T06:59:59.999+01:00', 1),
      reading('thu-at-start', '2026-08-06T00:00:00+01:00', 6),
      reading('thu-before-end', '2026-08-06T06:59:59.999+01:00', 8),
      reading('thu-at-end', '2026-08-06T07:00:00+01:00', 30),
      reading('thu-midday-poison', '2026-08-06T12:00:00+01:00', 40),
      reading('fri-at-start', '2026-08-07T00:00:00+01:00', 10),
      reading('fri-before-end', '2026-08-07T06:59:59.999+01:00', 12),
      reading('fri-at-end', '2026-08-07T07:00:00+01:00', 50),
      reading('after-range', '2026-08-08T00:00:00+01:00', 60),
    ];

    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent: resolution.intent,
      readings,
    });
    const exactIds = [
      'thu-at-start',
      'thu-before-end',
      'fri-at-start',
      'fri-before-end',
    ];

    expect(result.bundle.result.recordIds).toEqual(exactIds);
    expect(result.bundle.evidence.recordIds).toEqual(exactIds);
    expect(result.evidence.recordIds).toEqual(exactIds);
    expect(result.answerBundle.records.map(({ id }) => id)).toEqual(exactIds);
    expect(result.answerBundle.claims[0]?.calculationRecordIds).toEqual(exactIds);
    expect(result.bundle.result.observedMeanMmolL).toBe(9);
    expect(result.bundle.result.requestedWindowCount).toBe(2);
    expect(result.bundle.windows.map(({ anchorDate }) => anchorDate)).toEqual([
      '2026-08-06',
      '2026-08-07',
    ]);
    expect(result.evidence.visualization).toMatchObject({
      kind: 'recurring-clock-overlay-v1',
      domain: { startMinute: 0, endMinuteUnwrapped: 420 },
      windows: expect.any(Array),
    });
    expect(result.answer.evidenceIds).toEqual([result.evidence.id]);
    expect(result.answerBundle.charts[0]?.recordIds).toEqual(exactIds);
  });
});
