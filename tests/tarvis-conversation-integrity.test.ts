import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase: vi.fn(async () => ({
    getFirstAsync: vi.fn(async () =>
      persistence.value ? { value: persistence.value } : null,
    ),
  })),
  withDaymarkTransaction: vi.fn(async (work: (transaction: unknown) => Promise<void>) =>
    work({
      runAsync: vi.fn(async (_sql: string, _key: string, value?: string) => {
        persistence.value = value;
      }),
    }),
  ),
}));
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));

import {
  loadTarvisConversation,
  saveTarvisConversation,
  serializeTarvisConversation,
  TarvisConversationStorageLimitError,
  type StoredTarvisExchange,
  validStoredTarvisExchange,
} from '@/data/tarvis/conversationStore';
import { compactTarvisEvidence } from '@/data/tarvis/evidenceCompaction';
import { buildLocalGlucoseAnswer } from '@/data/tarvis/localGlucoseAnswer';
import { buildLocalGlucoseRangeAnswer } from '@/data/tarvis/localGlucoseRangeAnswer';
import { isReadyTarvisIntent, resolveTarvisIntent } from '@/data/tarvis/intent';
import type { GlucoseReading } from '@/domain/models';

const AS_OF = Date.parse('2026-08-07T20:00:00+01:00');

function ready(question: string) {
  const result = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: 'Europe/London',
  });
  if (!isReadyTarvisIntent(result)) throw new Error(result.outcome.code);
  return result.intent;
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

function exactExchange(): StoredTarvisExchange {
  const question = 'What was my average glucose today?';
  const intent = ready(question);
  const result = buildLocalGlucoseRangeAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading('first', '2026-08-07T08:00:00+01:00', 6),
      reading('second', '2026-08-07T08:05:00+01:00', 8),
    ],
  });
  return {
    id: 'exact-1',
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence(result.evidence),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function recurringBoundaryEventExchange(): StoredTarvisExchange {
  const question =
    'How many high-glucose events did I have over the last one day between midnight and 7 a.m.?';
  const intent = ready(question);
  const result = buildLocalGlucoseAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading('pre-boundary-normal', '2026-08-06T23:50:00+01:00', 6),
      reading('start-inside', '2026-08-07T06:55:00+01:00', 12),
      reading('post-boundary-high', '2026-08-07T07:00:00+01:00', 12),
      reading('post-boundary-confirm', '2026-08-07T07:10:00+01:00', 12),
    ],
  });
  return {
    id: 'recurring-boundary-event',
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence([result.evidence]),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function exactBoundaryEventExchange(): StoredTarvisExchange {
  const question = 'How many high-glucose events did I have yesterday?';
  const intent = ready(question);
  const result = buildLocalGlucoseRangeAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading('exact-pre-boundary', '2026-08-05T23:50:00+01:00', 6),
      reading('exact-start-inside', '2026-08-06T23:50:00+01:00', 12),
      reading('exact-still-inside', '2026-08-06T23:55:00+01:00', 12),
      reading('exact-post-confirm', '2026-08-07T00:05:00+01:00', 12),
    ],
  });
  return {
    id: 'exact-boundary-event',
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence(result.evidence),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function plainExchange(index: number): StoredTarvisExchange {
  return {
    id: `plain-${index}`,
    question: `Question ${index} ${'x'.repeat(220)}`,
    answer: {
      headline: `Answer ${index}`,
      answer: 'A deterministic plain answer.',
      confidence: 'limited',
      evidenceIds: [],
      limitations: [],
    },
    evidence: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Tarv1s schema-v3 conversation integrity', () => {
  beforeEach(() => {
    persistence.value = undefined;
  });

  it('persists, validates, reloads and refreezes a V2 answer bundle', async () => {
    const exchange = exactExchange();
    expect(validStoredTarvisExchange(exchange)).toBe(true);

    await saveTarvisConversation([exchange]);
    const document = JSON.parse(persistence.value!);
    expect(document.schemaVersion).toBe(3);
    expect(document.exchanges[0].answerBundle.identity).toEqual(
      exchange.answerBundle?.identity,
    );

    const [restored] = await loadTarvisConversation();
    expect(restored?.answerBundle?.identity).toEqual(
      exchange.answerBundle?.identity,
    );
    expect(Object.isFrozen(restored?.answerBundle)).toBe(true);
    expect(Object.isFrozen(restored?.answerBundle?.scope.windows[0])).toBe(true);
  });

  it('persists recurring event context in V2 provenance without exposing it as calculation evidence', async () => {
    const exchange = recurringBoundaryEventExchange();
    const bundleWindow = exchange.answerBundle!.scope.windows[0]!;

    expect(exchange.answerBundle!.claims[0]?.value).toBe(1);
    expect(bundleWindow.calculationRecordIds).toEqual(['start-inside']);
    expect(bundleWindow.contextRecordIds).toEqual([
      'pre-boundary-normal',
      'post-boundary-high',
      'post-boundary-confirm',
    ]);
    expect(exchange.answerBundle!.records.map(({ id }) => id)).toEqual([
      'pre-boundary-normal',
      'start-inside',
      'post-boundary-high',
      'post-boundary-confirm',
    ]);
    expect(exchange.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      'start-inside',
    ]);
    expect(validStoredTarvisExchange(exchange)).toBe(true);

    await saveTarvisConversation([exchange]);
    expect(JSON.parse(persistence.value!).schemaVersion).toBe(3);
    const [restored] = await loadTarvisConversation();

    expect(restored?.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      'start-inside',
    ]);
    expect(restored?.answerBundle?.scope.windows[0]?.contextRecordIds).toEqual(
      bundleWindow.contextRecordIds,
    );
    expect(Object.isFrozen(restored?.answerBundle)).toBe(true);
    expect(Object.isFrozen(restored?.answerBundle?.records[0])).toBe(true);
  });

  it('keeps exact-range classification context out of All Records too', () => {
    const exchange = exactBoundaryEventExchange();
    expect(exchange.answerBundle!.scope.windows[0]?.contextRecordIds).toEqual([
      'exact-pre-boundary',
      'exact-post-confirm',
    ]);
    expect(exchange.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      'exact-start-inside',
      'exact-still-inside',
    ]);
    expect(validStoredTarvisExchange(exchange)).toBe(true);
  });

  it('rejects detached answer, chart and bundle links before replay', () => {
    const missingEvidence = clone(exactExchange());
    missingEvidence.answer.evidenceIds = ['missing'];
    expect(validStoredTarvisExchange(missingEvidence)).toBe(false);

    const detachedPoint = clone(exactExchange());
    const visualization = detachedPoint.evidence[0]!.visualization;
    if (!visualization || visualization.kind === 'recurring-clock-overlay-v1') {
      throw new Error('Expected an exact visualization.');
    }
    visualization.windows[0]!.points[0] = {
      ...visualization.windows[0]!.points[0]!,
      recordIds: ['not-evidence'],
      recordId: undefined,
    };
    expect(validStoredTarvisExchange(detachedPoint)).toBe(false);

    const forgedDisplayedValue = clone(exactExchange());
    const forgedVisualization = forgedDisplayedValue.evidence[0]!.visualization;
    if (
      !forgedVisualization ||
      forgedVisualization.kind === 'recurring-clock-overlay-v1'
    ) {
      throw new Error('Expected an exact visualization.');
    }
    forgedVisualization.windows[0]!.points[0]!.mmolL = 19;
    expect(validStoredTarvisExchange(forgedDisplayedValue)).toBe(false);

    const changedClaim = clone(exactExchange());
    (changedClaim.answerBundle!.claims[0] as { value: number }).value = 99;
    expect(validStoredTarvisExchange(changedClaim)).toBe(false);
  });

  it('loads a valid schema-v2 recurring chart without inventing a V2 bundle', async () => {
    const question =
      'What were my average readings over the last two nights between midnight and 7 a.m.?';
    const intent = ready(question);
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading('night-a', '2026-08-06T01:00:00+01:00', 6),
        reading('night-b', '2026-08-07T01:00:00+01:00', 8),
      ],
    });
    persistence.value = JSON.stringify({
      schemaVersion: 2,
      updatedAt: AS_OF,
      exchanges: [{
        id: 'legacy-recurring',
        question,
        answer: result.answer,
        evidence: [result.evidence],
        intent,
        presentation: result.presentation,
      }],
    });

    const restored = await loadTarvisConversation();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.answerBundle).toBeUndefined();
    expect(restored[0]?.evidence[0]?.visualization?.kind).toBe(
      'recurring-clock-overlay-v1',
    );
  });

  it('rejects impossible recurring payloads during legacy migration', async () => {
    const question =
      'What were my average readings over the last two nights between midnight and 7 a.m.?';
    const intent = ready(question);
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [reading('night-a', '2026-08-07T01:00:00+01:00', 6)],
    });
    const exchange: any = {
      id: 'bad-legacy',
      question,
      answer: result.answer,
      evidence: [result.evidence],
      intent,
      presentation: result.presentation,
    };
    const populatedWindow = exchange.evidence[0].visualization.windows.find(
      (window: { points: unknown[] }) => window.points.length > 0,
    );
    if (!populatedWindow) throw new Error('Expected a populated clock window.');
    populatedWindow.status = 'missing';
    persistence.value = JSON.stringify({
      schemaVersion: 2,
      updatedAt: AS_OF,
      exchanges: [exchange],
    });

    expect(await loadTarvisConversation()).toEqual([]);
  });

  it('keeps the newest contiguous exchanges under a deterministic byte budget', () => {
    const serialized = serializeTarvisConversation(
      Array.from({ length: 8 }, (_, index) => plainExchange(index)),
      AS_OF,
      1_450,
    );
    const document = JSON.parse(serialized);
    const ids = document.exchanges.map((exchange: StoredTarvisExchange) => exchange.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.at(-1)).toBe('plain-7');
    expect(ids).toEqual(
      Array.from(
        { length: ids.length },
        (_, index) => `plain-${8 - ids.length + index}`,
      ),
    );
  });

  it('fails explicitly when the newest complete exchange alone exceeds the budget', () => {
    expect(() =>
      serializeTarvisConversation([plainExchange(1)], AS_OF, 256),
    ).toThrow(TarvisConversationStorageLimitError);
  });
});
