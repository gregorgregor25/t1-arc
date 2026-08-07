import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { EvidenceReference } from '@/domain/insights';
import {
  isTarvisIntentV1,
  TarvisIntentV1,
} from '@/data/tarvis/intent';

import {
  isTarvisEvidencePresentation,
  TarvisEvidencePresentation,
} from './evidencePresentation';
import { TarvisAnswer, TarvisRequestMetrics } from './types';

const STORAGE_KEY = 'tarvis-conversation-v1';
const MAX_STORED_EXCHANGES = 30;

export interface StoredTarvisExchange {
  id: string;
  question: string;
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  clarificationQuestion?: string;
  intent?: TarvisIntentV1;
  presentation?: TarvisEvidencePresentation;
  requestMetrics?: TarvisRequestMetrics;
}

interface StoredTarvisConversation {
  schemaVersion: 1 | 2;
  updatedAt: number;
  exchanges: StoredTarvisExchange[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validAnswer(value: unknown): value is TarvisAnswer {
  if (!isRecord(value)) return false;
  return (
    typeof value.headline === 'string' &&
    typeof value.answer === 'string' &&
    (value.confidence === 'high' ||
      value.confidence === 'moderate' ||
      value.confidence === 'limited') &&
    isStringArray(value.evidenceIds) &&
    isStringArray(value.limitations)
  );
}

function validPoint(value: unknown, aggregate = false) {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.minute) &&
    isFiniteNumber(value.mmolL) &&
    (!aggregate || isFiniteNumber(value.contributingWindowCount)) &&
    (value.recordIds === undefined || isStringArray(value.recordIds))
  );
}

function validClockVisualization(value: unknown) {
  if (!isRecord(value) || value.kind !== 'recurring-clock-overlay-v1') {
    return false;
  }
  if (
    value.timezone !== 'Europe/London' ||
    typeof value.title !== 'string' ||
    typeof value.subtitle !== 'string' ||
    typeof value.coverageSummary !== 'string' ||
    typeof value.units !== 'string' ||
    !isFiniteNumber(value.minimumAggregateContributors) ||
    !isStringArray(value.missingOccurrenceLabels) ||
    !isRecord(value.domain) ||
    !isFiniteNumber(value.domain.startMinute) ||
    !isFiniteNumber(value.domain.endMinuteUnwrapped) ||
    !Array.isArray(value.aggregatePoints) ||
    !value.aggregatePoints.every((point) => validPoint(point, true)) ||
    !Array.isArray(value.windows)
  ) {
    return false;
  }
  if (
    value.targetRange !== undefined &&
    (!isRecord(value.targetRange) ||
      !isFiniteNumber(value.targetRange.minimum) ||
      !isFiniteNumber(value.targetRange.maximum))
  ) {
    return false;
  }
  return value.windows.every((window) => {
    if (
      !isRecord(window) ||
      typeof window.id !== 'string' ||
      typeof window.label !== 'string' ||
      (window.status !== 'complete' &&
        window.status !== 'partial' &&
        window.status !== 'missing') ||
      !Array.isArray(window.points) ||
      !window.points.every((point) => validPoint(point)) ||
      !Array.isArray(window.segments) ||
      !Array.isArray(window.clockTransitions)
    ) {
      return false;
    }
    return (
      window.segments.every(
        (segment) =>
          isRecord(segment) &&
          Array.isArray(segment.points) &&
          segment.points.every((point) => validPoint(point)) &&
          isRecord(segment.startsAfter) &&
          typeof segment.startsAfter.sensorGap === 'boolean' &&
          (segment.startsAfter.clockTransition === null ||
            segment.startsAfter.clockTransition === 'gap' ||
            segment.startsAfter.clockTransition === 'fold'),
      ) &&
      window.clockTransitions.every(
        (transition) =>
          isRecord(transition) &&
          (transition.kind === 'gap' || transition.kind === 'fold') &&
          isFiniteNumber(transition.atTimestamp) &&
          isFiniteNumber(transition.utcOffsetBeforeMinutes) &&
          isFiniteNumber(transition.utcOffsetAfterMinutes) &&
          isFiniteNumber(transition.changeMinutes) &&
          isFiniteNumber(transition.affectedStartMinute) &&
          isFiniteNumber(transition.affectedEndMinute),
      )
    );
  });
}

function validCalculation(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    value.kind === 'tarvis-local-glucose-v1' &&
    typeof value.queryId === 'string' &&
    typeof value.algorithmVersion === 'string' &&
    Array.isArray(value.metrics) &&
    value.metrics.every(
      (metric) =>
        isRecord(metric) &&
        typeof metric.id === 'string' &&
        (metric.value === null || isFiniteNumber(metric.value)) &&
        typeof metric.unit === 'string',
    ) &&
    Array.isArray(value.thresholds) &&
    value.thresholds.every(
      (threshold) =>
        isRecord(threshold) &&
        typeof threshold.operator === 'string' &&
        typeof threshold.role === 'string' &&
        threshold.unit === 'mmol/L' &&
        isFiniteNumber(threshold.value),
    ) &&
    isFiniteNumber(value.requestedWindowCount) &&
    isFiniteNumber(value.windowsWithData) &&
    isFiniteNumber(value.coveragePercent)
  );
}

function validEvidenceReference(value: unknown): value is EvidenceReference {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.description !== 'string' ||
    !isRecord(value.range) ||
    !isFiniteNumber(value.range.start) ||
    !isFiniteNumber(value.range.end) ||
    value.range.end <= value.range.start ||
    !isStringArray(value.recordIds) ||
    !Array.isArray(value.examples) ||
    !value.examples.every(
      (example) =>
        isRecord(example) &&
        typeof example.id === 'string' &&
        typeof example.kind === 'string' &&
        isFiniteNumber(example.timestamp) &&
        typeof example.primary === 'string' &&
        typeof example.secondary === 'string' &&
        typeof example.sourceId === 'string',
    )
  ) {
    return false;
  }
  return (
    (value.calculation === undefined || validCalculation(value.calculation)) &&
    (value.visualization === undefined ||
      validClockVisualization(value.visualization))
  );
}

function validRequestMetrics(value: unknown): value is TarvisRequestMetrics {
  if (!isRecord(value)) return false;
  return (
    typeof value.model === 'string' &&
    isFiniteNumber(value.inputTokens) &&
    isFiniteNumber(value.outputTokens) &&
    isFiniteNumber(value.totalTokens) &&
    isFiniteNumber(value.estimatedCostUsd) &&
    isFiniteNumber(value.evidenceCharacters)
  );
}

export function validStoredTarvisExchange(
  value: unknown,
): value is StoredTarvisExchange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const exchange = value as Partial<StoredTarvisExchange>;
  return (
    typeof exchange.id === 'string' &&
    typeof exchange.question === 'string' &&
    validAnswer(exchange.answer) &&
    Array.isArray(exchange.evidence) &&
    exchange.evidence.every(validEvidenceReference) &&
    (exchange.clarificationQuestion === undefined ||
      typeof exchange.clarificationQuestion === 'string') &&
    (exchange.intent === undefined || isTarvisIntentV1(exchange.intent)) &&
    (exchange.presentation === undefined ||
      isTarvisEvidencePresentation(exchange.presentation)) &&
    (exchange.requestMetrics === undefined ||
      validRequestMetrics(exchange.requestMetrics))
  );
}

export async function loadTarvisConversation() {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    STORAGE_KEY,
  );
  if (!row?.value) return [];
  try {
    const stored = JSON.parse(row.value) as Partial<StoredTarvisConversation>;
    if (
      (stored.schemaVersion !== 1 && stored.schemaVersion !== 2) ||
      !Array.isArray(stored.exchanges)
    ) {
      return [];
    }
    return stored.exchanges
      .filter(validStoredTarvisExchange)
      .map((exchange) => ({
        ...exchange,
        intent: isTarvisIntentV1(exchange.intent)
          ? exchange.intent
          : undefined,
        presentation: isTarvisEvidencePresentation(exchange.presentation)
          ? exchange.presentation
          : undefined,
      }))
      .slice(-MAX_STORED_EXCHANGES);
  } catch {
    return [];
  }
}

export async function saveTarvisConversation(
  exchanges: StoredTarvisExchange[],
) {
  const document: StoredTarvisConversation = {
    schemaVersion: 2,
    updatedAt: Date.now(),
    exchanges: exchanges.slice(-MAX_STORED_EXCHANGES),
  };
  await openDaymarkDatabase();
  await withDaymarkTransaction(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      STORAGE_KEY,
      JSON.stringify(document),
    );
  });
}

export async function clearTarvisConversation() {
  await openDaymarkDatabase();
  await withDaymarkTransaction(async (transaction) => {
    await transaction.runAsync(
      'DELETE FROM app_metadata WHERE key = ?',
      STORAGE_KEY,
    );
  });
}
