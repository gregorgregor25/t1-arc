import { DexcomShareConnection } from './types';
import { type LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import {
  forceClearEpochBoundSecureStoreValue,
} from '@/data/privacy/localDataEpochSecureStore';
import {
  activateSourceOwnedSecureStoreBundle,
  beginSourceOwnedConnectionChange,
  digestSourceConnectionIdentity,
  disconnectSourceOwnedSecureStoreBundle,
  loadSourceOwnedSecureStoreBundle,
  type SourceOwnedActivationOptions,
  type SourceOwnedSecureStoreSpec,
} from '@/data/live/sourceOwnedSecureStore';
import { createUnknownSourceOwnerPrivacyBoundary } from '@/data/live/sourceOwnerPrivacyBoundary';
import type { SourceConnectionCandidateLease } from '@/data/live/sourceConnectionOwnership';

const DEXCOM_SHARE_CONNECTION_KEY = 't1arc.dexcom-share.connection.v1';

function parseDexcomShareConnection(value: unknown) {
  const candidate = value as Partial<DexcomShareConnection> | null;
  return candidate &&
    typeof candidate.username === 'string' &&
    typeof candidate.password === 'string' &&
    (candidate.region === 'international' ||
      candidate.region === 'us' ||
      candidate.region === 'japan')
    ? {
        username: candidate.username,
        password: candidate.password,
        region: candidate.region,
      }
    : undefined;
}

const dexcomShareSecureStoreSpec: SourceOwnedSecureStoreSpec<{
  connection: DexcomShareConnection;
}> = {
  sourceId: 'dexcom-share',
  primaryField: 'connection',
  fields: {
    connection: {
      key: DEXCOM_SHARE_CONNECTION_KEY,
      parse: parseDexcomShareConnection,
    },
  },
  identityDigest: ({ connection }) =>
    digestSourceConnectionIdentity('dexcom-share', [
      connection?.username.trim().toLowerCase() ?? '',
      connection?.region ?? '',
    ]),
  beforeLegacyBootstrap:
    createUnknownSourceOwnerPrivacyBoundary('dexcom-share'),
};

export async function loadOwnedDexcomShareConnection(
  lease?: LocalDataWriteLease,
) {
  return loadSourceOwnedSecureStoreBundle(dexcomShareSecureStoreSpec, lease);
}

export async function loadDexcomShareConnection(lease?: LocalDataWriteLease) {
  return (await loadOwnedDexcomShareConnection(lease)).values.connection;
}

export function beginDexcomShareConnectionChange(lease?: LocalDataWriteLease) {
  return beginSourceOwnedConnectionChange(dexcomShareSecureStoreSpec, lease);
}

export function activateDexcomShareConnection(
  candidate: SourceConnectionCandidateLease,
  connection: DexcomShareConnection,
  options?: SourceOwnedActivationOptions,
) {
  return activateSourceOwnedSecureStoreBundle(
    dexcomShareSecureStoreSpec,
    candidate,
    { connection },
    options,
  );
}

export function disconnectDexcomShareConnection(lease?: LocalDataWriteLease) {
  return disconnectSourceOwnedSecureStoreBundle(
    dexcomShareSecureStoreSpec,
    lease,
  );
}

/** Physical privacy-erase cleanup. Ordinary disconnect uses the tombstone above. */
export async function clearDexcomShareConnection() {
  await forceClearEpochBoundSecureStoreValue(DEXCOM_SHARE_CONNECTION_KEY);
}
