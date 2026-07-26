import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { LibreLinkUpCredentials, LibreLinkUpSession } from './types';

const CREDENTIALS_KEY = 'daymark.librelinkup.credentials.v1';
const SESSION_KEY = 'daymark.librelinkup.session.v1';
const DATA_MODE_KEY = 'daymark.data.mode.v1';

export type DataMode = 'live' | 'demo';

export async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

export async function loadLibreLinkUpCredentials() {
  const value = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  return value ? (JSON.parse(value) as LibreLinkUpCredentials) : undefined;
}

export async function saveLibreLinkUpCredentials(
  credentials: LibreLinkUpCredentials,
) {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function clearLibreLinkUpCredentials() {
  await Promise.all([
    SecureStore.deleteItemAsync(CREDENTIALS_KEY),
    SecureStore.deleteItemAsync(SESSION_KEY),
  ]);
}

export async function loadLibreLinkUpSession() {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  return value ? (JSON.parse(value) as LibreLinkUpSession) : undefined;
}

export async function saveLibreLinkUpSession(session: LibreLinkUpSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadDataMode(): Promise<DataMode | undefined> {
  const value = await SecureStore.getItemAsync(DATA_MODE_KEY);
  return value === 'live' || value === 'demo' ? value : undefined;
}

export async function saveDataMode(mode: DataMode) {
  await SecureStore.setItemAsync(DATA_MODE_KEY, mode);
}
