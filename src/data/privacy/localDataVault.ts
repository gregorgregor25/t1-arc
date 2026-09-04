import T1ArcGlucoseDisplay from "../../../modules/t1arc-glucose-display";
import T1ArcGlookoExport from "../../../modules/t1arc-glooko-export";
import T1ArcNotificationSource from "../../../modules/t1arc-notification-source";

import { clearDexcomShareConnection } from "@/data/dexcomShare/secureStore";
import { clearGlookoReportInbox } from "@/data/glooko/glookoReportInbox";
import {
  loadGlucoseAlertPreferences,
  resetGlucoseAlertState,
  saveGlucoseAlertPreferences,
} from "@/data/glucoseAlerts/glucoseAlertPreferences";
import { clearHevyConnection } from "@/data/hevy/secureStore";
import { invalidateHevyConnectionOwnership } from "@/data/hevy/repository";
import { clearInsightReviewPreferences } from "@/data/insights/insightReviewPreferences";
import { INSIGHT_REVIEW_PREFERENCES_DB_KEY } from "@/data/insights/insightReviewMetadata";
import { clearLibreLinkUpCredentials } from "@/data/libreLinkUp/secureStore";
import { clearMedtrumConnection } from "@/data/medtrum/secureStore";
import { clearNightscoutHistoryState } from "@/data/nightscout/historyStateStore";
import { clearNightscoutConnection } from "@/data/nightscout/secureStore";
import {
  openT1ArcDatabase,
  withT1ArcSanitizedEraseTransaction,
  withT1ArcTransaction,
} from "@/data/persistence/t1arcDatabase";
import {
  HEVY_CONNECTION_OWNERSHIP_KEY,
  invalidatedHevyOwnershipValue,
} from "@/data/hevy/ownership";
import { LOCAL_DATA_RESET_SENTINEL_KEY } from "@/data/privacy/localDataResetSentinel";
import { advanceNotificationSourceEpochInTransaction } from "@/data/notification/notificationSourceEpoch";
import {
  clearLocalDataEraseIntentInTransaction,
  establishLocalDataEraseIntentAtEpochInTransaction,
  readLocalDataEraseIntentFromDatabase,
  readLocalDataWriteEpochFromDatabase,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import { LocalDataSummary } from "@/domain/localDataSummary";
import { clearTarvisStoredData } from "@/data/tarvis/secureStore";
import { clearTarvisTreatmentProfile } from "@/data/tarvis/treatmentProfile";
import { clearXdripConnection } from "@/data/xdrip/secureStore";

interface LocalDataSummaryRow {
  glucose_readings: number;
  insulin_records: number;
  context_records: number;
  food_logs: number;
  food_recipes: number;
  health_connect_records: number;
  retained_source_exports: number;
  notification_source_events: number;
  saved_insight_reports: number;
}

function fromRow(row: LocalDataSummaryRow): LocalDataSummary {
  return {
    glucoseReadings: row.glucose_readings,
    insulinRecords: row.insulin_records,
    contextRecords: row.context_records,
    foodLogs: row.food_logs,
    foodRecipes: row.food_recipes,
    healthConnectRecords: row.health_connect_records,
    retainedSourceExports: row.retained_source_exports,
    notificationSourceEvents: row.notification_source_events,
    savedInsightReports: row.saved_insight_reports,
  };
}

export async function getLocalDataSummary(): Promise<LocalDataSummary> {
  const database = await openT1ArcDatabase();
  return getLocalDataSummaryFromDatabase(database);
}

async function getLocalDataSummaryFromDatabase(
  database: Awaited<ReturnType<typeof openT1ArcDatabase>>,
): Promise<LocalDataSummary> {
  const row = await database.getFirstAsync<LocalDataSummaryRow>(
    `SELECT
       (SELECT COUNT(*) FROM glucose_readings) AS glucose_readings,
       (
         (SELECT COUNT(*) FROM insulin_basal) +
         (SELECT COUNT(*) FROM insulin_bolus) +
         (SELECT COUNT(*) FROM insulin_daily_totals)
       ) AS insulin_records,
       (
         (SELECT COUNT(*) FROM context_events) +
         (SELECT COUNT(*) FROM context_notes)
       ) AS context_records,
       (SELECT COUNT(*) FROM food_logs) AS food_logs,
       (SELECT COUNT(*) FROM food_recipes) AS food_recipes,
       (SELECT COUNT(*) FROM health_connect_records)
         AS health_connect_records,
       (
         (SELECT COUNT(*) FROM import_source_payloads) +
         (SELECT COUNT(*) FROM glooko_report_payloads)
       ) AS retained_source_exports,
       (SELECT COUNT(*) FROM notification_source_events)
         AS notification_source_events,
       (SELECT COUNT(*) FROM insight_reports) AS saved_insight_reports`,
  );
  return fromRow(
    row ?? {
      glucose_readings: 0,
      insulin_records: 0,
      context_records: 0,
      food_logs: 0,
      food_recipes: 0,
      health_connect_records: 0,
      retained_source_exports: 0,
      notification_source_events: 0,
      saved_insight_reports: 0,
    },
  );
}

/**
 * Invalidates work that already captured credentials, evidence, or a native
 * page before destructive cleanup starts. The durable pending intent also
 * prevents any new work from acquiring this epoch until cleanup completes.
 */
async function clearNativeGlucoseForEraseIntent(intent: LocalDataWriteLease) {
  const nativeEpoch =
    await T1ArcGlucoseDisplay.getPrivateGlucoseWriteEpochAsync();
  if (
    !Number.isSafeInteger(nativeEpoch) ||
    nativeEpoch < 0 ||
    nativeEpoch > intent.epoch
  ) {
    throw new Error(
      "The native glucose privacy epoch cannot be reconciled with this erase.",
    );
  }
  await T1ArcGlucoseDisplay.clearPrivateGlucoseForWriteEpochAsync(
    intent.epoch,
    "No health data on this device",
  );
  const clearedEpoch =
    await T1ArcGlucoseDisplay.getPrivateGlucoseWriteEpochAsync();
  if (clearedEpoch !== intent.epoch) {
    throw new Error("The native glucose privacy clear was not durable.");
  }
}

async function prepareLocalDataEraseIntent() {
  await openT1ArcDatabase();
  return withT1ArcTransaction(async (transaction) => {
    const existing = await readLocalDataEraseIntentFromDatabase(transaction);
    if (existing) {
      if (
        (await readLocalDataWriteEpochFromDatabase(transaction)) !==
        existing.epoch
      ) {
        throw new Error(
          "The durable local-data erase intent does not match the write epoch.",
        );
      }
      await clearNativeGlucoseForEraseIntent(existing);
      return existing;
    }

    const databaseEpoch =
      await readLocalDataWriteEpochFromDatabase(transaction);
    if (databaseEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new Error(
        "The durable local-data write epoch cannot be advanced safely.",
      );
    }
    const nativeEpoch =
      await T1ArcGlucoseDisplay.getPrivateGlucoseWriteEpochAsync();
    if (
      !Number.isSafeInteger(nativeEpoch) ||
      nativeEpoch < 0 ||
      nativeEpoch > databaseEpoch + 1
    ) {
      throw new Error(
        "The native glucose privacy epoch cannot be reconciled with this erase.",
      );
    }
    const prepared = {
      epoch:
        nativeEpoch === databaseEpoch + 1 ? nativeEpoch : databaseEpoch + 1,
    } satisfies LocalDataWriteLease;

    // Native is fenced and all local/retained display surfaces are cleared
    // while SQLite excludes every older publication transaction. If the
    // process dies before COMMIT, native=DB+1 is the durable recovery signal.
    await clearNativeGlucoseForEraseIntent(prepared);
    return establishLocalDataEraseIntentAtEpochInTransaction(
      transaction,
      prepared,
    );
  });
}

export async function invalidateLocalDataWritesForErase() {
  return prepareLocalDataEraseIntent();
}

/**
 * Removes health records and raw source evidence while retaining the encrypted
 * database itself and non-health visual preferences. The native glucose cache
 * is cleared at intent creation and again inside the final writer boundary.
 */
export async function eraseLocalHealthData(): Promise<LocalDataSummary> {
  const preparedIntent = await prepareLocalDataEraseIntent();
  const before = await withT1ArcSanitizedEraseTransaction(
    async (transaction) => {
      const durableIntent =
        await readLocalDataEraseIntentFromDatabase(transaction);
      if (!durableIntent || durableIntent.epoch !== preparedIntent.epoch) {
        throw new Error(
          "The durable local-data erase intent changed unexpectedly.",
        );
      }
      // Repeat the clear while the final SQLite writer boundary is held. A
      // timeout rolls this transaction back but leaves the committed intent, so
      // startup/explicit retry can safely repeat the same epoch.
      await clearNativeGlucoseForEraseIntent(durableIntent);
      // Count under the same writer boundary as deletion. A writer that commits
      // before this transaction is included; every later writer remains blocked.
      const summary = await getLocalDataSummaryFromDatabase(transaction);
      // Invalidate every notification drain that acquired ownership before this
      // erase. This monotonic epoch is never removed or reused, so a later
      // re-enable cannot revive an already-running callback.
      await advanceNotificationSourceEpochInTransaction(transaction);
      // Delete dependent rows explicitly so the result is deterministic even if
      // an OEM SQLite build changes foreign-key defaults.
      for (const statement of [
        "DELETE FROM food_recipe_items",
        "DELETE FROM food_recipes",
        "DELETE FROM food_log_items",
        "DELETE FROM food_logs",
        "DELETE FROM hevy_workouts",
        "DELETE FROM context_notes",
        "DELETE FROM context_events",
        "DELETE FROM insulin_daily_totals",
        "DELETE FROM insulin_bolus",
        "DELETE FROM insulin_basal",
        "DELETE FROM glucose_readings",
        "DELETE FROM source_sync_state",
        "DELETE FROM health_connect_records",
        "DELETE FROM health_connect_sources",
        "DELETE FROM health_connect_sync_state",
        "DELETE FROM health_connect_preferences",
        "DELETE FROM import_raw_records",
        "DELETE FROM glooko_report_payloads",
        "DELETE FROM import_source_payloads",
        "DELETE FROM import_batches",
        "DELETE FROM notification_source_events",
        "DELETE FROM insight_reports",
        "DELETE FROM automation_runs",
        "DELETE FROM food_catalog_cache",
        `DELETE FROM app_metadata WHERE key = 'glooko-sync-state-v1'`,
        `DELETE FROM app_metadata WHERE key = 'glooko-report-sync-state-v1'`,
        `DELETE FROM app_metadata WHERE key = 'glooko-report-subject-fingerprint-v1'`,
        `DELETE FROM app_metadata WHERE key = 'health-connect-background-state-v1'`,
        `DELETE FROM app_metadata WHERE key = '${INSIGHT_REVIEW_PREFERENCES_DB_KEY}'`,
        `DELETE FROM app_metadata WHERE key = 'tarvis-conversation-v1'`,
        `DELETE FROM app_metadata WHERE key = 'hevy-sync-state-v1'`,
        `DELETE FROM app_metadata WHERE key = 'hevy-full-reconciliation-state-v1'`,
        `DELETE FROM app_metadata WHERE key = 'hevy-full-reconciliation-candidate-v1'`,
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:t1arc-librelinkup'`,
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:nightscout'`,
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:dexcom-share'`,
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:medtrum-easyfollow'`,
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:xdrip-local'`,
      ]) {
        await transaction.runAsync(statement);
      }
      // This durable tombstone is checked inside every Hevy write transaction.
      // A headless runtime that loaded credentials before this erase may finish
      // its network request, but it cannot repopulate rows afterwards.
      await transaction.runAsync(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        HEVY_CONNECTION_OWNERSHIP_KEY,
        invalidatedHevyOwnershipValue(),
      );
      await transaction.runAsync(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        LOCAL_DATA_RESET_SENTINEL_KEY,
        "1",
      );
      return summary;
    },
  );
  // Keep every new lease blocked until secure-delete COMMIT and the verified
  // WAL truncate have both finished. This final marker-only transaction cannot
  // reintroduce private payload pages; a crash before it simply retries the
  // idempotent erase intent on startup.
  await withT1ArcTransaction(async (transaction) => {
    const durableIntent =
      await readLocalDataEraseIntentFromDatabase(transaction);
    if (!durableIntent || durableIntent.epoch !== preparedIntent.epoch) {
      throw new Error("The completed local-data erase intent is unavailable.");
    }
    await clearLocalDataEraseIntentInTransaction(transaction);
  });
  return before;
}

/**
 * Completes an erase interrupted after its durable intent was established.
 * The foreground app waits for this before mounting DataProvider, while
 * headless writers see the intent as benign supersession.
 */
export async function resumePendingLocalDataErase() {
  await openT1ArcDatabase();
  const recoveryRequired = await withT1ArcTransaction(async (transaction) => {
    const pending = await readLocalDataEraseIntentFromDatabase(transaction);
    if (pending) {
      if (
        (await readLocalDataWriteEpochFromDatabase(transaction)) !==
        pending.epoch
      ) {
        throw new Error(
          "The durable local-data erase intent does not match the write epoch.",
        );
      }
      await clearNativeGlucoseForEraseIntent(pending);
      return true;
    }

    const databaseEpoch =
      await readLocalDataWriteEpochFromDatabase(transaction);
    const nativeEpoch =
      await T1ArcGlucoseDisplay.getPrivateGlucoseWriteEpochAsync();
    if (!Number.isSafeInteger(nativeEpoch) || nativeEpoch < 0) {
      throw new Error("The native glucose privacy epoch is invalid.");
    }
    if (nativeEpoch < databaseEpoch) {
      // SharedPreferences may have been restored/reset independently from the
      // encrypted database. Clear and align native under the SQLite writer
      // lock so exact-epoch publications cannot remain permanently bricked.
      await clearNativeGlucoseForEraseIntent({ epoch: databaseEpoch });
      return false;
    }
    if (nativeEpoch === databaseEpoch) return false;
    if (nativeEpoch !== databaseEpoch + 1) {
      throw new Error(
        "The interrupted native glucose erase cannot be reconciled safely.",
      );
    }
    // Re-clear any phone surfaces the interrupted native call had not reached,
    // then persist this exact native-ahead generation as the DB intent before
    // the startup writer lock is released.
    const prepared = { epoch: nativeEpoch } satisfies LocalDataWriteLease;
    await clearNativeGlucoseForEraseIntent(prepared);
    await establishLocalDataEraseIntentAtEpochInTransaction(
      transaction,
      prepared,
    );
    return true;
  });
  if (!recoveryRequired) return false;

  const resetLease = await T1ArcGlookoExport.beginDataResetAsync();
  if (!resetLease.acquired) {
    throw new Error(
      "The interrupted local-data erase is still being protected.",
    );
  }
  let completed = false;
  let resetEnded = false;
  try {
    const alerts = await loadGlucoseAlertPreferences();
    const [glookoSessionCleared, glookoArtifactsCleared] = await Promise.all([
      T1ArcGlookoExport.clearSessionAsync(),
      T1ArcGlookoExport.clearReportArtifactsAsync(),
      clearGlookoReportInbox(),
    ]);
    if (!glookoSessionCleared || !glookoArtifactsCleared) {
      throw new Error("The interrupted Glooko cleanup could not be resumed.");
    }
    await T1ArcNotificationSource.disableAndClearAsync();
    // The global intent blocks every loader first; this durable Hevy tombstone
    // then makes a previously staged credential permanently non-activatable.
    await invalidateHevyConnectionOwnership();
    await clearHevyConnection();
    await Promise.all([
      clearLibreLinkUpCredentials(),
      clearNightscoutConnection(),
      clearNightscoutHistoryState(),
      clearDexcomShareConnection(),
      clearMedtrumConnection(),
      clearXdripConnection(),
      clearTarvisStoredData(),
      clearTarvisTreatmentProfile(),
      T1ArcGlucoseDisplay.disableAsync(),
      T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync(),
      saveGlucoseAlertPreferences({ ...alerts, enabled: false }),
      resetGlucoseAlertState(),
      clearInsightReviewPreferences(),
    ]);
    await eraseLocalHealthData();
    // The database erase deliberately replaces source metadata. Re-plan from
    // that post-erase tombstone and verify every allocated scoped slot is gone
    // before startup is allowed to mount source configuration again.
    await clearHevyConnection();
    completed = true;
  } finally {
    resetEnded = await T1ArcGlookoExport.endDataResetAsync(
      resetLease.token,
    ).catch(() => false);
  }
  if (completed && !resetEnded) {
    throw new Error("The interrupted local-data erase lock did not release.");
  }
  return true;
}

export type { LocalDataSummary } from "@/domain/localDataSummary";
