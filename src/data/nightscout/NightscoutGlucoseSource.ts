import { normalizeXdripReading } from "@/data/adapters/xdrip";
import { GlucoseSource } from "@/data/contracts";
import { glucoseFreshness } from "@/domain/freshness";
import { DataSourceStatus, GlucoseReading, TimeRange } from "@/domain/models";
import { NIGHTSCOUT_GLUCOSE_CAPABILITIES } from "@/domain/sourceCapabilities";
import {
  GlucoseHistoryStore,
  SourceSyncState,
} from "@/data/persistence/GlucoseHistoryStore";

import {
  NIGHTSCOUT_SOURCE_ID,
  NightscoutConnection,
  NightscoutEntry,
  NightscoutError,
  NightscoutErrorCode,
 NightscoutIobCobSnapshot } from "./types";
import { nightscoutHost } from "./connection";
import { NightscoutTreatmentImporter } from "./NightscoutTreatmentImporter";
import { nightscoutRequestHeaders } from "./auth";
import { normalizeNightscoutPebbleIobCob } from "./iobCobSnapshot";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import {
  isSourceConnectionSupersededError,
  type SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';

const RECENT_ENTRY_COUNT = 96;
const MAX_ENTRY_COUNT = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = MAX_ENTRY_COUNT * 1_024;
const EARLIEST_PLAUSIBLE_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

type FetchLike = typeof fetch;

function errorCode(error: unknown): NightscoutErrorCode {
  return error instanceof NightscoutError ? error.code : "network";
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Nightscout could not be reached.";
}

async function ignoreOptionalSourceFailure<T>(work: Promise<T>) {
  try {
    return await work;
  } catch (error) {
    if (
      isLocalDataWriteSupersededError(error) ||
      isSourceConnectionSupersededError(error)
    ) {
      throw error;
    }
    return undefined;
  }
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
  return `${connection.baseUrl}/api/v1/entries/sgv.json?${query.join("&")}`;
}

function oversizedGlucoseResponse() {
  return new NightscoutError(
    "invalid-response",
    "The Nightscout glucose response is larger than T1 Arc accepts.",
  );
}

async function boundedResponseText(response: Response) {
  const advertisedLength = Number(
    response.headers.get("Content-Length") ?? 0,
  );
  if (
    Number.isFinite(advertisedLength) &&
    advertisedLength > MAX_RESPONSE_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // Preserve the deterministic invalid-response result even if the
      // transport cannot cancel an already-locked or failed body.
    }
    throw oversizedGlucoseResponse();
  }

  const stream = response.body;
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw oversizedGlucoseResponse();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  // React Native's default XHR-backed fetch resolves only after buffering the
  // response and exposes no ReadableStream. This fallback still enforces the
  // byte ceiling before UTF-8 decoding or JSON parsing, but cannot prevent the
  // native transport layer from having already buffered an unadvertised body.
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw oversizedGlucoseResponse();
  }
  return new TextDecoder().decode(buffer);
}

export class NightscoutGlucoseSource implements GlucoseSource {
  readonly sourceId = NIGHTSCOUT_SOURCE_ID;
  private refreshInFlight?: Promise<void>;
  private readonly saveIobCob: (
    snapshot: NightscoutIobCobSnapshot,
  ) => Promise<void>;
  private readonly clearIobCob: () => Promise<void>;
  private fallbackWriteLease?: Promise<LocalDataWriteLease>;

  constructor(
    private readonly connection: NightscoutConnection,
    private readonly store: GlucoseHistoryStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
    private readonly treatmentImporter?: NightscoutTreatmentImporter,
    saveIobCob?: (snapshot: NightscoutIobCobSnapshot) => Promise<void>,
    clearIobCob?: () => Promise<void>,
    private readonly writeLease?: LocalDataWriteLease,
    private readonly sourceWriteLease?: SourceConnectionWriteLease,
  ) {
    // Initialize callbacks after constructor parameters have been assigned.
    // Hermes 1.0 can crash while compiling a default parameter initializer
    // that captures another parameter property through `this`.
    this.saveIobCob =
      saveIobCob ??
      (async (snapshot) => {
        await this.getWriteLease();
        if (!this.sourceWriteLease) {
          throw new Error(
            'Nightscout IOB/COB persistence requires a source connection lease.',
          );
        }
        const snapshotStore = await import("./iobCobStore");
        await snapshotStore.saveNightscoutIobCobSnapshot(
          this.connection,
          snapshot,
          this.sourceWriteLease,
        );
      });
    this.clearIobCob =
      clearIobCob ??
      (async () => {
        await this.getWriteLease();
        if (!this.sourceWriteLease) {
          throw new Error(
            'Nightscout IOB/COB persistence requires a source connection lease.',
          );
        }
        const snapshotStore = await import("./iobCobStore");
        await snapshotStore.clearNightscoutIobCobSnapshot(
          this.sourceWriteLease,
        );
      });
  }

  private getWriteLease() {
    return this.writeLease
      ? Promise.resolve(this.writeLease)
      : (this.fallbackWriteLease ??= acquireLocalDataWriteLease());
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      await this.getWriteLease();
      await this.invalidateIobCobSnapshot();
      await this.importEntries(RECENT_ENTRY_COUNT);
      await this.refreshIobCobSnapshot();
      if (this.treatmentImporter) {
        await ignoreOptionalSourceFailure(this.treatmentImporter.refresh());
      }
    })().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  async importInitialHistory(days = 14) {
    await this.getWriteLease();
    const boundedDays = Math.min(17, Math.max(1, Math.round(days)));
    await this.invalidateIobCobSnapshot();
    await this.importEntries(
      Math.min(MAX_ENTRY_COUNT, boundedDays * 288 + 24),
      this.clock() - boundedDays * 86_400_000,
    );
    await this.refreshIobCobSnapshot();
    if (this.treatmentImporter) {
      await ignoreOptionalSourceFailure(
        this.treatmentImporter.importRange(
          this.clock() - boundedDays * 86_400_000,
          this.clock(),
        ),
      );
    }
    return this.store.getLatestReading(this.sourceId);
  }

  async importHistoryRange(startMs: number, endMs: number) {
    await this.getWriteLease();
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs >= endMs
    ) {
      throw new NightscoutError(
        "invalid-connection",
        "Nightscout history range is invalid.",
      );
    }
    await this.importEntries(MAX_ENTRY_COUNT, startMs, endMs);
    if (this.treatmentImporter) {
      await ignoreOptionalSourceFailure(
        this.treatmentImporter.importRange(startMs, endMs),
      );
    }
  }

  async getReadings(range: TimeRange) {
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    await this.store.initialize();
    await this.pruneImplausibleReadings();
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(now = this.clock()): Promise<DataSourceStatus> {
    await this.store.initialize();
    await this.pruneImplausibleReadings(now);
    const [latest, state, bounds] = await Promise.all([
      this.store.getLatestReading(this.sourceId),
      this.store.getSyncState(this.sourceId),
      this.store.getBounds(this.sourceId),
    ]);
    return {
      id: this.sourceId,
      label: "Nightscout",
      detail: `${nightscoutHost(this.connection)} · read-only glucose, treatments and profiles when supplied`,
      freshness: glucoseFreshness(latest?.timestamp, now),
      origin: "live",
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      capabilities: NIGHTSCOUT_GLUCOSE_CAPABILITIES,
      isLive: true,
    };
  }

  private async importEntries(count: number, since?: number, before?: number) {
    await this.store.initialize();
    const attemptedAt = this.clock();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      await this.pruneImplausibleReadings(attemptedAt);
      let response: Response;
      try {
        response = await this.fetcher(
          entriesEndpoint(this.connection, count, since, before),
          {
            method: "GET",
            headers: await nightscoutRequestHeaders(this.connection),
            signal: controller.signal,
          },
        );
      } catch {
        throw new NightscoutError(
          "network",
          "Nightscout could not be reached. Check the address and connection.",
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new NightscoutError(
          "authentication",
          "Nightscout rejected the connection. Use a readable access token, not an admin password.",
        );
      }
      if (!response.ok) {
        throw new NightscoutError(
          "network",
          `Nightscout returned HTTP ${response.status}.`,
        );
      }
      const body = await boundedResponseText(response);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new NightscoutError(
          "invalid-response",
          "Nightscout did not return a readable glucose response.",
        );
      }
      if (!Array.isArray(payload)) {
        throw new NightscoutError(
          "invalid-response",
          "Nightscout returned an unexpected glucose response.",
        );
      }
      if (payload.length > MAX_ENTRY_COUNT) {
        throw new NightscoutError(
          "invalid-response",
          "Nightscout returned more readings than T1 Arc can safely process at once.",
        );
      }
      const receivedAt = this.clock();
      const readings = (payload as NightscoutEntry[]).flatMap(
        (entry): GlucoseReading[] => {
          try {
            const entryTimestamp = Number(entry.date);
            if (
              entryTimestamp < EARLIEST_PLAUSIBLE_TIMESTAMP ||
              entryTimestamp > receivedAt + MAX_FUTURE_SKEW_MS
            ) {
              return [];
            }
            const normalized = normalizeXdripReading(
              {
                sgv: Number(entry.sgv),
                direction: entry.direction,
                date: entryTimestamp,
              },
              this.sourceId,
              receivedAt,
            );
            const sourceRecordId =
              typeof entry._id === "string" && entry._id.trim()
                ? entry._id.trim()
                : typeof entry.identifier === "string" &&
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
                  typeof entry.dateString === "string"
                    ? entry.dateString
                    : undefined,
                sourceDeviceId:
                  typeof entry.device === "string" ? entry.device : undefined,
              },
            ];
          } catch {
            return [];
          }
        },
      );
      if (payload.length > 0 && readings.length === 0) {
        throw new NightscoutError(
          "invalid-response",
          "Nightscout returned entries, but none contained a usable SGV and millisecond timestamp.",
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

  private async importIobCob() {
    const query = this.connection.accessToken
      ? `?token=${encodeURIComponent(this.connection.accessToken)}`
      : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(
        `${this.connection.baseUrl}/pebble${query}`,
        {
          method: "GET",
          headers: await nightscoutRequestHeaders(this.connection),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new NightscoutError(
          "network",
          `Nightscout IOB and COB returned HTTP ${response.status}.`,
        );
      }
      const payload = await response.json();
      const snapshot = normalizeNightscoutPebbleIobCob(payload, this.clock());
      if (!snapshot) {
        throw new NightscoutError(
          "invalid-response",
          "Nightscout returned no fresh, timestamped IOB or COB snapshot.",
        );
      }
      await this.saveIobCob(snapshot);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshIobCobSnapshot() {
    // IOB/COB is medically sensitive current-state data. Callers invalidate
    // the previous snapshot before the glucose request, so any failure in the
    // overall refresh cannot leave an old value looking current.
    if (!this.connection.includeIobCob) return;
    await ignoreOptionalSourceFailure(this.importIobCob());
  }

  private async invalidateIobCobSnapshot() {
    // Normalized and persisted connections always carry this preference. The
    // undefined case is retained only for legacy programmatic callers.
    if (this.connection.includeIobCob !== undefined) {
      await this.clearIobCob();
    }
  }

  private async pruneImplausibleReadings(now = this.clock()) {
    await this.store.pruneReadingsOutsideRange(
      this.sourceId,
      EARLIEST_PLAUSIBLE_TIMESTAMP,
      now + MAX_FUTURE_SKEW_MS,
    );
  }
}
