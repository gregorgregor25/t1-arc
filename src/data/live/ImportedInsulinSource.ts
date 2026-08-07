import { InsulinSource } from '@/data/contracts';
import {
  HealthRecordStore,
} from '@/data/persistence/HealthRecordStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { DataSourceStatus, TimeRange } from '@/domain/models';
import {
  GLOOKO_IMPORT_CAPABILITIES,
  SourceCapability,
} from '@/domain/sourceCapabilities';

const SOURCE_ID = 'glooko-export';
const RECENT_DATA_MS = 3 * 24 * 60 * 60 * 1000;
const RECENT_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;

interface LiveInsulinImporter {
  readonly label: string;
  readonly capabilities: readonly SourceCapability[];
  refresh(): Promise<unknown>;
}

export class ImportedInsulinSource implements InsulinSource {
  readonly sourceId = SOURCE_ID;

  constructor(
    private readonly store: HealthRecordStore = new SqliteHealthRecordStore(),
    private readonly liveImporter?: LiveInsulinImporter,
  ) {}

  async refresh() {
    await this.liveImporter?.refresh().catch(() => undefined);
  }

  async getBasalDeliveries(range: TimeRange) {
    return this.store.getBasalDeliveries(range);
  }

  async getBolusDeliveries(range: TimeRange) {
    return this.store.getBolusDeliveries(range);
  }

  async getDailyTotals(range: TimeRange) {
    return this.store.getDailyInsulinTotals(range);
  }

  async getPumpStates(range: TimeRange) {
    return this.store.getPumpStateIntervals(range);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const [bounds, latestGlookoImport, latestNightscoutImport] = await Promise.all([
      this.store.getInsulinBounds(),
      this.store.getLatestImport(SOURCE_ID),
      this.store.getLatestImport('nightscout'),
    ]);
    const latestImport = [latestGlookoImport, latestNightscoutImport]
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => right.importedAt - left.importedAt)[0];
    const capabilities = this.liveImporter
      ? [...GLOOKO_IMPORT_CAPABILITIES, ...this.liveImporter.capabilities].filter(
          (capability, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.kind === capability.kind &&
                candidate.fidelity === capability.fidelity,
            ) === index,
        )
      : GLOOKO_IMPORT_CAPABILITIES;
    if (!bounds.count) {
      return {
        id: this.sourceId,
        label: 'Insulin',
        detail: this.liveImporter
          ? 'Nightscout connected; no insulin treatments supplied yet'
          : 'No Glooko history imported',
        freshness: 'missing',
        origin: this.liveImporter ? 'live' : 'imported',
        recordCount: 0,
        lastAttemptAt: latestImport?.importedAt,
        lastUpdatedAt: latestImport?.importedAt,
        capabilities,
        isLive: Boolean(this.liveImporter),
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
      detail:
        latestGlookoImport && latestNightscoutImport
          ? 'Glooko and Nightscout insulin history'
          : latestNightscoutImport
            ? 'Nightscout insulin treatment history'
            : 'Glooko pump delivery history',
      freshness: dataRecent && importRecent ? 'delayed' : 'stale',
      origin: latestNightscoutImport ? 'live' : 'imported',
      lastAttemptAt: latestImport?.importedAt,
      lastUpdatedAt: latestImport?.importedAt ?? bounds.lastRecordedAt,
      dataThrough: bounds.latest,
      recordCount: bounds.count,
      capabilities,
      isLive: Boolean(this.liveImporter),
    };
  }
}
