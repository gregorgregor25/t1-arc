import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HevyConnection, HevySyncResult } from "@/data/hevy/types";

import {
  HEVY_FULL_RECONCILIATION_INTERVAL_MS,
  syncHevyIfDue,
  syncHevyConnection,
} from "@/data/hevy/sync";

const mocks = vi.hoisted(() => ({
  applyEvents: vi.fn(),
  cursor: vi.fn(),
  fullReconciliationCandidate: vi.fn(),
  fullReconciliationAt: vi.fn(),
  ensureOwnership: vi.fn(),
  getAllWorkouts: vi.fn(),
  getWorkoutEvents: vi.fn(),
  markAttempt: vi.fn(),
  markFailure: vi.fn(),
  reconcileFullSnapshot: vi.fn(),
  status: vi.fn(),
  loadConnection: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: vi.fn(async () => "snapshot-fingerprint"),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 0 })),
  assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
  isLocalDataWriteSupersededError: () => false,
}));

vi.mock("@/data/hevy/client", () => {
  class MockHevyError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    eventTimestamp: () => 0,
    HevyClient: class {
      getAllWorkouts = mocks.getAllWorkouts;
      getWorkoutEvents = mocks.getWorkoutEvents;
    },
    HevyError: MockHevyError,
    normalizeHevyApiKey: (value: string) => value,
  };
});

vi.mock("@/data/hevy/repository", () => ({
  FULL_RECONCILIATION_CONFIRMATION_DELAY_MS: 30 * 60_000,
  HevyWorkoutRepository: class {
    applyEvents = mocks.applyEvents;
    cursor = mocks.cursor;
    ensureConnectionOwnership = mocks.ensureOwnership;
    fullReconciliationCandidate = mocks.fullReconciliationCandidate;
    fullReconciliationAt = mocks.fullReconciliationAt;
    markAttempt = mocks.markAttempt;
    markFailure = mocks.markFailure;
    reconcileFullSnapshot = mocks.reconcileFullSnapshot;
    status = mocks.status;
  },
}));

vi.mock("@/data/hevy/secureStore", () => ({
  clearHevyConnection: vi.fn(),
  loadHevyConnection: mocks.loadConnection,
  savePendingHevyConnection: vi.fn(),
  saveHevyConnection: vi.fn(),
}));

const NOW = Date.parse("2026-08-18T20:00:00.000Z");
const CONNECTION: HevyConnection = {
  apiKey: "account-key",
  connectedAt: 1,
  user: { id: "hevy-user", name: "Hevy user" },
};

function result(mode: HevySyncResult["mode"], syncedAt = NOW): HevySyncResult {
  return {
    mode,
    imported: 0,
    updated: 0,
    deleted: 0,
    duplicatesLinked: 0,
    total: 0,
    syncedAt,
  };
}

describe("Hevy full-history reconciliation schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    mocks.cursor.mockResolvedValue(NOW - 60_000);
    mocks.fullReconciliationCandidate.mockResolvedValue(undefined);
    mocks.fullReconciliationAt.mockResolvedValue(NOW);
    mocks.getAllWorkouts.mockResolvedValue([]);
    mocks.getWorkoutEvents.mockResolvedValue([]);
    mocks.ensureOwnership.mockResolvedValue(undefined);
    mocks.markAttempt.mockResolvedValue(undefined);
    mocks.markFailure.mockResolvedValue(undefined);
    mocks.loadConnection.mockResolvedValue(CONNECTION);
    mocks.status.mockResolvedValue({
      connected: true,
      workoutCount: 0,
    });
    mocks.reconcileFullSnapshot.mockResolvedValue(result("initial"));
    mocks.applyEvents.mockResolvedValue(result("incremental"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a recovery full sync for a legacy connection without a marker", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(undefined);

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "initial",
    });

    expect(mocks.getAllWorkouts).toHaveBeenCalledOnce();
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        connectionGeneration: CONNECTION.connectedAt,
        fingerprint: "snapshot-fingerprint",
        sourceWorkoutCount: 0,
        userId: CONNECTION.user.id,
      }),
      { epoch: 0 },
    );
    expect(mocks.getWorkoutEvents).not.toHaveBeenCalled();
    expect(mocks.applyEvents).not.toHaveBeenCalled();
  });

  it("normalises a pre-generation saved connection to the legacy generation", async () => {
    const legacyConnection = {
      ...CONNECTION,
      connectedAt: undefined as unknown as number,
    };
    mocks.fullReconciliationAt.mockResolvedValue(undefined);

    await expect(syncHevyConnection(legacyConnection)).resolves.toMatchObject({
      mode: "initial",
    });

    expect(mocks.ensureOwnership).toHaveBeenCalledWith(
      { connectionGeneration: 0, userId: CONNECTION.user.id },
      expect.any(Function),
      { epoch: 0 },
    );
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ connectionGeneration: 0 }),
      { epoch: 0 },
    );
  });

  it("uses the incremental feed while the last full reconciliation is fresh", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(
      NOW - HEVY_FULL_RECONCILIATION_INTERVAL_MS + 1,
    );

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "incremental",
    });

    expect(mocks.getWorkoutEvents).toHaveBeenCalledOnce();
    expect(mocks.applyEvents).toHaveBeenCalledOnce();
    expect(mocks.getAllWorkouts).not.toHaveBeenCalled();
    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
  });

  it("reconciles the complete history again after seven days", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(
      NOW - HEVY_FULL_RECONCILIATION_INTERVAL_MS,
    );

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "initial",
    });

    expect(mocks.getAllWorkouts).toHaveBeenCalledOnce();
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getWorkoutEvents).not.toHaveBeenCalled();
  });

  it("uses incremental events while a staged snapshot waits for its confirmation window", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(undefined);
    mocks.fullReconciliationCandidate.mockResolvedValue({
      capturedAt: NOW - 60_000,
      connectionGeneration: CONNECTION.connectedAt,
      fingerprint: "snapshot-fingerprint",
      sourceWorkoutCount: 0,
      userId: CONNECTION.user.id,
    });

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "incremental",
    });

    expect(mocks.getWorkoutEvents).toHaveBeenCalledOnce();
    expect(mocks.getAllWorkouts).not.toHaveBeenCalled();
    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
  });

  it("runs the confirmation crawl after the staged snapshot is 30 minutes old", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(undefined);
    mocks.fullReconciliationCandidate.mockResolvedValue({
      capturedAt: NOW - 30 * 60_000,
      connectionGeneration: CONNECTION.connectedAt,
      fingerprint: "snapshot-fingerprint",
      sourceWorkoutCount: 0,
      userId: CONNECTION.user.id,
    });

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "initial",
    });

    expect(mocks.getAllWorkouts).toHaveBeenCalledOnce();
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getWorkoutEvents).not.toHaveBeenCalled();
  });

  it("restages a candidate captured in the future after a device clock rollback", async () => {
    mocks.fullReconciliationAt.mockResolvedValue(undefined);
    mocks.fullReconciliationCandidate.mockResolvedValue({
      capturedAt: NOW + 60_000,
      connectionGeneration: CONNECTION.connectedAt,
      fingerprint: "future-snapshot",
      sourceWorkoutCount: 0,
      userId: CONNECTION.user.id,
    });

    await expect(syncHevyConnection(CONNECTION)).resolves.toMatchObject({
      mode: "initial",
    });

    expect(mocks.getAllWorkouts).toHaveBeenCalledOnce();
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledOnce();
    expect(mocks.getWorkoutEvents).not.toHaveBeenCalled();
  });

  it("does not let a future last-attempt timestamp suspend unattended sync", async () => {
    mocks.status.mockResolvedValue({
      connected: true,
      workoutCount: 0,
      lastAttemptAt: NOW + 60_000,
    });

    await expect(syncHevyIfDue(NOW)).resolves.toMatchObject({
      mode: "incremental",
    });

    expect(mocks.getWorkoutEvents).toHaveBeenCalledOnce();
  });

  it("still suppresses an unattended check made inside the normal interval", async () => {
    mocks.status.mockResolvedValue({
      connected: true,
      workoutCount: 0,
      lastAttemptAt: NOW - 1,
    });

    await expect(syncHevyIfDue(NOW)).resolves.toBeUndefined();

    expect(mocks.getWorkoutEvents).not.toHaveBeenCalled();
    expect(mocks.getAllWorkouts).not.toHaveBeenCalled();
  });

  it("does not replace history or advance success state when verification fails", async () => {
    const failure = new Error("snapshot verification failed");
    mocks.fullReconciliationAt.mockResolvedValue(undefined);
    mocks.getAllWorkouts.mockRejectedValue(failure);

    await expect(syncHevyConnection(CONNECTION)).rejects.toThrow(
      "The Hevy sync could not be completed.",
    );

    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
    expect(mocks.markFailure).toHaveBeenCalledOnce();
  });
});
