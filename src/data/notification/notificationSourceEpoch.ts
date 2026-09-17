import type { SQLiteDatabase } from 'expo-sqlite';

import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';

export const NOTIFICATION_SOURCE_EPOCH_KEY = 'notification-source-epoch-v1';

interface EpochRow {
  value: string;
}

type EpochDatabase = Pick<SQLiteDatabase, 'getFirstAsync' | 'runAsync'>;

export class NotificationDrainSupersededError extends Error {
  constructor() {
    super('The notification drain was superseded by a local-data reset.');
    this.name = 'NotificationDrainSupersededError';
  }
}

function parseEpoch(row: EpochRow | null) {
  if (!row) return 0;
  if (!/^(?:0|[1-9]\d*)$/.test(row.value)) {
    throw new Error('The durable notification source epoch is invalid.');
  }
  const epoch = Number(row.value);
  if (!Number.isSafeInteger(epoch)) {
    throw new Error('The durable notification source epoch is invalid.');
  }
  return epoch;
}

async function readEpochRow(database: EpochDatabase) {
  return database.getFirstAsync<EpochRow>(
    'SELECT value FROM app_metadata WHERE key = ?',
    NOTIFICATION_SOURCE_EPOCH_KEY,
  );
}

async function readEpoch(database: EpochDatabase) {
  return parseEpoch(await readEpochRow(database));
}

export async function readNotificationSourceEpoch() {
  return readEpoch(await openT1ArcDatabase());
}

export async function assertNotificationSourceEpochInTransaction(
  transaction: EpochDatabase,
  expectedEpoch: number,
) {
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0) {
    throw new NotificationDrainSupersededError();
  }
  if ((await readEpoch(transaction)) !== expectedEpoch) {
    throw new NotificationDrainSupersededError();
  }
}

export async function advanceNotificationSourceEpochInTransaction(
  transaction: EpochDatabase,
) {
  const row = await readEpochRow(transaction);
  const current = parseEpoch(row);
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error('The notification source epoch cannot be advanced safely.');
  }
  const result =
    row === null
      ? await transaction.runAsync(
          'INSERT INTO app_metadata (key, value) VALUES (?, ?)',
          NOTIFICATION_SOURCE_EPOCH_KEY,
          String(next),
        )
      : await transaction.runAsync(
          `UPDATE app_metadata SET value = ?
            WHERE key = ? AND value = ?`,
          String(next),
          NOTIFICATION_SOURCE_EPOCH_KEY,
          String(current),
        );
  if (result.changes !== 1) {
    throw new Error('The notification source epoch could not be advanced safely.');
  }
  return next;
}
