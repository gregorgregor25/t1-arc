import * as SecureStore from 'expo-secure-store';

import { NightscoutConnection } from './types';

const NIGHTSCOUT_CONNECTION_KEY = 'daymark.nightscout.connection.v1';

export async function loadNightscoutConnection() {
  const value = await SecureStore.getItemAsync(
    NIGHTSCOUT_CONNECTION_KEY,
  );
  return value
    ? (JSON.parse(value) as NightscoutConnection)
    : undefined;
}

export async function saveNightscoutConnection(
  connection: NightscoutConnection,
) {
  await SecureStore.setItemAsync(
    NIGHTSCOUT_CONNECTION_KEY,
    JSON.stringify(connection),
  );
}

export async function clearNightscoutConnection() {
  await SecureStore.deleteItemAsync(NIGHTSCOUT_CONNECTION_KEY);
}
