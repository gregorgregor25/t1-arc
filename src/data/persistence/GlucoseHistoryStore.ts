import { GlucoseReading, TimeRange } from '@/domain/models';

export interface SourceSyncState {
  sourceId: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  recordCount: number;
}

export interface GlucoseHistoryBounds {
  earliest?: number;
  latest?: number;
  count: number;
}

export interface GlucoseHistoryStore {
  initialize(): Promise<void>;
  upsertReadings(readings: GlucoseReading[]): Promise<void>;
  getReadings(
    range: TimeRange,
    sourceId?: string,
  ): Promise<GlucoseReading[]>;
  getLatestReading(sourceId?: string): Promise<GlucoseReading | undefined>;
  getBounds(sourceId?: string): Promise<GlucoseHistoryBounds>;
  getSyncState(sourceId: string): Promise<SourceSyncState | undefined>;
  saveSyncState(state: SourceSyncState): Promise<void>;
  clearSource(sourceId: string): Promise<void>;
}

export class MemoryGlucoseHistoryStore implements GlucoseHistoryStore {
  private readonly readings = new Map<string, GlucoseReading>();
  private readonly syncStates = new Map<string, SourceSyncState>();

  async initialize() {}

  async upsertReadings(readings: GlucoseReading[]) {
    readings.forEach((reading) => {
      const key = `${reading.sourceId}:${reading.timestamp}`;
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

  async clearSource(sourceId: string) {
    for (const [key, reading] of this.readings.entries()) {
      if (reading.sourceId === sourceId) this.readings.delete(key);
    }
    this.syncStates.delete(sourceId);
  }
}
