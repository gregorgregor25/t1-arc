import { InsulinSource } from '@/data/contracts';
import {
  HealthRecordStore,
} from '@/data/persistence/HealthRecordStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { DataSourceStatus, TimeRange } from '@/domain/models';

const SOURCE_ID = 'glooko-export';
const RECENT_DATA_MS = 3 * 24 * 60 * 60 * 1000;
const RECENT_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;

export class ImportedInsulinSource implements InsulinSource {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly store: HealthRecordStore = new SqliteHealthRecordStore(),
  ) {}

  async getBasalDeliveries(range: TimeRange) {
    return this.store.getBasalDeliveries(range);
  }

  async getBolusDeliveries(range: TimeRange) {
    return this.store.getBolusDeliveries(range);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const [bounds, latestImport] = await Promise.all([
      this.store.getInsulinBounds(),
      this.store.getLatestImport(SOURCE_ID),
    ]);
    if (!bounds.count) {
      return {
        id: this.sourceId,
        label: 'Insulin',
        detail: 'No Glooko export imported · never shown as live pump data',
        freshness: 'missing',
        origin: 'imported',
        recordCount: 0,
        isLive: false,
      };
    }

    const dataRecent =
      bounds.latest !== undefined && now - bounds.latest <= RECENT_DATA_MS;
    const importRecent =
      latestImport !== undefined &&
      now - latestImport.importedAt <= RECENT_IMPORT_MS;
    return {
      id: this.sourceId,
      label: 'Insulin',
      detail: 'Glooko export · delayed pump delivery records',
      freshness: dataRecent && importRecent ? 'delayed' : 'stale',
      origin: 'imported',
      lastAttemptAt: latestImport?.importedAt,
      lastUpdatedAt: latestImport?.importedAt ?? bounds.lastRecordedAt,
      dataThrough: bounds.latest,
      recordCount: bounds.count,
      isLive: false,
    };
  }
}
