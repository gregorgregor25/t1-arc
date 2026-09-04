import {
  GlucoseReading,
  MG_DL_PER_MMOL_L,
  TrendDirection,
} from '@/domain/models';

export interface XdripSgvResponse {
  sgv: number;
  direction?: string;
  date: number;
}

const DIRECTION_MAP: Record<string, TrendDirection> = {
  DoubleDown: 'doubleDown',
  SingleDown: 'down',
  FortyFiveDown: 'slightDown',
  Flat: 'flat',
  FortyFiveUp: 'slightUp',
  SingleUp: 'up',
  DoubleUp: 'doubleUp',
  NONE: 'unknown',
  NOT_COMPUTABLE: 'unknown',
  'RATE OUT OF RANGE': 'unknown',
};

export function mapXdripDirection(direction?: string): TrendDirection {
  if (!direction) return 'unknown';
  return DIRECTION_MAP[direction] ?? 'unknown';
}

export function normalizeXdripReading(
  payload: XdripSgvResponse,
  sourceId = 'gdh-xdrip',
  receivedAt = Date.now(),
): GlucoseReading {
  if (!Number.isFinite(payload.sgv) || payload.sgv <= 0) {
    throw new Error('xDrip reading must contain a positive numeric sgv value.');
  }
  if (!Number.isFinite(payload.date) || payload.date <= 0) {
    throw new Error('xDrip reading must contain a millisecond date timestamp.');
  }

  return {
    id: `${sourceId}:${payload.date}:${payload.sgv}`,
    timestamp: payload.date,
    receivedAt,
    mmolL: Math.round((payload.sgv / MG_DL_PER_MMOL_L) * 10) / 10,
    trend: mapXdripDirection(payload.direction),
    quality: 'measured',
    sourceId,
  };
}
