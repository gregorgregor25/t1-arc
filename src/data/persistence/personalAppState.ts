import { openT1ArcDatabase } from './t1arcDatabase';
import { acquireLocalDataWriteLease, withLocalDataWriteLeaseTransaction, type LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';

/** Personal UI state lives in the same encrypted database as health history. */
export async function readPersonalAppState(key: string): Promise<string | undefined> {
  const database = await openT1ArcDatabase();
  return (await database.getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key = ?', key))?.value;
}

export async function updatePersonalAppState<T>(key: string, update: (stored: string | undefined) => { value: string; result: T }, capturedLease?: LocalDataWriteLease): Promise<T> {
  const lease = capturedLease ?? await acquireLocalDataWriteLease();
  return withLocalDataWriteLeaseTransaction(lease, async transaction => {
    const stored = await transaction.getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key = ?', key);
    const next = update(stored?.value);
    await transaction.runAsync('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, next.value);
    return next.result;
  });
}
