import type { GlucoseSource } from '@/data/contracts';
import type { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import type { DataSourceStatus, TimeRange } from '@/domain/models';
import { drainAapsLocalReadings, getAapsLocalSourceStatus } from './localAapsSource';
import { AAPS_LOCAL_SOURCE_ID } from './types';

/** Read only local AAPS glucose. IOB and COB stay separately labelled as estimates. */
export class AapsGlucoseSource implements GlucoseSource {
  readonly sourceId = AAPS_LOCAL_SOURCE_ID;

  constructor(private readonly history: GlucoseHistoryStore) {}

  async refresh() {
    await drainAapsLocalReadings();
  }

  async getReadings(range: TimeRange) {
    return this.history.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    return this.history.getLatestReading(this.sourceId);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const [native, latest, bounds] = await Promise.all([
      getAapsLocalSourceStatus(),
      this.getLatestReading(),
      this.history.getBounds(this.sourceId),
    ]);
    const selected = native.supported && native.selectedSourceId === this.sourceId;
    return {
      id: this.sourceId,
      label: 'AndroidAPS local',
      detail: selected
        ? latest
          ? 'Local AAPS broadcast · encrypted local history'
          : 'Waiting for AAPS local broadcast'
        : 'AAPS local source is not selected',
      freshness: selected ? glucoseFreshness(latest?.timestamp, now) : 'missing',
      origin: 'live',
      lastUpdatedAt: latest?.receivedAt,
      dataThrough: selected ? latest?.timestamp : undefined,
      recordCount: bounds.count,
      isLive: selected,
    };
  }
}
