import { ContextSource } from '@/data/contracts';
import { HealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { DataSourceStatus, TimeRange } from '@/domain/models';

const SOURCE_ID = 't1arc-context';
const RECENT_CONTEXT_MS = 14 * 24 * 60 * 60 * 1000;

export class StoredContextSource implements ContextSource {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly store: HealthRecordStore = new SqliteHealthRecordStore(),
  ) {}

  async getEvents(range: TimeRange) {
    return this.store.getContextEvents(range);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const bounds = await this.store.getContextBounds();
    if (!bounds.count) {
      return {
        id: this.sourceId,
        label: 'Health context',
        detail: 'No personal meals, activity, sleep, weight or medication yet',
        freshness: 'missing',
        origin: 'manual',
        recordCount: 0,
        isLive: false,
      };
    }
    const recent =
      bounds.latest !== undefined &&
      now - bounds.latest <= RECENT_CONTEXT_MS;
    return {
      id: this.sourceId,
      label: 'Health context',
      detail: 'Private manual and imported records',
      freshness: recent ? 'current' : 'stale',
      origin: 'manual',
      lastUpdatedAt: bounds.lastRecordedAt,
      dataThrough: bounds.latest,
      recordCount: bounds.count,
      isLive: false,
    };
  }
}
