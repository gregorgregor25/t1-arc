import { NightscoutConnection } from './types';
import type { NightscoutIobCobSnapshot } from './types';
import type { NightscoutHistoryState } from './historyBackfill';
import { isDateKey } from '@/domain/time';
import type { LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import { forceClearEpochBoundSecureStoreValue } from '@/data/privacy/localDataEpochSecureStore';
import {
  activateSourceOwnedSecureStoreBundle,
  beginSourceOwnedConnectionChange,
  digestSourceConnectionIdentity,
  disconnectSourceOwnedSecureStoreBundle,
  loadSourceOwnedSecureStoreBundle,
  updateSourceOwnedSecureStoreField,
  clearSourceOwnedSecureStoreField,
  type SourceOwnedActivationOptions,
  type SourceOwnedSecureStoreSpec,
} from '@/data/live/sourceOwnedSecureStore';
import { createUnknownSourceOwnerPrivacyBoundary } from '@/data/live/sourceOwnerPrivacyBoundary';
import type {
  SourceConnectionCandidateLease,
  SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';

const NIGHTSCOUT_CONNECTION_KEY = 't1arc.nightscout.connection.v1';
const NIGHTSCOUT_HISTORY_STATE_KEY = 't1arc.nightscout.history-state.v1';
const NIGHTSCOUT_IOB_COB_KEY = 't1arc.nightscout.iob-cob.v1';

export interface StoredNightscoutIobCobSnapshot {
  version: 2;
  connectionFingerprint: string;
  snapshot: NightscoutIobCobSnapshot;
}

function parseNightscoutConnection(value: unknown) {
  const candidate = value as Partial<NightscoutConnection> | null;
  return candidate &&
    typeof candidate.baseUrl === 'string' &&
    (candidate.accessToken === undefined ||
      typeof candidate.accessToken === 'string') &&
    (candidate.apiSecret === undefined ||
      typeof candidate.apiSecret === 'string') &&
    (candidate.includeIobCob === undefined ||
      typeof candidate.includeIobCob === 'boolean')
    ? {
        baseUrl: candidate.baseUrl,
        accessToken: candidate.accessToken,
        apiSecret: candidate.apiSecret,
        includeIobCob: candidate.includeIobCob !== false,
      }
    : undefined;
}

function parseNightscoutHistoryState(value: unknown) {
  const candidate = value as Partial<NightscoutHistoryState> | null;
  if (!candidate || typeof candidate !== 'object') return undefined;
  return {
    targetDate:
      candidate.targetDate && isDateKey(candidate.targetDate)
        ? candidate.targetDate
        : undefined,
    cursorBeforeMs:
      typeof candidate.cursorBeforeMs === 'number' &&
      Number.isFinite(candidate.cursorBeforeMs)
        ? candidate.cursorBeforeMs
        : undefined,
    lastAttemptAt:
      typeof candidate.lastAttemptAt === 'number' &&
      Number.isFinite(candidate.lastAttemptAt)
        ? candidate.lastAttemptAt
        : undefined,
    lastSuccessAt:
      typeof candidate.lastSuccessAt === 'number' &&
      Number.isFinite(candidate.lastSuccessAt)
        ? candidate.lastSuccessAt
        : undefined,
    completedAt:
      typeof candidate.completedAt === 'number' &&
      Number.isFinite(candidate.completedAt)
        ? candidate.completedAt
        : undefined,
    lastError:
      typeof candidate.lastError === 'string'
        ? candidate.lastError
        : undefined,
  };
}

function parseNightscoutIobCob(value: unknown) {
  const candidate = value as Partial<StoredNightscoutIobCobSnapshot> | null;
  const snapshot = candidate?.snapshot;
  return candidate?.version === 2 &&
    typeof candidate.connectionFingerprint === 'string' &&
    snapshot &&
    typeof snapshot.timestamp === 'number' &&
    Number.isFinite(snapshot.timestamp) &&
    (snapshot.iobUnits === undefined ||
      (typeof snapshot.iobUnits === 'number' &&
        Number.isFinite(snapshot.iobUnits))) &&
    (snapshot.cobGrams === undefined ||
      (typeof snapshot.cobGrams === 'number' &&
        Number.isFinite(snapshot.cobGrams)))
    ? {
        version: 2 as const,
        connectionFingerprint: candidate.connectionFingerprint,
        snapshot: {
          timestamp: snapshot.timestamp,
          iobUnits: snapshot.iobUnits,
          cobGrams: snapshot.cobGrams,
        },
      }
    : undefined;
}

const nightscoutSecureStoreSpec: SourceOwnedSecureStoreSpec<{
  connection: NightscoutConnection;
  historyState: NightscoutHistoryState;
  iobCob: StoredNightscoutIobCobSnapshot;
}> = {
  sourceId: 'nightscout',
  primaryField: 'connection',
  fields: {
    connection: {
      key: NIGHTSCOUT_CONNECTION_KEY,
      parse: parseNightscoutConnection,
    },
    historyState: {
      key: NIGHTSCOUT_HISTORY_STATE_KEY,
      parse: parseNightscoutHistoryState,
    },
    iobCob: {
      key: NIGHTSCOUT_IOB_COB_KEY,
      parse: parseNightscoutIobCob,
    },
  },
  identityDigest: ({ connection }) =>
    digestSourceConnectionIdentity('nightscout', [
      connection?.baseUrl.trim() ?? '',
    ]),
  beforeLegacyBootstrap:
    createUnknownSourceOwnerPrivacyBoundary('nightscout', true),
};

export async function loadOwnedNightscoutConnection(
  lease?: LocalDataWriteLease,
) {
  return loadSourceOwnedSecureStoreBundle(nightscoutSecureStoreSpec, lease);
}

export async function loadNightscoutConnection(lease?: LocalDataWriteLease) {
  return (await loadOwnedNightscoutConnection(lease)).values.connection;
}

export function beginNightscoutConnectionChange(lease?: LocalDataWriteLease) {
  return beginSourceOwnedConnectionChange(nightscoutSecureStoreSpec, lease);
}

export function activateNightscoutConnection(
  candidate: SourceConnectionCandidateLease,
  connection: NightscoutConnection,
  options?: SourceOwnedActivationOptions,
) {
  return activateSourceOwnedSecureStoreBundle(
    nightscoutSecureStoreSpec,
    candidate,
    { connection },
    options,
  );
}

export function disconnectNightscoutConnection(lease?: LocalDataWriteLease) {
  return disconnectSourceOwnedSecureStoreBundle(
    nightscoutSecureStoreSpec,
    lease,
  );
}

export function updateOwnedNightscoutHistoryState(
  state: NightscoutHistoryState,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  return updateSourceOwnedSecureStoreField(
    nightscoutSecureStoreSpec,
    'historyState',
    state,
    sourceWriteLease,
  );
}

export function updateOwnedNightscoutIobCob(
  stored: StoredNightscoutIobCobSnapshot,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  return updateSourceOwnedSecureStoreField(
    nightscoutSecureStoreSpec,
    'iobCob',
    stored,
    sourceWriteLease,
  );
}

export function clearOwnedNightscoutIobCob(
  sourceWriteLease: SourceConnectionWriteLease,
) {
  return clearSourceOwnedSecureStoreField(
    nightscoutSecureStoreSpec,
    'iobCob',
    sourceWriteLease,
  );
}

/** Physical privacy-erase cleanup. Ordinary disconnect uses the tombstone. */
export async function clearNightscoutConnection() {
  await Promise.all([
    forceClearEpochBoundSecureStoreValue(NIGHTSCOUT_CONNECTION_KEY),
    forceClearEpochBoundSecureStoreValue(NIGHTSCOUT_HISTORY_STATE_KEY),
    forceClearEpochBoundSecureStoreValue(NIGHTSCOUT_IOB_COB_KEY),
  ]);
}
