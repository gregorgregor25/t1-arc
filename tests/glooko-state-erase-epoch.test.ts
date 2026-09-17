import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  saveGlookoReportSyncState,
  updateGlookoReportSyncState,
} from "@/data/glooko/glookoReportSyncState";
import {
  loadGlookoSyncState,
  saveGlookoSyncState,
  updateGlookoSyncState,
} from "@/data/glooko/glookoSyncState";

const mocks = vi.hoisted(() => {
  const database = {
    getFirstAsync: vi.fn(),
    getAllAsync: vi.fn(async () => []),
    runAsync: vi.fn(async () => ({ changes: 1 })),
  };
  return {
    database,
    openDatabase: vi.fn(async () => database),
    withTransaction: vi.fn(
      async (operation: (value: typeof database) => Promise<unknown>) =>
        operation(database),
    ),
    assertLease: vi.fn(async () => undefined),
    acquireLease: vi.fn(async () => ({ epoch: 31 })),
  };
});

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: mocks.openDatabase,
  withT1ArcTransaction: mocks.withTransaction,
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  assertLocalDataWriteLeaseInTransaction: mocks.assertLease,
}));

const WRITE_LEASE = { epoch: 31 };
const SYNC_STATE = JSON.stringify({
  automaticEnabled: true,
  sessionStatus: "ready",
  consecutiveFailures: 0,
});
const REPORT_STATE = JSON.stringify({ consecutiveFailures: 0 });

describe("Glooko metadata privacy-erase fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertLease.mockResolvedValue(undefined);
    mocks.database.getFirstAsync.mockResolvedValue({ value: SYNC_STATE });
  });

  it("checks the lease before saving CSV metadata", async () => {
    await saveGlookoSyncState(
      {
        automaticEnabled: true,
        sessionStatus: "ready",
        consecutiveFailures: 0,
      },
      WRITE_LEASE,
    );

    expect(mocks.assertLease).toHaveBeenCalledWith(mocks.database, WRITE_LEASE);
    expect(mocks.assertLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.runAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("acquires ownership before a potentially bootstrapping state read", async () => {
    await loadGlookoSyncState();

    expect(mocks.acquireLease).toHaveBeenCalledOnce();
    expect(mocks.acquireLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.getFirstAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("acquires and asserts a lease when a CSV state caller omits one", async () => {
    await saveGlookoSyncState({
      automaticEnabled: false,
      sessionStatus: "unknown",
      consecutiveFailures: 0,
    });

    expect(mocks.acquireLease).toHaveBeenCalledOnce();
    expect(mocks.assertLease).toHaveBeenCalledWith(mocks.database, WRITE_LEASE);
  });

  it("checks the lease first inside a CSV metadata read-modify-write", async () => {
    await updateGlookoSyncState(
      (current) => ({ ...current, lastAttemptAt: 123 }),
      WRITE_LEASE,
    );

    // The first read is the legacy-bootstrap check outside the writer. Once
    // the transaction starts, the assertion precedes its current-state read.
    expect(mocks.database.getFirstAsync).toHaveBeenCalledTimes(2);
    expect(mocks.assertLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.getFirstAsync.mock.invocationCallOrder[1]!,
    );
    expect(mocks.assertLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.runAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("checks the lease first inside a report metadata read-modify-write", async () => {
    mocks.database.getFirstAsync.mockResolvedValueOnce({
      value: REPORT_STATE,
    });

    await updateGlookoReportSyncState(
      (current) => ({ ...current, lastAttemptAt: 456 }),
      WRITE_LEASE,
    );

    expect(mocks.assertLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.getFirstAsync.mock.invocationCallOrder[0]!,
    );
    expect(mocks.assertLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.runAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("does not write report metadata when erase already owns the epoch", async () => {
    const error = new Error("superseded");
    error.name = "LocalDataWriteSupersededError";
    mocks.assertLease.mockRejectedValueOnce(error);

    await expect(
      saveGlookoReportSyncState({ consecutiveFailures: 0 }, WRITE_LEASE),
    ).rejects.toBe(error);

    expect(mocks.database.runAsync).not.toHaveBeenCalled();
  });
});
