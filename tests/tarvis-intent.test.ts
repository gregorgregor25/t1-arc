import { describe, expect, it } from 'vitest';

import {
  describeTarvisIntent,
  extractTarvisLiterals,
  isReadyTarvisIntent,
  isTarvisIntentV1,
  resolveTarvisIntent,
  TarvisIntentHistoryEntry,
  validateTarvisIntentV1,
} from '@/data/tarvis/intent';

const NOW = Date.parse('2026-08-07T20:00:00+01:00');

function resolve(question: string) {
  return resolveTarvisIntent(question, {
    now: NOW,
    timezone: 'Europe/London',
  });
}

function expectReady(question: string) {
  const resolution = resolve(question);
  expect(resolution.outcome).toEqual({ status: 'ready', code: 'ready' });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected a ready intent for: ${question}`);
  }
  return resolution;
}

describe('Tarv1s literal extraction', () => {
  it('preserves written and digit numbers with their exact source spans', () => {
    const question = 'Compare the last three days with the past 24h and below 4,0 mmol/L';
    const literals = extractTarvisLiterals(question, { now: NOW });

    expect(literals.numbers.map(({ raw, value, notation }) => ({ raw, value, notation }))).toEqual(
      expect.arrayContaining([
        { raw: 'three', value: 3, notation: 'words' },
        { raw: '24', value: 24, notation: 'digits' },
        { raw: '4,0', value: 4, notation: 'digits' },
      ]),
    );
    for (const literal of literals.numbers) {
      expect(question.slice(literal.start, literal.end)).toBe(literal.raw);
    }
  });

  it('extracts durations including compact 24h and number words', () => {
    const literals = extractTarvisLiterals('past 24h and last three days');
    expect(literals.durations.map(({ raw, value, unit }) => ({ raw, value, unit }))).toEqual([
      { raw: '24h', value: 24, unit: 'hour' },
      { raw: 'three days', value: 3, unit: 'day' },
    ]);
  });

  it('extracts absolute, UK-format, named, and relative local dates', () => {
    const literals = extractTarvisLiterals(
      'on 2026-08-01, 02/08/2026, 6 August, yesterday and today',
      { now: NOW, timezone: 'Europe/London' },
    );
    expect(literals.dates.map(({ raw, date, kind, yearWasInferred }) => ({
      raw,
      date,
      kind,
      yearWasInferred,
    }))).toEqual([
      { raw: '2026-08-01', date: '2026-08-01', kind: 'absolute', yearWasInferred: false },
      { raw: '02/08/2026', date: '2026-08-02', kind: 'absolute', yearWasInferred: false },
      { raw: '6 August', date: '2026-08-06', kind: 'absolute', yearWasInferred: true },
      { raw: 'yesterday', date: '2026-08-06', kind: 'relative', yearWasInferred: false },
      { raw: 'today', date: '2026-08-07', kind: 'relative', yearWasInferred: false },
    ]);
  });

  it('extracts midnight, noon, 7 a.m., units, thresholds, negation, and comparison', () => {
    const literals = extractTarvisLiterals(
      'Compare, not estimate, readings from midnight to noon and below seven mmol/L at 7 a.m.',
      { now: NOW },
    );
    expect(literals.times.map((time) => time.minuteOfDay)).toEqual([0, 720, 420]);
    expect(literals.units[0]?.unit).toBe('mmol/L');
    expect(literals.thresholds[0]).toMatchObject({
      operator: 'lt',
      value: 7,
      unit: 'mmol/L',
    });
    expect(literals.negations.map((item) => item.kind)).toContain('not');
    expect(literals.comparisons.map((item) => item.kind)).toContain('compare');
  });
});

describe('Tarv1s high-priority intent resolution', () => {
  it('resolves the reported screenshot question exactly', () => {
    const resolution = expectReady(
      'What are my average readings over the last three days between midnight and 7 a.m.?',
    );

    expect(resolution.intent).toMatchObject({
      schemaVersion: 1,
      domain: { value: 'glucose', provenance: { kind: 'explicit' } },
      metrics: [{ value: 'glucose.mean', provenance: { kind: 'explicit' } }],
      operation: { value: 'aggregate' },
      temporalScope: {
        value: {
          kind: 'recent_local_days',
          count: 3,
          include: 'most_recent_completed_windows',
        },
      },
      clockWindow: {
        value: {
          start: { hour: 0, minute: 0 },
          end: { hour: 7, minute: 0 },
          crossesMidnight: false,
          occurrenceAnchor: 'start_date',
        },
      },
      comparison: null,
    });
    expect(resolution.literals.numbers).toEqual(
      expect.arrayContaining([expect.objectContaining({ raw: 'three', value: 3 })]),
    );
  });

  it('resolves average overnight readings as exactly two completed profile windows', () => {
    const resolution = expectReady(
      'What were my average overnight readings for the last two nights?',
    );

    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      'glucose.mean',
    ]);
    expect(resolution.intent.temporalScope).toMatchObject({
      value: {
        kind: 'recent_local_days',
        count: 2,
        include: 'most_recent_completed_windows',
      },
      provenance: {
        kind: 'explicit',
        sourceText: 'last two nights',
      },
    });
    expect(resolution.intent.clockWindow).toMatchObject({
      value: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
        crossesMidnight: false,
        occurrenceAnchor: 'start_date',
      },
      provenance: {
        kind: 'default',
        sourceText: 'overnight',
      },
    });
    expect(resolution.intent.clockWindow?.provenance.note).toContain(
      't1-arc-default-overnight',
    );
    expect(resolution.intent.clockWindow?.provenance.note).toContain(
      '00:00–07:00 in Europe/London',
    );
    expect(
      describeTarvisIntent(resolution.intent, {
        timezone: 'Europe/London',
      }),
    ).toBe(
      'Average glucose · 2 completed overnight windows · 00:00–07:00 · Europe/London',
    );
  });

  it.each([
    'What was the average of my overnight readings for the last two nights?',
    'What were my overnight readings on average for the last two nights?',
    'For the past 2 nights, what were my readings overnight on average?',
    'What were my overnight readings averaged over the last two nights?',
    "What's my average for overnight readings over the last two nights?",
    'What was the mean for my overnight readings in the last two nights?',
    'On average, what were my glucose readings overnight during the last two nights?',
  ])('recognises a compositional overnight mean: %s', (question) => {
    const resolution = expectReady(question);
    expect(resolution.intent.metrics[0]?.value).toBe('glucose.mean');
    expect(resolution.intent.temporalScope.value).toMatchObject({
      count: 2,
      include: 'most_recent_completed_windows',
    });
  });

  it('fails closed when more than one completed-night count is stated', () => {
    const resolution = resolve(
      'What were my average overnight readings for the last two nights and past three nights?',
    );
    expect(resolution.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'ambiguous_time_scope',
    });
  });

  it('uses a supplied overnight profile and records its exact provenance', () => {
    const resolution = resolveTarvisIntent(
      'What were my average overnight readings for the last two nights?',
      {
        now: NOW,
        timezone: 'Europe/London',
        overnightProfile: {
          id: 'personal-overnight',
          start: { hour: 23, minute: 0 },
          end: { hour: 6, minute: 30 },
        },
      },
    );

    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) throw new Error('Expected ready');
    expect(resolution.intent.clockWindow).toMatchObject({
      value: {
        start: { hour: 23, minute: 0 },
        end: { hour: 6, minute: 30 },
        crossesMidnight: true,
      },
      provenance: { kind: 'profile' },
    });
    expect(resolution.intent.clockWindow?.provenance.note).toContain(
      'personal-overnight',
    );
    expect(resolution.intent.clockWindow?.provenance.note).toContain(
      '23:00–06:30 in Europe/London',
    );
  });

  it('fails closed for an invalid overnight profile', () => {
    const resolution = resolveTarvisIntent(
      'What were my average overnight readings for the last two nights?',
      {
        now: NOW,
        timezone: 'Europe/London',
        overnightProfile: {
          id: 'invalid-profile',
          start: { hour: 7, minute: 0 },
          end: { hour: 7, minute: 0 },
        },
      },
    );

    expect(resolution.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'invalid_clock_window',
    });
  });

  it('lets explicit clock bounds safely override an invalid overnight profile', () => {
    const resolution = resolveTarvisIntent(
      'What was my average glucose overnight from 22:00 to 06:00 for the last two nights?',
      {
        now: NOW,
        timezone: 'Europe/London',
        overnightProfile: {
          id: 'invalid-profile',
          start: { hour: 7, minute: 0 },
          end: { hour: 7, minute: 0 },
        },
      },
    );

    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (!isReadyTarvisIntent(resolution)) throw new Error('Expected ready');
    expect(resolution.intent.clockWindow).toMatchObject({
      value: {
        start: { hour: 22, minute: 0 },
        end: { hour: 6, minute: 0 },
        crossesMidnight: true,
      },
      provenance: { kind: 'explicit' },
    });
  });

  it('does not inherit a prior high-event metric into an explicit average question', () => {
    const previous = expectReady(
      'How many high-glucose events have I had in the last 30 days?',
    );
    const history: TarvisIntentHistoryEntry[] = [
      {
        turnId: 'turn-highs',
        question: previous.intent.question,
        intent: previous.intent,
      },
    ];
    const next = resolveTarvisIntent(
      'And what are my average readings over the last three days between midnight and 7 a.m.?',
      { now: NOW, timezone: 'Europe/London', history },
    );

    expect(next.outcome.status).toBe('ready');
    if (!isReadyTarvisIntent(next)) throw new Error('Expected ready');
    expect(next.intent.metrics.map((metric) => metric.value)).toEqual([
      'glucose.mean',
    ]);
    expect(next.intent.metrics[0]?.provenance.kind).toBe('explicit');
  });

  it('does not treat bare "and" as permission to inherit conversation state', () => {
    const previous = expectReady(
      'How many high-glucose events in the last 30 days?',
    );
    const result = resolveTarvisIntent('And last week?', {
      now: NOW,
      history: [
        {
          turnId: 'turn-1',
          question: previous.intent.question,
          intent: previous.intent,
        },
      ],
    });
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'missing_metric',
    });
  });

  it('inherits only through an explicit follow-up form and records provenance', () => {
    const previous = expectReady('What was my average glucose in the last 30 days?');
    const result = resolveTarvisIntent('What about last week?', {
      now: NOW,
      history: [
        {
          turnId: 'turn-mean',
          question: previous.intent.question,
          intent: previous.intent,
        },
      ],
    });
    expect(result.outcome.status).toBe('ready');
    if (!isReadyTarvisIntent(result)) throw new Error('Expected ready');
    expect(result.intent.metrics[0]).toMatchObject({
      value: 'glucose.mean',
      provenance: { kind: 'conversation', turnId: 'turn-mean' },
    });
    expect(result.intent.temporalScope).toMatchObject({
      value: { kind: 'calendar_period', period: 'last_week' },
      provenance: { kind: 'explicit' },
    });
  });

  it('preserves the exact completed-night count and clock profile in a follow-up', () => {
    const previous = expectReady(
      'What were my average overnight readings for the last two nights?',
    );
    const result = resolveTarvisIntent('What about high events?', {
      now: NOW,
      timezone: 'Europe/London',
      history: [
        {
          turnId: 'turn-overnight',
          question: previous.intent.question,
          intent: previous.intent,
        },
      ],
    });

    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error('Expected ready');
    expect(result.intent.metrics[0]?.value).toBe('glucose.high_episodes');
    expect(result.intent.temporalScope).toMatchObject({
      value: {
        kind: 'recent_local_days',
        count: 2,
        include: 'most_recent_completed_windows',
      },
      provenance: { kind: 'conversation', turnId: 'turn-overnight' },
    });
    expect(result.intent.clockWindow).toMatchObject({
      value: {
        start: { hour: 0, minute: 0 },
        end: { hour: 7, minute: 0 },
      },
      provenance: { kind: 'conversation', turnId: 'turn-overnight' },
    });
  });

  it.each([
    ['What was my avg BG over the last seven days?', 'glucose.mean'],
    ['What was my avarage glocose over the last seven days?', 'glucose.mean'],
    ['How many hypos have I had over the last seven days?', 'glucose.low_episodes'],
    ['How many spikes did I have over the last seven days?', 'glucose.high_episodes'],
    ['What was my TIR over the last seven days?', 'glucose.time_in_range'],
    ['What percent of time was in my target range over the last seven days?', 'glucose.time_in_range'],
  ])('normalises alias or typo: %s', (question, expectedMetric) => {
    const result = expectReady(question);
    expect(result.intent.metrics[0]?.value).toBe(expectedMetric);
  });

  it('keeps low- and high-episode counts as separate explicit metrics', () => {
    const result = expectReady(
      'How many lows and how many highs did I have over the last 14 days?',
    );
    expect(result.intent.metrics.map((metric) => metric.value)).toEqual([
      'glucose.low_episodes',
      'glucose.high_episodes',
    ]);
    expect(result.intent.operation.value).toBe('count_episodes');
  });

  it('uses target-profile provenance for episode and range thresholds', () => {
    const result = resolveTarvisIntent(
      'What was my time in range over the last 14 days?',
      {
        now: NOW,
        targetProfile: {
          id: 'personal-targets',
          unit: 'mg/dL',
          lowBelow: 75,
          highAbove: 170,
        },
      },
    );
    expect(result.outcome.status).toBe('ready');
    if (!isReadyTarvisIntent(result)) throw new Error('Expected ready');
    expect(result.intent.thresholds).toEqual([
      expect.objectContaining({
        value: { operator: 'gte', value: 75, unit: 'mg/dL', role: 'range_lower' },
        provenance: expect.objectContaining({ kind: 'profile', sourceText: 'personal-targets' }),
      }),
      expect.objectContaining({
        value: { operator: 'lte', value: 170, unit: 'mg/dL', role: 'range_upper' },
        provenance: expect.objectContaining({ kind: 'profile', sourceText: 'personal-targets' }),
      }),
    ]);
  });

  it('preserves an explicit custom glucose threshold and unit', () => {
    const result = expectReady(
      'How many low-glucose episodes below 70 mg/dL over the last 30 days?',
    );
    expect(result.intent.thresholds).toEqual([
      expect.objectContaining({
        value: { operator: 'lt', value: 70, unit: 'mg/dL', role: 'low' },
        provenance: expect.objectContaining({ kind: 'explicit' }),
      }),
    ]);
  });

  it('resolves a custom time-in-range band without confusing it with clock time', () => {
    const result = expectReady(
      'What percentage of my glucose readings were between 4 and 10 mmol over the last 14 days?',
    );
    expect(result.intent.metrics[0]?.value).toBe('glucose.time_in_range');
    expect(result.intent.thresholds.map((threshold) => threshold.value)).toEqual([
      { operator: 'gte', value: 4, unit: 'mmol/L', role: 'range_lower' },
      { operator: 'lte', value: 10, unit: 'mmol/L', role: 'range_upper' },
    ]);
  });

  it.each([
    'What was my time in range above 4 mmol/L over the last 14 days?',
    'How many low-glucose events at most 4 mmol/L over the last 14 days?',
    'How many high-glucose events at least 10 mmol/L over the last 14 days?',
    'What was my time in range between 10 and 4 mmol/L over the last 14 days?',
    'What was my average glucose above 10 mmol/L over the last 14 days?',
  ])('rejects a metric-incompatible threshold before producing a ready intent: %s', (question) => {
    expect(resolve(question).outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'invalid_threshold',
    });
  });
});

describe('Tarv1s temporal semantics', () => {
  it('distinguishes rolling 72 hours from three local calendar days', () => {
    const rolling = expectReady('What was my average glucose over the past 72 hours?');
    const localDays = expectReady('What was my average glucose over the last three days?');
    expect(rolling.intent.temporalScope.value).toEqual({
      kind: 'rolling',
      amount: 72,
      unit: 'hour',
      anchor: 'now',
    });
    expect(localDays.intent.temporalScope.value).toEqual({
      kind: 'recent_local_days',
      count: 3,
      include: 'through_now',
    });
  });

  it('resolves compact rolling durations at their exact boundary', () => {
    const result = expectReady('What was my average glucose over the last 24h?');
    expect(result.intent.temporalScope.value).toEqual({
      kind: 'rolling',
      amount: 24,
      unit: 'hour',
      anchor: 'now',
    });
  });

  it.each([
    ['today', 'today'],
    ['yesterday', 'yesterday'],
    ['this week', 'this_week'],
    ['last week', 'last_week'],
    ['this month', 'this_month'],
    ['last month', 'last_month'],
  ])('resolves the local-calendar period %s', (wording, period) => {
    const result = expectReady(`What was my average glucose ${wording}?`);
    expect(result.intent.temporalScope.value).toEqual({
      kind: 'calendar_period',
      period,
    });
  });

  it('resolves an exact local date and an inclusive date range', () => {
    const date = expectReady('What was my average glucose on 6 August 2026?');
    expect(date.intent.temporalScope.value).toEqual({
      kind: 'calendar_date',
      date: '2026-08-06',
    });

    const range = expectReady(
      'What was my average glucose from 1 August 2026 to 3 August 2026?',
    );
    expect(range.intent.temporalScope.value).toEqual({
      kind: 'calendar_date_range',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      inclusiveEndDate: true,
    });
  });

  it('resolves a cross-midnight recurring window without converting it to UTC', () => {
    const result = expectReady(
      'What was my average glucose over the last seven days from 10 p.m. to 3 a.m.?',
    );
    expect(result.intent.clockWindow?.value).toEqual({
      start: { hour: 22, minute: 0 },
      end: { hour: 3, minute: 0 },
      crossesMidnight: true,
      occurrenceAnchor: 'start_date',
    });
    expect(result.intent.temporalScope.value).toMatchObject({
      include: 'most_recent_completed_windows',
    });
  });

  it.each(['morning', 'afternoon', 'evening', 'at night'])(
    'does not silently broaden the named daypart %s',
    (daypart) => {
      const result = resolve(
        `What were my average ${daypart} readings over the last two days?`,
      );
      expect(result.outcome).toMatchObject({
        status: 'needs_clarification',
        code: 'ambiguous_time_scope',
      });
    },
  );

  it('fails closed for a named weekday instead of dropping the filter', () => {
    const result = resolve('What were my average readings on Tuesdays?');
    expect(result.outcome).toMatchObject({
      status: 'unsupported',
      code: 'unsupported_time_scope',
    });
  });

  it.each([
    [
      'What was my average glucose around 6 over the last three days?',
      'ambiguous_clock_time',
    ],
    [
      'What was my average glucose roughly between 6 and 7 over the last three days?',
      'ambiguous_clock_time',
    ],
    [
      'What was my average glucose at 06:00 over the last three days?',
      'ambiguous_clock_time',
    ],
    [
      'What was my average glucose 06:00 over the last three days?',
      'ambiguous_clock_time',
    ],
    [
      'What was my average glucose over the last 7 days excluding readings below 4 mmol/L?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose over the last 7 days without calibration readings?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose over the last 7 days using only Dexcom readings?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose after waking over the last week?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose while exercising over the last week?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose during workouts over the last week?',
      'ambiguous_time_scope',
    ],
    [
      'What was my average glucose post-meal over the last week?',
      'ambiguous_time_scope',
    ],
  ])('fails closed instead of dropping an unrepresented filter: %s', (question, code) => {
    expect(resolve(question).outcome).toMatchObject({
      status: 'needs_clarification',
      code,
    });
  });

  it('keeps an explicit safe window containing an until connector', () => {
    const result = expectReady(
      'What was my average glucose over the last three days from midnight until 7 a.m.?',
    );
    expect(result.intent.clockWindow?.value).toMatchObject({
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
    });
    expect(result.intent.temporalScope.value).toMatchObject({
      count: 3,
      include: 'most_recent_completed_windows',
    });
  });

  it('treats leading-zero clock text as explicit 24-hour time', () => {
    const result = expectReady(
      'What was my average glucose over the last three days from 00:00 to 07:00?',
    );
    expect(result.intent.clockWindow?.value).toMatchObject({
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
      crossesMidnight: false,
    });
  });

  it('can deterministically infer morning after the midnight keyword', () => {
    const result = expectReady(
      'What was my average glucose over the last three days between midnight and 7?',
    );
    expect(result.intent.clockWindow?.value.end).toEqual({ hour: 7, minute: 0 });
    expect(result.intent.clockWindow?.provenance.note).toContain('inferred');
  });

  it.each([
    ['between 10 and 3', 'ambiguous_clock_time'],
    ['between midnight and midnight', 'invalid_clock_window'],
    ['between 25 and 7', 'ambiguous_clock_time'],
    ['from 24:00 to 7 a.m.', 'ambiguous_clock_time'],
  ])('fails closed for unsafe clock bounds: %s', (clockText, code) => {
    const result = resolve(`What was my average glucose over the last three days ${clockText}?`);
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code,
    });
  });

  it('fails closed when two unequal durations are requested', () => {
    const result = resolve(
      'Compare my average glucose over the last 30 days versus the previous 7 days',
    );
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'ambiguous_time_scope',
    });
  });

  it.each([
    'What was my average glucose today over the last seven days?',
    'What was my average glucose yesterday over the past 24 hours?',
    'What was my average glucose on 6 August 2026 over the last seven days?',
    'What were my average overnight readings for the last two nights over the last seven days?',
  ])('fails closed when non-equivalent time scopes are combined: %s', (question) => {
    expect(resolve(question).outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'ambiguous_time_scope',
    });
  });

  it.each([
    'What was my average glucose today over the last one day?',
    'What was my average glucose today on 7 August 2026?',
    'What was my average glucose over the last seven days and for the last one week?',
    'What were my average overnight readings for the last two nights over the last two days?',
  ])('allows a genuinely equivalent redundant time cue: %s', (question) => {
    expect(expectReady(question).intent.temporalScope.value).toBeTruthy();
  });

  it('fails closed when an explicit date range runs backwards', () => {
    const result = resolve(
      'What was my average glucose from 6 August 2026 to 3 August 2026?',
    );
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'ambiguous_time_scope',
    });
  });

  it('supports comparison with the previous equal-length period', () => {
    const result = expectReady(
      'Compare my average glucose over the last 30 days with the previous 30 days',
    );
    expect(result.intent.comparison?.value).toEqual({
      kind: 'previous_equal_period',
    });
  });
});

describe('Tarv1s fail-closed capability outcomes', () => {
  it('asks for a period rather than selecting a default', () => {
    const result = resolve('What is my average glucose?');
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'missing_time_scope',
    });
  });

  it('asks for a metric rather than reusing unrelated state', () => {
    const result = resolve('Show me the last 30 days');
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'missing_metric',
    });
  });

  it('recognises newly executable metrics exactly instead of answering a nearby one', () => {
    const median = expectReady('What was my median glucose over the last 30 days?');
    expect(median.intent.metrics[0]?.value).toBe('glucose.median');

    const samples = expectReady('How many readings were low over the last 30 days?');
    expect(samples.intent.metrics[0]?.value).toBe('glucose.low_readings');
    expect(samples.intent.thresholds[0]?.value).toMatchObject({
      role: 'low',
      operator: 'lt',
      value: 3.9,
    });
  });

  it('reports unsupported domains rather than treating insulin as glucose', () => {
    const result = resolve('What was my total insulin over the last seven days?');
    expect(result.outcome).toMatchObject({
      status: 'unsupported',
      code: 'unsupported_domain',
    });
    expect(result.intent.domain?.value).toBe('insulin');
  });

  it('clarifies a genuinely negated metric', () => {
    const result = resolve('Not low episodes over the last seven days');
    expect(result.outcome).toMatchObject({
      status: 'needs_clarification',
      code: 'ambiguous_negation',
    });
  });

  it('honours an explicit correction without retaining the rejected metric', () => {
    const result = expectReady(
      'Not highs, I mean lows over the last seven days',
    );
    expect(result.intent.metrics.map((metric) => metric.value)).toEqual([
      'glucose.low_episodes',
    ]);
  });

  it('rejects numbered month scopes rather than silently treating them as 90 days', () => {
    const result = resolve('What was my average glucose over the last three months?');
    expect(result.outcome).toMatchObject({
      status: 'unsupported',
      code: 'unsupported_time_scope',
    });
  });
});

describe('Tarv1s strict intent contract', () => {
  it('validates a locally resolved ready intent', () => {
    const result = expectReady(
      'What was my average glucose over the last three days from midnight to 7 a.m.?',
    );
    expect(validateTarvisIntentV1(result.intent)).toEqual({
      valid: true,
      errors: [],
    });
    expect(isTarvisIntentV1(result.intent)).toBe(true);
  });

  it('rejects missing nullable fields and additional properties', () => {
    const result = expectReady('What was my average glucose over the last seven days?');
    const { clockWindow: _clockWindow, ...missingNullable } = result.intent;
    const withExtra = { ...result.intent, invented: true };

    expect(validateTarvisIntentV1(missingNullable)).toMatchObject({ valid: false });
    expect(validateTarvisIntentV1(withExtra)).toMatchObject({ valid: false });
  });

  it('rejects invalid clock boundaries even when the object shape looks plausible', () => {
    const result = expectReady(
      'What was my average glucose over the last three days from midnight to 7 a.m.?',
    );
    const invalid = structuredClone(result.intent);
    if (!invalid.clockWindow) throw new Error('Expected window');
    invalid.clockWindow.value.start.hour = 25;
    const validation = validateTarvisIntentV1(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('does not match any allowed shape')]),
    );
  });
});
