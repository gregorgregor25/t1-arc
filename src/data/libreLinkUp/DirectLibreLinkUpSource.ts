import { LibreLinkUpClient } from './LibreLinkUpClient';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from './constants';
import { LibreLinkUpCredentials, LibreLinkUpError } from './types';
import {
  loadLibreLinkUpSession,
  saveLibreLinkUpSession,
  sha256,
} from './secureStore';
import { directLibreRefreshInterval } from './refreshPolicy';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  MemoryGlucoseHistoryStore,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import { DataSourceStatus, TimeRange } from '@/domain/models';

export class DirectLibreLinkUpSource implements GlucoseSource {
  readonly sourceId = DIRECT_LIBRE_LINKUP_SOURCE_ID;
  private lastAttemptAt = 0;
  private initialization?: Promise<void>;
  private refreshInFlight?: Promise<void>;
  private lastError?: LibreLinkUpError;
  private client?: LibreLinkUpClient;

  constructor(
    private readonly credentials: LibreLinkUpCredentials,
    private readonly store: GlucoseHistoryStore =
      new MemoryGlucoseHistoryStore(),
  ) {}

  private async initialize() {
    this.initialization ??= (async () => {
      await this.store.initialize();
      const state = await this.store.getSyncState(this.sourceId);
      this.lastAttemptAt = state?.lastAttemptAt ?? 0;
    })();
    return this.initialization;
  }

  private async getClient() {
    if (!this.client) {
      const session = await loadLibreLinkUpSession();
      this.client = new LibreLinkUpClient(
        this.credentials,
        sha256,
        globalThis.fetch,
        session,
        saveLibreLinkUpSession,
      );
    }
    return this.client;
  }

  private async sync(force = false) {
    await this.initialize();
    if (this.refreshInFlight) return this.refreshInFlight;
    const now = Date.now();
    const [currentState, latest] = await Promise.all([
      this.store.getSyncState(this.sourceId),
      this.store.getLatestReading(this.sourceId),
    ]);
    this.lastAttemptAt = Math.max(
      this.lastAttemptAt,
      currentState?.lastAttemptAt ?? 0,
    );
    const refreshInterval = directLibreRefreshInterval(
      latest?.timestamp,
      currentState?.lastErrorCode,
      now,
    );
    if (!force && now - this.lastAttemptAt < refreshInterval) {
      const bounds = await this.store.getBounds(this.sourceId);
      if (this.lastError && bounds.count === 0) throw this.lastError;
      return;
    }

    const attemptAt = now;
    this.lastAttemptAt = attemptAt;
    this.refreshInFlight = (async () => {
      const previousState = await this.store.getSyncState(this.sourceId);
      const previousBounds = await this.store.getBounds(this.sourceId);
      await this.store.saveSyncState({
        sourceId: this.sourceId,
        lastAttemptAt: attemptAt,
        lastSuccessAt: previousState?.lastSuccessAt,
        lastErrorCode: previousState?.lastErrorCode,
        lastErrorMessage: previousState?.lastErrorMessage,
        recordCount: previousBounds.count,
      });

      try {
        const client = await this.getClient();
        const snapshot = await client.getSnapshot();
        await this.store.upsertReadings(snapshot.readings);
        const bounds = await this.store.getBounds(this.sourceId);
        await this.store.saveSyncState({
          sourceId: this.sourceId,
          lastAttemptAt: attemptAt,
          lastSuccessAt: Date.now(),
          recordCount: bounds.count,
        });
        this.lastError = undefined;
      } catch (error) {
        this.lastError =
          error instanceof LibreLinkUpError
            ? error
            : new LibreLinkUpError(
                'network',
                error instanceof Error
                  ? error.message
                  : 'Direct glucose refresh failed.',
              );
        const bounds = await this.store.getBounds(this.sourceId);
        await this.store.saveSyncState({
          sourceId: this.sourceId,
          lastAttemptAt: attemptAt,
          lastSuccessAt: previousState?.lastSuccessAt,
          lastErrorCode: this.lastError.code,
          lastErrorMessage: this.lastError.message,
          recordCount: bounds.count,
        });
        throw this.lastError;
      } finally {
        this.refreshInFlight = undefined;
      }
    })();
    return this.refreshInFlight;
  }

  /**
   * Polls more closely around the next expected Libre reading, while retaining
   * a one-minute baseline and an explicit rate-limit backoff.
   */
  async refresh() {
    await this.sync();
  }

  async getReadings(range: TimeRange) {
    try {
      await this.sync();
    } catch (error) {
      const bounds = await this.store.getBounds(this.sourceId);
      if (bounds.count === 0) throw error;
    }
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    try {
      await this.sync();
    } catch (error) {
      const bounds = await this.store.getBounds(this.sourceId);
      if (bounds.count === 0) throw error;
    }
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    try {
      await this.sync();
    } catch {
      // The status below exposes the failure without discarding cached history.
    }
    const [latest, state, bounds] = await Promise.all([
      this.store.getLatestReading(this.sourceId),
      this.store.getSyncState(this.sourceId),
      this.store.getBounds(this.sourceId),
    ]);
    const freshness = glucoseFreshness(latest?.timestamp, now);
    const hasError = Boolean(state?.lastErrorCode);
    return {
      id: this.sourceId,
      label: 'Glucose',
      detail: hasError
        ? `Saved LibreLinkUp history · ${state?.lastErrorMessage}`
        : 'T1 Arc direct LibreLinkUp · encrypted local history',
      freshness:
        hasError && freshness === 'current' ? 'delayed' : freshness,
      origin: 'live',
      lastAttemptAt: state?.lastAttemptAt,
      lastUpdatedAt: state?.lastSuccessAt,
      dataThrough: latest?.timestamp,
      recordCount: bounds.count,
      errorCode: state?.lastErrorCode,
      isLive: true,
    };
  }
}
