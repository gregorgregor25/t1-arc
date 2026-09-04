import type * as SQLite from 'expo-sqlite';

import {
  retrySqliteBusy,
  type SqliteBusyRetryOptions,
} from './sqliteBusyRetry';

export const ERASE_SANITIZATION_PENDING_KEY =
  'erase-sanitization-pending-v1';

const ERASE_SANITIZATION_PENDING_VALUE = '1';

type SqliteRow = Record<string, unknown>;

function normalizedColumnValue(row: SqliteRow, expectedName: string) {
  const normalizedExpectedName = expectedName
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  const matching = Object.entries(row).find(
    ([name]) =>
      name.replace(/[^a-z0-9]/gi, '').toLowerCase() ===
      normalizedExpectedName,
  );
  return matching?.[1];
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function secureDeleteEnabled(row: SqliteRow | null) {
  return normalizedColumnValue(row ?? {}, 'secure_delete') === 1;
}

interface WalCheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

function parseWalCheckpointResult(
  row: SqliteRow | null,
): WalCheckpointResult | undefined {
  if (!row) return undefined;
  // SQLite reports log=-1/checkpointed=-1 when the database is not in WAL
  // mode. Treat that as unverifiable rather than assuming there was no WAL.
  const busy = nonNegativeInteger(normalizedColumnValue(row, 'busy'));
  const log = nonNegativeInteger(normalizedColumnValue(row, 'log'));
  const checkpointed = nonNegativeInteger(
    normalizedColumnValue(row, 'checkpointed'),
  );
  return busy === undefined || log === undefined || checkpointed === undefined
    ? undefined
    : { busy, log, checkpointed };
}

export class EraseSanitizationCheckpointIncompleteError extends Error {
  constructor(reason: 'busy' | 'incomplete' | 'invalid') {
    const retryPrefix = reason === 'invalid' ? '' : 'SQLITE_BUSY: ';
    super(
      `${retryPrefix}The encrypted database WAL checkpoint was ${reason}; erased data remains logically deleted, but SQLite file cleanup is still pending.`,
    );
    this.name = 'EraseSanitizationCheckpointIncompleteError';
  }
}

async function hasPendingEraseSanitization(
  database: SQLite.SQLiteDatabase,
) {
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value
       FROM app_metadata
      WHERE key = ?`,
    ERASE_SANITIZATION_PENDING_KEY,
  );
  return Boolean(row);
}

/**
 * Runs the logical deletion and its durable recovery marker in one transaction.
 * The caller is responsible for keying this dedicated connection first.
 */
export async function runSecureEraseTransaction<T>(
  database: SQLite.SQLiteDatabase,
  task: (transaction: SQLite.SQLiteDatabase) => Promise<T>,
) {
  await database.execAsync('PRAGMA secure_delete = ON;');
  const secureDelete = await database.getFirstAsync<SqliteRow>(
    'PRAGMA secure_delete',
  );
  if (!secureDeleteEnabled(secureDelete)) {
    throw new Error(
      'Encrypted database secure deletion could not be verified. No local health data was erased.',
    );
  }

  let began = false;
  try {
    await database.execAsync('BEGIN IMMEDIATE;');
    began = true;
    const result = await task(database);
    await database.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ERASE_SANITIZATION_PENDING_KEY,
      ERASE_SANITIZATION_PENDING_VALUE,
    );
    await database.execAsync('COMMIT;');
    began = false;
    return result;
  } catch (error) {
    if (began) {
      await database.execAsync('ROLLBACK;').catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Removes committed pre-erase WAL frames, then clears the recovery marker.
 * A failed, busy, incomplete, or malformed checkpoint leaves the marker intact.
 */
export async function completePendingEraseSanitization(
  database: SQLite.SQLiteDatabase,
) {
  if (!(await hasPendingEraseSanitization(database))) return false;

  const checkpointRow = await database.getFirstAsync<SqliteRow>(
    'PRAGMA wal_checkpoint(TRUNCATE)',
  );
  const checkpoint = parseWalCheckpointResult(checkpointRow);
  if (!checkpoint) {
    throw new EraseSanitizationCheckpointIncompleteError('invalid');
  }
  if (checkpoint.busy !== 0) {
    throw new EraseSanitizationCheckpointIncompleteError('busy');
  }
  // SQLite guarantees that a successful TRUNCATE checkpoint reports zero for
  // both counters. Equal non-zero counters prove only that all frames were
  // checkpointed, not that the WAL was truncated.
  if (checkpoint.log !== 0 || checkpoint.checkpointed !== 0) {
    throw new EraseSanitizationCheckpointIncompleteError('incomplete');
  }

  // The erase transaction's secure-delete page images have reached the main
  // database and the WAL now contains no SQLite-visible frames. Truncation does
  // not promise that a filesystem or flash device overwrote released physical
  // blocks. Another runtime may append a causally later frame after this point;
  // preventing a stale source callback from logically inserting health data
  // again is a separate source-ownership concern.
  await database.runAsync(
    'DELETE FROM app_metadata WHERE key = ?',
    ERASE_SANITIZATION_PENDING_KEY,
  );
  if (await hasPendingEraseSanitization(database)) {
    throw new Error(
      'The erase sanitization marker could not be cleared safely.',
    );
  }
  return true;
}

/**
 * Uses a fresh non-transaction connection for each bounded checkpoint attempt.
 * Retrying the marker after a successful checkpoint is harmless if the app
 * stopped before its marker-clear write committed.
 */
export function completePendingEraseSanitizationWithRetry(
  openDatabase: (
    remainingBudgetMs: number,
  ) => Promise<SQLite.SQLiteDatabase>,
  options?: SqliteBusyRetryOptions,
) {
  return retrySqliteBusy(async (remainingBudgetMs) => {
    const database = await openDatabase(remainingBudgetMs);
    try {
      return await completePendingEraseSanitization(database);
    } finally {
      await database.closeAsync().catch(() => undefined);
    }
  }, options);
}

/**
 * Called with the already-open keyed startup connection. The supplied resume
 * callback must open its own keyed connection; this avoids recursively asking
 * for the database promise that is currently being created. The startup
 * connection is in autocommit mode: its completed Expo getFirstAsync calls do
 * not retain a read snapshot. Any genuinely active reader makes the truncate
 * report busy, which leaves the marker intact and fails this startup attempt.
 */
export async function resumePendingEraseSanitizationAtStartup(
  startupDatabase: SQLite.SQLiteDatabase,
  resume: () => Promise<unknown>,
) {
  if (!(await hasPendingEraseSanitization(startupDatabase))) return false;
  await resume();
  return true;
}
