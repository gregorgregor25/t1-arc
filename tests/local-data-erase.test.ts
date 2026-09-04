import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  eraseLocalHealthData,
  invalidateLocalDataWritesForErase,
  resumePendingLocalDataErase,
} from "@/data/privacy/localDataVault";
import { HEVY_CONNECTION_OWNERSHIP_KEY } from "@/data/hevy/ownership";
import { INSIGHT_REVIEW_PREFERENCES_DB_KEY } from "@/data/insights/insightReviewMetadata";
import {
  acquireLocalDataWriteLeaseFromDatabase,
  LOCAL_DATA_ERASE_INTENT_KEY,
} from "@/data/privacy/localDataWriteEpoch";

const mocks = vi.hoisted(() => ({
  getFirst: vi.fn(),
  run: vi.fn(),
  transaction: vi.fn(),
  normalTransaction: vi.fn(),
  getNativeEpoch: vi.fn(),
  clearNative: vi.fn(),
  events: [] as string[],
  metadata: new Map<string, string>(),
  nativeEpoch: 0,
  summaryGlucoseReadings: 0,
  failSanitizedAfterTask: false,
  failNormalAfterTask: false,
  beginReset: vi.fn(),
  endReset: vi.fn(),
  clearGlookoSession: vi.fn(),
  clearGlookoArtifacts: vi.fn(),
  disableNotificationSource: vi.fn(),
  cleanup: vi.fn(),
  hevyClear: vi.fn(),
  hevyInvalidate: vi.fn(),
  loadAlerts: vi.fn(),
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: mocks.getFirst,
  })),
  withT1ArcSanitizedEraseTransaction: mocks.transaction,
  withT1ArcTransaction: mocks.normalTransaction,
}));

vi.mock("../modules/t1arc-glucose-display", () => ({
  default: {
    getPrivateGlucoseWriteEpochAsync: mocks.getNativeEpoch,
    clearPrivateGlucoseForWriteEpochAsync: mocks.clearNative,
    disableAsync: vi.fn(),
    cancelGlookoSignInRequiredAsync: mocks.cleanup,
  },
}));
vi.mock("../modules/t1arc-glooko-export", () => ({
  default: {
    beginDataResetAsync: mocks.beginReset,
    endDataResetAsync: mocks.endReset,
    clearSessionAsync: mocks.clearGlookoSession,
    clearReportArtifactsAsync: mocks.clearGlookoArtifacts,
  },
}));
vi.mock("../modules/t1arc-notification-source", () => ({
  default: { disableAndClearAsync: mocks.disableNotificationSource },
}));

vi.mock("@/data/dexcomShare/secureStore", () => ({
  clearDexcomShareConnection: mocks.cleanup,
}));
vi.mock("@/data/glooko/glookoReportInbox", () => ({
  clearGlookoReportInbox: mocks.cleanup,
}));
vi.mock("@/data/glucoseAlerts/glucoseAlertPreferences", () => ({
  loadGlucoseAlertPreferences: mocks.loadAlerts,
  resetGlucoseAlertState: mocks.cleanup,
  saveGlucoseAlertPreferences: mocks.cleanup,
}));
vi.mock("@/data/hevy/secureStore", () => ({
  clearHevyConnection: mocks.hevyClear,
}));
vi.mock("@/data/hevy/repository", () => ({
  invalidateHevyConnectionOwnership: mocks.hevyInvalidate,
}));
vi.mock("@/data/insights/insightReviewPreferences", () => ({
  clearInsightReviewPreferences: mocks.cleanup,
}));
vi.mock("@/data/libreLinkUp/secureStore", () => ({
  clearLibreLinkUpCredentials: mocks.cleanup,
}));
vi.mock("@/data/medtrum/secureStore", () => ({
  clearMedtrumConnection: mocks.cleanup,
}));
vi.mock("@/data/nightscout/historyStateStore", () => ({
  clearNightscoutHistoryState: mocks.cleanup,
}));
vi.mock("@/data/nightscout/secureStore", () => ({
  clearNightscoutConnection: mocks.cleanup,
}));
vi.mock("@/data/tarvis/secureStore", () => ({
  clearTarvisStoredData: mocks.cleanup,
}));
vi.mock("@/data/tarvis/treatmentProfile", () => ({
  clearTarvisTreatmentProfile: mocks.cleanup,
}));
vi.mock("@/data/xdrip/secureStore", () => ({
  clearXdripConnection: mocks.cleanup,
}));

describe("local data erase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.metadata.clear();
    mocks.nativeEpoch = 0;
    mocks.summaryGlucoseReadings = 0;
    mocks.failSanitizedAfterTask = false;
    mocks.failNormalAfterTask = false;
    mocks.beginReset.mockReset().mockResolvedValue({
      acquired: true,
      token: "reset-token",
    });
    mocks.endReset.mockReset().mockResolvedValue(true);
    mocks.clearGlookoSession.mockReset().mockResolvedValue(true);
    mocks.clearGlookoArtifacts.mockReset().mockResolvedValue(true);
    mocks.disableNotificationSource.mockReset().mockResolvedValue(0);
    mocks.cleanup.mockReset().mockResolvedValue(undefined);
    mocks.hevyClear.mockReset().mockImplementation(async () => {
      mocks.events.push("hevy-clear");
    });
    mocks.hevyInvalidate.mockReset().mockImplementation(async () => {
      mocks.events.push("hevy-invalidate");
    });
    mocks.loadAlerts.mockReset().mockResolvedValue({
      enabled: true,
      lowEnabled: true,
      lowThresholdMmolL: 4,
      highEnabled: true,
      highThresholdMmolL: 10,
      staleEnabled: true,
      repeatMinutes: 30,
    });
    mocks.getFirst.mockImplementation(async (query: string, key?: string) => {
      if (query.includes("FROM app_metadata") && key) {
        return mocks.metadata.has(key)
          ? { value: mocks.metadata.get(key)! }
          : null;
      }
      mocks.events.push("summary-read");
      return {
        glucose_readings: mocks.summaryGlucoseReadings,
        insulin_records: 0,
        context_records: 0,
        food_logs: 0,
        food_recipes: 0,
        health_connect_records: 0,
        retained_source_exports: 0,
        notification_source_events: 0,
        saved_insight_reports: 0,
      };
    });
    mocks.run.mockImplementation(
      async (statement: string, key?: string, value?: string) => {
        if (statement.trim().startsWith("INSERT INTO app_metadata") && key) {
          mocks.metadata.set(key, value ?? "");
          mocks.events.push(`metadata:${key}`);
        } else if (
          statement
            .trim()
            .startsWith("DELETE FROM app_metadata WHERE key = ?") &&
          key
        ) {
          mocks.metadata.delete(key);
          mocks.events.push(`metadata-clear:${key}`);
        } else if (statement.includes("DELETE FROM glucose_readings")) {
          mocks.events.push("delete-glucose");
        }
        return { changes: 1 };
      },
    );
    const runTransaction = (
      work: (database: {
        getFirstAsync: typeof mocks.getFirst;
        runAsync: typeof mocks.run;
      }) => unknown,
    ) => work({ getFirstAsync: mocks.getFirst, runAsync: mocks.run });
    mocks.normalTransaction.mockImplementation(async (work) => {
      const before = new Map(mocks.metadata);
      try {
        const result = await runTransaction(work);
        if (mocks.failNormalAfterTask) {
          throw new Error("simulated process death before intent commit");
        }
        return result;
      } catch (error) {
        mocks.metadata.clear();
        before.forEach((value, key) => mocks.metadata.set(key, value));
        throw error;
      }
    });
    mocks.transaction.mockImplementation(
      async (
        work: (database: {
          getFirstAsync: typeof mocks.getFirst;
          runAsync: typeof mocks.run;
        }) => unknown,
      ) => {
        const result = await runTransaction(work);
        mocks.events.push("logical-commit");
        if (mocks.failSanitizedAfterTask) {
          throw new Error("simulated process death before SQLite commit");
        }
        mocks.events.push("checkpoint-complete");
        return result;
      },
    );
    mocks.getNativeEpoch.mockImplementation(async () => mocks.nativeEpoch);
    mocks.clearNative.mockImplementation(async (epoch: number) => {
      mocks.events.push(`native-clear:${epoch}`);
      mocks.nativeEpoch = epoch;
      return { supported: true };
    });
  });

  it("removes report sync metadata and leaves a reset sentinel, not fake preferences", async () => {
    await eraseLocalHealthData();

    const sql = mocks.run.mock.calls.map(([statement]) => statement as string);
    expect(sql).toContain(
      "DELETE FROM app_metadata WHERE key = 'glooko-report-sync-state-v1'",
    );
    expect(sql).toContain(
      "DELETE FROM app_metadata WHERE key = 'hevy-full-reconciliation-state-v1'",
    );
    expect(sql).toContain(
      "DELETE FROM app_metadata WHERE key = 'hevy-full-reconciliation-candidate-v1'",
    );
    expect(sql).toContain(
      `DELETE FROM app_metadata WHERE key = '${INSIGHT_REVIEW_PREFERENCES_DB_KEY}'`,
    );
    for (const sourceId of [
      "t1arc-librelinkup",
      "nightscout",
      "dexcom-share",
      "medtrum-easyfollow",
      "xdrip-local",
    ]) {
      expect(sql).toContain(
        `DELETE FROM app_metadata WHERE key = 'glucose-source-connection-ownership-v1:${sourceId}'`,
      );
    }
    expect(sql).toContain("DELETE FROM health_connect_preferences");
    expect(
      sql.some((statement) =>
        statement.includes("INSERT INTO health_connect_preferences"),
      ),
    ).toBe(false);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO app_metadata"),
      "local-data-reset-sentinel-v1",
      expect.any(String),
    );
    const calls = mocks.run.mock.calls;
    const epochWrite = calls.findIndex(
      ([, key]) => key === "notification-source-epoch-v1",
    );
    const notificationDelete = calls.findIndex(([statement]) =>
      String(statement).includes("DELETE FROM notification_source_events"),
    );
    const glucoseDelete = calls.findIndex(([statement]) =>
      String(statement).includes("DELETE FROM glucose_readings"),
    );
    const syncDelete = calls.findIndex(([statement]) =>
      String(statement).includes("DELETE FROM source_sync_state"),
    );
    expect(epochWrite).toBeGreaterThanOrEqual(0);
    expect(epochWrite).toBeLessThan(notificationDelete);
    expect(epochWrite).toBeLessThan(glucoseDelete);
    expect(epochWrite).toBeLessThan(syncDelete);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO app_metadata"),
      HEVY_CONNECTION_OWNERSHIP_KEY,
      expect.stringContaining('"state":"invalidated"'),
    );
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
    expect(mocks.events.indexOf("native-clear:1")).toBeLessThan(
      mocks.events.indexOf("metadata:local-data-erase-intent-v1"),
    );
    expect(
      mocks.events.indexOf("metadata:local-data-erase-intent-v1"),
    ).toBeLessThan(mocks.events.indexOf("delete-glucose"));
    expect(mocks.events.indexOf("checkpoint-complete")).toBeLessThan(
      mocks.events.indexOf("metadata-clear:local-data-erase-intent-v1"),
    );
  });

  it("keeps leases blocked until the verified checkpoint has completed", async () => {
    let blockedDuringCheckpoint = false;
    mocks.transaction.mockImplementationOnce(async (work) => {
      const transaction = {
        getFirstAsync: mocks.getFirst,
        runAsync: mocks.run,
      };
      const result = await work(transaction);
      blockedDuringCheckpoint = await acquireLocalDataWriteLeaseFromDatabase(
        transaction as never,
      ).then(
        () => false,
        () => true,
      );
      mocks.events.push("checkpoint-complete");
      return result;
    });

    await eraseLocalHealthData();

    expect(blockedDuringCheckpoint).toBe(true);
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
  });

  it("counts rows at the same writer-fenced boundary that deletes them", async () => {
    mocks.transaction.mockImplementationOnce(async (work) => {
      mocks.summaryGlucoseReadings = 7;
      const result = await work({
        getFirstAsync: mocks.getFirst,
        runAsync: mocks.run,
      });
      mocks.events.push("checkpoint-complete");
      return result;
    });

    const removed = await eraseLocalHealthData();

    expect(removed.glucoseReadings).toBe(7);
    expect(mocks.events.indexOf("summary-read")).toBeLessThan(
      mocks.events.indexOf("delete-glucose"),
    );
  });

  it("retries the same intent after native clear and a rolled-back final transaction", async () => {
    mocks.failSanitizedAfterTask = true;

    await expect(eraseLocalHealthData()).rejects.toThrow(/process death/i);
    expect(mocks.metadata.get(LOCAL_DATA_ERASE_INTENT_KEY)).toBe("1");
    expect(mocks.nativeEpoch).toBe(1);

    mocks.failSanitizedAfterTask = false;
    await expect(eraseLocalHealthData()).resolves.toBeDefined();

    expect(
      new Set(mocks.clearNative.mock.calls.map(([epoch]) => epoch)),
    ).toEqual(new Set([1]));
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
  });

  it("resumes a pending intent before foreground source configuration", async () => {
    mocks.metadata.set("local-data-write-epoch-v1", "3");
    mocks.metadata.set(LOCAL_DATA_ERASE_INTENT_KEY, "3");

    await expect(resumePendingLocalDataErase()).resolves.toBe(true);

    expect(mocks.beginReset).toHaveBeenCalledOnce();
    expect(mocks.clearGlookoSession).toHaveBeenCalledOnce();
    expect(mocks.clearGlookoArtifacts).toHaveBeenCalledOnce();
    expect(mocks.disableNotificationSource).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalled();
    expect(mocks.hevyInvalidate).toHaveBeenCalledOnce();
    expect(mocks.hevyClear).toHaveBeenCalledTimes(2);
    expect(mocks.events.indexOf("hevy-invalidate")).toBeLessThan(
      mocks.events.indexOf("hevy-clear"),
    );
    expect(mocks.events.indexOf("hevy-clear")).toBeLessThan(
      mocks.events.indexOf("delete-glucose"),
    );
    expect(mocks.events.lastIndexOf("hevy-clear")).toBeGreaterThan(
      mocks.events.indexOf("delete-glucose"),
    );
    expect(mocks.endReset).toHaveBeenCalledWith("reset-token");
    expect(mocks.nativeEpoch).toBe(3);
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
  });

  it("recovers native-ahead state when the process dies before intent commit", async () => {
    mocks.failNormalAfterTask = true;

    await expect(invalidateLocalDataWritesForErase()).rejects.toThrow(
      /before intent commit/i,
    );
    expect(mocks.nativeEpoch).toBe(1);
    expect(mocks.metadata.has("local-data-write-epoch-v1")).toBe(false);
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);

    mocks.failNormalAfterTask = false;
    await expect(resumePendingLocalDataErase()).resolves.toBe(true);

    expect(mocks.nativeEpoch).toBe(1);
    expect(mocks.metadata.get("local-data-write-epoch-v1")).toBe("1");
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
  });

  it("clears and aligns a native epoch restored behind the database", async () => {
    mocks.metadata.set("local-data-write-epoch-v1", "4");
    mocks.nativeEpoch = 1;

    await expect(resumePendingLocalDataErase()).resolves.toBe(false);

    expect(mocks.clearNative).toHaveBeenCalledWith(
      4,
      "No health data on this device",
    );
    expect(mocks.nativeEpoch).toBe(4);
    expect(mocks.beginReset).not.toHaveBeenCalled();
    expect(mocks.metadata.has(LOCAL_DATA_ERASE_INTENT_KEY)).toBe(false);
  });

  it("fails closed when native is more than one erase ahead of the database", async () => {
    mocks.metadata.set("local-data-write-epoch-v1", "4");
    mocks.nativeEpoch = 6;

    await expect(resumePendingLocalDataErase()).rejects.toThrow(
      /cannot be reconciled safely/i,
    );

    expect(mocks.clearNative).not.toHaveBeenCalled();
    expect(mocks.beginReset).not.toHaveBeenCalled();
  });
});
