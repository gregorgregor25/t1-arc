import * as SecureStore from 'expo-secure-store';

import { XdripConnection } from './types';

const XDRIP_CONNECTION_KEY = 'daymark.xdrip.connection.v1';

export async function loadXdripConnection() {
  const value = await SecureStore.getItemAsync(XDRIP_CONNECTION_KEY);
  return value ? (JSON.parse(value) as XdripConnection) : undefined;
}

export async function saveXdripConnection(
  connection: XdripConnection,
) {
  await SecureStore.setItemAsync(
    XDRIP_CONNECTION_KEY,
    JSON.stringify(connection),
  );
}

export async function clearXdripConnection() {
  await SecureStore.deleteItemAsync(XDRIP_CONNECTION_KEY);
}
