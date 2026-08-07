import { LibreLinkUpClient } from './LibreLinkUpClient';
import {
  loadLibreLinkUpCredentials,
  loadLibreLinkUpSession,
  saveLibreLinkUpCredentials,
  saveLibreLinkUpSession,
  sha256,
} from './secureStore';
import { LibreLinkUpCredentials } from './types';

export async function connectLibreLinkUp(
  credentials: LibreLinkUpCredentials,
) {
  const [storedCredentials, storedSession] = await Promise.all([
    loadLibreLinkUpCredentials(),
    loadLibreLinkUpSession(),
  ]);
  const sameCredentials =
    storedCredentials?.email.trim().toLowerCase() ===
      credentials.email.trim().toLowerCase() &&
    storedCredentials?.password === credentials.password;
  const client = new LibreLinkUpClient(
    credentials,
    sha256,
    globalThis.fetch,
    sameCredentials ? storedSession : undefined,
    saveLibreLinkUpSession,
  );
  const snapshot = await client.getSnapshot();
  await saveLibreLinkUpCredentials(credentials);
  return snapshot;
}
