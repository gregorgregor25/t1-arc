import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  disconnectHevyConnectionOwnership,
  FULL_RECONCILIATION_CANDIDATE_KEY,
  FULL_RECONCILIATION_CONFIRMATION_DELAY_MS,
  FULL_RECONCILIATION_METADATA_KEY,
  HevyWorkoutRepository,
} from "@/data/hevy/repository";
import {
  activeHevyOwnershipValue,
  disconnectedHevyOwnershipValue,
  HEVY_CONNECTION_OWNERSHIP_KEY,
  invalidatedHevyOwnershipValue,
} from "@/data/hevy/ownership";
import { LOCAL_DATA_RESET_SENTINEL_KEY } from "@/data/privacy/localDataResetSentinel";

const mocks = vi.hoisted(() => ({
  databaseGetFirst: vi.fn(),
  transactionGetAll: vi.fn(),
  transactionGetFirst: vi.fn(),
  transactionRun: vi.fn(),
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: mocks.databaseGetFirst,
  })),
  withT1ArcTransaction: vi.fn(
    async (operation: (transaction: unknown) => Promise<unknown>) =>
      operation({
        getAllAsync: mocks.transactionGetAll,
        getFirstAsync: mocks.transactionGetFirst,
        runAsync: mocks.transactionRun,
      }),
  ),
}));

const OWNERSHIP = { connectionGeneration: 10, userId: "user-a" };

function activeOwnershipRow() {
  return { value: activeHevyOwnershipValue(OWNERSHIP) };
}

function snapshot(syncedAt: number, fingerprint = "fingerprint-a") {
  return {
    connectionGeneration: 10,
    cursorAt: syncedAt,
    fingerprint,
    sourceWorkoutCount: 0,
    syncedAt,
    userId: "user-a",
  };
}

describe("Hevy full-reconciliation persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionGetAll.mockResolvedValue([]);
    mocks.transactionGetFirst.mockImplementation(
      async (_query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? activeOwnershipRow()
          : { count: 0 },
    );
    mocks.transactionRun.mockResolvedValue(undefined);
  });

  it("reads only the marker belonging to the active Hevy user", async () => {
    mocks.databaseGetFirst.mockResolvedValue({
      value: JSON.stringify({ userId: "user-a", lastSuccessfulAt: 1234 }),
    });
    const repository = new HevyWorkoutRepository();

    await expect(repository.fullReconciliationAt("user-a")).resolves.toBe(1234);
    await expect(
      repository.fullReconciliationAt("user-b"),
    ).resolves.toBeUndefined();
  });

  it("reads a staged candidate only for its user and connection generation", async () => {
    mocks.databaseGetFirst.mockResolvedValue({
      value: JSON.stringify({
        capturedAt: 1234,
        connectionGeneration: 10,
        fingerprint: "fingerprint-a",
        sourceWorkoutCount: 2,
        userId: "user-a",
      }),
    });
    const repository = new HevyWorkoutRepository();

    await expect(
      repository.fullReconciliationCandidate("user-a", 10),
    ).resolves.toMatchObject({
      capturedAt: 1234,
      fingerprint: "fingerprint-a",
      sourceWorkoutCount: 2,
    });
    await expect(
      repository.fullReconciliationCandidate("user-a", 11),
    ).resolves.toBeUndefined();
    await expect(
      repository.fullReconciliationCandidate("user-b", 10),
    ).resolves.toBeUndefined();
  });

  it("can explicitly discard a staged candidate", async () => {
    await new HevyWorkoutRepository().clearFullReconciliationCandidate();

    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM app_metadata"),
      FULL_RECONCILIATION_CANDIDATE_KEY,
    );
  });

  it("keeps retained workouts account-owned while disconnecting future writes", async () => {
    await disconnectHevyConnectionOwnership(2_000);

    const ownershipWrite = mocks.transactionRun.mock.calls.find(
      ([, key]) => key === HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(String(ownershipWrite?.[2]))).toMatchObject({
      connectionGeneration: 10,
      disconnectedAt: 2_000,
      revision: 1,
      state: "disconnected",
      userId: "user-a",
    });
    expect(mocks.transactionRun).not.toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM hevy_workouts"),
      expect.anything(),
    );
  });

  it("rejects stale cross-runtime activation after a newer privacy invalidation", async () => {
    mocks.transactionGetFirst.mockImplementation(
      async (_query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? { value: invalidatedHevyOwnershipValue(2_000) }
          : null,
    );

    await expect(
      new HevyWorkoutRepository().activateConnection(OWNERSHIP),
    ).rejects.toThrow("superseded");

    expect(mocks.transactionRun).not.toHaveBeenCalled();
  });

  it("bootstraps ownership for a saved connection from an older build", async () => {
    mocks.transactionGetFirst.mockResolvedValue(null);

    await new HevyWorkoutRepository().ensureConnectionOwnership(OWNERSHIP);

    const ownershipWrite = mocks.transactionRun.mock.calls.find(
      ([, key]) => key === HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(String(ownershipWrite?.[2]))).toMatchObject({
      connectionGeneration: 10,
      state: "active",
      userId: "user-a",
    });
    expect(JSON.parse(String(ownershipWrite?.[2]))).not.toHaveProperty(
      "revision",
    );
  });

  it("does not bootstrap stale credentials after a local-data reset", async () => {
    mocks.transactionGetFirst.mockImplementation(
      async (_query: string, key?: string) =>
        key === LOCAL_DATA_RESET_SENTINEL_KEY ? { value: "1" } : null,
    );

    await expect(
      new HevyWorkoutRepository().ensureConnectionOwnership(OWNERSHIP),
    ).rejects.toThrow("superseded");
    expect(mocks.transactionRun).not.toHaveBeenCalled();
  });

  it("removes the previous account history before a different account connects", async () => {
    mocks.transactionGetAll.mockResolvedValue([{ id: "old-workout" }]);
    mocks.transactionGetFirst.mockImplementation(
      async (query: string, key?: string) => {
        if (query.includes("app_metadata") && key === "hevy-sync-state-v1") {
          return {
            value: JSON.stringify({ lastEventAt: 1234, userId: "user-a" }),
          };
        }
        if (query.includes("FROM hevy_workouts h")) {
          return {
            context_event_id: "hevy:old-workout",
            source_id: "hevy",
          };
        }
        return { count: 0 };
      },
    );

    await expect(
      new HevyWorkoutRepository().prepareForConnection("user-b"),
    ).resolves.toBe(true);

    expect(mocks.transactionRun).toHaveBeenCalledWith(
      "DELETE FROM hevy_workouts WHERE id = ?",
      "old-workout",
    );
    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM context_events"),
      "hevy:old-workout",
      "hevy",
    );
    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM app_metadata"),
      "hevy-sync-state-v1",
      FULL_RECONCILIATION_METADATA_KEY,
      FULL_RECONCILIATION_CANDIDATE_KEY,
    );
  });

  it("removes restored history with no device-bound owner before connecting", async () => {
    mocks.transactionGetAll.mockResolvedValue([{ id: "restored-workout" }]);
    mocks.transactionGetFirst.mockImplementation(
      async (query: string, key?: string) => {
        if (query.includes("app_metadata") && key === "hevy-sync-state-v1") {
          return null;
        }
        if (query.includes("FROM hevy_workouts h")) {
          return {
            context_event_id: "hevy:restored-workout",
            source_id: "hevy",
          };
        }
        return { count: 0 };
      },
    );

    await expect(
      new HevyWorkoutRepository().prepareForConnection("user-b"),
    ).resolves.toBe(true);

    expect(mocks.transactionRun).toHaveBeenCalledWith(
      "DELETE FROM hevy_workouts WHERE id = ?",
      "restored-workout",
    );
  });

  it("stages the first exact snapshot without pruning or advancing the full marker", async () => {
    const repository = new HevyWorkoutRepository();
    await repository.reconcileFullSnapshot([], snapshot(1234));

    const candidateWrite = mocks.transactionRun.mock.calls.find(
      ([, key]) => key === FULL_RECONCILIATION_CANDIDATE_KEY,
    );
    expect(candidateWrite).toBeDefined();
    expect(JSON.parse(String(candidateWrite?.[2]))).toEqual({
      capturedAt: 1234,
      connectionGeneration: 10,
      fingerprint: "fingerprint-a",
      sourceWorkoutCount: 0,
      userId: "user-a",
    });
    expect(mocks.transactionGetAll).not.toHaveBeenCalled();
    expect(
      mocks.transactionRun.mock.calls.some(
        ([, key]) => key === FULL_RECONCILIATION_METADATA_KEY,
      ),
    ).toBe(false);
  });

  it("prunes and advances the full marker only after a delayed matching snapshot", async () => {
    const capturedAt = 1_000;
    mocks.transactionGetFirst.mockImplementation(
      async (query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? activeOwnershipRow()
          : query.includes("app_metadata")
            ? {
                value: JSON.stringify({
                  capturedAt,
                  connectionGeneration: 10,
                  fingerprint: "fingerprint-a",
                  sourceWorkoutCount: 0,
                  userId: "user-a",
                }),
              }
            : { count: 0 },
    );
    const syncedAt = capturedAt + FULL_RECONCILIATION_CONFIRMATION_DELAY_MS;
    await new HevyWorkoutRepository().reconcileFullSnapshot(
      [],
      snapshot(syncedAt),
    );

    expect(mocks.transactionGetAll).toHaveBeenCalledOnce();
    const markerWrite = mocks.transactionRun.mock.calls.find(
      ([, key]) => key === FULL_RECONCILIATION_METADATA_KEY,
    );
    expect(JSON.parse(String(markerWrite?.[2]))).toEqual({
      lastSuccessfulAt: syncedAt,
      userId: "user-a",
    });
    expect(mocks.transactionRun).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM app_metadata"),
      FULL_RECONCILIATION_CANDIDATE_KEY,
    );
  });

  it("replaces a changed candidate without deleting local history", async () => {
    mocks.transactionGetFirst.mockImplementation(
      async (query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? activeOwnershipRow()
          : query.includes("app_metadata")
            ? {
                value: JSON.stringify({
                  capturedAt: 1_000,
                  connectionGeneration: 10,
                  fingerprint: "older-fingerprint",
                  sourceWorkoutCount: 0,
                  userId: "user-a",
                }),
              }
            : { count: 0 },
    );
    await new HevyWorkoutRepository().reconcileFullSnapshot(
      [],
      snapshot(1_000 + FULL_RECONCILIATION_CONFIRMATION_DELAY_MS),
    );

    expect(mocks.transactionGetAll).not.toHaveBeenCalled();
    expect(
      mocks.transactionRun.mock.calls.some(
        ([, key]) => key === FULL_RECONCILIATION_METADATA_KEY,
      ),
    ).toBe(false);
  });

  it("does not advance the full marker during an incremental event sync", async () => {
    const repository = new HevyWorkoutRepository();
    await repository.applyEvents([], 1234, OWNERSHIP, 1200);

    expect(
      mocks.transactionRun.mock.calls.some(
        ([, key]) => key === FULL_RECONCILIATION_METADATA_KEY,
      ),
    ).toBe(false);
  });

  it("rejects a late snapshot transaction after erase invalidates ownership", async () => {
    mocks.transactionGetFirst.mockImplementation(
      async (_query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? { value: invalidatedHevyOwnershipValue(2000) }
          : { count: 0 },
    );

    await expect(
      new HevyWorkoutRepository().reconcileFullSnapshot([], snapshot(3000)),
    ).rejects.toThrow("superseded");
    expect(mocks.transactionRun).not.toHaveBeenCalled();
  });

  it("rejects a late snapshot after disconnect or workout removal preserves ownership", async () => {
    mocks.transactionGetFirst.mockImplementation(
      async (_query: string, key?: string) =>
        key === HEVY_CONNECTION_OWNERSHIP_KEY
          ? { value: disconnectedHevyOwnershipValue(OWNERSHIP, 2_000) }
          : { count: 0 },
    );

    await expect(
      new HevyWorkoutRepository().reconcileFullSnapshot([], snapshot(3_000)),
    ).rejects.toThrow("superseded");
    expect(mocks.transactionRun).not.toHaveBeenCalled();
  });
});
