import { LibreLinkUpClient } from './LibreLinkUpClient';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from './constants';
import {
  LibreLinkUpCredentials,
  LibreLinkUpError,
  LibreLinkUpErrorCode,
} from './types';
import {
  loadLibreLinkUpSession,
  saveLibreLinkUpSession,
  sha256,
} from './secureStore';
import {
  DIRECT_LIBRE_ATTEMPT_LEASE_MS,
  DirectLibreRefreshReason,
  directLibreRefreshInterval,
} from './refreshPolicy';
import { GlucoseSource } from '@/data/contracts';
import {
  GlucoseHistoryStore,
  MemoryGlucoseHistoryStore,
  sourceSyncAttemptDue,
} from '@/data/persistence/GlucoseHistoryStore';
import { glucoseFreshness } from '@/domain/freshness';
import { DataSourceStatus, TimeRange } from '@/domain/models';
import { type LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import type { SourceConnectionWriteLease } from '@/data/live/sourceConnectionOwnership';

let sharedDirectRefresh:
  | { ownerKey: string; promise: Promise<void> }
  | undefined;

const LIBRE_LINKUP_ERROR_CODES = new Set<LibreLinkUpErrorCode>([
  'invalid-credentials',
  'action-required',
  'rate-limited',
  'patient-selection-required',
  'unsupported-api',
  'network',
  'invalid-response',
]);

function persistedLibreLinkUpError(
  code: string | undefined,
  message: string | undefined,
) {
  const validatedCode =
    code && LIBRE_LINKUP_ERROR_CODES.has(code as LibreLinkUpErrorCode)
      ? (code as LibreLinkUpErrorCode)
      : 'network';
  return new LibreLinkUpError(
    validatedCode,
    message ?? 'Direct glucose refresh failed.',
  );
}

function validatedNetworkMayRetry(
  reason: DirectLibreRefreshReason | undefined,
  errorCode: string | undefined,
) {
  return (
    reason === 'validated-network' &&
    (errorCode === 'network' || errorCode === 'invalid-response')
  );
}

function cancelledLibreRefresh() {
  return new LibreLinkUpError(
    'network',
    'Direct glucose refresh was cancelled before it completed.',
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelledLibreRefresh();
}

function waitForPromiseOrAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      reject(cancelledLibreRefresh());
    };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      },
    );
  });
}

async function waitForAttemptLease(
  lastAttemptAt: number | undefined,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (lastAttemptAt === undefined) return;
  const remaining = Math.max(
    0,
    lastAttemptAt + DIRECT_LIBRE_ATTEMPT_LEASE_MS - Date.now(),
  );
  if (remaining > 0) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await waitForPromiseOrAbort(
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, remaining);
      }),
      signal,
    ).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
  }
}

export interface DirectLibreLinkUpSourceOptions {
  refreshReason?: DirectLibreRefreshReason;
  signal?: AbortSignal;
  writeLease?: LocalDataWriteLease;
  sourceWriteLease?: SourceConnectionWriteLease;
}

export class DirectLibreLinkUpSource implements GlucoseSource {
  readonly sourceId = DIRECT_LIBRE_LINKUP_SOURCE_ID;
  private initialization?: Promise<void>;
  private client?: LibreLinkUpClient;
  private nextRefreshReason?: DirectLibreRefreshReason;
  private readonly signal?: AbortSignal;
  private readonly writeLease?: LocalDataWriteLease;
  private readonly sourceWriteLease?: SourceConnectionWriteLease;
  private readonly refreshOwnerKey: string;

  constructor(
    private readonly credentials: LibreLinkUpCredentials,
    private readonly store: GlucoseHistoryStore =
      new MemoryGlucoseHistoryStore(),
    options: DirectLibreLinkUpSourceOptions = {},
  ) {
    this.nextRefreshReason = options.refreshReason;
    this.signal = options.signal;
    this.sourceWriteLease = options.sourceWriteLease;
    this.refreshOwnerKey = options.sourceWriteLease
      ? `${options.sourceWriteLease.localDataWriteLease.epoch}:${options.sourceWriteLease.ownerGeneration}:${options.sourceWriteLease.identityDigest}`
      : 'unleased-direct-libre';
    this.writeLease =
      options.writeLease ?? options.sourceWriteLease?.localDataWriteLease;
  }

  private async initialize() {
    this.initialization ??= (async () => {
      await this.store.initialize();
    })();
    return this.initialization;
  }

  private async getClient() {
    if (!this.client) {
      const session = await loadLibreLinkUpSession(this.writeLease);
      this.client = new LibreLinkUpClient(
        this.credentials,
        sha256,
        globalThis.fetch,
        session,
        this.sourceWriteLease
          ? (nextSession) =>
              saveLibreLinkUpSession(nextSession, this.sourceWriteLease!)
          : undefined,
      );
    }
    return this.client;
  }

  private async sync() {
    // Task-data reasons are edge triggers, not sticky source configuration.
    const refreshReason = this.nextRefreshReason;
    this.nextRefreshReason = undefined;
    await this.syncWithReason(refreshReason, true);
  }

  private async syncWithReason(
    refreshReason: DirectLibreRefreshReason | undefined,
    mayWaitForValidatedLease: boolean,
  ): Promise<void> {
    throwIfAborted(this.signal);
    await this.initialize();
    throwIfAborted(this.signal);
    if (sharedDirectRefresh?.ownerKey === this.refreshOwnerKey) {
      const owner = sharedDirectRefresh.promise;
      try {
        await waitForPromiseOrAbort(owner, this.signal);
        // A successful owner already used the newly validated connection.
        return;
      } catch (error) {
        const state = await this.store.getSyncState(this.sourceId);
        if (
          !mayWaitForValidatedLease ||
          !validatedNetworkMayRetry(refreshReason, state?.lastErrorCode)
        ) {
          throw error;
        }
        // Preserve a network-available edge that arrived during the failed
        // handover request. Wait only for the short attempt lease, then consume
        // the edge in one CAS-authorised recovery attempt.
        await waitForAttemptLease(state?.lastAttemptAt, this.signal);
        return this.syncWithReason(refreshReason, false);
      }
    }
    const now = Date.now();
    const [currentState, latest] = await Promise.all([
      this.store.getSyncState(this.sourceId),
      this.store.getLatestReading(this.sourceId),
    ]);
    const refreshInterval = directLibreRefreshInterval(
      latest?.timestamp,
      currentState?.lastErrorCode,
      now,
      refreshReason,
    );
    const minimumInterval = Math.max(
      refreshInterval,
      DIRECT_LIBRE_ATTEMPT_LEASE_MS,
    );
    // Native display ticks are deliberately frequent. Avoid opening a keyed
    // write transaction when the state already proves this source is not due;
    // claimSyncAttempt remains the authoritative CAS when it is due.
    if (
      !sourceSyncAttemptDue(
        currentState?.lastAttemptAt,
        now,
        minimumInterval,
      )
    ) {
      if (
        mayWaitForValidatedLease &&
        validatedNetworkMayRetry(
          refreshReason,
          currentState?.lastErrorCode,
        )
      ) {
        await waitForAttemptLease(currentState?.lastAttemptAt, this.signal);
        return this.syncWithReason(refreshReason, false);
      }
      if (currentState?.lastErrorCode && !latest) {
        throw persistedLibreLinkUpError(
          currentState.lastErrorCode,
          currentState.lastErrorMessage,
        );
      }
      return;
    }
    const claimed = await this.store.claimSyncAttempt(
      this.sourceId,
      now,
      minimumInterval,
      currentState ?? null,
    );
    if (!claimed) {
      // Another runtime may have changed both the retry reason and history
      // after our precheck. Re-read only on this rare CAS-loss path.
      const [latestState, currentLatest] = await Promise.all([
        this.store.getSyncState(this.sourceId),
        this.store.getLatestReading(this.sourceId),
      ]);
      if (latestState?.lastErrorCode && !currentLatest) {
        throw persistedLibreLinkUpError(
          latestState.lastErrorCode,
          latestState.lastErrorMessage,
        );
      }
      return;
    }

    const attemptAt = now;
    const refresh = (async () => {
      const claimedState = await this.store.getSyncState(this.sourceId);
      const previousBounds = await this.store.getBounds(this.sourceId);

      try {
        const client = await this.getClient();
        // Each HTTP request is bounded by LibreLinkUpClient. Do not impose a
        // shorter whole-chain deadline: re-authentication legitimately needs
        // several sequential requests on a slow mobile handover.
        const snapshot = await client.getSnapshot(this.signal);
        throwIfAborted(this.signal);
        await this.store.upsertReadings(snapshot.readings);
        const bounds = await this.store.getBounds(this.sourceId);
        await this.store.completeSyncAttempt(
          {
            sourceId: this.sourceId,
            lastAttemptAt: attemptAt,
            lastSuccessAt: Date.now(),
            recordCount: bounds.count,
          },
          attemptAt,
        );
      } catch (error) {
        const normalizedError =
          error instanceof LibreLinkUpError
            ? error
            : new LibreLinkUpError(
                'network',
                error instanceof Error
                  ? error.message
                  : 'Direct glucose refresh failed.',
              );
        const bounds = await this.store.getBounds(this.sourceId);
        await this.store.completeSyncAttempt(
          {
            sourceId: this.sourceId,
            lastAttemptAt: attemptAt,
            lastSuccessAt: claimedState?.lastSuccessAt,
            lastErrorCode: normalizedError.code,
            lastErrorMessage: normalizedError.message,
            recordCount: Math.max(previousBounds.count, bounds.count),
          },
          attemptAt,
        );
        throw normalizedError;
      }
    })();
    const shared = refresh.finally(() => {
      if (sharedDirectRefresh?.promise === shared) {
        sharedDirectRefresh = undefined;
      }
    });
    sharedDirectRefresh = { ownerKey: this.refreshOwnerKey, promise: shared };
    await shared;
  }

  /**
   * Polls more closely around the next expected Libre reading, while retaining
   * a one-minute baseline and an explicit rate-limit backoff.
   */
  async refresh() {
    await this.sync();
  }

  async getReadings(range: TimeRange) {
    await this.initialize();
    return this.store.getReadings(range, this.sourceId);
  }

  async getLatestReading() {
    await this.initialize();
    return this.store.getLatestReading(this.sourceId);
  }

  async getStatus(now = Date.now()): Promise<DataSourceStatus> {
    // Status rendering must never become another polling owner. Foreground,
    // headless and explicit refresh paths coordinate sync; this method only
    // reports their persisted result.
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
      // A retained request error is separate diagnostic metadata. Freshness
      // describes the newest measurement timestamp, so a genuinely current
      // cached reading must remain current while the next retry is pending.
      freshness,
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
