import {
  normalizeXdripReading,
  XdripSgvResponse,
} from '@/data/adapters/xdrip';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  SourceSyncState,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
} from '@/domain/models';

import {
  isLocalXdripConnection,
  xdripEndpointLabel,
} from './connection';
import {
  XDRIP_SOURCE_ID,
  XdripConnection,
  XdripError,
  XdripErrorCode,
} from './types';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;
const MAX_READING_COUNT = 512;
const EARLIEST_PLAUSIBLE_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

type FetchLike = typeof fetch;

function errorCode(error: unknown): XdripErrorCode {
  return error instanceof XdripError ? error.code : 'network';
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The xDrip endpoint could not be reached.';
}

function payloadEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  throw new XdripError(
    'invalid-response',
    'The xDrip endpoint returned an unexpected response.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class XdripGlucoseSource implements GlucoseSource {
  readonly sourceId = XDRIP_SOURCE_ID;
  private refreshInFlight?: Promise<void>;

  constructor(
    private readonly connection: XdripConnection,
    private readonly store: GlucoseHistoryStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.importReadings().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  getReadings(range: TimeRange) {
    return this.store.getReadings(range, this.sourceId);
  }

  getLatestReading() {
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
      label: 'xDrip-compatible endpoint',
      detail: `${xdripEndpointLabel(this.connection)} · ${
        isLocalXdripConnection(this.connection)
          ? 'on-device read-only glucose'
          : 'HTTPS read-only glucose'
      }`,
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      isLive: true,
    };
  }

  private async importReadings() {
    await this.store.initialize();
    const attemptedAt = this.clock();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetcher(this.connection.endpointUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        throw new XdripError(
          'network',
          'The xDrip endpoint could not be reached. Check that its web service is running.',
        );
      }
      if (!response.ok) {
        throw new XdripError(
          'network',
          `The xDrip endpoint returned HTTP ${response.status}.`,
        );
      }
      const advertisedLength = Number(
        response.headers.get('Content-Length') ?? 0,
      );
      if (
        Number.isFinite(advertisedLength) &&
        advertisedLength > MAX_RESPONSE_CHARACTERS
      ) {
        throw new XdripError(
          'invalid-response',
          'The xDrip response is larger than T1 Arc accepts.',
        );
      }
      const body = await response.text();
      if (body.length > MAX_RESPONSE_CHARACTERS) {
        throw new XdripError(
          'invalid-response',
          'The xDrip response is larger than T1 Arc accepts.',
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new XdripError(
          'invalid-response',
          'The xDrip endpoint did not return readable JSON.',
        );
      }
      const entries = payloadEntries(payload);
      if (entries.length === 0) {
        throw new XdripError(
          'invalid-response',
          'The xDrip endpoint returned no glucose readings.',
        );
      }
      if (entries.length > MAX_READING_COUNT) {
        throw new XdripError(
          'invalid-response',
          'The xDrip endpoint returned too many readings at once.',
        );
      }

      const receivedAt = this.clock();
      const readings = entries.flatMap((entry): GlucoseReading[] => {
        if (!isRecord(entry)) return [];
        const raw: XdripSgvResponse = {
          sgv: Number(entry.sgv),
          direction:
            typeof entry.direction === 'string' ? entry.direction : undefined,
          date: Number(entry.date),
        };
        if (
          raw.date < EARLIEST_PLAUSIBLE_TIMESTAMP ||
          raw.date > receivedAt + MAX_FUTURE_SKEW_MS
        ) {
          return [];
        }
        try {
          return [
            normalizeXdripReading(raw, this.sourceId, receivedAt),
          ];
        } catch {
          return [];
        }
      });
      if (readings.length === 0) {
        throw new XdripError(
          'invalid-response',
          'The xDrip response did not contain a usable SGV and millisecond timestamp.',
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
