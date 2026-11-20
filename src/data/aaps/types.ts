import type { GlucoseReading, TrendDirection } from '@/domain/models';

export const AAPS_LOCAL_SOURCE_ID = 'aaps-local';
export const AAPS_HISTORICAL_SOURCE_ID = 'aaps-history';
export const AAPS_RESTORED_SOURCE_ID = 'aaps-restored';
export const AAPS_NO_SOURCE_ID = 'none';

export interface AapsLocalReading {
  id: string;
  receivedAt: number;
  writeEpoch: number;
  selectionGeneration: number;
  glucoseMgdl?: number;
  glucoseTimestamp?: number;
  trend?: string;
  rawTrend?: string;
  deltaMgdl?: number;
  avgDeltaMgdl?: number;
  iobUnits?: number;
  bolusIobUnits?: number;
  basalIobUnits?: number;
  cobGrams?: number;
  futureCarbsGrams?: number;
  displayUnits?: string;
}

export interface AapsLocalStatus {
  supported: boolean;
  selectedSourceId?: string;
  selectionGeneration: number;
  writeEpoch: number;
  lastReceivedAt?: number;
  latestGlucoseTimestamp?: number;
  latest?: AapsLocalReading;
  bufferedCount: number;
  droppedCount?: number;
}

export interface AapsContextObservation extends AapsLocalReading {
  trend?: TrendDirection;
  /** AAPS-calculated estimates captured at receivedAt, not delivery records. */
  reconciliationScope: 'local' | 'restored';
}

export interface ParsedAapsObservation {
  context: AapsContextObservation;
  glucose?: GlucoseReading;
}
