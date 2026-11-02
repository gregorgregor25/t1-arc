import { MG_DL_PER_MMOL_L, type GlucoseReading, type TrendDirection } from '@/domain/models';
import { AAPS_LOCAL_SOURCE_ID, type AapsLocalReading, type ParsedAapsObservation } from './types';

const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_SKEW_MS = 2 * 60_000;
const DIRECTIONS = new Set<TrendDirection>([
  'tripleDown',
  'doubleDown', 'down', 'slightDown', 'flat', 'slightUp',
  'up', 'doubleUp', 'tripleUp', 'unknown',
]);

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timestamp(value: unknown, now: number): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= MIN_TIMESTAMP_MS &&
    (value as number) <= now + MAX_FUTURE_SKEW_MS;
}

function optionalFinite(value: unknown): number | undefined {
  return finiteNumber(value) ? value : undefined;
}

function bounded(value: unknown, minimum: number, maximum: number) {
  return finiteNumber(value) && value >= minimum && value <= maximum
    ? value : undefined;
}

/** Keep the source mg/dL and full-precision conversion; only UI formats it. */
export function normalizeAapsReading(
  raw: AapsLocalReading,
  now = Date.now(),
): ParsedAapsObservation | undefined {
  if (
    typeof raw.id !== 'string' || !raw.id || raw.id.length > 200 ||
    !timestamp(raw.receivedAt, now) ||
    !Number.isSafeInteger(raw.writeEpoch) || raw.writeEpoch < 0 ||
    !Number.isSafeInteger(raw.selectionGeneration) || raw.selectionGeneration < 0
  ) return undefined;

  const glucoseTimestamp = timestamp(raw.glucoseTimestamp, raw.receivedAt)
    ? raw.glucoseTimestamp
    : undefined;
  const glucoseMgdl = bounded(raw.glucoseMgdl,
    0.5 * MG_DL_PER_MMOL_L, 40 * MG_DL_PER_MMOL_L);
  const trend: TrendDirection | undefined = DIRECTIONS.has(raw.trend as TrendDirection)
    ? raw.trend as TrendDirection
    : undefined;
  const context = {
    id: raw.id,
    receivedAt: raw.receivedAt,
    writeEpoch: raw.writeEpoch,
    selectionGeneration: raw.selectionGeneration,
    glucoseTimestamp,
    glucoseMgdl,
    trend,
    rawTrend: typeof raw.rawTrend === 'string' && raw.rawTrend.length <= 64
      ? raw.rawTrend : undefined,
    deltaMgdl: optionalFinite(raw.deltaMgdl),
    avgDeltaMgdl: optionalFinite(raw.avgDeltaMgdl),
    iobUnits: bounded(raw.iobUnits, -100, 100),
    bolusIobUnits: bounded(raw.bolusIobUnits, -100, 100),
    basalIobUnits: bounded(raw.basalIobUnits, -100, 100),
    cobGrams: bounded(raw.cobGrams, 0, 1_000),
    futureCarbsGrams: bounded(raw.futureCarbsGrams, 0, 1_000),
    displayUnits: typeof raw.displayUnits === 'string' &&
      raw.displayUnits.length <= 24
      ? raw.displayUnits
      : undefined,
    reconciliationScope: 'local' as const,
  };
  const glucose: GlucoseReading | undefined =
    glucoseTimestamp !== undefined && glucoseMgdl !== undefined
      ? {
          id: `${AAPS_LOCAL_SOURCE_ID}:${glucoseTimestamp}`,
          sourceId: AAPS_LOCAL_SOURCE_ID,
          timestamp: glucoseTimestamp,
          receivedAt: raw.receivedAt,
          mmolL: glucoseMgdl / MG_DL_PER_MMOL_L,
          trend: trend ?? 'unknown',
          quality: 'measured',
        }
      : undefined;
  return { context, glucose };
}
