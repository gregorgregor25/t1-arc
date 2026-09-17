import type { SQLiteDatabase } from 'expo-sqlite';
import {
  OWNED_GLUCOSE_SOURCE_IDS,
  readSourceConnectionOwnershipStateInTransaction,
  writeSourceConnectionOwnershipStateInTransaction,
  type OwnedGlucoseSourceId,
} from '@/data/live/sourceConnectionOwnership';

/** One-way account/patient identity digests; never sign-in or session material. */
export type BackupSourceOwners = Partial<Record<OwnedGlucoseSourceId, string>>;

export function validateBackupSourceOwners(value: unknown): BackupSourceOwners | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The backup source identities are invalid.');
  }
  const result: BackupSourceOwners = {};
  for (const [source, digest] of Object.entries(value)) {
    if (!(OWNED_GLUCOSE_SOURCE_IDS as readonly string[]).includes(source) ||
      typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error('The backup source identities are invalid.');
    }
    result[source as OwnedGlucoseSourceId] = digest;
  }
  return result;
}

export async function captureBackupSourceOwners(database: SQLiteDatabase): Promise<BackupSourceOwners> {
  const result: BackupSourceOwners = {};
  for (const source of OWNED_GLUCOSE_SOURCE_IDS) {
    const state = await readSourceConnectionOwnershipStateInTransaction(database, source);
    if (state?.identityDigest) result[source] = state.identityDigest;
  }
  return result;
}

/** Only call inside an authenticated, empty-store restore transaction. */
export async function restoreBackupSourceOwners(database: SQLiteDatabase, owners: BackupSourceOwners | undefined) {
  for (const [source, digest] of Object.entries(validateBackupSourceOwners(owners) ?? {})) {
    const sourceId = source as OwnedGlucoseSourceId;
    // A restore must not replace an account selected on the destination.
    if (await readSourceConnectionOwnershipStateInTransaction(database, sourceId)) continue;
    await writeSourceConnectionOwnershipStateInTransaction(database, sourceId, {
      version: 1, changeGeneration: 0, ownerGeneration: 0,
      connected: false, identityDigest: digest,
    });
  }
}
