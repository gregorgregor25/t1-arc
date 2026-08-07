import { normalizeXdripReading } from '@/data/adapters/xdrip';
import { GlucoseSource } from '@/data/contracts';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
} from '@/domain/models';
import { NIGHTSCOUT_GLUCOSE_CAPABILITIES } from '@/domain/sourceCapabilities';
import {
  GlucoseHistoryStore,
  SourceSyncState,
} from '@/data/persistence/GlucoseHistoryStore';

import {
  NIGHTSCOUT_SOURCE_ID,
  NightscoutConnection,
  NightscoutEntry,
  NightscoutError,
  NightscoutErrorCode,
} from './types';
import { nightscoutHost } from './connection';
import { NightscoutTreatmentImporter } from './NightscoutTreatmentImporter';

const RECENT_ENTRY_COUNT = 96;
const MAX_ENTRY_COUNT = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

function errorCode(error: unknown): NightscoutErrorCode {
  return error instanceof NightscoutError ? error.code : 'network';
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Nightscout could not be reached.';
}

function entriesEndpoint(
  connection: NightscoutConnection,
  count: number,
  since?: number,
  before?: number,
) {
  const query = [`count=${Math.min(MAX_ENTRY_COUNT, Math.max(1, count))}`];
  if (since !== undefined) {
    query.push(`find%5Bdate%5D%5B%24gte%5D=${Math.round(since)}`);
  }
  if (before !== undefined) {
    query.push(`find%5Bdate%5D%5B%24lt%5D=${Math.round(before)}`);
  }
  if (connection.accessToken) {
    query.push(`token=${encodeURIComponent(connection.accessToken)}`);
  }
  return `${connection.baseUrl}/api/v1/entries/sgv.json?${query.join('&')}`;
}

export class NightscoutGlucoseSource implements GlucoseSource {
  readonly sourceId = NIGHTSCOUT_SOURCE_ID;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly connection: NightscoutConnection,
    private readonly store: GlucoseHistoryStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
    private readonly treatmentImporter?: NightscoutTreatmentImporter,
  ) {}

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      await this.importEntries(RECENT_ENTRY_COUNT);
      await this.treatmentImporter?.refresh().catch(() => undefined);
    })().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  async importInitialHistory(days = 14) {
    const boundedDays = Math.min(17, Math.max(1, Math.round(days)));
    await this.importEntries(
      Math.min(MAX_ENTRY_COUNT, boundedDays * 288 + 24),
      this.clock() - boundedDays * 86_400_000,
    );
    await this.treatmentImporter
      ?.importRange(
        this.clock() - boundedDays * 86_400_000,
        this.clock(),
      )
      .catch(() => undefined);
    return this.store.getLatestReading(this.sourceId);
  }

  async importHistoryRange(startMs: number, endMs: number) {
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs >= endMs
    ) {
      throw new NightscoutError(
        'invalid-connection',
        'Nightscout history range is invalid.',
      );
    }
    await this.importEntries(MAX_ENTRY_COUNT, startMs, endMs);
    await this.treatmentImporter
      ?.importRange(startMs, endMs)
      .catch(() => undefined);
  }

  async getReadings(range: TimeRange) {
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(now = this.clock()): Promise<DataSourceStatus> {
    await this.store.initialize();
    const [latest, state, bounds] = await Promise.all([
      this.store.getLatestReading(this.sourceId),
      this.store.getSyncState(this.sourceId),
      this.store.getBounds(this.sourceId),
    ]);
    return {
      id: this.sourceId,
      label: 'Nightscout',
      detail: `${nightscoutHost(this.connection)} · read-only glucose, treatments and profiles when supplied`,
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      capabilities: NIGHTSCOUT_GLUCOSE_CAPABILITIES,
      isLive: true,
    };
  }

  private async importEntries(
    count: number,
    since?: number,
    before?: number,
  ) {
    await this.store.initialize();
    const attemptedAt = this.clock();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await this.fetcher(
          entriesEndpoint(this.connection, count, since, before),
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        );
      } catch {
        throw new NightscoutError(
          'network',
          'Nightscout could not be reached. Check the address and connection.',
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new NightscoutError(
          'authentication',
          'Nightscout rejected the connection. Use a readable access token, not an admin password.',
        );
      }
      if (!response.ok) {
        throw new NightscoutError(
          'network',
          `Nightscout returned HTTP ${response.status}.`,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout did not return a readable glucose response.',
        );
      }
      if (!Array.isArray(payload)) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned an unexpected glucose response.',
        );
      }
      if (payload.length > MAX_ENTRY_COUNT) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned more readings than T1 Arc can safely process at once.',
        );
      }
      const receivedAt = this.clock();
      const readings = (payload as NightscoutEntry[]).flatMap(
        (entry): GlucoseReading[] => {
          try {
            const normalized = normalizeXdripReading(
              {
                sgv: Number(entry.sgv),
                direction: entry.direction,
                date: Number(entry.date),
              },
              this.sourceId,
              receivedAt,
            );
            const sourceRecordId =
              typeof entry._id === 'string' && entry._id.trim()
                ? entry._id.trim()
                : typeof entry.identifier === 'string' &&
                    entry.identifier.trim()
                  ? entry.identifier.trim()
                  : undefined;
            return [
              {
                ...normalized,
                id: sourceRecordId
                  ? `${this.sourceId}:${sourceRecordId}`
                  : normalized.id,
                sourceFactoryTimestamp:
                  typeof entry.dateString === 'string'
                    ? entry.dateString
                    : undefined,
                sourceDeviceId:
                  typeof entry.device === 'string'
                    ? entry.device
                    : undefined,
              },
            ];
          } catch {
            return [];
          }
        },
      );
      if (payload.length > 0 && readings.length === 0) {
        throw new NightscoutError(
          'invalid-response',
          'Nightscout returned entries, but none contained a usable SGV and millisecond timestamp.',
        );
      }
      await this.store.upsertReadings(readings);
      const bounds = await this.store.getBounds(this.sourceId);
      await this.store.saveSyncState({
        sourceId: this.sourceId,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: receivedAt,
        recordCount: bounds.count,
      });
    } catch (error) {
      const current =
        (await this.store.getSyncState(this.sourceId)) ??
        ({
          sourceId: this.sourceId,
          recordCount: 0,
        } satisfies SourceSyncState);
      await this.store.saveSyncState({
        ...current,
        lastAttemptAt: attemptedAt,
        lastErrorCode: errorCode(error),
        lastErrorMessage: errorMessage(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
