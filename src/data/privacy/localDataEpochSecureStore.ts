import * as SecureStore from 'expo-secure-store';

import {
  assertLocalDataWriteLeaseCurrent,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

interface EpochBoundSecureStoreEnvelope {
  version: 1;
  localDataWriteEpoch: number;
  payload: unknown;
}

function isEnvelope(value: unknown): value is EpochBoundSecureStoreEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EpochBoundSecureStoreEnvelope>;
  return (
    candidate.version === 1 &&
    Number.isSafeInteger(candidate.localDataWriteEpoch) &&
    (candidate.localDataWriteEpoch ?? -1) >= 0 &&
    Object.prototype.hasOwnProperty.call(candidate, 'payload')
  );
}

/**
 * Stores private state with the DB generation that authorized the operation.
 * The embedded generation makes a late write unusable even if the process dies
 * before the post-write check can reject it.
 */
export async function saveEpochBoundSecureStoreValue<T>(
  key: string,
  payload: T,
  lease: LocalDataWriteLease,
) {
  await assertLocalDataWriteLeaseCurrent(lease);
  const raw = JSON.stringify({
    version: 1,
    localDataWriteEpoch: lease.epoch,
    payload,
  } satisfies EpochBoundSecureStoreEnvelope);
  // Hold SQLite's cross-runtime writer lock across the SecureStore mutation.
  // That orders this same-key write against epoch advancement and prevents an
  // old verified setup from clobbering a post-erase setup value.
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    await SecureStore.setItemAsync(key, raw);
  });
  await assertLocalDataWriteLeaseCurrent(lease);
}

/**
 * Legacy raw values are accepted only before the first privacy erase. Once an
 * epoch exists, every usable value must prove it was written in that epoch.
 */
export async function loadEpochBoundSecureStoreValue<T>(
  key: string,
  lease: LocalDataWriteLease,
  parse: (payload: unknown) => T | undefined,
): Promise<T | undefined> {
  await assertLocalDataWriteLeaseCurrent(lease);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return undefined;
  // Erase/new setup may have interleaved with the read. Never let an old
  // loader return a value until its lease is revalidated.
  await assertLocalDataWriteLeaseCurrent(lease);

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  const payload = isEnvelope(decoded)
    ? decoded.localDataWriteEpoch === lease.epoch
      ? decoded.payload
      : undefined
    : lease.epoch === 0
      ? decoded
      : undefined;
  if (payload === undefined) {
    return undefined;
  }

  const parsed = parse(payload);
  if (parsed === undefined) {
    return undefined;
  }
  await assertLocalDataWriteLeaseCurrent(lease);
  return parsed;
}

/** String values used to be stored without JSON quoting. */
export async function loadEpochBoundSecureStoreString(
  key: string,
  lease: LocalDataWriteLease,
) {
  await assertLocalDataWriteLeaseCurrent(lease);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return undefined;
  await assertLocalDataWriteLeaseCurrent(lease);

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    if (lease.epoch !== 0) {
      return undefined;
    }
    await assertLocalDataWriteLeaseCurrent(lease);
    return raw;
  }

  const payload = isEnvelope(decoded)
    ? decoded.localDataWriteEpoch === lease.epoch
      ? decoded.payload
      : undefined
    : lease.epoch === 0
      ? decoded
      : undefined;
  if (typeof payload !== 'string') {
    return undefined;
  }
  await assertLocalDataWriteLeaseCurrent(lease);
  return payload;
}

/** Explicit cleanup only; never race a read/compare/delete with another runtime. */
export async function clearEpochBoundSecureStoreValue(
  key: string,
  lease: LocalDataWriteLease,
) {
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  await withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    await SecureStore.deleteItemAsync(key);
  });
}

/** Reserved for explicit user disconnect and privacy erase cleanup. */
export async function forceClearEpochBoundSecureStoreValue(key: string) {
  await SecureStore.deleteItemAsync(key);
}
