import {
  BasalDelivery,
  BolusDelivery,
  DataSourceStatus,
  GlucoseReading,
  HealthContextEvent,
  TimeRange,
  TimelineData,
} from '@/domain/models';

export interface GlucoseSource {
  readonly sourceId: string;
  refresh?(): Promise<void>;
  getReadings(range: TimeRange): Promise<GlucoseReading[]>;
  getLatestReading(): Promise<GlucoseReading | undefined>;
  getStatus(now?: number): Promise<DataSourceStatus>;
}

export interface InsulinSource {
  readonly sourceId: string;
  refresh?(): Promise<void>;
  getBasalDeliveries(range: TimeRange): Promise<BasalDelivery[]>;
  getBolusDeliveries(range: TimeRange): Promise<BolusDelivery[]>;
  getStatus(now?: number): Promise<DataSourceStatus>;
}

export interface ContextSource {
  readonly sourceId: string;
  getEvents(range: TimeRange): Promise<HealthContextEvent[]>;
  getStatus?(now?: number): Promise<DataSourceStatus>;
}

export interface DiabetesRepository {
  refresh(): Promise<void>;
  getTimeline(range: TimeRange): Promise<TimelineData>;
  getLatestGlucose(): Promise<GlucoseReading | undefined>;
  getSourceStatuses(now?: number): Promise<DataSourceStatus[]>;
}

export class CombinedDiabetesRepository implements DiabetesRepository {
  constructor(
    private readonly glucoseSource: GlucoseSource,
    private readonly insulinSource: InsulinSource,
    private readonly contextSource?: ContextSource,
  ) {}

  async refresh() {
    const results = await Promise.allSettled([
      this.glucoseSource.refresh?.(),
      this.insulinSource.refresh?.(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }

  async getTimeline(range: TimeRange): Promise<TimelineData> {
    const [
      glucose,
      basal,
      boluses,
      context,
      glucoseStatus,
      insulinStatus,
      contextStatus,
    ] = await Promise.all([
      this.glucoseSource.getReadings(range),
      this.insulinSource.getBasalDeliveries(range),
      this.insulinSource.getBolusDeliveries(range),
      this.contextSource?.getEvents(range) ?? Promise.resolve([]),
      this.glucoseSource.getStatus(),
      this.insulinSource.getStatus(),
      this.contextSource?.getStatus?.() ?? Promise.resolve(undefined),
    ]);

    return {
      range,
      glucose,
      basal,
      boluses,
      context,
      sources: [
        glucoseStatus,
        insulinStatus,
        ...(contextStatus ? [contextStatus] : []),
      ],
    };
  }

  getLatestGlucose() {
    return this.glucoseSource.getLatestReading();
  }

  async getSourceStatuses(now = Date.now()) {
    const statuses = await Promise.all([
      this.glucoseSource.getStatus(now),
      this.insulinSource.getStatus(now),
      this.contextSource?.getStatus?.(now) ?? Promise.resolve(undefined),
    ]);
    return statuses.filter(
      (status): status is DataSourceStatus => status !== undefined,
    );
  }
}
