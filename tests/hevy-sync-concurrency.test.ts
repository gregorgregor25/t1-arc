import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HevyConnection,
  HevySyncResult,
  HevyUser,
} from "@/data/hevy/types";

import {
  beginHevyDataChange,
  connectAndSyncHevy,
  disconnectHevy,
  syncHevyConnection,
} from "@/data/hevy/sync";

const mocks = vi.hoisted(() => ({
  abortReservation: vi.fn(),
  acquireWriteLease: vi.fn(),
  activateReserved: vi.fn(),
  clearCandidate: vi.fn(),
  clearConnection: vi.fn(),
  clearCredentialRevision: vi.fn(),
  clearImportedWorkouts: vi.fn(),
  clientKeys: [] as string[],
  getAllWorkouts: vi.fn(),
  getUser: vi.fn(),
  ensureOwnership: vi.fn(),
  disconnectAndClear: vi.fn(),
  disconnectOwnership: vi.fn(),
  isCredentialCurrent: vi.fn(),
  loadConnection: vi.fn(),
  markAttempt: vi.fn(),
  markFailure: vi.fn(),
  prepareConnection: vi.fn(),
  reconcileFullSnapshot: vi.fn(),
  reserveConnection: vi.fn(),
  withCurrentReservation: vi.fn(),
  saveConnection: vi.fn(),
  savePendingConnection: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: vi.fn(async () => "snapshot-fingerprint"),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireWriteLease,
  assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
  isLocalDataWriteSupersededError: (error: unknown) =>
    error instanceof Error && error.name.includes("LocalData"),
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
    eventTimestamp: (event: { workout: { updated_at: string } }) =>
      Date.parse(event.workout.updated_at),
    HevyClient: class {
      constructor(private readonly apiKey: string) {
        mocks.clientKeys.push(apiKey);
      }

      getAllWorkouts() {
        return mocks.getAllWorkouts(this.apiKey);
      }

      getUser() {
        return mocks.getUser(this.apiKey);
      }
    },
    HevyError: MockHevyError,
    normalizeHevyApiKey: (value: string) => value.trim(),
  };
});

vi.mock("@/data/hevy/repository", () => ({
  disconnectAndClearHevyData: mocks.disconnectAndClear,
  disconnectHevyConnectionOwnership: mocks.disconnectOwnership,
  FULL_RECONCILIATION_CONFIRMATION_DELAY_MS: 30 * 60_000,
  HevyWorkoutRepository: class {
    abortCredentialReservation = mocks.abortReservation;
    activateReservedConnection = mocks.activateReserved;
    applyEvents = vi.fn();
    clearFullReconciliationCandidate = mocks.clearCandidate;
    clearImportedWorkouts = mocks.clearImportedWorkouts;
    cursor = vi.fn(async () => undefined);
    fullReconciliationAt = vi.fn(async () => undefined);
    fullReconciliationCandidate = vi.fn(async () => undefined);
    ensureConnectionOwnership = mocks.ensureOwnership;
    isCredentialSnapshotCurrent = mocks.isCredentialCurrent;
    markAttempt = mocks.markAttempt;
    markFailure = mocks.markFailure;
    prepareForConnection = mocks.prepareConnection;
    reconcileFullSnapshot = mocks.reconcileFullSnapshot;
    reserveConnection = mocks.reserveConnection;
    status = vi.fn();
    withCurrentCredentialReservation = mocks.withCurrentReservation;
  },
}));

vi.mock("@/data/hevy/secureStore", () => ({
  clearHevyCredentialRevision: mocks.clearCredentialRevision,
  clearHevyConnection: mocks.clearConnection,
  loadHevyConnection: mocks.loadConnection,
  savePendingHevyConnection: mocks.savePendingConnection,
  saveHevyConnection: mocks.saveConnection,
}));

const API_KEY_A = "account-a-key";
const API_KEY_B = "account-b-key";
const USER_A: HevyUser = { id: "user-a", name: "Account A" };
const USER_B: HevyUser = { id: "user-b", name: "Account B" };

function connection(apiKey: string, user: HevyUser): HevyConnection {
  return { apiKey, user, connectedAt: 1 };
}

function result(syncedAt: number): HevySyncResult {
  return {
    mode: "initial",
    imported: 0,
    updated: 0,
    deleted: 0,
    duplicatesLinked: 0,
    total: 0,
    syncedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("Hevy sync connection ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientKeys.length = 0;
    mocks.abortReservation.mockReset().mockResolvedValue(true);
    mocks.acquireWriteLease.mockReset().mockResolvedValue({ epoch: 0 });
    mocks.markAttempt.mockResolvedValue(undefined);
    mocks.markFailure.mockResolvedValue(undefined);
    let nextRevision = 1;
    mocks.reserveConnection.mockImplementation(
      async (ownership: { connectionGeneration: number; userId: string }) => {
        const revision = nextRevision;
        nextRevision += 2;
        return {
          ...ownership,
          credentialRevision: revision,
          retiredCredentialRevisions: [],
          revision,
          state: "pending",
        };
      },
    );
    mocks.activateReserved.mockImplementation(
      async (reservation: {
        connectionGeneration: number;
        credentialRevision: number;
        retiredCredentialRevisions: number[];
        revision: number;
        userId: string;
      }) => ({
        ...reservation,
        revision: reservation.revision + 1,
        state: "active",
      }),
    );
    mocks.isCredentialCurrent.mockResolvedValue(true);
    mocks.withCurrentReservation.mockImplementation(
      async (
        _reservation: unknown,
        _lease: unknown,
        task: () => Promise<unknown>,
      ) => task(),
    );
    mocks.ensureOwnership.mockResolvedValue(undefined);
    mocks.prepareConnection.mockResolvedValue(false);
    mocks.saveConnection.mockResolvedValue(undefined);
    mocks.savePendingConnection.mockResolvedValue(undefined);
    mocks.clearCandidate.mockResolvedValue(undefined);
    mocks.clearConnection.mockReset().mockResolvedValue(undefined);
    mocks.clearCredentialRevision.mockResolvedValue(undefined);
    mocks.clearImportedWorkouts.mockResolvedValue(0);
    mocks.disconnectOwnership.mockResolvedValue(undefined);
    mocks.disconnectAndClear.mockResolvedValue({
      clearLegacyCredential: false,
      credentialRevisions: [],
      removed: 0,
    });
    mocks.reconcileFullSnapshot.mockImplementation(
      async (_workouts: unknown[], snapshot: { syncedAt: number }) =>
        result(snapshot.syncedAt),
    );
  });

  it("coalesces concurrent checks for the same saved connection", async () => {
    const history = deferred<[]>();
    mocks.getAllWorkouts.mockReturnValueOnce(history.promise);
    const saved = connection(API_KEY_A, USER_A);

    const first = syncHevyConnection(saved);
    const second = syncHevyConnection(saved);
    await vi.waitFor(() => expect(mocks.getAllWorkouts).toHaveBeenCalledOnce());

    history.resolve([]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.clientKeys).toEqual([API_KEY_A]);
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledOnce();
  });

  it("does not start a saved-account network request after global erase intent", async () => {
    mocks.acquireWriteLease.mockRejectedValueOnce(
      new Error("A local-data privacy erase is still being completed."),
    );
    const saved = connection(API_KEY_A, USER_A);

    await expect(syncHevyConnection(saved)).rejects.toThrow("privacy erase");

    expect(mocks.getAllWorkouts).not.toHaveBeenCalled();
    expect(mocks.markAttempt).not.toHaveBeenCalled();
    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
  });

  it("does not validate a newly connected account with an older account run", async () => {
    const oldHistory = deferred<[]>();
    mocks.getAllWorkouts.mockImplementation((apiKey: string) =>
      apiKey === API_KEY_A ? oldHistory.promise : Promise.resolve([]),
    );
    mocks.getUser.mockImplementation(async (apiKey: string) => {
      expect(apiKey).toBe(API_KEY_B);
      return USER_B;
    });

    const oldRun = syncHevyConnection(connection(API_KEY_A, USER_A));
    await vi.waitFor(() => expect(mocks.getAllWorkouts).toHaveBeenCalledOnce());

    const newConnection = connectAndSyncHevy(API_KEY_B);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    expect(mocks.getAllWorkouts).toHaveBeenCalledTimes(1);

    oldHistory.resolve([]);
    await expect(oldRun).resolves.toMatchObject({ mode: "initial" });
    await expect(newConnection).resolves.toMatchObject({
      connection: { apiKey: API_KEY_B, user: USER_B },
      result: { mode: "initial" },
    });

    expect(mocks.clientKeys).toEqual([API_KEY_A, API_KEY_B, API_KEY_B]);
    expect(mocks.getAllWorkouts).toHaveBeenNthCalledWith(2, API_KEY_B);
    expect(mocks.reconcileFullSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.activateReserved).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionGeneration: expect.any(Number),
        state: "pending",
        userId: USER_B.id,
      }),
      expect.any(Function),
      { epoch: 0 },
    );
    expect(mocks.clearCandidate).toHaveBeenCalledOnce();
    expect(
      mocks.savePendingConnection.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.activateReserved.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.clearCandidate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAllWorkouts.mock.invocationCallOrder[1] ?? 0,
    );
    expect(mocks.clearConnection).toHaveBeenCalledOnce();
  });

  it("retains an authenticated account when its first history crawl fails", async () => {
    const firstHistory = deferred<[]>();
    mocks.getUser.mockImplementation(async (apiKey: string) =>
      apiKey === API_KEY_A ? USER_A : USER_B,
    );
    mocks.getAllWorkouts.mockImplementation((apiKey: string) =>
      apiKey === API_KEY_A ? firstHistory.promise : Promise.resolve([]),
    );

    const first = connectAndSyncHevy(API_KEY_A);
    await vi.waitFor(() =>
      expect(mocks.savePendingConnection).toHaveBeenCalledOnce(),
    );
    await vi.waitFor(() => expect(mocks.getAllWorkouts).toHaveBeenCalledOnce());

    const second = connectAndSyncHevy(API_KEY_B);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.savePendingConnection).toHaveBeenCalledTimes(1);

    firstHistory.reject(new Error("first account failed"));
    await expect(first).rejects.toThrow(
      "The Hevy sync could not be completed.",
    );
    await expect(second).resolves.toMatchObject({
      connection: { apiKey: API_KEY_B, user: USER_B },
      result: { mode: "initial" },
    });

    expect(mocks.clearConnection).toHaveBeenCalledTimes(2);
    expect(mocks.savePendingConnection).toHaveBeenCalledTimes(2);
    expect(mocks.savePendingConnection.mock.calls[1]?.[0]).toMatchObject({
      apiKey: API_KEY_B,
      user: USER_B,
    });
    expect(mocks.savePendingConnection.mock.calls[0]?.[0]).toMatchObject({
      apiKey: API_KEY_A,
      user: USER_A,
    });
  });

  it("preserves connection invocation order when the first authentication is slow", async () => {
    const firstUser = deferred<HevyUser>();
    mocks.getUser.mockImplementation((apiKey: string) =>
      apiKey === API_KEY_A ? firstUser.promise : Promise.resolve(USER_B),
    );
    mocks.getAllWorkouts.mockResolvedValue([]);

    const first = connectAndSyncHevy(API_KEY_A);
    await vi.waitFor(() => expect(mocks.getUser).toHaveBeenCalledOnce());
    const second = connectAndSyncHevy(API_KEY_B);

    await Promise.resolve();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.savePendingConnection).not.toHaveBeenCalled();

    firstUser.resolve(USER_A);
    await expect(first).resolves.toMatchObject({
      connection: { apiKey: API_KEY_A, user: USER_A },
    });
    await expect(second).resolves.toMatchObject({
      connection: { apiKey: API_KEY_B, user: USER_B },
    });

    expect(
      mocks.savePendingConnection.mock.calls.map(([saved]) => saved.apiKey),
    ).toEqual([API_KEY_A, API_KEY_B]);
  });

  it("does not write a reserved credential after the local erase fence wins", async () => {
    mocks.getUser.mockResolvedValue(USER_A);
    mocks.withCurrentReservation.mockRejectedValueOnce(
      new Error("privacy erase superseded the write"),
    );

    await expect(connectAndSyncHevy(API_KEY_A)).rejects.toThrow(
      "privacy erase superseded",
    );

    expect(mocks.savePendingConnection).not.toHaveBeenCalled();
    expect(mocks.activateReserved).not.toHaveBeenCalled();
    expect(mocks.abortReservation).toHaveBeenCalledWith(
      expect.objectContaining({ credentialRevision: 1, state: "pending" }),
      { epoch: 0 },
    );
    expect(mocks.clearConnection).toHaveBeenCalledOnce();
    expect(mocks.abortReservation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearConnection.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.clearCredentialRevision).not.toHaveBeenCalled();
  });

  it("durably aborts a failed activation before surfacing credential cleanup failure", async () => {
    mocks.getUser.mockResolvedValue(USER_A);
    mocks.activateReserved.mockRejectedValueOnce(
      new Error("activation failed"),
    );
    mocks.clearConnection.mockRejectedValueOnce(
      new Error("The saved Hevy credentials could not be fully removed."),
    );

    await expect(connectAndSyncHevy(API_KEY_A)).rejects.toThrow(
      "fully removed",
    );

    expect(mocks.abortReservation).toHaveBeenCalledWith(
      expect.objectContaining({ credentialRevision: 1, state: "pending" }),
      { epoch: 0 },
    );
    expect(mocks.abortReservation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearConnection.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.clearCredentialRevision).not.toHaveBeenCalled();
  });

  it("revalidates a saved account when its sync waits behind a new connection", async () => {
    const newUser = deferred<HevyUser>();
    const savedA = connection(API_KEY_A, USER_A);
    const savedB = connection(API_KEY_B, USER_B);
    mocks.getUser.mockReturnValue(newUser.promise);
    mocks.getAllWorkouts.mockResolvedValue([]);
    mocks.loadConnection
      .mockResolvedValueOnce(savedA)
      .mockResolvedValueOnce(savedB);

    const connectingB = connectAndSyncHevy(API_KEY_B);
    await vi.waitFor(() => expect(mocks.getUser).toHaveBeenCalledOnce());

    const queuedSavedSync = syncHevyConnection();
    await vi.waitFor(() => expect(mocks.loadConnection).toHaveBeenCalledOnce());
    expect(mocks.getAllWorkouts).not.toHaveBeenCalled();

    newUser.resolve(USER_B);
    await expect(connectingB).resolves.toMatchObject({
      connection: { apiKey: API_KEY_B, user: USER_B },
    });
    await expect(queuedSavedSync).resolves.toMatchObject({ mode: "initial" });

    expect(mocks.loadConnection).toHaveBeenCalledTimes(2);
    expect(mocks.getAllWorkouts).toHaveBeenCalledTimes(2);
    expect(mocks.getAllWorkouts).toHaveBeenNthCalledWith(1, API_KEY_B);
    expect(mocks.getAllWorkouts).toHaveBeenNthCalledWith(2, API_KEY_B);
    expect(mocks.getAllWorkouts).not.toHaveBeenCalledWith(API_KEY_A);
  });

  it("invalidates a sync past credential load before it can repopulate erased data", async () => {
    const history = deferred<[]>();
    const saved = connection(API_KEY_A, USER_A);
    mocks.getAllWorkouts.mockReturnValue(history.promise);

    const sync = syncHevyConnection(saved);
    await vi.waitFor(() => expect(mocks.getAllWorkouts).toHaveBeenCalledOnce());

    const barrier = beginHevyDataChange();
    history.resolve([]);

    await expect(sync).rejects.toThrow("superseded");
    await expect(barrier.ready).resolves.toBeUndefined();
    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
    expect(mocks.markFailure).not.toHaveBeenCalled();
    barrier.release();
  });

  it("disconnects and removes under one barrier so an old sync cannot repopulate", async () => {
    const history = deferred<[]>();
    const saved = connection(API_KEY_A, USER_A);
    mocks.getAllWorkouts.mockReturnValue(history.promise);

    const sync = syncHevyConnection(saved);
    await vi.waitFor(() => expect(mocks.getAllWorkouts).toHaveBeenCalledOnce());

    const removal = disconnectHevy({ removeImportedWorkouts: true });
    await vi.waitFor(() =>
      expect(mocks.disconnectAndClear).toHaveBeenCalledOnce(),
    );
    expect(mocks.clearImportedWorkouts).not.toHaveBeenCalled();

    history.resolve([]);
    await expect(sync).rejects.toThrow("superseded");
    await expect(removal).resolves.toBeUndefined();

    expect(mocks.reconcileFullSnapshot).not.toHaveBeenCalled();
    expect(mocks.clearConnection).toHaveBeenCalledTimes(2);
    expect(mocks.clearImportedWorkouts).not.toHaveBeenCalled();
    expect(mocks.markFailure).not.toHaveBeenCalled();
  });
});
