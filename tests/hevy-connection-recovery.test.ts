import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HevyCredentialSnapshot } from "@/data/hevy/ownership";

import {
  clearHevyConnection,
  hevyCredentialKey,
  loadHevyConnection,
  savePendingHevyConnection,
} from "@/data/hevy/secureStore";
import type { HevyConnection } from "@/data/hevy/types";

const mocks = vi.hoisted(() => ({
  acquireWriteLease: vi.fn(),
  acknowledgeCleanup: vi.fn(),
  activateReserved: vi.fn(),
  cleanupPlan: vi.fn(),
  deleteItem: vi.fn(),
  getItem: vi.fn(),
  isCurrent: vi.fn(),
  recoverMissing: vi.fn(),
  snapshot: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireWriteLease,
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItem,
  getItemAsync: mocks.getItem,
  setItemAsync: mocks.setItem,
}));

vi.mock("@/data/hevy/repository", () => ({
  HevyWorkoutRepository: class {
    acknowledgeCredentialCleanup = mocks.acknowledgeCleanup;
    activateReservedConnection = mocks.activateReserved;
    credentialCleanupPlan = mocks.cleanupPlan;
    credentialSnapshot = mocks.snapshot;
    isCredentialSnapshotCurrent = mocks.isCurrent;
    recoverMissingCredential = mocks.recoverMissing;
  },
}));

const CONNECTION_A: HevyConnection = {
  apiKey: "private-key-a",
  connectedAt: 3_000,
  user: { id: "user-a", name: "Account A" },
};
const CONNECTION_B: HevyConnection = {
  apiKey: "private-key-b",
  connectedAt: 2_000,
  user: { id: "user-b", name: "Account B" },
};
const ACTIVE_A: HevyCredentialSnapshot = {
  connectionGeneration: 3_000,
  credentialRevision: 1,
  retiredCredentialRevisions: [],
  revision: 2,
  state: "active",
  userId: "user-a",
};
const ACTIVE_B: HevyCredentialSnapshot = {
  connectionGeneration: 2_000,
  credentialRevision: 4,
  retiredCredentialRevisions: [1],
  revision: 5,
  state: "active",
  userId: "user-b",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Hevy cross-store connection recovery", () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = new Map();
    mocks.acquireWriteLease.mockReset().mockResolvedValue({ epoch: 0 });
    mocks.acknowledgeCleanup.mockReset().mockResolvedValue(true);
    mocks.activateReserved.mockReset();
    mocks.recoverMissing.mockReset();
    mocks.getItem.mockImplementation(
      async (key: string) => stored.get(key) ?? null,
    );
    mocks.setItem.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
    mocks.deleteItem.mockImplementation(async (key: string) => {
      stored.delete(key);
    });
    mocks.snapshot.mockReset().mockResolvedValue(undefined);
    mocks.isCurrent.mockReset().mockResolvedValue(true);
    mocks.cleanupPlan.mockReset().mockResolvedValue({
      clearLegacyCredential: false,
      credentialRevisions: [],
    });
  });

  it("stores a candidate under its immutable SQLite credential revision", async () => {
    await savePendingHevyConnection(CONNECTION_A, {
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });

    expect([...stored.keys()]).toEqual([hevyCredentialKey(1)]);
    expect(JSON.parse(stored.get(hevyCredentialKey(1))!)).toMatchObject({
      connection: CONNECTION_A,
      credentialRevision: 1,
      version: 3,
    });
  });

  it("does not access credentials or recover a pending owner after a global erase intent", async () => {
    mocks.acquireWriteLease.mockRejectedValueOnce(
      new Error("A local-data privacy erase is still being completed."),
    );
    mocks.snapshot.mockResolvedValueOnce({
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });

    await expect(loadHevyConnection()).rejects.toThrow("privacy erase");

    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.activateReserved).not.toHaveBeenCalled();
  });

  it("resumes a pending activation after process death without rewriting credentials", async () => {
    await savePendingHevyConnection(CONNECTION_A, {
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });
    const pending = { ...ACTIVE_A, revision: 1, state: "pending" as const };
    mocks.snapshot.mockResolvedValueOnce(pending);
    mocks.activateReserved.mockResolvedValueOnce(ACTIVE_A);

    await expect(loadHevyConnection()).resolves.toEqual({
      ...CONNECTION_A,
      credentialRevision: 1,
      ownershipRevision: 2,
    });

    expect(mocks.setItem).toHaveBeenCalledOnce();
    expect(mocks.activateReserved).toHaveBeenCalledWith(pending, undefined, {
      epoch: 0,
    });
    expect(stored.has(hevyCredentialKey(1))).toBe(true);
  });

  it("cannot let a stale load delete or rewrite a newer account credential", async () => {
    await savePendingHevyConnection(CONNECTION_A, {
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });
    await savePendingHevyConnection(CONNECTION_B, {
      ...ACTIVE_B,
      revision: 4,
      state: "pending",
    });
    const staleCheck = deferred<boolean>();
    mocks.snapshot
      .mockResolvedValueOnce(ACTIVE_A)
      .mockResolvedValueOnce(ACTIVE_B);
    mocks.isCurrent
      .mockReturnValueOnce(staleCheck.promise)
      .mockResolvedValueOnce(true);

    const loading = loadHevyConnection();
    await vi.waitFor(() =>
      expect(mocks.isCurrent).toHaveBeenCalledWith(ACTIVE_A, { epoch: 0 }),
    );
    staleCheck.resolve(false);

    await expect(loading).resolves.toMatchObject({
      apiKey: CONNECTION_B.apiKey,
      credentialRevision: 4,
      ownershipRevision: 5,
    });
    expect(stored.get(hevyCredentialKey(4))).toContain(CONNECTION_B.apiKey);
    expect(mocks.deleteItem).not.toHaveBeenCalledWith(hevyCredentialKey(4));
    expect(mocks.setItem).toHaveBeenCalledTimes(2);
  });

  it("recovers the previous active account when a pending candidate has no credential", async () => {
    await savePendingHevyConnection(CONNECTION_A, {
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });
    const pendingB = { ...ACTIVE_B, revision: 4, state: "pending" as const };
    mocks.snapshot
      .mockResolvedValueOnce(pendingB)
      .mockResolvedValueOnce(ACTIVE_A);
    mocks.recoverMissing.mockResolvedValueOnce(ACTIVE_A);
    mocks.isCurrent.mockResolvedValueOnce(true);

    await expect(loadHevyConnection()).resolves.toMatchObject({
      apiKey: CONNECTION_A.apiKey,
      credentialRevision: 1,
      ownershipRevision: 2,
    });

    expect(mocks.recoverMissing).toHaveBeenCalledWith(pendingB, { epoch: 0 });
    expect(mocks.deleteItem).not.toHaveBeenCalledWith(hevyCredentialKey(1));
  });

  it("clears only revisions retired by the durable action, not a concurrent reconnect", async () => {
    await savePendingHevyConnection(CONNECTION_A, {
      ...ACTIVE_A,
      revision: 1,
      state: "pending",
    });
    await savePendingHevyConnection(CONNECTION_B, {
      ...ACTIVE_B,
      revision: 4,
      state: "pending",
    });
    mocks.cleanupPlan.mockResolvedValueOnce({
      clearLegacyCredential: true,
      credentialRevisions: [1],
    });

    await clearHevyConnection();

    expect(stored.has(hevyCredentialKey(1))).toBe(false);
    expect(stored.has(hevyCredentialKey(4))).toBe(true);
    expect(mocks.deleteItem).not.toHaveBeenCalledWith(hevyCredentialKey(4));
  });

  it("acknowledges imported cleanup metadata without probing an old credential slot", async () => {
    const plan = {
      clearLegacyCredential: true,
      credentialRevisions: [],
      ownershipValue: "imported-owner",
    };
    mocks.cleanupPlan.mockResolvedValueOnce(plan);

    await clearHevyConnection();

    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.acknowledgeCleanup).toHaveBeenCalledWith(plan, undefined);
  });

  it("attempts every scoped cleanup target and reports any SecureStore failure", async () => {
    stored.set(hevyCredentialKey(1), "credential-a");
    stored.set(hevyCredentialKey(4), "credential-b");
    mocks.cleanupPlan.mockResolvedValueOnce({
      clearLegacyCredential: true,
      credentialRevisions: [1, 4],
    });
    mocks.deleteItem.mockImplementation(async (key: string) => {
      if (key === hevyCredentialKey(1)) throw new Error("keystore unavailable");
      stored.delete(key);
    });

    await expect(clearHevyConnection()).rejects.toThrow("fully removed");

    expect(mocks.deleteItem).toHaveBeenCalledWith(hevyCredentialKey(1));
    expect(mocks.deleteItem).toHaveBeenCalledWith(hevyCredentialKey(4));
    expect(stored.has(hevyCredentialKey(4))).toBe(false);
  });

  it("verifies a scoped credential is absent before acknowledging cleanup", async () => {
    stored.set(hevyCredentialKey(1), "credential-a");
    mocks.cleanupPlan.mockResolvedValueOnce({
      clearLegacyCredential: false,
      credentialRevisions: [1],
      ownershipValue: "exact-owner",
    });
    mocks.deleteItem.mockResolvedValueOnce(undefined);

    await expect(clearHevyConnection()).rejects.toThrow("fully removed");

    expect(stored.has(hevyCredentialKey(1))).toBe(true);
    expect(mocks.acknowledgeCleanup).not.toHaveBeenCalled();
  });

  it("deletes an unreadable scoped credential only after exact snapshot revalidation", async () => {
    stored.set(hevyCredentialKey(1), "{broken");
    mocks.snapshot.mockResolvedValueOnce(ACTIVE_A);
    mocks.isCurrent.mockResolvedValueOnce(true);
    mocks.recoverMissing.mockResolvedValueOnce(undefined);

    await expect(loadHevyConnection()).rejects.toThrow("unreadable");

    expect(mocks.isCurrent).toHaveBeenCalledWith(ACTIVE_A, { epoch: 0 });
    expect(mocks.deleteItem).toHaveBeenCalledWith(hevyCredentialKey(1));
    expect(mocks.recoverMissing).toHaveBeenCalledWith(ACTIVE_A, { epoch: 0 });
  });
});
