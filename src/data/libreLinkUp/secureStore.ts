import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { LibreLinkUpCredentials, LibreLinkUpSession } from "./types";
import type { LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";
import { forceClearEpochBoundSecureStoreValue } from '@/data/privacy/localDataEpochSecureStore';
import {
  activateSourceOwnedSecureStoreBundle,
  beginSourceOwnedConnectionChange,
  digestSourceConnectionIdentity,
  disconnectSourceOwnedSecureStoreBundle,
  loadSourceOwnedSecureStoreBundle,
  updateSourceOwnedSecureStoreField,
  type SourceOwnedActivationOptions,
  type SourceOwnedSecureStoreSpec,
} from '@/data/live/sourceOwnedSecureStore';
import { createUnknownSourceOwnerPrivacyBoundary } from '@/data/live/sourceOwnerPrivacyBoundary';
import type {
  SourceConnectionCandidateLease,
  SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';

const CREDENTIALS_KEY = "t1arc.librelinkup.credentials.v1";
const SESSION_KEY = "t1arc.librelinkup.session.v1";
const DATA_MODE_KEY = "t1arc.data.mode.v1";

export type DataMode = "live" | "demo";

export async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

function parseCredentials(value: unknown) {
  const candidate = value as Partial<LibreLinkUpCredentials> | null;
  return candidate &&
    typeof candidate.email === 'string' &&
    typeof candidate.password === 'string' &&
    (candidate.topLevelDomain === 'io' || candidate.topLevelDomain === 'us')
    ? {
        email: candidate.email,
        password: candidate.password,
        topLevelDomain: candidate.topLevelDomain,
      }
    : undefined;
}

function parseSession(value: unknown) {
  const candidate = value as Partial<LibreLinkUpSession> | null;
  return candidate &&
    typeof candidate.token === 'string' &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    typeof candidate.userId === 'string' &&
    typeof candidate.region === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.accountEmail === 'string' &&
    (candidate.patientId === undefined || typeof candidate.patientId === 'string')
    ? {
        token: candidate.token,
        expiresAt: candidate.expiresAt,
        userId: candidate.userId,
        region: candidate.region,
        version: candidate.version,
        accountEmail: candidate.accountEmail,
        patientId: candidate.patientId,
      }
    : undefined;
}

export async function digestLibreLinkUpOwnerIdentity(
  credentials: LibreLinkUpCredentials | undefined,
  session: LibreLinkUpSession | undefined,
) {
  const accountEmail = credentials?.email.trim().toLowerCase();
  const verifiedAccountEmail = session?.accountEmail.trim().toLowerCase();
  const userId = session?.userId.trim();
  const patientId = session?.patientId?.trim();
  if (
    !accountEmail ||
    !verifiedAccountEmail ||
    accountEmail !== verifiedAccountEmail ||
    !userId ||
    !patientId
  ) {
    throw new Error(
      'The LibreLinkUp owner is not bound to a verified account and patient.',
    );
  }
  return digestSourceConnectionIdentity('t1arc-librelinkup', [
    accountEmail,
    credentials?.topLevelDomain ?? '',
    verifiedAccountEmail,
    userId,
    patientId,
  ]);
}

const libreUnknownOwnerPrivacyBoundary =
  createUnknownSourceOwnerPrivacyBoundary('t1arc-librelinkup');

const libreSecureStoreSpec: SourceOwnedSecureStoreSpec<{
  credentials: LibreLinkUpCredentials;
  session: LibreLinkUpSession;
}> = {
  sourceId: 't1arc-librelinkup',
  primaryField: 'credentials',
  fields: {
    credentials: { key: CREDENTIALS_KEY, parse: parseCredentials },
    session: { key: SESSION_KEY, parse: parseSession },
  },
  identityDigest: ({ credentials, session }) =>
    digestLibreLinkUpOwnerIdentity(credentials, session),
  legacyIdentityDigests: ({ credentials }) =>
    credentials
      ? Promise.all([
          digestSourceConnectionIdentity('t1arc-librelinkup', [
            credentials.email.trim().toLowerCase(),
            credentials.topLevelDomain,
          ]),
        ])
      : Promise.resolve([]),
  beforeLegacyBootstrap: libreUnknownOwnerPrivacyBoundary,
  beforeLegacyIdentityMigration: libreUnknownOwnerPrivacyBoundary,
};

export async function loadOwnedLibreLinkUpConnection(
  lease?: LocalDataWriteLease,
) {
  return loadSourceOwnedSecureStoreBundle(libreSecureStoreSpec, lease);
}

export async function loadLibreLinkUpCredentials(
  lease?: LocalDataWriteLease,
) {
  return (await loadOwnedLibreLinkUpConnection(lease)).values.credentials;
}

export function beginLibreLinkUpConnectionChange(lease?: LocalDataWriteLease) {
  return beginSourceOwnedConnectionChange(libreSecureStoreSpec, lease);
}

export function activateLibreLinkUpConnection(
  candidate: SourceConnectionCandidateLease,
  credentials: LibreLinkUpCredentials,
  session: LibreLinkUpSession | undefined,
  options?: SourceOwnedActivationOptions,
) {
  return activateSourceOwnedSecureStoreBundle(
    libreSecureStoreSpec,
    candidate,
    { credentials, session },
    options,
  );
}

export function disconnectLibreLinkUpConnection(lease?: LocalDataWriteLease) {
  return disconnectSourceOwnedSecureStoreBundle(libreSecureStoreSpec, lease);
}

/** Physical privacy-erase cleanup. Ordinary disconnect uses the tombstone. */
export async function clearLibreLinkUpCredentials() {
  await Promise.all([
    forceClearEpochBoundSecureStoreValue(CREDENTIALS_KEY),
    forceClearEpochBoundSecureStoreValue(SESSION_KEY),
  ]);
}

export async function loadLibreLinkUpSession(lease?: LocalDataWriteLease) {
  return (await loadOwnedLibreLinkUpConnection(lease)).values.session;
}

export async function saveLibreLinkUpSession(
  session: LibreLinkUpSession,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  await updateSourceOwnedSecureStoreField(
    libreSecureStoreSpec,
    'session',
    session,
    sourceWriteLease,
  );
}

export async function loadDataMode(): Promise<DataMode | undefined> {
  const value = await SecureStore.getItemAsync(DATA_MODE_KEY);
  return value === "live" || value === "demo" ? value : undefined;
}

export async function saveDataMode(mode: DataMode) {
  await SecureStore.setItemAsync(DATA_MODE_KEY, mode);
}
