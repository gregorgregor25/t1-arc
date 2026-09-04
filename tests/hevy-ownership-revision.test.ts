import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disconnectAndClearHevyData,
  disconnectHevyConnectionOwnership,
  HevyWorkoutRepository,
  invalidateHevyConnectionOwnership,
} from "@/data/hevy/repository";
import {
  HEVY_CONNECTION_OWNERSHIP_KEY,
  HEVY_CONNECTION_REVISION_KEY,
  parseStoredHevyOwnership,
} from "@/data/hevy/ownership";

const persistence = vi.hoisted(() => ({
  database: undefined as unknown,
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => persistence.database),
  withT1ArcTransaction: vi.fn(
    async (work: (database: unknown) => Promise<unknown>) => {
      const database = persistence.database as AsyncDatabaseAdapter;
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

type BindValue = string | number | bigint | Uint8Array | null;

class AsyncDatabaseAdapter {
  failWorkoutDelete = false;

  constructor(readonly database: DatabaseSync) {}

  async runAsync(sql: string, ...parameters: BindValue[]) {
    if (
      this.failWorkoutDelete &&
      sql === "DELETE FROM hevy_workouts WHERE id = ?"
    ) {
      throw new Error("simulated process failure");
    }
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

function createSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE source_sync_state (
      source_id TEXT NOT NULL PRIMARY KEY,
      last_attempt_at_ms INTEGER,
      last_success_at_ms INTEGER,
      last_error_code TEXT,
      last_error_message TEXT,
      record_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE context_events (
      id TEXT NOT NULL PRIMARY KEY,
      source_id TEXT NOT NULL
    );
    CREATE TABLE hevy_workouts (
      id TEXT NOT NULL PRIMARY KEY,
      context_event_id TEXT NOT NULL UNIQUE
        REFERENCES context_events(id) ON DELETE CASCADE
    );
  `);
}

describe("Hevy monotonic ownership and atomic privacy transitions", () => {
  let sqlite: DatabaseSync;
  let database: AsyncDatabaseAdapter;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    database = new AsyncDatabaseAdapter(sqlite);
    persistence.database = database;
  });

  afterEach(() => {
    sqlite.close();
  });

  it("lets a later tombstone beat a future-dated pending credential by revision", async () => {
    const repository = new HevyWorkoutRepository();
    const pending = await repository.reserveConnection({
      connectionGeneration: 3_000,
      userId: "user-a",
    });

    await disconnectHevyConnectionOwnership(2_000);

    await expect(
      repository.activateReservedConnection(pending),
    ).rejects.toThrow("superseded");
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(row!.value)).toMatchObject({
      invalidatedAt: 2_000,
      revision: pending.revision + 1,
      state: "invalidated",
    });
  });

  it("revalidates the pending revision inside the SQLite-held credential-write fence", async () => {
    const repository = new HevyWorkoutRepository();
    const pending = await repository.reserveConnection({
      connectionGeneration: 3_000,
      userId: "user-a",
    });
    const write = vi.fn(async () => undefined);

    await expect(
      repository.withCurrentCredentialReservation(pending, { epoch: 0 }, write),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledOnce();

    await disconnectHevyConnectionOwnership(2_000);
    await expect(
      repository.withCurrentCredentialReservation(pending, { epoch: 0 }, write),
    ).rejects.toThrow("superseded");
    expect(write).toHaveBeenCalledOnce();
  });

  it("can erase through a corrupt ownership row and recovers every allocated credential slot", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      "{corrupt",
    );

    await expect(invalidateHevyConnectionOwnership(2_000)).resolves.toEqual({
      clearLegacyCredential: true,
      credentialRevisions: [],
    });

    await expect(
      new HevyWorkoutRepository().credentialCleanupPlan(),
    ).resolves.toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
  });

  it("retains a legacy fallback until its revision-scoped replacement activates", async () => {
    const repository = new HevyWorkoutRepository();
    await repository.activateConnection({
      connectionGeneration: 1_000,
      userId: "legacy-user",
    });
    const pending = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "new-user",
    });

    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: false,
    });

    await repository.activateReservedConnection(pending);
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: true,
    });
  });

  it("allows a same-millisecond reconnect while rejecting the old generation lease", async () => {
    const repository = new HevyWorkoutRepository();
    const firstPending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    const firstActive =
      await repository.activateReservedConnection(firstPending);
    await disconnectHevyConnectionOwnership(1_000);

    const secondPending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    const secondActive =
      await repository.activateReservedConnection(secondPending);

    expect(secondPending.revision).toBeGreaterThan(firstActive.revision);
    expect(secondActive.revision).toBeGreaterThan(secondPending.revision);
    await expect(
      repository.markAttempt(1_000, {
        ...firstActive,
        ownershipRevision: firstActive.revision,
      }),
    ).rejects.toThrow("superseded");
    await expect(
      repository.markAttempt(1_000, {
        connectionGeneration: 1_000,
        userId: "user-a",
      }),
    ).rejects.toThrow("superseded");
    await expect(
      repository.markAttempt(1_000, {
        ...secondActive,
        ownershipRevision: secondActive.revision,
      }),
    ).resolves.toBeUndefined();
  });

  it("requires the exact modern credential and ownership revisions for a full snapshot", async () => {
    const repository = new HevyWorkoutRepository();
    const firstPending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    const firstActive =
      await repository.activateReservedConnection(firstPending);
    const firstSnapshot = {
      connectionGeneration: 1_000,
      credentialRevision: firstActive.credentialRevision,
      cursorAt: 1_000,
      fingerprint: "first",
      ownershipRevision: firstActive.revision,
      sourceWorkoutCount: 0,
      syncedAt: 1_000,
      userId: "user-a",
    };

    await expect(
      repository.reconcileFullSnapshot([], firstSnapshot),
    ).resolves.toMatchObject({ syncedAt: 1_000 });
    const firstCandidate = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      "hevy-full-reconciliation-candidate-v1",
    );
    expect(JSON.parse(firstCandidate!.value)).toMatchObject({
      credentialRevision: firstActive.credentialRevision,
      ownershipRevision: firstActive.revision,
    });

    await disconnectHevyConnectionOwnership(1_000);
    const secondPending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    const secondActive =
      await repository.activateReservedConnection(secondPending);
    await expect(
      repository.fullReconciliationCandidate(
        "user-a",
        1_000,
        secondActive.credentialRevision,
        secondActive.revision,
      ),
    ).resolves.toBeUndefined();

    await expect(
      repository.reconcileFullSnapshot([], {
        ...firstSnapshot,
        fingerprint: "stale",
        syncedAt: 2_000,
      }),
    ).rejects.toThrow("superseded");
    await expect(
      repository.reconcileFullSnapshot([], {
        ...firstSnapshot,
        credentialRevision: secondActive.credentialRevision,
        fingerprint: "second",
        ownershipRevision: secondActive.revision,
        syncedAt: 2_000,
      }),
    ).resolves.toMatchObject({ syncedAt: 2_000 });
  });

  it("treats a modern active owner without a credential revision as corrupt", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({
        connectionGeneration: 1_000,
        revision: 4,
        state: "active",
        userId: "user-a",
        version: 2,
      }),
    );
    const repository = new HevyWorkoutRepository();

    const plan = await repository.credentialCleanupPlan();

    expect(plan).toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
    await expect(
      repository.ensureConnectionOwnership({
        connectionGeneration: 1_000,
        userId: "user-a",
      }),
    ).rejects.toThrow("superseded");
    await expect(
      repository.reserveConnection({
        connectionGeneration: 2_000,
        userId: "user-b",
      }),
    ).rejects.toThrow("superseded");
    await expect(repository.acknowledgeCredentialCleanup(plan)).resolves.toBe(
      true,
    );
    expect(await repository.credentialSnapshot()).toBeUndefined();
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: false,
      credentialRevisions: [],
    });
  });

  it("preserves incomplete-owner high-water cleanup through privacy invalidation", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({
        connectionGeneration: 1_000,
        revision: 4,
        state: "active",
        userId: "user-a",
        version: 2,
      }),
    );

    await invalidateHevyConnectionOwnership(2_000);

    await expect(
      new HevyWorkoutRepository().credentialCleanupPlan(),
    ).resolves.toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
  });

  it("materializes a failed high-water cleanup across reconnect without targeting the new slot", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({ invalidatedAt: 1_000, state: "invalidated" }),
    );
    const repository = new HevyWorkoutRepository();
    const stalePlan = await repository.credentialCleanupPlan();
    expect(stalePlan).toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });

    const pending = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "user-b",
    });

    expect(pending.credentialRevision).toBe(6);
    expect(pending.retiredCredentialRevisions).toEqual([1, 2, 3, 4, 5]);
    const pendingRow = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(pendingRow!.value)).toMatchObject({
      clearLegacyCredential: true,
      retiredCredentialRevisions: [1, 2, 3, 4, 5],
    });
    await expect(
      repository.acknowledgeCredentialCleanup(stalePlan),
    ).resolves.toBe(false);
    await expect(repository.credentialSnapshot()).resolves.toMatchObject({
      credentialRevision: pending.credentialRevision,
      state: "pending",
    });
    const active = await repository.activateReservedConnection(pending);
    const activePlan = await repository.credentialCleanupPlan();
    expect(activePlan).toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
    expect(activePlan.credentialRevisions).not.toContain(
      active.credentialRevision,
    );
    await expect(
      repository.acknowledgeCredentialCleanup(activePlan),
    ).resolves.toBe(true);
    await expect(repository.credentialSnapshot()).resolves.toMatchObject({
      connectionGeneration: active.connectionGeneration,
      credentialRevision: active.credentialRevision,
      revision: active.revision,
      state: "active",
      userId: active.userId,
    });
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: false,
      credentialRevisions: [],
    });
  });

  it("unions a compact high-water obligation with explicitly retired slots", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "8",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({
        cleanupThroughRevision: 5,
        clearLegacyCredential: true,
        invalidatedAt: 1_000,
        retiredCredentialRevisions: [7],
        revision: 8,
        state: "invalidated",
        version: 2,
      }),
    );
    const repository = new HevyWorkoutRepository();

    await invalidateHevyConnectionOwnership(2_000);
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5, 7],
    });

    const pending = await repository.reserveConnection({
      connectionGeneration: 3_000,
      userId: "user-b",
    });
    expect(pending.credentialRevision).toBe(10);
    expect(pending.retiredCredentialRevisions).toEqual([1, 2, 3, 4, 5, 7]);
    expect(pending.retiredCredentialRevisions).not.toContain(8);
    expect(pending.retiredCredentialRevisions).not.toContain(9);
    expect(pending.retiredCredentialRevisions).not.toContain(10);
  });

  it("allocates reconnect credentials above inherited cleanup floors", async () => {
    const inheritedObligations = [
      { cleanupThroughRevision: 10 },
      { retiredCredentialRevisions: [10] },
    ];

    for (const obligation of inheritedObligations) {
      await database.runAsync("DELETE FROM app_metadata");
      await database.runAsync(
        "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
        HEVY_CONNECTION_REVISION_KEY,
        "5",
      );
      await database.runAsync(
        "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
        HEVY_CONNECTION_OWNERSHIP_KEY,
        JSON.stringify({
          invalidatedAt: 1_000,
          state: "invalidated",
          ...obligation,
        }),
      );
      const repository = new HevyWorkoutRepository();

      const cleanupPlan = await repository.credentialCleanupPlan();
      expect(cleanupPlan.credentialRevisions).toContain(10);
      const pending = await repository.reserveConnection({
        connectionGeneration: 2_000,
        userId: "user-b",
      });

      expect(pending.credentialRevision).toBe(11);
      expect(pending.revision).toBe(11);
      expect(pending.retiredCredentialRevisions).toContain(10);
      expect(pending.retiredCredentialRevisions).not.toContain(
        pending.credentialRevision,
      );
      await expect(repository.credentialSnapshot()).resolves.toMatchObject(
        pending,
      );
      await expect(
        repository.acknowledgeCredentialCleanup(cleanupPlan),
      ).resolves.toBe(false);
      await expect(repository.credentialSnapshot()).resolves.toMatchObject(
        pending,
      );
    }
  });

  it("retires a reconnected credential on a later disconnect without targeting action revisions", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({ invalidatedAt: 1_000, state: "invalidated" }),
    );
    const repository = new HevyWorkoutRepository();
    const pending = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "user-b",
    });
    const active = await repository.activateReservedConnection(pending);

    await disconnectHevyConnectionOwnership(3_000);

    const plan = await repository.credentialCleanupPlan();
    expect(plan).toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5, 6],
    });
    expect(plan.credentialRevisions).toContain(active.credentialRevision);
    expect(plan.credentialRevisions).not.toContain(active.revision);
    expect(plan.credentialRevisions).not.toContain(active.revision + 1);
  });

  it("preserves failed high-water and legacy cleanup across repeated invalidation and disconnect", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({ invalidatedAt: 1_000, state: "invalidated" }),
    );
    const repository = new HevyWorkoutRepository();

    await invalidateHevyConnectionOwnership(2_000);
    await invalidateHevyConnectionOwnership(3_000);
    await disconnectHevyConnectionOwnership(4_000);

    const plan = await repository.credentialCleanupPlan();
    expect(plan).toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
    expect(plan.credentialRevisions).not.toContain(6);
    expect(plan.credentialRevisions).not.toContain(7);
    expect(plan.credentialRevisions).not.toContain(8);
  });

  it("preserves failed legacy cleanup when aborting back to a modern owner", async () => {
    const repository = new HevyWorkoutRepository();
    await repository.activateConnection({
      connectionGeneration: 1_000,
      userId: "legacy-user",
    });
    const modernPending = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "modern-user",
    });
    const modernActive =
      await repository.activateReservedConnection(modernPending);
    expect(await repository.credentialCleanupPlan()).toMatchObject({
      clearLegacyCredential: true,
    });

    const replacement = await repository.reserveConnection({
      connectionGeneration: 3_000,
      userId: "replacement-user",
    });
    await repository.abortCredentialReservation(replacement);

    expect(await repository.credentialSnapshot()).toMatchObject({
      credentialRevision: modernActive.credentialRevision,
      state: "active",
      userId: modernActive.userId,
    });
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [replacement.credentialRevision],
    });
  });

  it("keeps the legacy key when an aborted replacement restores that legacy owner", async () => {
    const repository = new HevyWorkoutRepository();
    await repository.activateConnection({
      connectionGeneration: 1_000,
      userId: "legacy-user",
    });
    const replacement = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "replacement-user",
    });

    await repository.abortCredentialReservation(replacement);

    expect(await repository.credentialSnapshot()).toBeUndefined();
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: false,
      credentialRevisions: [replacement.credentialRevision],
    });
  });

  it("fails closed for every partial modern active ownership tuple", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    const partialTuples = [
      { version: 2 },
      { revision: 4 },
      { credentialRevision: 99 },
      { version: 2, revision: 4 },
      { version: 2, credentialRevision: 99 },
      { revision: 4, credentialRevision: 99 },
    ];
    const repository = new HevyWorkoutRepository();

    for (const tuple of partialTuples) {
      const value = JSON.stringify({
        connectionGeneration: 1_000,
        state: "active",
        userId: "user-a",
        ...tuple,
      });
      await database.runAsync(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        HEVY_CONNECTION_OWNERSHIP_KEY,
        value,
      );

      expect(parseStoredHevyOwnership(value)).toBeUndefined();
      expect(await repository.credentialSnapshot()).toBeUndefined();
      await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
        clearLegacyCredential: true,
        credentialRevisions: [1, 2, 3, 4, 5],
      });
    }

    for (const tuple of [
      { credentialRevision: 4, revision: 5, version: 1 },
      { credentialRevision: 4, revision: 0, version: 2 },
      { credentialRevision: 0, revision: 5, version: 2 },
      { credentialRevision: null, revision: 5, version: 2 },
    ]) {
      expect(
        parseStoredHevyOwnership(
          JSON.stringify({
            connectionGeneration: 1_000,
            state: "active",
            userId: "user-a",
            ...tuple,
          }),
        ),
      ).toBeUndefined();
    }

    expect(
      parseStoredHevyOwnership(
        JSON.stringify({
          connectionGeneration: 1_000,
          state: "active",
          userId: "legacy-user",
        }),
      ),
    ).toMatchObject({ state: "active" });
    expect(
      parseStoredHevyOwnership(
        JSON.stringify({
          connectionGeneration: 2_000,
          credentialRevision: 6,
          revision: 7,
          state: "active",
          userId: "modern-user",
          version: 2,
        }),
      ),
    ).toMatchObject({ state: "active" });
  });

  it("fails closed for relationally impossible modern ownership tuples", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    const corruptOwners = [
      {
        connectionGeneration: 1_000,
        credentialRevision: 4,
        retiredCredentialRevisions: [4],
        revision: 5,
        state: "active",
        userId: "user-a",
        version: 2,
      },
      {
        connectionGeneration: 1_000,
        credentialRevision: 5,
        retiredCredentialRevisions: [5],
        revision: 5,
        state: "pending",
        userId: "user-a",
        version: 2,
      },
      {
        connectionGeneration: 2_000,
        credentialRevision: 5,
        previousActive: {
          connectionGeneration: 1_000,
          credentialRevision: 4,
          userId: "user-a",
        },
        retiredCredentialRevisions: [4],
        revision: 5,
        state: "pending",
        userId: "user-b",
        version: 2,
      },
      {
        connectionGeneration: 2_000,
        credentialRevision: 4,
        revision: 5,
        state: "pending",
        userId: "user-b",
        version: 2,
      },
      {
        connectionGeneration: 1_000,
        credentialRevision: 5,
        revision: 5,
        state: "active",
        userId: "user-a",
        version: 2,
      },
      {
        connectionGeneration: 1_000,
        credentialRevision: 99,
        revision: 5,
        state: "active",
        userId: "user-a",
        version: 2,
      },
      {
        connectionGeneration: 1_000,
        credentialRevision: 4,
        retiredCredentialRevisions: [6],
        revision: 5,
        state: "active",
        userId: "user-a",
        version: 2,
      },
      {
        connectionGeneration: 2_000,
        credentialRevision: 5,
        previousActive: {
          connectionGeneration: 1_000,
          credentialRevision: 6,
          userId: "user-a",
        },
        revision: 5,
        state: "pending",
        userId: "user-b",
        version: 2,
      },
    ];
    const repository = new HevyWorkoutRepository();

    for (const owner of corruptOwners) {
      const value = JSON.stringify(owner);
      await database.runAsync(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        HEVY_CONNECTION_OWNERSHIP_KEY,
        value,
      );

      expect(parseStoredHevyOwnership(value)).toBeUndefined();
      await expect(repository.credentialSnapshot()).resolves.toBeUndefined();
      const plan = await repository.credentialCleanupPlan();
      expect(plan).toMatchObject({
        clearLegacyCredential: true,
        credentialRevisions: [1, 2, 3, 4, 5],
        invalidateAfterCleanup: true,
      });
      expect(plan.credentialRevisions).not.toContain(6);
      expect(plan.credentialRevisions).not.toContain(99);
    }
  });

  it("fails closed for malformed tombstone tuples and cleanup metadata", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    const malformedMetadata = [
      { revision: 4 },
      { version: 2 },
      { revision: 4, version: 1 },
      { revision: 0, version: 2 },
      { credentialRevision: 3, revision: 4, version: 2 },
      { cleanupThroughRevision: "4", revision: 5, version: 2 },
      { clearLegacyCredential: "true", revision: 5, version: 2 },
      { retiredCredentialRevisions: "1,2", revision: 5, version: 2 },
      { retiredCredentialRevisions: null, revision: 5, version: 2 },
      { retiredCredentialRevisions: [1, "2"], revision: 5, version: 2 },
      { retiredCredentialRevisions: [1, 0], revision: 5, version: 2 },
    ];
    const repository = new HevyWorkoutRepository();

    for (const state of ["invalidated", "disconnected"] as const) {
      for (const metadata of malformedMetadata) {
        const value = JSON.stringify({
          ...(state === "invalidated"
            ? { invalidatedAt: 1_000 }
            : { disconnectedAt: 1_000 }),
          state,
          ...metadata,
        });
        await database.runAsync(
          `INSERT INTO app_metadata (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          HEVY_CONNECTION_OWNERSHIP_KEY,
          value,
        );

        expect(parseStoredHevyOwnership(value)).toBeUndefined();
        await expect(repository.credentialCleanupPlan()).resolves.toMatchObject(
          {
            clearLegacyCredential: true,
            credentialRevisions: [1, 2, 3, 4, 5],
            invalidateAfterCleanup: true,
          },
        );
      }
    }

    expect(
      parseStoredHevyOwnership(
        JSON.stringify({ invalidatedAt: 1_000, state: "invalidated" }),
      ),
    ).toMatchObject({ state: "invalidated" });
    expect(
      parseStoredHevyOwnership(
        JSON.stringify({
          invalidatedAt: 1_000,
          retiredCredentialRevisions: [1, 2],
          revision: 5,
          state: "invalidated",
          version: 2,
        }),
      ),
    ).toMatchObject({ state: "invalidated" });
  });

  it("carries bounded cleanup targets through disconnect of a malformed tombstone", async () => {
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_REVISION_KEY,
      "5",
    );
    await database.runAsync(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      HEVY_CONNECTION_OWNERSHIP_KEY,
      JSON.stringify({
        disconnectedAt: 1_000,
        retiredCredentialRevisions: [1, "broken", 5],
        revision: 5,
        state: "disconnected",
        version: 2,
      }),
    );
    const repository = new HevyWorkoutRepository();

    await disconnectHevyConnectionOwnership(2_000);

    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      clearLegacyCredential: true,
      credentialRevisions: [1, 2, 3, 4, 5],
    });
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      HEVY_CONNECTION_OWNERSHIP_KEY,
    );
    expect(JSON.parse(row!.value)).toMatchObject({
      cleanupThroughRevision: 5,
      clearLegacyCredential: true,
      revision: 6,
      state: "invalidated",
      version: 2,
    });
  });

  it("compacts retired credential cleanup only for the exact current owner", async () => {
    const repository = new HevyWorkoutRepository();
    const first = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    await repository.activateReservedConnection(first);
    const second = await repository.reserveConnection({
      connectionGeneration: 2_000,
      userId: "user-b",
    });
    await repository.activateReservedConnection(second);
    const plan = await repository.credentialCleanupPlan();
    expect(plan.credentialRevisions).toContain(first.credentialRevision);

    const third = await repository.reserveConnection({
      connectionGeneration: 3_000,
      userId: "user-c",
    });
    await repository.activateReservedConnection(third);
    await expect(repository.acknowledgeCredentialCleanup(plan)).resolves.toBe(
      false,
    );
    expect(
      (await repository.credentialCleanupPlan()).credentialRevisions,
    ).toContain(first.credentialRevision);

    const currentPlan = await repository.credentialCleanupPlan();
    await expect(
      repository.acknowledgeCredentialCleanup(currentPlan),
    ).resolves.toBe(true);
    await expect(repository.credentialCleanupPlan()).resolves.toMatchObject({
      credentialRevisions: [],
    });
  });

  it("rolls back both the disconnect tombstone and row purge at a crash boundary", async () => {
    const repository = new HevyWorkoutRepository();
    const pending = await repository.reserveConnection({
      connectionGeneration: 1_000,
      userId: "user-a",
    });
    const active = await repository.activateReservedConnection(pending);
    await database.runAsync(
      "INSERT INTO context_events (id, source_id) VALUES ('hevy:one', 'hevy')",
    );
    await database.runAsync(
      "INSERT INTO hevy_workouts (id, context_event_id) VALUES ('one', 'hevy:one')",
    );
    database.failWorkoutDelete = true;

    await expect(disconnectAndClearHevyData(2_000)).rejects.toThrow(
      "simulated process failure",
    );

    expect(await repository.credentialSnapshot()).toMatchObject(active);
    expect(
      await database.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hevy_workouts",
      ),
    ).toEqual({ count: 1 });

    database.failWorkoutDelete = false;
    await expect(disconnectAndClearHevyData(2_000)).resolves.toMatchObject({
      credentialRevisions: [pending.credentialRevision],
    });
    expect(await repository.credentialSnapshot()).toBeUndefined();
    expect(
      await database.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hevy_workouts",
      ),
    ).toEqual({ count: 0 });
  });
});
