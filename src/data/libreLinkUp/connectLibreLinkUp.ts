import { LibreLinkUpClient } from './LibreLinkUpClient';
import { sameLibreLinkUpCredentials } from './credentialIdentity';
import {
  activateLibreLinkUpConnection,
  beginLibreLinkUpConnectionChange,
  loadOwnedLibreLinkUpConnection,
  sha256,
} from './secureStore';
import { LibreLinkUpCredentials } from './types';
import type { SourceConnectionCandidateLease } from '@/data/live/sourceConnectionOwnership';
import { verifiedSourceActivationOptions } from '@/data/live/verifiedSourceActivation';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from './constants';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

export async function verifyLibreLinkUp(
  credentials: LibreLinkUpCredentials,
  signal?: AbortSignal,
  lease?: LocalDataWriteLease,
) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const stored = await loadOwnedLibreLinkUpConnection(writeLease);
  const storedCredentials = stored.values.credentials;
  const storedSession = stored.values.session;
  const client = new LibreLinkUpClient(
    credentials,
    sha256,
    globalThis.fetch,
    sameLibreLinkUpCredentials(storedCredentials, credentials)
      ? storedSession
      : undefined,
  );
  return client.getSnapshot(signal);
}

export async function commitVerifiedLibreLinkUp(
  credentials: LibreLinkUpCredentials,
  snapshot: Awaited<ReturnType<typeof verifyLibreLinkUp>>,
  candidate: SourceConnectionCandidateLease,
) {
  if (
    snapshot.session.accountEmail !== credentials.email.trim().toLowerCase()
  ) {
    throw new Error(
      'The verified LibreLinkUp session does not match this account.',
    );
  }
  if (
    !snapshot.session.userId.trim() ||
    !snapshot.selectedPatientId.trim() ||
    snapshot.session.patientId !== snapshot.selectedPatientId ||
    !snapshot.patients.some(
      (patient) => patient.id === snapshot.selectedPatientId,
    )
  ) {
    throw new Error(
      'The verified LibreLinkUp session is not bound to the selected patient.',
    );
  }
  if (snapshot.readings.length === 0) {
    throw new Error('The verified LibreLinkUp snapshot contains no readings.');
  }
  return activateLibreLinkUpConnection(
    candidate,
    credentials,
    snapshot.session,
    verifiedSourceActivationOptions({
      sourceId: DIRECT_LIBRE_LINKUP_SOURCE_ID,
      readings: snapshot.readings,
    }),
  );
}

export async function connectLibreLinkUp(
  credentials: LibreLinkUpCredentials,
) {
  const writeLease = await acquireLocalDataWriteLease();
  const candidate = await beginLibreLinkUpConnectionChange(writeLease);
  const snapshot = await verifyLibreLinkUp(credentials, undefined, writeLease);
  await commitVerifiedLibreLinkUp(credentials, snapshot, candidate);
  return snapshot;
}
