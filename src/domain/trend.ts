import { GlucoseReading, TrendDirection } from './models';

export interface TrendPresentation {
  arrow: string;
  label: string;
}

const TREND_PRESENTATION: Record<TrendDirection, TrendPresentation> = {
  doubleDown: { arrow: '⇊', label: 'falling quickly' },
  down: { arrow: '↓', label: 'falling' },
  slightDown: { arrow: '↘', label: 'gently falling' },
  flat: { arrow: '→', label: 'steady' },
  slightUp: { arrow: '↗', label: 'gently rising' },
  up: { arrow: '↑', label: 'rising' },
  doubleUp: { arrow: '⇈', label: 'rising quickly' },
  unknown: { arrow: '—', label: 'trend unavailable' },
};

export function presentTrend(trend: TrendDirection) {
  return TREND_PRESENTATION[trend];
}

export function trendFromDelta(deltaMmolLPerFiveMinutes: number): TrendDirection {
  if (deltaMmolLPerFiveMinutes >= 0.55) return 'doubleUp';
  if (deltaMmolLPerFiveMinutes >= 0.3) return 'up';
  if (deltaMmolLPerFiveMinutes >= 0.1) return 'slightUp';
  if (deltaMmolLPerFiveMinutes <= -0.55) return 'doubleDown';
  if (deltaMmolLPerFiveMinutes <= -0.3) return 'down';
  if (deltaMmolLPerFiveMinutes <= -0.1) return 'slightDown';
  return 'flat';
}

export type TrendOrigin = 'source' | 'calculated' | 'unavailable';

export interface GlucoseTrendAssessment {
  direction: TrendDirection;
  origin: TrendOrigin;
  rateMmolLPerFiveMinutes?: number;
  windowMinutes?: number;
  supportingReadings: GlucoseReading[];
  reason?: string;
}

/**
 * Uses a small, recent, single-source window only when the source itself did
 * not provide a direction. The result is presentation metadata; the original
 * readings remain untouched and are the inspectable evidence.
 */
export function assessGlucoseTrend(
  current: GlucoseReading | undefined,
  history: GlucoseReading[],
): GlucoseTrendAssessment {
  if (!current) {
    return {
      direction: 'unknown',
      origin: 'unavailable',
      supportingReadings: [],
      reason: 'There is no current glucose reading.',
    };
  }
  if (current.trend !== 'unknown') {
    return {
      direction: current.trend,
      origin: 'source',
      supportingReadings: [current],
    };
  }

  const minimumTimestamp = current.timestamp - TREND_WINDOW_MS;
  const byTimestamp = new Map<number, GlucoseReading>();
  for (const reading of [...history, current]) {
    if (
      reading.sourceId !== current.sourceId ||
      reading.timestamp < minimumTimestamp ||
      reading.timestamp > current.timestamp ||
      !Number.isFinite(reading.mmolL) ||
      reading.mmolL < 0.5 ||
      reading.mmolL > 40
    ) {
      continue;
    }
    const existing = byTimestamp.get(reading.timestamp);
    if (!existing || reading.receivedAt >= existing.receivedAt) {
      byTimestamp.set(reading.timestamp, reading);
    }
  }
  const available = [...byTimestamp.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  if (available.length < MIN_TREND_READINGS) {
    return unavailable(
      current,
      available,
      'At least three recent readings from the same source are required.',
    );
  }

  const readings = sampleTrendReadings(available, MAX_TREND_READINGS);
  const windowMinutes =
    (readings.at(-1)!.timestamp - readings[0]!.timestamp) / 60_000;
  if (windowMinutes < MIN_TREND_WINDOW_MINUTES) {
    return unavailable(
      current,
      readings,
      'The supporting readings do not yet cover eight minutes.',
    );
  }
  for (let index = 1; index < readings.length; index += 1) {
    const gapMinutes =
      (readings[index]!.timestamp - readings[index - 1]!.timestamp) / 60_000;
    if (gapMinutes > MAX_SUPPORTING_GAP_MINUTES) {
      return unavailable(
        current,
        readings,
        'The recent reading window contains a gap that is too large.',
      );
    }
  }

  const firstTimestamp = readings[0]!.timestamp;
  const points = readings.map((reading) => ({
    x: (reading.timestamp - firstTimestamp) / 60_000,
    y: reading.mmolL,
  }));
  const meanX =
    points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY =
    points.reduce((total, point) => total + point.y, 0) / points.length;
  const denominator = points.reduce(
    (total, point) => total + (point.x - meanX) ** 2,
    0,
  );
  if (denominator <= 0) {
    return unavailable(
      current,
      readings,
      'The supporting readings do not have distinct timestamps.',
    );
  }
  const slopePerMinute =
    points.reduce(
      (total, point) =>
        total + (point.x - meanX) * (point.y - meanY),
      0,
    ) / denominator;
  const residualSum = points.reduce((total, point) => {
    const predicted = meanY + slopePerMinute * (point.x - meanX);
    return total + (point.y - predicted) ** 2;
  }, 0);
  const totalSum = points.reduce(
    (total, point) => total + (point.y - meanY) ** 2,
    0,
  );
  const fit = totalSum <= 0.0001 ? 1 : Math.max(0, 1 - residualSum / totalSum);
  const rate = slopePerMinute * 5;
  const direction = trendFromDelta(rate);
  const observedRange =
    Math.max(...points.map((point) => point.y)) -
    Math.min(...points.map((point) => point.y));
  if (
    (direction === 'flat' && observedRange > MAX_FLAT_RANGE_MMOL_L) ||
    (direction !== 'flat' && fit < MIN_DIRECTIONAL_FIT)
  ) {
    return unavailable(
      current,
      readings,
      'Recent readings do not support one clear direction.',
    );
  }

  return {
    direction,
    origin: 'calculated',
    rateMmolLPerFiveMinutes: Math.round(rate * 100) / 100,
    windowMinutes: Math.round(windowMinutes),
    supportingReadings: readings,
  };
}

function unavailable(
  current: GlucoseReading,
  supportingReadings: GlucoseReading[],
  reason: string,
): GlucoseTrendAssessment {
  return {
    direction: 'unknown',
    origin: 'unavailable',
    supportingReadings:
      supportingReadings.length > 0 ? supportingReadings : [current],
    reason,
  };
}

function sampleTrendReadings(
  readings: GlucoseReading[],
  limit: number,
) {
  if (readings.length <= limit) return readings;
  const sampled: GlucoseReading[] = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(
      readings[
        Math.round((index * (readings.length - 1)) / (limit - 1))
      ]!,
    );
  }
  return sampled;
}

const TREND_WINDOW_MS = 20 * 60_000;
const MIN_TREND_READINGS = 3;
const MAX_TREND_READINGS = 6;
const MIN_TREND_WINDOW_MINUTES = 8;
const MAX_SUPPORTING_GAP_MINUTES = 8;
const MIN_DIRECTIONAL_FIT = 0.45;
const MAX_FLAT_RANGE_MMOL_L = 0.8;
