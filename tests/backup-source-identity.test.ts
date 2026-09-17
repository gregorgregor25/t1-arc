import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { captureBackupSourceOwners, restoreBackupSourceOwners, validateBackupSourceOwners } from '@/data/backup/sourceRecoveryIdentity';
import { readSourceConnectionOwnershipStateInTransaction, beginSourceConnectionChangeInTransaction, activateSourceConnectionCandidateInTransaction } from '@/data/live/sourceConnectionOwnership';

const databases: DatabaseSync[] = [];
function createDatabase() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec('CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return {
    getFirstAsync: async (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args) ?? null,
    runAsync: async (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args),
  } as unknown as SQLiteDatabase;
}
afterEach(() => { databases.splice(0).forEach(db => db.close()); });

describe('backup source provenance', () => {
  it('retains account identity across recovery without restoring credentials or an active connection', async () => {
    const db = createDatabase(); const digest = 'a'.repeat(64);
    await restoreBackupSourceOwners(db, { 't1arc-librelinkup': digest });
    expect(await readSourceConnectionOwnershipStateInTransaction(db, 't1arc-librelinkup'))
      .toEqual({ version: 1, changeGeneration: 0, ownerGeneration: 0, connected: false, identityDigest: digest });
    const candidate = await beginSourceConnectionChangeInTransaction(db, 't1arc-librelinkup', { epoch: 0 });
    expect(candidate.observedIdentityDigest).toBe(digest);
    const verified = await activateSourceConnectionCandidateInTransaction(db, candidate, digest);
    // This is the comparison used by verifiedSourceActivationOptions before clearing history.
    expect(verified.identityDigest).toBe(candidate.observedIdentityDigest);
    expect(await captureBackupSourceOwners(db)).toEqual({ 't1arc-librelinkup': digest });
  });

  it('does not replace destination ownership and still identifies a different verified account', async () => {
    const db = createDatabase(); const original = 'a'.repeat(64); const other = 'b'.repeat(64);
    await restoreBackupSourceOwners(db, { nightscout: original });
    await restoreBackupSourceOwners(db, { nightscout: other });
    const candidate = await beginSourceConnectionChangeInTransaction(db, 'nightscout', { epoch: 0 });
    const verified = await activateSourceConnectionCandidateInTransaction(db, candidate, other);
    expect(candidate.observedIdentityDigest).toBe(original);
    expect(verified.identityDigest).not.toBe(candidate.observedIdentityDigest);
  });

  it.each([null, [], { nightscout: 'https://secret@example.com' }, { token: 'a'.repeat(64) }, { nightscout: { password: 'secret' } }])
    ('rejects invalid or credential-like provenance %j', value => {
      expect(() => validateBackupSourceOwners(value)).toThrow('source identities');
    });

  it('keeps old backups without identity proof conservative', async () => {
    const db = createDatabase(); await restoreBackupSourceOwners(db, undefined);
    const candidate = await beginSourceConnectionChangeInTransaction(db, 'nightscout', { epoch: 0 });
    expect(candidate.observedIdentityDigest).toBeUndefined();
  });
});
