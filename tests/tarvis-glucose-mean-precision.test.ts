import { describe, expect, it, vi } from 'vitest';
import { serializeTarvisConversation } from '@/data/tarvis/conversationStore';
import { buildLocalGlucoseAnswer } from '@/data/tarvis/localGlucoseAnswer';
import { buildLocalGlucoseRangeAnswer } from '@/data/tarvis/localGlucoseRangeAnswer';
import { createGlucoseAnswerBundleV2, parseGlucoseAnswerBundleV2, isGlucoseAnswerBundleV2 } from '@/data/tarvis/glucoseAnswerBundleV2';
import { isReadyTarvisIntent, resolveTarvisIntent } from '@/data/tarvis/intent';
import { calculateGlucoseStats } from '@/domain/stats';
import { formatGlucose } from '@/domain/regionalFormat';
import type { GlucoseReading } from '@/domain/models';

vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-secure-store', () => ({}));

const now = Date.parse('2026-09-07T12:00:00+01:00');
const makeReading = (mmolL: number, index: number): GlucoseReading => ({
  id: `precision-${index}`, timestamp: now - 86_400_000 + index * 300_000,
  receivedAt: now, mmolL, sourceId: 'synthetic', trend: 'flat', quality: 'measured',
});
function intent(question: string) {
  const resolved = resolveTarvisIntent(question, { now, timezone: 'Europe/London' });
  if (!isReadyTarvisIntent(resolved)) throw new Error('Question must resolve');
  return resolved.intent;
}

describe('average glucose rounds only at regional display', () => {
  it.each([
    { values: [6.6, 6.697], mean: 6.6485, glucoseUnit: 'mmolL' as const, display: '6.6 mmol/L' },
    { values: [6.66, 6.66], mean: 6.66, glucoseUnit: 'mgDl' as const, display: '120 mg/dL' },
  ])('keeps History and both Tarv1s executors aligned for $display', ({ values, mean, glucoseUnit, display }) => {
    const readings = values.map(makeReading);
    const exact = buildLocalGlucoseRangeAnswer({ asOf: now, intent: intent('What was my average glucose yesterday?'), readings });
    const clock = buildLocalGlucoseAnswer({ asOf: now, intent: intent('What was my average glucose over the last one day between midnight and 7 p.m.?'), readings });
    const range = exact.answerBundle.scope.calculationRange;
    const history = calculateGlucoseStats(readings, range);
    const regional = { locale: 'en-GB', glucoseUnit };
    expect(history.averageMmolL).toBe(mean);
    for (const result of [exact, clock]) {
      expect(result.answerBundle.claims[0]?.value).toBe(mean);
      expect(isGlucoseAnswerBundleV2(result.answerBundle)).toBe(true);
      expect(formatGlucose(result.answerBundle.claims[0]!.value!, regional)).toBe(display);
      expect(() => serializeTarvisConversation([{
        id: 'precision-roundtrip', question: result.answerBundle.intent.original.question,
        answer: result.answer, evidence: Array.isArray(result.evidence) ? result.evidence : [result.evidence], intent: result.answerBundle.intent.original,
        presentation: result.presentation, answerBundle: result.answerBundle,
      }], now)).not.toThrow();
    }
    expect(formatGlucose(history.averageMmolL!, regional)).toBe(display);
  });

  it('still validates and preserves a saved two-decimal bundle without rewriting it', () => {
    const readings = [6.6, 6.697].map(makeReading);
    const { answerBundle: current } = buildLocalGlucoseRangeAnswer({
      asOf: now, intent: intent('What was my average glucose yesterday?'), readings,
    });
    const legacy = createGlucoseAnswerBundleV2({
      executor: current.executor, originalIntent: current.intent.original,
      normalizedThresholds: current.thresholds, timezone: current.scope.timezone, asOf: now,
      windows: current.scope.windows.map((window) => ({ ...window, calculationReadings: readings })),
      algorithms: { ...current.algorithms, metricVersions: current.algorithms.metricVersions.map((entry) => ({ ...entry, version: entry.version.replace('rounded-4dp', 'rounded-2dp') })) },
      claims: current.claims.map((claim) => ({ ...claim, value: 6.65 })),
      charts: current.charts,
    });
    expect(isGlucoseAnswerBundleV2(legacy)).toBe(true);
    expect(parseGlucoseAnswerBundleV2(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    expect(legacy.claims[0]?.value).toBe(6.65);
    expect(isGlucoseAnswerBundleV2({ ...current, claims: legacy.claims })).toBe(false);
  });
});
