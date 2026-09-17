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

export const COMPOSITE_GLUCOSE_SOURCE_ID = 't1arc-live-glucose';

function latestTimestamp(values: (number | undefined)[]) {
  const timestamps = values.filter(
    (value): value is number => value !== undefined,
  );
  return timestamps.length ? Math.max(...timestamps) : undefined;
}

export class CompositeGlucoseSource implements GlucoseSource {
  readonly sourceId = COMPOSITE_GLUCOSE_SOURCE_ID;
  private refreshInFlight?: Promise<void>;
  private statusReadInFlight?: Promise<DataSourceStatus>;
  private statusSnapshot?: DataSourceStatus;
  private refreshGeneration = 0;
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
    const generation = ++this.refreshGeneration;
    this.statusSnapshot = undefined;
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
      if (this.refreshGeneration === generation) {
        // A status read can finish while the source request is still running.
        // Do not retain that pre-refresh snapshot after new history lands.
        this.refreshGeneration += 1;
        this.statusSnapshot = undefined;
      }
    });
    return this.refreshInFlight;
  }

  async getReadings(range: TimeRange) {
    // Rendering is cache-first. Explicit repository refresh lanes own all
    // network work, so a slow/offline source can never hide saved history.
    const readings = await this.history.getReadings(range);
    return this.preferLiveOverHistoricalDuplicates(
      this.preferOneReadingPerExactTimestamp(readings),
    );
  }

  async getLatestReading() {
    return this.getLatestReadingFromHistory();
  }

  private async getLatestReadingFromHistory() {
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

  private async readStatusSnapshot(now: number): Promise<DataSourceStatus> {
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
      this.getLatestReadingFromHistory(),
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

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    // Status is also a cache-only observation. It must not wait for an active
    // source request before allowing the saved glucose value to render.

    if (!this.statusSnapshot) {
      if (!this.statusReadInFlight) {
        const generation = this.refreshGeneration;
        const read = this.readStatusSnapshot(now).then((snapshot) => {
          if (generation === this.refreshGeneration) {
            this.statusSnapshot = snapshot;
          }
          return snapshot;
        });
        const tracked = read.finally(() => {
          if (this.statusReadInFlight === tracked) {
            this.statusReadInFlight = undefined;
          }
        });
        this.statusReadInFlight = tracked;
      }
      await this.statusReadInFlight;
    }

    const snapshot = this.statusSnapshot ?? (await this.readStatusSnapshot(now));
    // A headless/native owner can append history without calling refresh() on
    // this foreground object. Keep the expensive source metadata cached, but
    // always reconcile its value timestamp from encrypted local history.
    const latest = await this.getLatestReadingFromHistory();
    const dataThrough = latest?.timestamp;
    const freshness = glucoseFreshness(dataThrough, now);
    const latestIsImported =
      latest?.sourceId === GLOOKO_CGM_SOURCE_ID ||
      latest?.sourceId === DEXCOM_CGM_SOURCE_ID;
    const origin = latest
      ? latestIsImported
        ? 'imported'
        : 'live'
      : snapshot.origin;
    return freshness === snapshot.freshness &&
      dataThrough === snapshot.dataThrough &&
      snapshot.origin === origin
      ? snapshot
      : {
          ...snapshot,
          dataThrough,
          freshness,
          origin,
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
