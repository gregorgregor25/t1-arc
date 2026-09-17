import type { SQLiteDatabase } from 'expo-sqlite';

export const LOCAL_DATA_WRITE_EPOCH_KEY = 'local-data-write-epoch-v1';
export const LOCAL_DATA_ERASE_INTENT_KEY = 'local-data-erase-intent-v1';

export interface LocalDataWriteLease {
  readonly epoch: number;
}

interface EpochRow {
  value: string;
}

export class LocalDataWriteSupersededError extends Error {
  constructor() {
    super('This local-data operation was superseded by a privacy erase.');
    this.name = 'LocalDataWriteSupersededError';
  }
}

export class LocalDataErasePendingError extends LocalDataWriteSupersededError {
  constructor() {
    super();
    this.message = 'A local-data privacy erase is still being completed.';
    this.name = 'LocalDataErasePendingError';
  }
}

export function isLocalDataWriteSupersededError(
  error: unknown,
): error is LocalDataWriteSupersededError {
  return error instanceof LocalDataWriteSupersededError;
}

function parseEpoch(row: EpochRow | null) {
  if (!row) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(row.value)) {
    throw new Error('The durable local-data write epoch is invalid.');
  }
  const epoch = Number(row.value);
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new Error('The durable local-data write epoch is invalid.');
  }
  return epoch;
}

async function readEpoch(database: SQLiteDatabase) {
  return parseEpoch(
    await database.getFirstAsync<EpochRow>(
      'SELECT value FROM app_metadata WHERE key = ?',
      LOCAL_DATA_WRITE_EPOCH_KEY,
    ),
  );
}

export function readLocalDataWriteEpochFromDatabase(
  database: SQLiteDatabase,
) {
  return readEpoch(database);
}

function parseEraseIntent(row: EpochRow | null) {
  if (!row) return undefined;
  const epoch = parseEpoch(row);
  if (epoch < 1) {
    throw new Error('The durable local-data erase intent is invalid.');
  }
  return { epoch } satisfies LocalDataWriteLease;
}

export async function readLocalDataEraseIntentFromDatabase(
  database: SQLiteDatabase,
) {
  return parseEraseIntent(
    await database.getFirstAsync<EpochRow>(
      'SELECT value FROM app_metadata WHERE key = ?',
      LOCAL_DATA_ERASE_INTENT_KEY,
    ),
  );
}

async function assertNoLocalDataEraseIntent(database: SQLiteDatabase) {
  if (await readLocalDataEraseIntentFromDatabase(database)) {
    throw new LocalDataErasePendingError();
  }
}

export async function acquireLocalDataWriteLeaseFromDatabase(
  database: SQLiteDatabase,
): Promise<LocalDataWriteLease> {
  // Read epoch first, then intent. If an erase commits between these reads,
  // either the new intent is observed or the transaction was already complete.
  const lease = { epoch: await readEpoch(database) };
  await assertNoLocalDataEraseIntent(database);
  return lease;
}

/** Capture before credentials, evidence, native pages, or network work. */
export async function acquireLocalDataWriteLease() {
  const { openT1ArcDatabase } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  return acquireLocalDataWriteLeaseFromDatabase(await openT1ArcDatabase());
}

/** Must be the first operation in the eventual sensitive write transaction. */
export async function assertLocalDataWriteLeaseInTransaction(
  transaction: SQLiteDatabase,
  lease: LocalDataWriteLease,
) {
  await assertNoLocalDataEraseIntent(transaction);
  if ((await readEpoch(transaction)) !== lease.epoch) {
    throw new LocalDataWriteSupersededError();
  }
}

export async function assertLocalDataWriteLeaseCurrent(
  lease: LocalDataWriteLease,
) {
  const { openT1ArcDatabase } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  const database = await openT1ArcDatabase();
  await assertLocalDataWriteLeaseInTransaction(database, lease);
}

/**
 * Linearizes a sensitive external/native side effect with privacy erase. The
 * lease assertion is the first statement after SQLite grants the writer lock.
 */
export async function withLocalDataWriteLeaseTransaction<T>(
  lease: LocalDataWriteLease,
  task: (transaction: SQLiteDatabase) => Promise<T>,
) {
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  return withT1ArcTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    return task(transaction);
  });
}

/** Advances monotonically and never removes or reuses a previous generation. */
export async function advanceLocalDataWriteEpochInTransaction(
  transaction: SQLiteDatabase,
) {
  const current = await readEpoch(transaction);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('The durable local-data write epoch cannot be advanced safely.');
  }
  const next = current + 1;
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    LOCAL_DATA_WRITE_EPOCH_KEY,
    String(next),
  );
  return { epoch: next } satisfies LocalDataWriteLease;
}

/**
 * Establishes the non-rollbackable side of a cross-store erase handshake.
 * Re-entry reuses the exact pending epoch so native/watch clear is idempotent.
 */
export async function prepareLocalDataEraseIntentInTransaction(
  transaction: SQLiteDatabase,
) {
  const existing = await readLocalDataEraseIntentFromDatabase(transaction);
  if (existing) {
    if ((await readEpoch(transaction)) !== existing.epoch) {
      throw new Error(
        'The durable local-data erase intent does not match the write epoch.',
      );
    }
    return existing;
  }
  const current = await readEpoch(transaction);
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('The durable local-data write epoch cannot be advanced safely.');
  }
  return establishLocalDataEraseIntentAtEpochInTransaction(
    transaction,
    { epoch: current + 1 },
  );
}

export async function establishLocalDataEraseIntentAtEpochInTransaction(
  transaction: SQLiteDatabase,
  lease: LocalDataWriteLease,
) {
  const existing = await readLocalDataEraseIntentFromDatabase(transaction);
  if (existing) {
    if (
      (await readEpoch(transaction)) !== existing.epoch ||
      existing.epoch !== lease.epoch
    ) {
      throw new Error(
        'The durable local-data erase intent does not match the write epoch.',
      );
    }
    return existing;
  }
  const current = await readEpoch(transaction);
  if (
    !Number.isSafeInteger(lease.epoch) ||
    lease.epoch < 1 ||
    current >= Number.MAX_SAFE_INTEGER ||
    lease.epoch !== current + 1
  ) {
    throw new Error('The prepared local-data erase epoch is invalid.');
  }
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    LOCAL_DATA_WRITE_EPOCH_KEY,
    String(lease.epoch),
  );
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    LOCAL_DATA_ERASE_INTENT_KEY,
    String(lease.epoch),
  );
  return lease;
}

export async function clearLocalDataEraseIntentInTransaction(
  transaction: SQLiteDatabase,
) {
  await transaction.runAsync(
    'DELETE FROM app_metadata WHERE key = ?',
    LOCAL_DATA_ERASE_INTENT_KEY,
  );
}
