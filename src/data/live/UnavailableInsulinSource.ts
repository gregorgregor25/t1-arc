import { InsulinSource } from '@/data/contracts';
import { DataSourceStatus, TimeRange } from '@/domain/models';

export class UnavailableInsulinSource implements InsulinSource {
  readonly sourceId = 'insulin-not-connected';

  async getBasalDeliveries(_range: TimeRange) {
    return [];
  }

  async getBolusDeliveries(_range: TimeRange) {
    return [];
  }

  async getStatus(): Promise<DataSourceStatus> {
    return {
      id: this.sourceId,
      label: 'Insulin',
      detail: 'Not connected · add Glooko history from Sources',
      freshness: 'missing',
      origin: 'delayed',
      recordCount: 0,
      isLive: false,
    };
  }
}
