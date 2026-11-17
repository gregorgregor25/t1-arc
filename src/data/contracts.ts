import {
  BasalDelivery,
  BolusDelivery,
  DataSourceStatus,
  GlucoseReading,
  HealthContextEvent,
  InsulinDailyTotal,
  PumpStateInterval,
  TimeRange,
  TimelineData,
} from '@/domain/models';
import type { DirectLibreRefreshReason } from '@/data/libreLinkUp/refreshPolicy';
import {
  SOURCE_HEALTH_WINDOW_MS,
  type SourceDuplicateSummary,
  type SourceHealthSnapshot,
  type SourceHealthSourceInput,
} from '@/domain/sourceHealth';

/** Native collector tick that checks early whether a five-minute source now reads every minute. */
export const CADENCE_PROBE_REFRESH_REASON = 'cadence-probe';

export type GlucoseRefreshReason =
  | DirectLibreRefreshReason
  | typeof CADENCE_PROBE_REFRESH_REASON;

export interface GlucoseRefreshOptions {
  /**
   * Bypass a remote source's due check: an explicit user refresh or a first
   * connection. Remote sources otherwise fetch only when a reading is due.
   */
  force?: boolean;
  /**
   * A native validated-network edge bypasses the due check after a network
   * error. A native cadence probe is always due but fetches only the latest
   * readings. One sync carries one reason: a pending validated-network edge
   * supersedes a probe. That is harmless: at worst one probe is lost and the
   * native service probes again two readings later.
   */
  reason?: GlucoseRefreshReason;
}

export interface GlucoseSource {
  readonly sourceId: string;
  refresh?(options?: GlucoseRefreshOptions): Promise<void>;
  getReadings(range: TimeRange): Promise<GlucoseReading[]>;
  getLatestReading(): Promise<GlucoseReading | undefined>;
  getStatus(now?: number): Promise<DataSourceStatus>;
  /**
   * Per configured source: stored sync metadata and record times in the
   * window, plus exact-timestamp duplicates across sources. Cache-only.
   */
  getSourceHealth?(
    window: TimeRange,
    now: number,
  ): Promise<{ sources: SourceHealthSourceInput[]; duplicates: SourceDuplicateSummary[] }>;
}

export interface InsulinSource {
  readonly sourceId: string;
  refresh?(): Promise<void>;
  getBasalDeliveries(range: TimeRange): Promise<BasalDelivery[]>;
  getBolusDeliveries(range: TimeRange): Promise<BolusDelivery[]>;
  getDailyTotals?(range: TimeRange): Promise<InsulinDailyTotal[]>;
  getPumpStates?(range: TimeRange): Promise<PumpStateInterval[]>;
  getStatus(now?: number): Promise<DataSourceStatus>;
}

export interface ContextSource {
  readonly sourceId: string;
  getEvents(range: TimeRange): Promise<HealthContextEvent[]>;
  getStatus?(now?: number): Promise<DataSourceStatus>;
}

export interface DiabetesRepository {
  refresh(options?: GlucoseRefreshOptions): Promise<void>;
  refreshGlucose?(options?: GlucoseRefreshOptions): Promise<void>;
  getTimeline(range: TimeRange): Promise<TimelineData>;
  getLatestGlucose(): Promise<GlucoseReading | undefined>;
  getSourceStatuses(now?: number): Promise<DataSourceStatus[]>;
  /** Cache-only view of each configured source for the source health panel. */
  getSourceHealthSnapshot?(now?: number): Promise<SourceHealthSnapshot>;
}

export class CombinedDiabetesRepository implements DiabetesRepository {
  private glucoseRefreshInFlight?: Promise<void>;
  private glucoseRefreshInFlightForced = false;
  constructor(
    private readonly glucoseSource: GlucoseSource,
    private readonly insulinSource: InsulinSource,
    private readonly contextSource?: ContextSource,
  ) {}

  refreshGlucose(options?: GlucoseRefreshOptions): Promise<void> {
    const inFlight = this.glucoseRefreshInFlight;
    if (inFlight) {
      // A forced refresh must not settle for a routine one that may have
      // skipped a source that was not yet due. Run it once that one settles.
      if (!options?.force || this.glucoseRefreshInFlightForced) return inFlight;
      return inFlight.catch(() => undefined).then(() => this.refreshGlucose(options));
    }
    // Full and glucose-only foreground lanes can overlap. Share the actual
    // source request, but release it as soon as glucose finishes, not insulin.
    const refresh = Promise.resolve().then(() => this.glucoseSource.refresh?.(options));
    const tracked = refresh.finally(() => {
      if (this.glucoseRefreshInFlight === tracked) this.glucoseRefreshInFlight = undefined;
    });
    this.glucoseRefreshInFlight = tracked;
    this.glucoseRefreshInFlightForced = options?.force === true;
    return tracked;
  }

  async refresh(options?: GlucoseRefreshOptions) {
    const results = await Promise.allSettled([
      this.refreshGlucose(options),
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
      dailyInsulinTotals,
      pumpStates,
      context,
      glucoseStatus,
      insulinStatus,
      contextStatus,
    ] = await Promise.all([
      this.glucoseSource.getReadings(range),
      this.insulinSource.getBasalDeliveries(range),
      this.insulinSource.getBolusDeliveries(range),
      this.insulinSource.getDailyTotals?.(range) ?? Promise.resolve([]),
      this.insulinSource.getPumpStates?.(range) ?? Promise.resolve([]),
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
      dailyInsulinTotals,
      pumpStates,
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

  async getSourceHealthSnapshot(now = Date.now()): Promise<SourceHealthSnapshot> {
    const window = { start: now - SOURCE_HEALTH_WINDOW_MS, end: now };
    const [glucose, insulinStatus, basal, boluses, contextStatus, events] = await Promise.all([
      this.glucoseSource.getSourceHealth
        ? this.glucoseSource.getSourceHealth(window, now)
        : Promise.all([
            this.glucoseSource.getStatus(now),
            this.glucoseSource.getReadings(window),
          ]).then(([status, readings]) => ({
            sources: [{
              kind: 'glucose' as const,
              status,
              recentRecords: readings.map(({ timestamp, sourceId }) => ({ timestamp, sourceId })),
            }],
            duplicates: [],
          })),
      this.insulinSource.getStatus(now),
      this.insulinSource.getBasalDeliveries(window),
      this.insulinSource.getBolusDeliveries(window),
      this.contextSource?.getStatus?.(now) ?? Promise.resolve(undefined),
      this.contextSource?.getEvents(window) ?? Promise.resolve([]),
    ]);
    const inWindow = (timestamp: number) => timestamp >= window.start && timestamp < window.end;
    const sources: SourceHealthSourceInput[] = [
      ...glucose.sources,
      {
        kind: 'insulin',
        status: insulinStatus,
        recentRecords: [
          ...boluses.map(({ timestamp, sourceId }) => ({ timestamp, sourceId })),
          ...basal.map(({ start, sourceId }) => ({ timestamp: start, sourceId })),
        ].filter((record) => inWindow(record.timestamp)),
      },
      ...(contextStatus
        ? [{
            kind: 'context' as const,
            status: contextStatus,
            recentRecords: events
              .map(({ start, sourceId }) => ({ timestamp: start, sourceId }))
              .filter((record) => inWindow(record.timestamp)),
          }]
        : []),
    ];
    return { generatedAt: now, window, sources, duplicates: glucose.duplicates };
  }
}
