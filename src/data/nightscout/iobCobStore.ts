import * as Crypto from 'expo-crypto';
import { NightscoutConnection, NightscoutIobCobSnapshot } from './types';
import {
  isFreshNightscoutIobCobSnapshot,
  NIGHTSCOUT_IOB_COB_DISPLAY_MAX_AGE_MS,
} from './iobCobSnapshot';
import {
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import type { SourceConnectionWriteLease } from '@/data/live/sourceConnectionOwnership';
import {
  clearOwnedNightscoutIobCob,
  loadOwnedNightscoutConnection,
  updateOwnedNightscoutIobCob,
  type StoredNightscoutIobCobSnapshot,
} from './secureStore';

export {
  NIGHTSCOUT_IOB_COB_DISPLAY_MAX_AGE_MS,
  NIGHTSCOUT_IOB_COB_MAX_AGE_MS,
} from './iobCobSnapshot';

export function nightscoutConnectionFingerprintMaterial(
  connection: NightscoutConnection,
) {
  return JSON.stringify([
    connection.baseUrl,
    connection.accessToken ?? '',
    connection.apiSecret ?? '',
  ]);
}

export function nightscoutConnectionFingerprint(
  connection: NightscoutConnection,
) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    nightscoutConnectionFingerprintMaterial(connection),
  );
}

export async function loadNightscoutIobCobSnapshot(
  connection: NightscoutConnection,
  now = Date.now(),
  lease?: LocalDataWriteLease,
) {
  const stored = (await loadOwnedNightscoutConnection(lease)).values.iobCob;
  if (!stored) return undefined;
  const fingerprint = await nightscoutConnectionFingerprint(connection);
  if (
    stored.version !== 2 ||
    stored.connectionFingerprint !== fingerprint ||
    !stored.snapshot ||
    !isFreshNightscoutIobCobSnapshot(stored.snapshot, now)
  ) {
    return undefined;
  }
  return stored.snapshot;
}

/**
 * The saved connection's last reported estimate for glance surfaces and the
 * Today card, which show its own age. Undefined when the user turned IOB/COB
 * off, the connection changed or the estimate is over an hour old.
 */
export async function loadDisplayableNightscoutIobCobSnapshot(
  now = Date.now(),
  lease?: LocalDataWriteLease,
) {
  const { connection, iobCob: stored } = (
    await loadOwnedNightscoutConnection(lease)
  ).values;
  if (!connection || connection.includeIobCob === false || !stored) {
    return undefined;
  }
  if (
    stored.version !== 2 ||
    !stored.snapshot ||
    stored.connectionFingerprint !==
      (await nightscoutConnectionFingerprint(connection)) ||
    !isFreshNightscoutIobCobSnapshot(
      stored.snapshot,
      now,
      NIGHTSCOUT_IOB_COB_DISPLAY_MAX_AGE_MS,
    )
  ) {
    return undefined;
  }
  return stored.snapshot;
}

export async function saveNightscoutIobCobSnapshot(
  connection: NightscoutConnection,
  snapshot: NightscoutIobCobSnapshot,
  writeLease: SourceConnectionWriteLease,
) {
  const stored: StoredNightscoutIobCobSnapshot = {
    version: 2,
    connectionFingerprint: await nightscoutConnectionFingerprint(connection),
    snapshot,
  };
  await updateOwnedNightscoutIobCob(stored, writeLease);
}

export async function clearNightscoutIobCobSnapshot(
  lease: SourceConnectionWriteLease,
) {
  await clearOwnedNightscoutIobCob(lease);
}
