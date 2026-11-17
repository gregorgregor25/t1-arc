import { InsulinSource } from '@/data/contracts';
import {
  HealthRecordStore,
} from '@/data/persistence/HealthRecordStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { DataSourceStatus, TimeRange } from '@/domain/models';
import {
  THERAPY_STATE_LOOKBACK_MS,
  therapyStatesForRange,
} from '@/domain/therapyStates';
import {
  reconcileBasalSources,
  reconcileBolusSources,
} from '@/domain/insulinSourceReconciliation';
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
    /** On-phone intake, such as AAPS treatments, drained before remote reads. */
    private readonly localImporters: readonly { refresh(): Promise<unknown> }[] = [],
    private readonly clock: () => number = Date.now,
  ) {}

  async refresh() {
    for (const importer of this.localImporters) {
      await importer.refresh().catch(() => undefined);
    }
    await this.liveImporter?.refresh().catch(() => undefined);
  }

  async getBasalDeliveries(range: TimeRange) {
    // The same delivery can be stored by Glooko, AAPS and Nightscout; count it once.
    return reconcileBasalSources(await this.store.getBasalDeliveries(range));
  }

  async getBolusDeliveries(range: TimeRange) {
    return reconcileBolusSources(await this.store.getBolusDeliveries(range))
      .boluses;
  }

  async getDailyTotals(range: TimeRange) {
    return this.store.getDailyInsulinTotals(range);
  }

  async getPumpStates(range: TimeRange) {
    return this.store.getPumpStateIntervals(range);
  }

  /**
   * Resolved at read time from stored AAPS treatments, so history imported
   * before this view existed is included and a later cancel or edit is
   * reflected without re-importing.
   */
  async getTherapyStates(range: TimeRange) {
    if (!this.store.getTherapyStateRecords || range.end <= range.start) return [];
    const records = await this.store.getTherapyStateRecords({
      start: range.start - THERAPY_STATE_LOOKBACK_MS,
      end: range.end,
    });
    return therapyStatesForRange(records, range, this.clock());
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    const [
      bounds,
      manualBounds,
      latestGlookoImport,
      latestNightscoutImport,
      latestAapsImport,
    ] = await Promise.all([
      this.store.getInsulinBounds(),
      this.store.getManualInsulinBounds(),
      this.store.getLatestImport(SOURCE_ID),
      this.store.getLatestImport('nightscout'),
      this.store.getLatestImport('aaps-local'),
    ]);
    const latestImport = [latestGlookoImport, latestNightscoutImport, latestAapsImport]
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
    const manualRecent =
      manualBounds.latest !== undefined &&
      now - manualBounds.latest <= RECENT_DATA_MS;
    const remoteDetail =
      latestGlookoImport && latestNightscoutImport
        ? 'Glooko and Nightscout insulin history'
        : latestNightscoutImport
          ? 'Nightscout insulin treatment history'
          : latestGlookoImport
            ? 'Glooko pump delivery history'
            : undefined;
    const importedDetail = latestAapsImport
      ? remoteDetail
        ? `${remoteDetail} plus AAPS records received on this phone (sender not verified)`
        : 'AAPS insulin and carb records received on this phone (sender not verified)'
      : remoteDetail;
    return {
      id: this.sourceId,
      label: 'Insulin',
      detail: importedDetail
        ? manualBounds.count
          ? `${importedDetail} plus manual doses`
          : importedDetail
        : 'Manual insulin doses recorded on this phone',
      freshness:
        dataRecent && (importRecent || manualRecent)
          ? importedDetail
            ? 'delayed'
            : 'current'
          : 'stale',
      origin:
        latestNightscoutImport || latestAapsImport || !importedDetail
          ? 'live'
          : 'imported',
      lastAttemptAt: latestImport?.importedAt,
      lastUpdatedAt: latestImport?.importedAt ?? bounds.lastRecordedAt,
      dataThrough: bounds.latest,
      recordCount: bounds.count,
      capabilities,
      isLive: Boolean(this.liveImporter),
    };
  }
}
