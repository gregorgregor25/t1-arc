import type { GlucoseReading } from '@/domain/models';
import {
  clearOwnedGlucoseSourceDataInTransaction,
  commitVerifiedSnapshotInTransaction,
} from '@/data/persistence/SqliteGlucoseHistoryStore';
import { clearOwnedHealthSourceDataInTransaction } from '@/data/persistence/SqliteHealthRecordStore';
import { clearSavedInsightReportsInTransaction } from '@/data/insights/insightReportRepository';
import type {
  SourceOwnedActivationContext,
  SourceOwnedActivationOptions,
} from '@/data/live/sourceOwnedSecureStore';
import {
  SourceConnectionSupersededError,
  type OwnedGlucoseSourceId,
} from '@/data/live/sourceConnectionOwnership';
import type { SQLiteDatabase } from 'expo-sqlite';

export interface VerifiedSourceActivationInput {
  readonly sourceId: OwnedGlucoseSourceId;
  readonly readings: readonly GlucoseReading[];
  readonly activatedAt?: number;
  /** Nightscout owns imported treatment/profile rows under the same source ID. */
  readonly clearHealthRecordsOnIdentityChange?: boolean;
  /** Test seam; production uses the epoch-gated native privacy boundary. */
  readonly invalidatePreviousNativeOwner?: (
    writeEpoch: number,
  ) => Promise<void>;
}

export async function invalidatePreviousNativeOwner(writeEpoch: number) {
  const [
    { default: T1ArcGlucoseDisplay },
    { invalidateGlucoseAlertsForSourceReplacement },
  ] = await Promise.all([
    import('../../../modules/t1arc-glucose-display'),
    import('@/data/glucoseAlerts/glucoseAlertPreferences'),
  ]);
  // Alert cancellation happens first. Once the synchronous phone-surface
  // clear returns, no old notification, Auto card, widget or AOD value can be
  // exposed by a later SQLite commit or process death.
  let alertInvalidationError: unknown;
  try {
    await invalidateGlucoseAlertsForSourceReplacement();
  } catch (error) {
    alertInvalidationError = error;
  }
  await T1ArcGlucoseDisplay.clearPrivateGlucoseForWriteEpochAsync(
    writeEpoch,
    'No personal glucose reading',
  );
  if (alertInvalidationError !== undefined) {
    throw alertInvalidationError;
  }
}

export async function clearPreviousSourceOwnerInTransaction(input: {
  readonly transaction: SQLiteDatabase;
  readonly sourceId: OwnedGlucoseSourceId;
  readonly writeEpoch: number;
  readonly clearHealthRecords?: boolean;
  readonly invalidateNative?: (writeEpoch: number) => Promise<void>;
}) {
  await (input.invalidateNative ?? invalidatePreviousNativeOwner)(
    input.writeEpoch,
  );
  await clearOwnedGlucoseSourceDataInTransaction(
    input.transaction,
    input.sourceId,
  );
  if (input.clearHealthRecords) {
    await clearOwnedHealthSourceDataInTransaction(
      input.transaction,
      input.sourceId,
    );
  }
  await clearSavedInsightReportsInTransaction(input.transaction);
}

/**
 * Stages a verified snapshot in the same SQLite transaction that activates its
 * credential owner. A different identity first removes only the old source's
 * rows; same-identity reauthentication and ordinary disconnect retain history.
 */
export function verifiedSourceActivationOptions(
  input: VerifiedSourceActivationInput,
): SourceOwnedActivationOptions {
  const activatedAt = input.activatedAt ?? Date.now();
  return {
    async beforeCommit(context: SourceOwnedActivationContext) {
      if (context.sourceWriteLease.sourceId !== input.sourceId) {
        throw new SourceConnectionSupersededError(
          context.sourceWriteLease.sourceId,
        );
      }
      // Undefined means provenance is unknown, not that this is known-safe
      // first use. Conservatively replace exact-source data on activation.
      const identityChanged =
        context.previousIdentityDigest === undefined ||
        context.previousIdentityDigest !==
          context.sourceWriteLease.identityDigest;
      if (identityChanged) {
        await clearPreviousSourceOwnerInTransaction({
          transaction: context.transaction,
          sourceId: input.sourceId,
          writeEpoch: context.sourceWriteLease.localDataWriteLease.epoch,
          clearHealthRecords: input.clearHealthRecordsOnIdentityChange,
          invalidateNative: input.invalidatePreviousNativeOwner,
        });
      }
      await commitVerifiedSnapshotInTransaction(
        context.transaction,
        input.sourceId,
        [...input.readings],
        activatedAt,
      );
    },
  };
}
