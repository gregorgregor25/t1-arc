import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEVY_CONNECTION_OWNERSHIP_KEY,
  HEVY_CONNECTION_REVISION_KEY,
} from "@/data/hevy/ownership";
import {
  HevyWorkoutRepository,
  invalidateHevyConnectionOwnership,
} from "@/data/hevy/repository";
import {
  clearHevyConnection,
  hevyCredentialKey,
  loadHevyConnection,
  savePendingHevyConnection,
} from "@/data/hevy/secureStore";
import { syncHevyIfDue } from "@/data/hevy/sync";
import { LOCAL_DATA_ERASE_INTENT_KEY } from "@/data/privacy/localDataWriteEpoch";

const state = vi.hoisted(() => ({
  database: undefined as unknown,
  deleteCredential: vi.fn(),
  getCredential: vi.fn(),
  network: vi.fn(),
  secureValues: new Map<string, string>(),
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => state.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = state.database as AsyncDatabaseAdapter;
      database.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(database);
        database.database.exec("COMMIT");
        return result;
      } catch (error) {
        database.database.exec("ROLLBACK");
        throw error;
      }
    },
  ),
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: state.deleteCredential,
  getItemAsync: state.getCredential,
  setItemAsync: vi.fn(async (key: string, value: string) => {
    state.secureValues.set(key, value);
  }),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: vi.fn(async () => "fingerprint"),
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
      getAllWorkouts = state.network;
      getWorkoutEvents = state.network;
      getUser = state.network;
    },
    HevyError: MockHevyError,
    normalizeHevyApiKey: (value: string) => value,
  };
});

type BindValue = string | number | bigint | Uint8Array | null;

class AsyncDatabaseAdapter {
  constructor(readonly database: DatabaseSync) {}

  async runAsync(sql: string, ...parameters: BindValue[]) {
    const result = this.database.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, ...parameters: BindValue[]) {
    return (
      (this.database.prepare(sql).get(...parameters) as T | undefined) ?? null
    );
  }

  async getAllAsync<T>(sql: string, ...parameters: BindValue[]) {
    return this.database.prepare(sql).all(...parameters) as T[];
  }
}

describe("Hevy global local-data erase fence", () => {
  let sqlite: DatabaseSync;
  let database: AsyncDatabaseAdapter;

  beforeEach(async () => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    database = new AsyncDatabaseAdapter(sqlite);
    state.database = database;
    state.secureValues.clear();
    state.getCredential
      .mockReset()
      .mockImplementation(
        async (key: string) => state.secureValues.get(key) ?? null,
      );
    state.deleteCredential
      .mockReset()
      .mockImplementation(async (key: string) => {
        state.secureValues.delete(key);
      });
    state.network.mockReset();

    const repository = new HevyWorkoutRepository();
    const pending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    await savePendingHevyConnection(
      {
        apiKey: "private-key",
        connectedAt: 1_000,
        user: { id: "user-a", name: "User A" },
      },
      pending,
    );
    expect(state.secureValues.has(hevyCredentialKey(1))).toBe(true);
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      "local-data-write-epoch-v1",
      "1",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      LOCAL_DATA_ERASE_INTENT_KEY,
      "1",
    );
    state.getCredential.mockClear();
  });

  afterEach(() => {
    sqlite.close();
  });

  it("blocks pending recovery before credentials, network, or ownership writes", async () => {
    await expect(loadHevyConnection()).rejects.toThrow("privacy erase");
    await expect(syncHevyIfDue()).rejects.toThrow("privacy erase");

    expect(state.getCredential).not.toHaveBeenCalled();
    expect(state.network).not.toHaveBeenCalled();
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(row!.value)).toMatchObject({
      credentialRevision: 1,
      revision: 1,
      state: "pending",
    });
    expect(
      await database.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = ?",
        HEVY_CONNECTION_REVISION_KEY,
      ),
    ).toEqual({ value: "1" });
  });

  it("cannot reactivate an aborted candidate when credential deletion fails", async () => {
    await database.runAsync(
      "DELETE FROM app_metadata WHERE key = ?",
      LOCAL_DATA_ERASE_INTENT_KEY,
    );
    const repository = new HevyWorkoutRepository();
    const pending = await repository.credentialSnapshot();
    expect(pending?.state).toBe("pending");
    await expect(
      repository.abortCredentialReservation(pending!, { epoch: 1 }),
    ).resolves.toBe(true);
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      credentialRevisions: [1],
    });
    state.deleteCredential.mockRejectedValue(
      new Error("simulated keystore deletion failure"),
    );

    await expect(clearHevyConnection({ epoch: 1 })).rejects.toThrow(
      "fully removed",
    );
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      credentialRevisions: [1],
    });
    await expect(loadHevyConnection()).rejects.toThrow("fully removed");
    expect(state.network).not.toHaveBeenCalled();
    expect(await repository.credentialSnapshot()).toBeUndefined();
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(row!.value)).toMatchObject({ state: "invalidated" });

    state.deleteCredential.mockImplementation(async (key: string) => {
      state.secureValues.delete(key);
    });
    await expect(loadHevyConnection()).resolves.toBeUndefined();
    expect(state.secureValues.has(hevyCredentialKey(1))).toBe(false);
  });

  it("cannot finish full cleanup while any malformed-owner credential remains", async () => {
    await database.runAsync(
      "DELETE FROM app_metadata WHERE key = ?",
      LOCAL_DATA_ERASE_INTENT_KEY,
    );
    await database.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      HEVY_CONNECTION_REVISION_KEY,
      "3",
    );
    await database.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({
        disconnectedAt: 1_000,
        retiredCredentialRevisions: [1, "broken", 3],
        revision: 3,
        state: "disconnected",
        version: 2,
      }),
    );
    state.secureValues.set(hevyCredentialKey(2), "private-key-2");
    state.secureValues.set(hevyCredentialKey(3), "private-key-3");

    await invalidateHevyConnectionOwnership(2_000);
    const durableTombstone = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(durableTombstone!.value)).toMatchObject({
      cleanupThroughRevision: 3,
      clearLegacyCredential: true,
      state: "invalidated",
    });
    state.deleteCredential.mockImplementation(async (key: string) => {
      if (key === hevyCredentialKey(2)) {
        throw new Error("simulated keystore deletion failure");
      }
      state.secureValues.delete(key);
    });

    await expect(clearHevyConnection({ epoch: 1 })).rejects.toThrow(
      "fully removed",
    );

    expect(state.deleteCredential).toHaveBeenCalledWith(hevyCredentialKey(1));
    expect(state.deleteCredential).toHaveBeenCalledWith(hevyCredentialKey(2));
    expect(state.deleteCredential).toHaveBeenCalledWith(hevyCredentialKey(3));
    expect(state.secureValues.has(hevyCredentialKey(2))).toBe(true);
    expect(
      await database.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = ?",
        HEVY_CONNECTION_OWNERSHIP_KEY,
      ),
    ).toEqual(durableTombstone);

    state.deleteCredential.mockImplementation(async (key: string) => {
      state.secureValues.delete(key);
    });
    await expect(clearHevyConnection({ epoch: 1 })).resolves.toBeUndefined();

    expect(state.secureValues.has(hevyCredentialKey(2))).toBe(false);
    await expect(
      new HevyWorkoutRepository().credentialCleanupPlan(),
    ).resolves.toMatchObject({
      clearLegacyCredential: false,
      credentialRevisions: [],
    });
  });
});
