import { MedtrumConnection } from './types';
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

const MEDTRUM_CONNECTION_KEY = 't1arc.medtrum.connection.v1';

function parseMedtrumConnection(value: unknown) {
  const candidate = value as Partial<MedtrumConnection> | null;
  return candidate &&
    typeof candidate.username === 'string' &&
    typeof candidate.password === 'string' &&
    (candidate.region === 'eu' || candidate.region === 'fr') &&
    (candidate.glucoseUnit === undefined ||
      candidate.glucoseUnit === 'mmolL' ||
      candidate.glucoseUnit === 'mgDl') &&
    (candidate.patientId === undefined ||
      typeof candidate.patientId === 'string') &&
    (candidate.patientName === undefined ||
      typeof candidate.patientName === 'string')
    ? {
        username: candidate.username,
        password: candidate.password,
        region: candidate.region,
        glucoseUnit: candidate.glucoseUnit ?? 'mmolL',
        patientId: candidate.patientId,
        patientName: candidate.patientName,
      }
    : undefined;
}

const medtrumSecureStoreSpec: SourceOwnedSecureStoreSpec<{
  connection: MedtrumConnection;
}> = {
  sourceId: 'medtrum-easyfollow',
  primaryField: 'connection',
  fields: {
    connection: {
      key: MEDTRUM_CONNECTION_KEY,
      parse: parseMedtrumConnection,
    },
  },
  identityDigest: ({ connection }) =>
    digestSourceConnectionIdentity('medtrum-easyfollow', [
      connection?.username.trim().toLowerCase() ?? '',
      connection?.region ?? '',
      connection?.glucoseUnit ?? 'mmolL',
      connection?.patientId?.trim() ?? '',
    ]),
  beforeLegacyBootstrap:
    createUnknownSourceOwnerPrivacyBoundary('medtrum-easyfollow'),
};

export async function loadOwnedMedtrumConnection(lease?: LocalDataWriteLease) {
  return loadSourceOwnedSecureStoreBundle(medtrumSecureStoreSpec, lease);
}

export async function loadMedtrumConnection(lease?: LocalDataWriteLease) {
  return (await loadOwnedMedtrumConnection(lease)).values.connection;
}

export function beginMedtrumConnectionChange(lease?: LocalDataWriteLease) {
  return beginSourceOwnedConnectionChange(medtrumSecureStoreSpec, lease);
}

export function activateMedtrumConnection(
  candidate: SourceConnectionCandidateLease,
  connection: MedtrumConnection,
  options?: SourceOwnedActivationOptions,
) {
  return activateSourceOwnedSecureStoreBundle(
    medtrumSecureStoreSpec,
    candidate,
    { connection },
    options,
  );
}

export function disconnectMedtrumConnection(lease?: LocalDataWriteLease) {
  return disconnectSourceOwnedSecureStoreBundle(medtrumSecureStoreSpec, lease);
}

/** Physical privacy-erase cleanup. Ordinary disconnect uses the tombstone above. */
export async function clearMedtrumConnection() {
  await forceClearEpochBoundSecureStoreValue(MEDTRUM_CONNECTION_KEY);
}
