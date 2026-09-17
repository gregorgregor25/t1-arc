import { XdripConnection } from './types';
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

const XDRIP_CONNECTION_KEY = 't1arc.xdrip.connection.v1';

function parseXdripConnection(value: unknown) {
  const candidate = value as Partial<XdripConnection> | null;
  return candidate && typeof candidate.endpointUrl === 'string'
    ? { endpointUrl: candidate.endpointUrl }
    : undefined;
}

const xdripSecureStoreSpec: SourceOwnedSecureStoreSpec<{
  connection: XdripConnection;
}> = {
  sourceId: 'xdrip-local',
  primaryField: 'connection',
  fields: {
    connection: {
      key: XDRIP_CONNECTION_KEY,
      parse: parseXdripConnection,
    },
  },
  identityDigest: ({ connection }) =>
    digestSourceConnectionIdentity('xdrip-local', [
      connection?.endpointUrl.trim() ?? '',
    ]),
  beforeLegacyBootstrap:
    createUnknownSourceOwnerPrivacyBoundary('xdrip-local'),
};

export async function loadOwnedXdripConnection(lease?: LocalDataWriteLease) {
  return loadSourceOwnedSecureStoreBundle(xdripSecureStoreSpec, lease);
}

export async function loadXdripConnection(lease?: LocalDataWriteLease) {
  return (await loadOwnedXdripConnection(lease)).values.connection;
}

export function beginXdripConnectionChange(lease?: LocalDataWriteLease) {
  return beginSourceOwnedConnectionChange(xdripSecureStoreSpec, lease);
}

export function activateXdripConnection(
  candidate: SourceConnectionCandidateLease,
  connection: XdripConnection,
  options?: SourceOwnedActivationOptions,
) {
  return activateSourceOwnedSecureStoreBundle(
    xdripSecureStoreSpec,
    candidate,
    { connection },
    options,
  );
}

export function disconnectXdripConnection(lease?: LocalDataWriteLease) {
  return disconnectSourceOwnedSecureStoreBundle(xdripSecureStoreSpec, lease);
}

/** Physical privacy-erase cleanup. Ordinary disconnect uses the tombstone above. */
export async function clearXdripConnection() {
  await forceClearEpochBoundSecureStoreValue(XDRIP_CONNECTION_KEY);
}
