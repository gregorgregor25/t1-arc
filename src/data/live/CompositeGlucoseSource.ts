import { GlucoseSource } from '@/data/contracts';
import { GLOOKO_CGM_SOURCE_ID } from '@/data/import/glookoCsv';
import { DEXCOM_CGM_SOURCE_ID } from '@/data/import/dexcomClarityCsv';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';
import { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
} from '@/domain/models';

export const COMPOSITE_GLUCOSE_SOURCE_ID = 'daymark-live-glucose';

function latestTimestamp(values: Array<number | undefined>) {
  const timestamps = values.filter(
    (value): value is number => value !== undefined,
  );
  return timestamps.length ? Math.max(...timestamps) : undefined;
}

export class CompositeGlucoseSource implements GlucoseSource {
  readonly sourceId = COMPOSITE_GLUCOSE_SOURCE_ID;
  private refreshInFlight?: Promise<void>;
  private readonly priority = new Map<string, number>();

  constructor(
    private readonly sources: GlucoseSource[],
    private readonly history: GlucoseHistoryStore,
  ) {
    sources.forEach((source, index) => {
      this.priority.set(source.sourceId, index);
    });
    this.priority.set(DEXCOM_CGM_SOURCE_ID, sources.length);
    this.priority.set(GLOOKO_CGM_SOURCE_ID, sources.length + 1);
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const results = await Promise.allSettled(
        this.sources.map((source) => source.refresh?.()),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failure) {
        const bounds = await this.history.getBounds();
        if (bounds.count === 0) throw failure.reason;
      }
    })().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  async getReadings(range: TimeRange) {
    await this.refresh();
    const readings = await this.history.getReadings(range);
    return this.preferLiveOverHistoricalDuplicates(
      this.preferOneReadingPerExactTimestamp(readings),
    );
  }

  async getLatestReading() {
    await this.refresh();
    const liveReadings = (
      await Promise.all(
        this.sources.map((source) =>
          this.history.getLatestReading(source.sourceId),
        ),
      )
    ).filter((reading): reading is GlucoseReading => Boolean(reading));
    return liveReadings.sort((a, b) => b.timestamp - a.timestamp)[0] ??
      this.history.getLatestReading();
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    await this.refresh().catch(() => undefined);
    const [statuses, latest, bounds] = await Promise.all([
      Promise.all(
        this.sources.map((source) =>
          source.getStatus(now).catch(
            (): DataSourceStatus => ({
              id: source.sourceId,
              label: source.sourceId,
              detail: 'Source unavailable',
              freshness: 'missing',
              origin: 'live',
              isLive: false,
            }),
          ),
        ),
      ),
      this.getLatestReading(),
      this.history.getBounds(),
    ]);
    const active =
      statuses.find((status) => status.id === latest?.sourceId) ??
      statuses.find((status) => status.freshness === 'current') ??
      statuses[0];
    const hasCurrentSource = statuses.some(
      (status) => status.freshness === 'current',
    );
    const latestIsImported =
      latest !== undefined &&
      (latest.sourceId === GLOOKO_CGM_SOURCE_ID ||
        latest.sourceId === DEXCOM_CGM_SOURCE_ID);
    const latestError = statuses.find((status) => status.errorCode);
    const noConfiguredSource =
      !latest &&
      bounds.count === 0 &&
      statuses.length === 1 &&
      active?.id === NOTIFICATION_SOURCE_ID &&
      active.detail === 'No notification source selected';
    return {
      id: this.sourceId,
      label: 'Glucose',
      detail: noConfiguredSource
        ? 'No glucose source connected'
        : latestIsImported
          ? 'Historical glucose · encrypted local history'
        : active?.isLive
        ? 'Connected source · encrypted local history'
        : active?.detail ?? 'No glucose source is ready',
      freshness:
        hasCurrentSource && latest
          ? 'current'
          : glucoseFreshness(latest?.timestamp, now),
      origin: latestIsImported ? 'imported' : 'live',
      lastAttemptAt: latestTimestamp(
        statuses.map((status) => status.lastAttemptAt),
      ),
      lastUpdatedAt: latestTimestamp(
        statuses.map((status) => status.lastUpdatedAt),
      ),
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: latestError?.errorCode,
      isLive: statuses.some((status) => status.isLive),
    };
  }

  private preferOneReadingPerExactTimestamp(
    readings: GlucoseReading[],
  ) {
    const selected = new Map<number, GlucoseReading>();
    for (const reading of readings) {
      const existing = selected.get(reading.timestamp);
      const rank = this.priority.get(reading.sourceId) ?? Number.MAX_SAFE_INTEGER;
      const existingRank =
        existing === undefined
          ? Number.MAX_SAFE_INTEGER
          : this.priority.get(existing.sourceId) ?? Number.MAX_SAFE_INTEGER;
      if (!existing || rank < existingRank) {
        selected.set(reading.timestamp, reading);
      }
    }
    return [...selected.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  private preferLiveOverHistoricalDuplicates(readings: GlucoseReading[]) {
    const importedSources = new Set([
      GLOOKO_CGM_SOURCE_ID,
      DEXCOM_CGM_SOURCE_ID,
    ]);
    const live = readings.filter(
      (reading) => !importedSources.has(reading.sourceId),
    );
    let liveIndex = 0;
    return readings.filter((reading) => {
      if (!importedSources.has(reading.sourceId)) return true;
      while (
        liveIndex < live.length &&
        live[liveIndex]!.timestamp < reading.timestamp - 90_000
      ) {
        liveIndex += 1;
      }
      for (
        let index = liveIndex;
        index < live.length &&
        live[index]!.timestamp <= reading.timestamp + 90_000;
        index += 1
      ) {
        if (Math.abs(live[index]!.mmolL - reading.mmolL) <= 0.3) {
          return false;
        }
      }
      return true;
    });
  }
}
