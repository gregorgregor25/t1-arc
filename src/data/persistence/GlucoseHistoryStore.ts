import { GlucoseReading, TimeRange } from '@/domain/models';
import { glucoseReadingIdentityKey } from './glucoseReadingIdentitySchema';

export interface SourceSyncState {
  sourceId: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  recordCount: number;
}

export const SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS = 60_000;

export function sourceSyncAttemptDue(
  lastAttemptAt: number | undefined,
  attemptAt: number,
  minimumIntervalMs: number,
) {
  if (lastAttemptAt === undefined) return true;
  const elapsed = attemptAt - lastAttemptAt;
  if (elapsed >= 0) return elapsed >= minimumIntervalMs;
  // A slightly newer timestamp belongs to a concurrent claimant. A timestamp
  // implausibly far in the future instead means the wall clock moved backwards;
  // recover rather than suppressing automatic refresh indefinitely.
  return -elapsed > SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS;
}

export function sourceSyncStateMatches(
  current: SourceSyncState | undefined,
  observed: SourceSyncState | null,
) {
  if (!current || !observed) return current === undefined && observed === null;
  return (
    current.lastAttemptAt === observed.lastAttemptAt &&
    current.lastSuccessAt === observed.lastSuccessAt &&
    current.lastErrorCode === observed.lastErrorCode &&
    current.recordCount === observed.recordCount
  );
}

export interface GlucoseHistoryBounds {
  earliest?: number;
  latest?: number;
  count: number;
}

export interface GlucoseHistoryStore {
  initialize(): Promise<void>;
  upsertReadings(readings: GlucoseReading[]): Promise<void>;
  commitVerifiedSnapshot?(
    sourceId: string,
    readings: GlucoseReading[],
    activatedAt: number,
  ): Promise<GlucoseHistoryBounds>;
  getReadings(
    range: TimeRange,
    sourceId?: string,
  ): Promise<GlucoseReading[]>;
  getLatestReading(sourceId?: string): Promise<GlucoseReading | undefined>;
  getBounds(sourceId?: string): Promise<GlucoseHistoryBounds>;
  getSyncState(sourceId: string): Promise<SourceSyncState | undefined>;
  saveSyncState(state: SourceSyncState): Promise<void>;
  claimSyncAttempt(
    sourceId: string,
    attemptAt: number,
    minimumIntervalMs: number,
    observedState: SourceSyncState | null,
  ): Promise<boolean>;
  completeSyncAttempt(
    state: SourceSyncState,
    attemptAt: number,
  ): Promise<boolean>;
  /**
   * Deletes only source readings outside the inclusive timestamp bounds.
   * Source sync metadata is intentionally left unchanged.
   */
  pruneReadingsOutsideRange(
    sourceId: string,
    minimumTimestamp: number,
    maximumTimestamp: number,
  ): Promise<number>;
  clearSource(sourceId: string): Promise<void>;
}

export class MemoryGlucoseHistoryStore implements GlucoseHistoryStore {
  private readonly readings = new Map<string, GlucoseReading>();
  private readonly syncStates = new Map<string, SourceSyncState>();

  async initialize() {}

  async upsertReadings(readings: GlucoseReading[]) {
    readings.forEach((reading) => {
      const key = glucoseReadingIdentityKey(
        reading.sourceId,
        reading.timestamp,
        reading.sourceDeviceId,
      );
      const existing = this.readings.get(key);
      this.readings.set(key, {
        ...reading,
        receivedAt: existing
          ? Math.min(existing.receivedAt, reading.receivedAt)
          : reading.receivedAt,
      });
    });
  }

  async getReadings(range: TimeRange, sourceId?: string) {
    return [...this.readings.values()]
      .filter(
        (reading) =>
          reading.timestamp >= range.start &&
          reading.timestamp < range.end &&
          (!sourceId || reading.sourceId === sourceId),
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async getLatestReading(sourceId?: string) {
    return [...this.readings.values()]
      .filter((reading) => !sourceId || reading.sourceId === sourceId)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  async getBounds(sourceId?: string) {
    const readings = [...this.readings.values()].filter(
      (reading) => !sourceId || reading.sourceId === sourceId,
    );
    if (readings.length === 0) return { count: 0 };
    const timestamps = readings.map((reading) => reading.timestamp);
    return {
      earliest: Math.min(...timestamps),
      latest: Math.max(...timestamps),
      count: readings.length,
    };
  }

  async getSyncState(sourceId: string) {
    const state = this.syncStates.get(sourceId);
    return state ? { ...state } : undefined;
  }

  async saveSyncState(state: SourceSyncState) {
    this.syncStates.set(state.sourceId, { ...state });
  }

  async claimSyncAttempt(
    sourceId: string,
    attemptAt: number,
    minimumIntervalMs: number,
    observedState: SourceSyncState | null,
  ) {
    const current = this.syncStates.get(sourceId);
    if (
      !sourceSyncStateMatches(current, observedState) ||
      !sourceSyncAttemptDue(
        current?.lastAttemptAt,
        attemptAt,
        minimumIntervalMs,
      )
    ) {
      return false;
    }
    this.syncStates.set(sourceId, {
      sourceId,
      lastAttemptAt: attemptAt,
      lastSuccessAt: current?.lastSuccessAt,
      lastErrorCode: current?.lastErrorCode,
      lastErrorMessage: current?.lastErrorMessage,
      recordCount: current?.recordCount ?? 0,
    });
    return true;
  }

  async completeSyncAttempt(state: SourceSyncState, attemptAt: number) {
    const current = this.syncStates.get(state.sourceId);
    if (current?.lastAttemptAt !== attemptAt) return false;
    this.syncStates.set(state.sourceId, {
      ...state,
      lastAttemptAt: attemptAt,
      lastSuccessAt: Math.max(
        current.lastSuccessAt ?? 0,
        state.lastSuccessAt ?? 0,
      ) || undefined,
    });
    return true;
  }

  async pruneReadingsOutsideRange(
    sourceId: string,
    minimumTimestamp: number,
    maximumTimestamp: number,
  ) {
    if (
      !Number.isFinite(minimumTimestamp) ||
      !Number.isFinite(maximumTimestamp) ||
      minimumTimestamp > maximumTimestamp
    ) {
      throw new Error('Glucose history prune range is invalid.');
    }
    let removed = 0;
    for (const [key, reading] of this.readings.entries()) {
      if (
        reading.sourceId === sourceId &&
        (reading.timestamp < minimumTimestamp ||
          reading.timestamp > maximumTimestamp)
      ) {
        this.readings.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async clearSource(sourceId: string) {
    for (const [key, reading] of this.readings.entries()) {
      if (reading.sourceId === sourceId) this.readings.delete(key);
    }
    this.syncStates.delete(sourceId);
  }
}
