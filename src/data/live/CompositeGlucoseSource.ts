import { GlucoseSource } from '@/data/contracts';
import { AAPS_HISTORICAL_SOURCE_ID, AAPS_RESTORED_SOURCE_ID } from '@/data/aaps/types';
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

export type GlucoseSourceSelection =
  | string
  | undefined
  | { sourceId?: string; generation?: number };

function normalizedSelection(value: GlucoseSourceSelection) {
  return typeof value === 'object' && value !== null
    ? value
    : { sourceId: value };
}

function sameSelection(
  left: ReturnType<typeof normalizedSelection>,
  right: ReturnType<typeof normalizedSelection>,
) {
  return left.sourceId === right.sourceId &&
    left.generation === right.generation;
}

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
  private activeSourceId?: string;
  private activeSelection: ReturnType<typeof normalizedSelection> = {};

  constructor(
    private readonly sources: GlucoseSource[],
    private readonly history: GlucoseHistoryStore,
    private readonly selectedSource?: () => Promise<GlucoseSourceSelection>,
  ) {
    sources.forEach((source, index) => {
      this.priority.set(source.sourceId, index);
    });
    this.priority.set(DEXCOM_CGM_SOURCE_ID, sources.length);
    this.priority.set(GLOOKO_CGM_SOURCE_ID, sources.length + 1);
    this.priority.set(AAPS_RESTORED_SOURCE_ID, sources.length + 2);
    this.priority.set(AAPS_HISTORICAL_SOURCE_ID, sources.length + 3);
  }

  private async resolveSelectedSource() {
    const selected = normalizedSelection(await this.selectedSource?.());
    if (!sameSelection(this.activeSelection, selected)) {
      this.activeSelection = selected;
      this.activeSourceId = selected.sourceId;
      this.statusSnapshot = undefined;
      this.refreshGeneration += 1;
    }
    return selected;
  }

  private async selectionStillCurrent(expected: ReturnType<typeof normalizedSelection>) {
    return sameSelection(expected, await this.resolveSelectedSource());
  }

  private configuredSourcesFor(selected: string | undefined) {
    return selected === undefined
      ? this.sources
      : this.sources.filter((source) => source.sourceId === selected);
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    const generation = ++this.refreshGeneration;
    this.statusSnapshot = undefined;
    this.refreshInFlight = (async () => {
      const selection = await this.resolveSelectedSource();
      const selected = selection.sourceId;
      const results = await Promise.allSettled(
        this.configuredSourcesFor(selected).map((source) => source.refresh?.()),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failure) {
        const bounds = await this.history.getBounds(selected);
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
    const selection = await this.resolveSelectedSource();
    const selected = selection.sourceId;
    if (selected === 'none') return [];
    const readings = await this.history.getReadings(range, selected);
    if (!(await this.selectionStillCurrent(selection))) return [];
    return this.selectReadings(readings);
  }

  /** Shared by Today and native display publication. */
  selectReadings(readings: GlucoseReading[]) {
    if (this.activeSourceId === 'none') return [];
    const scoped = this.activeSourceId === undefined
      ? readings
      : readings.filter((reading) => reading.sourceId === this.activeSourceId);
    return this.preferLiveOverHistoricalDuplicates(
      this.preferOneReadingPerExactTimestamp(scoped),
    );
  }

  async getLatestReading() {
    return this.getLatestReadingFromHistory();
  }

  private async getLatestReadingFromHistory() {
    const selection = await this.resolveSelectedSource();
    const selected = selection.sourceId;
    if (selected === 'none') return undefined;
    if (selected !== undefined) {
      const reading = await this.history.getLatestReading(selected);
      return await this.selectionStillCurrent(selection) ? reading : undefined;
    }
    const liveReadings = (
      await Promise.all(
        this.sources.map((source) =>
          this.history.getLatestReading(source.sourceId),
        ),
      )
    ).filter((reading): reading is GlucoseReading => Boolean(reading));
    const latest = liveReadings.sort((a, b) => b.timestamp - a.timestamp)[0] ??
      await this.history.getLatestReading();
    return await this.selectionStillCurrent(selection) ? latest : undefined;
  }

  private async readStatusSnapshot(now: number): Promise<DataSourceStatus> {
    const selected = (await this.resolveSelectedSource()).sourceId;
    const configured = this.configuredSourcesFor(selected);
    const [statuses, latest, bounds] = await Promise.all([
      Promise.all(
        configured.map((source) =>
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
      this.history.getBounds(selected === 'none' ? 'none' : selected),
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
        latest.sourceId === DEXCOM_CGM_SOURCE_ID ||
        latest.sourceId === AAPS_RESTORED_SOURCE_ID ||
        latest.sourceId === AAPS_HISTORICAL_SOURCE_ID);
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
        : active?.detail ?? (selected === 'none' ? 'No glucose source selected' : 'No glucose source is ready'),
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

    const selection = await this.resolveSelectedSource();
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
      latest?.sourceId === DEXCOM_CGM_SOURCE_ID ||
      latest?.sourceId === AAPS_RESTORED_SOURCE_ID ||
      latest?.sourceId === AAPS_HISTORICAL_SOURCE_ID;
    const origin = latest
      ? latestIsImported
        ? 'imported'
        : 'live'
      : snapshot.origin;
    if (!(await this.selectionStillCurrent(selection))) {
      return {
        ...snapshot,
        freshness: 'missing',
        dataThrough: undefined,
        detail: 'Glucose source changed; refreshing',
        isLive: false,
      };
    }
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
      AAPS_RESTORED_SOURCE_ID,
      AAPS_HISTORICAL_SOURCE_ID,
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
