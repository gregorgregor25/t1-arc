import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));

import { validStoredTarvisExchange } from '@/data/tarvis/conversationStore';

function validExchange() {
  return {
    id: 'exchange-1',
    question: 'What was my average glucose today?',
    answer: {
      headline: 'Observed average glucose',
      answer: 'The observed average was 7.0 mmol/L.',
      confidence: 'limited',
      evidenceIds: ['evidence-1'],
      limitations: ['Coverage was limited.'],
    },
    evidence: [
      {
        id: 'evidence-1',
        label: 'Requested period exact glucose inputs',
        description: 'One exact record.',
        range: { start: 1, end: 2 },
        recordIds: ['reading-1'],
        examples: [
          {
            id: 'reading-1',
            kind: 'glucose',
            timestamp: 1,
            primary: '7.0 mmol/L',
            secondary: 'measured',
            sourceId: 'test',
          },
        ],
      },
    ],
  };
}

describe('stored Tarv1s conversation validation', () => {
  it('accepts a complete backward-compatible exchange', () => {
    expect(validStoredTarvisExchange(validExchange())).toBe(true);
  });

  it('rejects malformed answers that would crash rendering', () => {
    const exchange = validExchange();
    exchange.answer.evidenceIds = undefined as unknown as string[];
    expect(validStoredTarvisExchange(exchange)).toBe(false);
  });

  it('rejects malformed evidence ranges and examples', () => {
    const exchange = validExchange();
    exchange.evidence[0]!.range.end = 0;
    expect(validStoredTarvisExchange(exchange)).toBe(false);

    const other = validExchange();
    other.evidence[0]!.examples[0]!.timestamp = Number.NaN;
    expect(validStoredTarvisExchange(other)).toBe(false);
  });

  it('rejects incomplete persisted chart payloads before replay', () => {
    const exchange = validExchange() as ReturnType<typeof validExchange> & {
      evidence: Array<ReturnType<typeof validExchange>['evidence'][number] & {
        visualization?: unknown;
      }>;
    };
    exchange.evidence[0]!.visualization = {
      kind: 'recurring-clock-overlay-v1',
      title: 'Missing required chart fields',
    };
    expect(validStoredTarvisExchange(exchange)).toBe(false);
  });

  it('accepts a complete finite exact-range chart payload', () => {
    const exchange = validExchange() as ReturnType<typeof validExchange> & {
      evidence: Array<ReturnType<typeof validExchange>['evidence'][number] & {
        visualization?: unknown;
      }>;
    };
    exchange.evidence[0]!.visualization = {
      gapThresholdMilliseconds: 12 * 60_000,
      kind: 'range-trace-v1',
      metric: 'glucose.mean',
      schemaVersion: 1,
      subtitle: 'All exact readings',
      targetRange: { maximum: 10, minimum: 3.9 },
      timezone: 'Europe/London',
      title: 'Exact glucose trace',
      units: 'mmol/L',
      valueDomain: { maximum: 20, minimum: 0 },
      windows: [
        {
          coveragePercent: 100,
          coverageStatus: 'sufficient',
          distribution: null,
          events: [],
          id: 'requested',
          label: 'Requested period',
          meanMmolL: 7,
          points: [{ mmolL: 7, recordId: 'reading-1', timestamp: 1 }],
          range: { start: 1, end: 2 },
          recordCount: 1,
        },
      ],
    };
    expect(validStoredTarvisExchange(exchange)).toBe(true);
  });
});
