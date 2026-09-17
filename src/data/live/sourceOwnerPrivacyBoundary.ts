import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertOwnedGlucoseSourceId,
  type OwnedGlucoseSourceId,
} from '@/data/live/sourceConnectionOwnership';
import type { LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';

/**
 * Converts an ownerless legacy credential into an explicit privacy boundary.
 * The exact source's derived rows are invalid until provenance is established.
 */
export function createUnknownSourceOwnerPrivacyBoundary(
  sourceId: OwnedGlucoseSourceId,
  clearHealthRecords = false,
) {
  assertOwnedGlucoseSourceId(sourceId);
  return async (context: {
    readonly transaction: SQLiteDatabase;
    readonly localDataWriteLease: LocalDataWriteLease;
  }) => {
    const { clearPreviousSourceOwnerInTransaction } = await import(
      '@/data/live/verifiedSourceActivation'
    );
    await clearPreviousSourceOwnerInTransaction({
      transaction: context.transaction,
      sourceId,
      writeEpoch: context.localDataWriteLease.epoch,
      clearHealthRecords,
    });
  };
}
