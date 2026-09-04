import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runGlookoBackgroundTask,
  updateGlookoBackgroundSyncRegistration,
} from "@/data/background/glookoSyncTask";

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  beginRun: vi.fn(),
  finishRun: vi.fn(),
  syncCsv: vi.fn(),
  syncReport: vi.fn(),
  updateState: vi.fn(),
  reconcileRegistration: vi.fn(),
  withLeaseTransaction: vi.fn(),
  hydrateProfile: vi.fn(),
}));

vi.mock("expo-background-task", () => ({
  BackgroundTaskResult: { Failed: "failed", Success: "success" },
}));

vi.mock("expo-task-manager", () => ({
  defineTask: vi.fn(),
  isTaskDefined: vi.fn(() => true),
}));

vi.mock("@/data/background/backgroundTaskRegistration", () => ({
  backgroundTaskSchedulerAvailable: vi.fn(async () => true),
  reconcileBackgroundTaskRegistration: mocks.reconcileRegistration,
}));

vi.mock("@/data/background/automationRunLog", () => ({
  beginAutomationRun: mocks.beginRun,
  finishAutomationRun: mocks.finishRun,
}));

vi.mock("@/data/glooko/glookoSync", () => ({
  syncGlookoIfDue: mocks.syncCsv,
}));

vi.mock("@/data/glooko/glookoReportSync", () => ({
  syncGlookoReportIfDue: mocks.syncReport,
}));

vi.mock("@/data/glooko/glookoSyncOutcome", () => ({
  glookoStepCountsAsFailure: (value: { status: string }) =>
    value.status === "failed",
  glookoStepCountsAsSkipped: (value: { status: string }) =>
    value.status === "skipped",
}));

vi.mock("@/data/glooko/glookoReportSyncPolicy", () => ({
  glookoReportBackgroundSchedulingEnabled: vi.fn(() => true),
}));

vi.mock("@/data/glooko/glookoReportSyncState", () => ({
  loadGlookoReportSyncState: vi.fn(async () => ({ consecutiveFailures: 0 })),
}));

vi.mock("@/data/glooko/glookoSyncPolicy", () => ({
  glookoBackgroundSchedulingEnabled: vi.fn(() => true),
}));

vi.mock("@/data/glooko/glookoSyncState", () => ({
  loadGlookoSyncState: vi.fn(async () => ({
    automaticEnabled: true,
    sessionStatus: "ready",
    consecutiveFailures: 0,
  })),
  updateGlookoSyncState: mocks.updateState,
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  isLocalDataWriteSupersededError: (error: unknown) =>
    error instanceof Error && error.name === "LocalDataWriteSupersededError",
  withLocalDataWriteLeaseTransaction: mocks.withLeaseTransaction,
}));

vi.mock("@/data/regionalProfile", () => ({
  ensureRegionalProfileRuntimeHydrated: mocks.hydrateProfile,
}));

const LEASE = { epoch: 17 };
const CSV_SUCCESS = {
  status: "success" as const,
  days: 1,
  result: {
    insertedGlucose: 0,
    insertedBasal: 0,
    insertedBoluses: 0,
    insertedContext: 0,
    insertedDailyTotals: 0,
  },
  syncState: {
    automaticEnabled: true,
    consecutiveFailures: 0,
    lastCheckOutcome: "no-new-data",
  },
};
const REPORT_SKIPPED = {
  status: "skipped" as const,
  reason: "no-new-file" as const,
  syncState: { consecutiveFailures: 0 },
};

function supersededError() {
  const error = new Error(
    "This local-data operation was superseded by a privacy erase.",
  );
  error.name = "LocalDataWriteSupersededError";
  return error;
}

describe("Glooko background privacy-erase fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hydrateProfile.mockResolvedValue(undefined);
    mocks.acquireLease.mockResolvedValue(LEASE);
    mocks.beginRun.mockResolvedValue("run-id");
    mocks.finishRun.mockResolvedValue(undefined);
    mocks.syncCsv.mockResolvedValue(CSV_SUCCESS);
    mocks.syncReport.mockResolvedValue(REPORT_SKIPPED);
    mocks.updateState.mockImplementation(async (update) =>
      update({
        automaticEnabled: true,
        sessionStatus: "ready",
        consecutiveFailures: 0,
      }),
    );
    mocks.reconcileRegistration.mockResolvedValue(true);
    mocks.withLeaseTransaction.mockImplementation(async (_lease, operation) =>
      operation(),
    );
  });

  it("acquires one lease before work and passes it to every persisted stage", async () => {
    await expect(runGlookoBackgroundTask()).resolves.toBe("success");

    expect(mocks.hydrateProfile).toHaveBeenCalledOnce();
    expect(mocks.hydrateProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acquireLease.mock.invocationCallOrder[0]!,
    );
    expect(mocks.acquireLease).toHaveBeenCalledOnce();
    expect(mocks.beginRun).toHaveBeenCalledWith(
      "glooko",
      expect.any(Number),
      LEASE,
    );
    expect(mocks.syncCsv).toHaveBeenCalledWith("background", LEASE);
    expect(mocks.syncReport).toHaveBeenCalledWith("background", LEASE);
    expect(mocks.finishRun).toHaveBeenCalledWith(
      "run-id",
      expect.objectContaining({ outcome: "success" }),
      LEASE,
    );
    expect(mocks.updateState).toHaveBeenCalledWith(expect.any(Function), LEASE);
  });

  it("does not publish stale success metadata after an erase wins", async () => {
    mocks.syncReport.mockRejectedValueOnce(supersededError());

    await expect(runGlookoBackgroundTask()).resolves.toBe("success");

    expect(mocks.finishRun).not.toHaveBeenCalled();
    expect(mocks.updateState).not.toHaveBeenCalled();
  });

  it("treats a failure audit superseded by erase as benign success", async () => {
    mocks.syncCsv.mockRejectedValueOnce(new Error("network unavailable"));
    mocks.finishRun.mockRejectedValueOnce(supersededError());

    await expect(runGlookoBackgroundTask()).resolves.toBe("success");

    expect(mocks.finishRun).toHaveBeenCalledWith(
      "run-id",
      expect.objectContaining({ outcome: "failed" }),
      LEASE,
    );
    expect(mocks.updateState).not.toHaveBeenCalled();
  });

  it("contains a pending erase before native or network work starts", async () => {
    mocks.acquireLease.mockRejectedValueOnce(supersededError());

    await expect(runGlookoBackgroundTask()).resolves.toBe("success");

    expect(mocks.beginRun).not.toHaveBeenCalled();
    expect(mocks.syncCsv).not.toHaveBeenCalled();
    expect(mocks.syncReport).not.toHaveBeenCalled();
  });

  it("reports an ordinary lease-acquisition failure", async () => {
    mocks.acquireLease.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runGlookoBackgroundTask()).resolves.toBe("failed");
    expect(mocks.beginRun).not.toHaveBeenCalled();
  });

  it("cannot re-register stale background work after erase commits", async () => {
    mocks.syncCsv.mockResolvedValueOnce({
      ...CSV_SUCCESS,
      syncState: {
        ...CSV_SUCCESS.syncState,
        automaticEnabled: false,
      },
    });
    mocks.withLeaseTransaction.mockRejectedValueOnce(supersededError());

    await expect(runGlookoBackgroundTask()).resolves.toBe("success");

    expect(mocks.withLeaseTransaction).toHaveBeenCalledWith(
      LEASE,
      expect.any(Function),
    );
    expect(mocks.reconcileRegistration).not.toHaveBeenCalled();
  });

  it("acquires and checks ownership when registration callers omit a lease", async () => {
    mocks.withLeaseTransaction.mockRejectedValueOnce(supersededError());

    await expect(
      updateGlookoBackgroundSyncRegistration(),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });

    expect(mocks.acquireLease).toHaveBeenCalledOnce();
    expect(mocks.withLeaseTransaction).toHaveBeenCalledWith(
      LEASE,
      expect.any(Function),
    );
    expect(mocks.reconcileRegistration).not.toHaveBeenCalled();
  });
});
