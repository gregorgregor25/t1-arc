import type { SQLiteDatabase } from "expo-sqlite";

import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from "@/data/persistence/t1arcDatabase";
import { LOCAL_DATA_RESET_SENTINEL_KEY } from "@/data/privacy/localDataResetSentinel";
import {
  assertLocalDataWriteLeaseInTransaction,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";
import type { LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";
import { parseExternalAbsoluteTimestamp } from "@/domain/externalTimestamp";

import { HEVY_SOURCE_ID, hevyWorkoutToActivity } from "./mapping";
import {
  activeHevyOwnershipValue,
  disconnectedHevyOwnershipValue,
  HEVY_CONNECTION_OWNERSHIP_KEY,
  HEVY_CONNECTION_REVISION_KEY,
  hevyCredentialSnapshot,
  hevyOwnershipMatches,
  HevySyncSupersededError,
  invalidatedHevyOwnershipValue,
  pendingHevyOwnershipValue,
  parseActiveHevyOwnership,
  parseStoredHevyOwnership,
} from "./ownership";
import type {
  HevyConnectionOwnership,
  HevyCredentialCleanupPlan,
  HevyCredentialReference,
  HevyCredentialSnapshot,
  StoredHevyOwnership,
} from "./ownership";
import type {
  HevySourceStatus,
  HevySyncResult,
  HevyWorkout,
  HevyWorkoutEvent,
} from "./types";

const SYNC_METADATA_KEY = "hevy-sync-state-v1";
const MAX_HEVY_CREDENTIAL_CLEANUP_REVISION = 100_000;
export const FULL_RECONCILIATION_METADATA_KEY =
  "hevy-full-reconciliation-state-v1";
export const FULL_RECONCILIATION_CANDIDATE_KEY =
  "hevy-full-reconciliation-candidate-v1";
export const FULL_RECONCILIATION_CONFIRMATION_DELAY_MS = 30 * 60_000;
interface StoredCursor {
  lastEventAt: number;
  userId: string;
}

interface StoredFullReconciliation {
  lastSuccessfulAt: number;
  userId: string;
}

interface StoredFullReconciliationCandidate {
  capturedAt: number;
  connectionGeneration: number;
  credentialRevision?: number;
  fingerprint: string;
  ownershipRevision?: number;
  sourceWorkoutCount: number;
  userId: string;
}

interface UpsertResult {
  existed: boolean;
  linkedDuplicate: boolean;
}

async function loadHevyOwnership(database: SQLiteDatabase) {
  return database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    HEVY_CONNECTION_OWNERSHIP_KEY,
  );
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function uniqueRevisions(values: (number | undefined)[]) {
  return [...new Set(values.filter(validRevision))].sort(
    (left, right) => left - right,
  );
}

function highestRevision(values: (number | undefined)[]) {
  return values.reduce<number>(
    (highest, value) =>
      validRevision(value) ? Math.max(highest, value) : highest,
    0,
  );
}

function revisionRange(through: number) {
  if (!validRevision(through)) return [];
  if (through > MAX_HEVY_CREDENTIAL_CLEANUP_REVISION) {
    throw new Error("The durable Hevy credential revision is invalid.");
  }
  return Array.from({ length: through }, (_, index) => index + 1);
}

function storedCredentialRevisions(stored: StoredHevyOwnership | undefined) {
  const direct =
    stored?.state === "active" || stored?.state === "pending"
      ? stored.credentialRevision
      : undefined;
  const previous =
    stored?.state === "pending"
      ? stored.previousActive?.credentialRevision
      : undefined;
  return uniqueRevisions([
    ...(stored?.retiredCredentialRevisions ?? []),
    direct,
    previous,
  ]);
}

function storedCredentialReference(
  stored: StoredHevyOwnership | undefined,
): HevyCredentialReference | undefined {
  return stored?.state === "active"
    ? {
        connectionGeneration: stored.connectionGeneration,
        ...(validRevision(stored.credentialRevision)
          ? { credentialRevision: stored.credentialRevision }
          : {}),
        userId: stored.userId,
      }
    : stored?.state === "pending"
      ? stored.previousActive
      : undefined;
}

function requiresCredentialHighWaterCleanup(
  stored: StoredHevyOwnership | undefined,
) {
  return (
    stored?.state === "active" &&
    stored.version === 2 &&
    validRevision(stored.revision) &&
    !validRevision(stored.credentialRevision)
  );
}

function isTombstone(stored: StoredHevyOwnership | undefined) {
  return stored?.state === "disconnected" || stored?.state === "invalidated";
}

function isLegacyTombstone(stored: StoredHevyOwnership | undefined) {
  return isTombstone(stored) && !validRevision(stored?.revision);
}

async function cleanupThroughBeforeTransition(
  transaction: SQLiteDatabase,
  rowPresent: boolean,
  stored: StoredHevyOwnership | undefined,
) {
  if (isTombstone(stored) && validRevision(stored?.cleanupThroughRevision)) {
    return stored.cleanupThroughRevision;
  }
  return rowPresent &&
    (!stored ||
      isLegacyTombstone(stored) ||
      requiresCredentialHighWaterCleanup(stored))
    ? hevyRevisionHighWater(transaction)
    : undefined;
}

function requiresLegacyCredentialCleanup(
  rowPresent: boolean,
  stored: StoredHevyOwnership | undefined,
  reference = storedCredentialReference(stored),
) {
  return Boolean(
    stored?.clearLegacyCredential ||
    (reference && !validRevision(reference.credentialRevision)) ||
    isLegacyTombstone(stored) ||
    (rowPresent && !stored),
  );
}

async function reservationCleanupRevisions(
  transaction: SQLiteDatabase,
  stored: StoredHevyOwnership | undefined,
) {
  const through = isTombstone(stored)
    ? validRevision(stored?.cleanupThroughRevision)
      ? stored.cleanupThroughRevision
      : isLegacyTombstone(stored)
        ? await hevyRevisionHighWater(transaction)
        : undefined
    : undefined;
  return uniqueRevisions([
    ...(validRevision(through) ? revisionRange(through) : []),
    ...(stored?.retiredCredentialRevisions ?? []),
    ...(stored?.state === "pending" ? [stored.credentialRevision] : []),
  ]);
}

async function allocateHevyRevision(
  transaction: SQLiteDatabase,
  minimumExclusive = 0,
) {
  if (minimumExclusive !== 0 && !validRevision(minimumExclusive)) {
    throw new Error("The durable Hevy credential revision is invalid.");
  }
  const counterRow = await transaction.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    HEVY_CONNECTION_REVISION_KEY,
  );
  const ownershipRow = await loadHevyOwnership(transaction);
  const counter = Number(counterRow?.value);
  const stored = ownershipRow
    ? parseStoredHevyOwnership(ownershipRow.value)
    : undefined;
  const current = Math.max(
    minimumExclusive,
    validRevision(counter) ? counter : 0,
    validRevision(stored?.revision) ? stored.revision : 0,
  );
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new Error("The Hevy ownership revision is exhausted.");
  }
  const revision = current + 1;
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    HEVY_CONNECTION_REVISION_KEY,
    String(revision),
  );
  return revision;
}

async function writeStoredHevyOwnership(
  transaction: SQLiteDatabase,
  value: string,
) {
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    HEVY_CONNECTION_OWNERSHIP_KEY,
    value,
  );
}

async function hevyRevisionHighWater(database: SQLiteDatabase) {
  const counter = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    HEVY_CONNECTION_REVISION_KEY,
  );
  const through = Number(counter?.value);
  return validRevision(through) ? through : 0;
}

async function assertHevyOwnership(
  database: SQLiteDatabase,
  expected: HevyConnectionOwnership,
) {
  const row = await loadHevyOwnership(database);
  const active = row ? parseActiveHevyOwnership(row.value) : undefined;
  if (!active || !hevyOwnershipMatches(active, expected)) {
    throw new HevySyncSupersededError();
  }
}

async function loadStoredCursor(database: SQLiteDatabase) {
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    SYNC_METADATA_KEY,
  );
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.value) as Partial<StoredCursor>;
    return typeof value.userId === "string" &&
      value.userId.length > 0 &&
      typeof value.lastEventAt === "number" &&
      Number.isFinite(value.lastEventAt)
      ? (value as StoredCursor)
      : undefined;
  } catch {
    return undefined;
  }
}

async function linkedContext(transaction: SQLiteDatabase, workoutId: string) {
  return transaction.getFirstAsync<{
    context_event_id: string;
    source_id: string | null;
  }>(
    `SELECT h.context_event_id, c.source_id
       FROM hevy_workouts h
       LEFT JOIN context_events c ON c.id = h.context_event_id
      WHERE h.id = ?`,
    workoutId,
  );
}

async function removeWorkout(transaction: SQLiteDatabase, workoutId: string) {
  const linked = await linkedContext(transaction, workoutId);
  await transaction.runAsync(
    "DELETE FROM hevy_workouts WHERE id = ?",
    workoutId,
  );
  if (linked?.source_id === HEVY_SOURCE_ID) {
    await transaction.runAsync(
      `DELETE FROM context_events WHERE id = ? AND source_id = ?`,
      linked.context_event_id,
      HEVY_SOURCE_ID,
    );
  }
  return Boolean(linked);
}

async function upsertWorkout(
  transaction: SQLiteDatabase,
  workout: HevyWorkout,
  importedAt: number,
): Promise<UpsertResult> {
  const updatedAt = parseExternalAbsoluteTimestamp(workout.updated_at);
  const createdAt = parseExternalAbsoluteTimestamp(workout.created_at);
  if (updatedAt === undefined || createdAt === undefined) {
    throw new Error(
      "Cannot persist a Hevy workout without absolute timestamps.",
    );
  }
  const previous = await linkedContext(transaction, workout.id);
  if (previous) await removeWorkout(transaction, workout.id);

  const activity = hevyWorkoutToActivity(workout, importedAt);
  const activityEnd =
    activity.end ?? activity.start + activity.durationMinutes * 60_000;
  const contextId = activity.id;
  const conflicting = await transaction.getFirstAsync<{ source_id: string }>(
    "SELECT source_id FROM context_events WHERE id = ?",
    contextId,
  );
  if (conflicting && conflicting.source_id !== HEVY_SOURCE_ID) {
    throw new Error(
      `A non-Hevy context row already owns the reserved workout id ${contextId}.`,
    );
  }
  await transaction.runAsync(
    `INSERT INTO context_events (
       id, source_id, origin, kind, start_ms, end_ms, title,
       activity_type, duration_minutes, intensity, recorded_at_ms
     ) VALUES (?, ?, 'imported', 'activity', ?, ?, ?, 'strength', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_id = excluded.source_id,
       origin = excluded.origin,
       kind = excluded.kind,
       start_ms = excluded.start_ms,
       end_ms = excluded.end_ms,
       title = excluded.title,
       activity_type = excluded.activity_type,
       duration_minutes = excluded.duration_minutes,
       intensity = excluded.intensity,
       recorded_at_ms = excluded.recorded_at_ms`,
    contextId,
    HEVY_SOURCE_ID,
    activity.start,
    activityEnd,
    activity.title,
    activity.durationMinutes,
    activity.intensity,
    importedAt,
  );
  await transaction.runAsync(
    `INSERT INTO hevy_workouts (
       id, context_event_id, title, description, start_ms, end_ms,
       updated_at_ms, created_at_ms, payload_json, imported_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       context_event_id = excluded.context_event_id,
       title = excluded.title,
       description = excluded.description,
       start_ms = excluded.start_ms,
       end_ms = excluded.end_ms,
       updated_at_ms = excluded.updated_at_ms,
       created_at_ms = excluded.created_at_ms,
       payload_json = excluded.payload_json,
       imported_at_ms = excluded.imported_at_ms`,
    workout.id,
    contextId,
    workout.title,
    workout.description || null,
    activity.start,
    activityEnd,
    updatedAt,
    createdAt,
    JSON.stringify(workout),
    importedAt,
  );
  return { existed: Boolean(previous), linkedDuplicate: false };
}

async function storeCursor(
  transaction: SQLiteDatabase,
  lastEventAt: number,
  userId: string,
) {
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    SYNC_METADATA_KEY,
    JSON.stringify({ lastEventAt, userId } satisfies StoredCursor),
  );
}

async function storeFullReconciliation(
  transaction: SQLiteDatabase,
  lastSuccessfulAt: number,
  userId: string,
) {
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    FULL_RECONCILIATION_METADATA_KEY,
    JSON.stringify({
      lastSuccessfulAt,
      userId,
    } satisfies StoredFullReconciliation),
  );
}

async function loadFullReconciliationCandidate(
  database: SQLiteDatabase,
  ownership: HevyConnectionOwnership,
) {
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    FULL_RECONCILIATION_CANDIDATE_KEY,
  );
  if (!row) return undefined;
  try {
    const value = JSON.parse(
      row.value,
    ) as Partial<StoredFullReconciliationCandidate>;
    const candidateOwnership: HevyConnectionOwnership = {
      connectionGeneration: Number(value.connectionGeneration),
      ...(validRevision(value.credentialRevision)
        ? { credentialRevision: value.credentialRevision }
        : {}),
      ...(validRevision(value.ownershipRevision)
        ? { ownershipRevision: value.ownershipRevision }
        : {}),
      userId: String(value.userId ?? ""),
    };
    return hevyOwnershipMatches(candidateOwnership, ownership) &&
      typeof value.capturedAt === "number" &&
      Number.isFinite(value.capturedAt) &&
      typeof value.fingerprint === "string" &&
      value.fingerprint.length > 0 &&
      typeof value.sourceWorkoutCount === "number" &&
      Number.isSafeInteger(value.sourceWorkoutCount) &&
      value.sourceWorkoutCount >= 0
      ? (value as StoredFullReconciliationCandidate)
      : undefined;
  } catch {
    return undefined;
  }
}

async function storeFullReconciliationCandidate(
  transaction: SQLiteDatabase,
  candidate: StoredFullReconciliationCandidate,
) {
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    FULL_RECONCILIATION_CANDIDATE_KEY,
    JSON.stringify(candidate),
  );
}

async function updateSourceState(
  transaction: SQLiteDatabase,
  values: {
    attemptedAt: number;
    successAt?: number;
    errorCode?: string;
    errorMessage?: string;
  },
) {
  const count =
    (
      await transaction.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM hevy_workouts",
      )
    )?.count ?? 0;
  await transaction.runAsync(
    `INSERT INTO source_sync_state (
       source_id, last_attempt_at_ms, last_success_at_ms,
       last_error_code, last_error_message, record_count
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       last_attempt_at_ms = excluded.last_attempt_at_ms,
       last_success_at_ms = COALESCE(excluded.last_success_at_ms, source_sync_state.last_success_at_ms),
       last_error_code = excluded.last_error_code,
       last_error_message = excluded.last_error_message,
       record_count = excluded.record_count`,
    HEVY_SOURCE_ID,
    values.attemptedAt,
    values.successAt ?? null,
    values.errorCode ?? null,
    values.errorMessage ?? null,
    count,
  );
  return count;
}

async function prepareForConnectionTransaction(
  transaction: SQLiteDatabase,
  userId: string,
) {
  const cursor = await loadStoredCursor(transaction);
  if (cursor?.userId === userId) return false;

  // Hevy rows predate per-row account ownership. Once a different account
  // has authenticated, remove the prior account's rows before saving the new
  // connection so Health and Tarv1s can never expose a mixed history. Rows
  // restored from backup have no device-bound cursor, so an unknown owner is
  // treated the same way once a new account is authenticated.
  const rows = await transaction.getAllAsync<{ id: string }>(
    "SELECT id FROM hevy_workouts",
  );
  if (!cursor && rows.length === 0) return false;
  for (const row of rows) {
    await removeWorkout(transaction, row.id);
  }
  await transaction.runAsync(
    "DELETE FROM source_sync_state WHERE source_id = ?",
    HEVY_SOURCE_ID,
  );
  await transaction.runAsync(
    "DELETE FROM app_metadata WHERE key IN (?, ?, ?)",
    SYNC_METADATA_KEY,
    FULL_RECONCILIATION_METADATA_KEY,
    FULL_RECONCILIATION_CANDIDATE_KEY,
  );
  return true;
}

async function clearImportedWorkoutsTransaction(transaction: SQLiteDatabase) {
  let removed = 0;
  const rows = await transaction.getAllAsync<{ id: string }>(
    "SELECT id FROM hevy_workouts",
  );
  for (const row of rows) {
    if (await removeWorkout(transaction, row.id)) removed += 1;
  }
  await transaction.runAsync(
    "DELETE FROM source_sync_state WHERE source_id = ?",
    HEVY_SOURCE_ID,
  );
  await transaction.runAsync(
    "DELETE FROM app_metadata WHERE key = ?",
    SYNC_METADATA_KEY,
  );
  await transaction.runAsync(
    "DELETE FROM app_metadata WHERE key = ?",
    FULL_RECONCILIATION_METADATA_KEY,
  );
  await transaction.runAsync(
    "DELETE FROM app_metadata WHERE key = ?",
    FULL_RECONCILIATION_CANDIDATE_KEY,
  );
  return removed;
}

async function disconnectHevyTransaction(
  transaction: SQLiteDatabase,
  disconnectedAt: number,
  removeImportedWorkouts: boolean,
) {
  const row = await loadHevyOwnership(transaction);
  const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
  const cleanupThroughRevision = await cleanupThroughBeforeTransition(
    transaction,
    Boolean(row),
    stored,
  );
  const credentialRevisions = storedCredentialRevisions(stored);
  const reference = storedCredentialReference(stored);
  const clearLegacyCredential = requiresLegacyCredentialCleanup(
    Boolean(row),
    stored,
    reference,
  );
  const revision = await allocateHevyRevision(
    transaction,
    highestRevision([cleanupThroughRevision, ...credentialRevisions]),
  );
  const value = reference
    ? disconnectedHevyOwnershipValue(reference, disconnectedAt, {
        cleanupThroughRevision,
        clearLegacyCredential,
        retiredCredentialRevisions: credentialRevisions,
        revision,
      })
    : invalidatedHevyOwnershipValue(disconnectedAt, {
        cleanupThroughRevision,
        clearLegacyCredential,
        retiredCredentialRevisions: credentialRevisions,
        revision,
      });
  await writeStoredHevyOwnership(transaction, value);
  const removed = removeImportedWorkouts
    ? await clearImportedWorkoutsTransaction(transaction)
    : 0;
  return {
    clearLegacyCredential,
    credentialRevisions,
    removed,
  };
}

export async function invalidateHevyConnectionOwnership(
  invalidatedAt = Date.now(),
) {
  return withT1ArcTransaction(async (transaction) => {
    const row = await loadHevyOwnership(transaction);
    const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
    const cleanupThroughRevision = await cleanupThroughBeforeTransition(
      transaction,
      Boolean(row),
      stored,
    );
    const credentialRevisions = storedCredentialRevisions(stored);
    const clearLegacyCredential = requiresLegacyCredentialCleanup(
      Boolean(row),
      stored,
    );
    const revision = await allocateHevyRevision(
      transaction,
      highestRevision([cleanupThroughRevision, ...credentialRevisions]),
    );
    await writeStoredHevyOwnership(
      transaction,
      invalidatedHevyOwnershipValue(invalidatedAt, {
        cleanupThroughRevision,
        clearLegacyCredential,
        retiredCredentialRevisions: credentialRevisions,
        revision,
      }),
    );
    return {
      clearLegacyCredential,
      credentialRevisions,
    } satisfies HevyCredentialCleanupPlan;
  });
}

export async function disconnectHevyConnectionOwnership(
  disconnectedAt = Date.now(),
) {
  return withT1ArcTransaction((transaction) =>
    disconnectHevyTransaction(transaction, disconnectedAt, false),
  );
}

export async function disconnectAndClearHevyData(disconnectedAt = Date.now()) {
  return withT1ArcTransaction((transaction) =>
    disconnectHevyTransaction(transaction, disconnectedAt, true),
  );
}

export class HevyWorkoutRepository {
  async credentialSnapshot() {
    const database = await openT1ArcDatabase();
    const row = await loadHevyOwnership(database);
    return hevyCredentialSnapshot(
      row ? parseStoredHevyOwnership(row.value) : undefined,
    );
  }

  async isCredentialSnapshotCurrent(
    snapshot: HevyCredentialSnapshot,
    writeLease?: LocalDataWriteLease,
  ) {
    return withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      const row = await loadHevyOwnership(transaction);
      const current = hevyCredentialSnapshot(
        row ? parseStoredHevyOwnership(row.value) : undefined,
      );
      return Boolean(
        current &&
        current.state === snapshot.state &&
        current.revision === snapshot.revision &&
        current.credentialRevision === snapshot.credentialRevision &&
        current.connectionGeneration === snapshot.connectionGeneration &&
        current.userId === snapshot.userId,
      );
    });
  }

  async credentialCleanupPlan(): Promise<HevyCredentialCleanupPlan> {
    return withT1ArcTransaction(async (database) => {
      // Read the owner and its high-water mark under one writer boundary. A
      // reconnect can only allocate a later immutable slot after this plan is
      // fixed, so a stale cleanup can never include the reconnect's key.
      const row = await loadHevyOwnership(database);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      if (!row) {
        return {
          clearLegacyCredential: false,
          credentialRevisions: [],
        };
      }
      if (!stored) {
        const through = await hevyRevisionHighWater(database);
        return {
          clearLegacyCredential: true,
          credentialRevisions: revisionRange(through),
          invalidateAfterCleanup: true,
          ownershipValue: row.value,
        };
      }
      if (requiresCredentialHighWaterCleanup(stored)) {
        const through = Math.max(
          Number(stored.revision),
          await hevyRevisionHighWater(database),
        );
        return {
          clearLegacyCredential: true,
          credentialRevisions: revisionRange(through),
          invalidateAfterCleanup: true,
          ownershipValue: row.value,
        };
      }
      if (stored.state === "disconnected" || stored.state === "invalidated") {
        let through = stored.cleanupThroughRevision;
        if (!validRevision(stored.revision) && !validRevision(through)) {
          through = await hevyRevisionHighWater(database);
        }
        return {
          clearLegacyCredential:
            Boolean(stored.clearLegacyCredential) ||
            !validRevision(stored.revision),
          credentialRevisions: uniqueRevisions([
            ...(validRevision(through) ? revisionRange(through) : []),
            ...(stored.retiredCredentialRevisions ?? []),
          ]),
          ...(!validRevision(stored.revision)
            ? { invalidateAfterCleanup: true }
            : {}),
          ownershipValue: row.value,
        };
      }
      return {
        clearLegacyCredential:
          stored.state === "active" && Boolean(stored.clearLegacyCredential),
        credentialRevisions: [...(stored.retiredCredentialRevisions ?? [])],
        ownershipValue: row.value,
      };
    });
  }

  async acknowledgeCredentialCleanup(
    plan: HevyCredentialCleanupPlan,
    writeLease?: LocalDataWriteLease,
  ) {
    if (!plan.ownershipValue) return false;
    let acknowledged = false;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      const row = await loadHevyOwnership(transaction);
      if (!row || row.value !== plan.ownershipValue) return;
      const stored = parseStoredHevyOwnership(row.value);
      if (!stored || plan.invalidateAfterCleanup) {
        const revision = await allocateHevyRevision(
          transaction,
          highestRevision(plan.credentialRevisions),
        );
        await writeStoredHevyOwnership(
          transaction,
          invalidatedHevyOwnershipValue(Date.now(), { revision }),
        );
        acknowledged = true;
        return;
      }
      const value = JSON.parse(row.value) as Record<string, unknown>;
      delete value.cleanupThroughRevision;
      if (plan.clearLegacyCredential) delete value.clearLegacyCredential;
      const removed = new Set(plan.credentialRevisions);
      const retired = (stored.retiredCredentialRevisions ?? []).filter(
        (revision) => !removed.has(revision),
      );
      if (retired.length > 0) value.retiredCredentialRevisions = retired;
      else delete value.retiredCredentialRevisions;
      await writeStoredHevyOwnership(transaction, JSON.stringify(value));
      acknowledged = true;
    });
    return acknowledged;
  }

  async reserveConnection(
    ownership: Pick<HevyConnectionOwnership, "connectionGeneration" | "userId">,
    isCurrent: () => boolean = () => true,
    writeLease?: LocalDataWriteLease,
  ): Promise<HevyCredentialSnapshot> {
    let reserved!: HevyCredentialSnapshot;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      if (!isCurrent()) throw new HevySyncSupersededError();
      const row = await loadHevyOwnership(transaction);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      if (row && (!stored || requiresCredentialHighWaterCleanup(stored))) {
        throw new HevySyncSupersededError();
      }
      const previousActive = storedCredentialReference(stored);
      const retiredCredentialRevisions = await reservationCleanupRevisions(
        transaction,
        stored,
      );
      const clearLegacyCredential = requiresLegacyCredentialCleanup(
        Boolean(row),
        stored,
        previousActive,
      );
      const revision = await allocateHevyRevision(
        transaction,
        highestRevision([
          ...retiredCredentialRevisions,
          previousActive?.credentialRevision,
        ]),
      );
      if (!isCurrent()) throw new HevySyncSupersededError();
      reserved = {
        connectionGeneration: ownership.connectionGeneration,
        credentialRevision: revision,
        retiredCredentialRevisions,
        revision,
        state: "pending",
        userId: ownership.userId,
      };
      await writeStoredHevyOwnership(
        transaction,
        pendingHevyOwnershipValue(
          reserved,
          previousActive,
          clearLegacyCredential,
        ),
      );
    });
    return reserved;
  }

  async activateReservedConnection(
    reservation: HevyCredentialSnapshot,
    isCurrent: () => boolean = () => true,
    writeLease?: LocalDataWriteLease,
  ): Promise<HevyCredentialSnapshot> {
    let active!: HevyCredentialSnapshot;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      if (!isCurrent()) throw new HevySyncSupersededError();
      const row = await loadHevyOwnership(transaction);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      const current = hevyCredentialSnapshot(stored);
      if (
        stored?.state !== "pending" ||
        !current ||
        current.revision !== reservation.revision ||
        current.credentialRevision !== reservation.credentialRevision ||
        current.connectionGeneration !== reservation.connectionGeneration ||
        current.userId !== reservation.userId
      ) {
        throw new HevySyncSupersededError();
      }
      await prepareForConnectionTransaction(transaction, reservation.userId);
      if (!isCurrent()) throw new HevySyncSupersededError();
      const revision = await allocateHevyRevision(transaction);
      active = {
        connectionGeneration: reservation.connectionGeneration,
        credentialRevision: reservation.credentialRevision,
        retiredCredentialRevisions: uniqueRevisions([
          ...(stored.retiredCredentialRevisions ?? []),
          stored.previousActive?.credentialRevision,
        ]),
        revision,
        state: "active",
        userId: reservation.userId,
      };
      await writeStoredHevyOwnership(
        transaction,
        activeHevyOwnershipValue(
          {
            connectionGeneration: active.connectionGeneration,
            credentialRevision: active.credentialRevision,
            ownershipRevision: active.revision,
            userId: active.userId,
          },
          active.retiredCredentialRevisions,
          Boolean(stored.clearLegacyCredential),
        ),
      );
      await transaction.runAsync(
        "DELETE FROM app_metadata WHERE key = ?",
        LOCAL_DATA_RESET_SENTINEL_KEY,
      );
    });
    return active;
  }

  async abortCredentialReservation(
    reservation: HevyCredentialSnapshot,
    writeLease?: LocalDataWriteLease,
  ) {
    let aborted = false;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      const row = await loadHevyOwnership(transaction);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      const current = hevyCredentialSnapshot(stored);
      if (
        stored?.state !== "pending" ||
        current?.state !== "pending" ||
        current.revision !== reservation.revision ||
        current.credentialRevision !== reservation.credentialRevision ||
        current.connectionGeneration !== reservation.connectionGeneration ||
        current.userId !== reservation.userId
      ) {
        return;
      }
      const revision = await allocateHevyRevision(transaction);
      const retired = uniqueRevisions([
        ...(stored.retiredCredentialRevisions ?? []),
        stored.credentialRevision,
      ]);
      const previous = stored.previousActive;
      if (previous) {
        await writeStoredHevyOwnership(
          transaction,
          activeHevyOwnershipValue(
            {
              connectionGeneration: previous.connectionGeneration,
              ...(validRevision(previous.credentialRevision)
                ? { credentialRevision: previous.credentialRevision }
                : {}),
              ...(validRevision(previous.credentialRevision)
                ? { ownershipRevision: revision }
                : {}),
              userId: previous.userId,
            },
            retired,
            validRevision(previous.credentialRevision) &&
              Boolean(stored.clearLegacyCredential),
          ),
        );
      } else {
        await writeStoredHevyOwnership(
          transaction,
          invalidatedHevyOwnershipValue(Date.now(), {
            clearLegacyCredential: Boolean(stored.clearLegacyCredential),
            retiredCredentialRevisions: retired,
            revision,
          }),
        );
      }
      aborted = true;
    });
    return aborted;
  }

  async withCurrentCredentialReservation<T>(
    reservation: HevyCredentialSnapshot,
    writeLease: LocalDataWriteLease,
    task: () => Promise<T>,
  ) {
    return withLocalDataWriteLeaseTransaction(
      writeLease,
      async (transaction) => {
        const row = await loadHevyOwnership(transaction);
        const current = hevyCredentialSnapshot(
          row ? parseStoredHevyOwnership(row.value) : undefined,
        );
        if (
          current?.state !== "pending" ||
          current.revision !== reservation.revision ||
          current.credentialRevision !== reservation.credentialRevision ||
          current.connectionGeneration !== reservation.connectionGeneration ||
          current.userId !== reservation.userId
        ) {
          throw new HevySyncSupersededError();
        }
        return task();
      },
    );
  }

  async recoverMissingCredential(
    snapshot: HevyCredentialSnapshot,
    writeLease?: LocalDataWriteLease,
  ) {
    let recovered: HevyCredentialSnapshot | undefined;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      const row = await loadHevyOwnership(transaction);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      const current = hevyCredentialSnapshot(stored);
      if (
        !current ||
        current.state !== snapshot.state ||
        current.revision !== snapshot.revision ||
        current.credentialRevision !== snapshot.credentialRevision ||
        current.connectionGeneration !== snapshot.connectionGeneration ||
        current.userId !== snapshot.userId
      ) {
        return;
      }
      const revision = await allocateHevyRevision(transaction);
      if (stored?.state === "pending" && stored.previousActive) {
        const previous = stored.previousActive;
        const retired = uniqueRevisions([
          ...(stored.retiredCredentialRevisions ?? []),
          stored.credentialRevision,
        ]);
        await writeStoredHevyOwnership(
          transaction,
          activeHevyOwnershipValue(
            {
              connectionGeneration: previous.connectionGeneration,
              credentialRevision: previous.credentialRevision,
              ...(validRevision(previous.credentialRevision)
                ? { ownershipRevision: revision }
                : {}),
              userId: previous.userId,
            },
            retired,
            validRevision(previous.credentialRevision) &&
              Boolean(stored.clearLegacyCredential),
          ),
        );
        if (validRevision(previous.credentialRevision)) {
          recovered = {
            connectionGeneration: previous.connectionGeneration,
            credentialRevision: previous.credentialRevision,
            retiredCredentialRevisions: retired,
            revision,
            state: "active",
            userId: previous.userId,
          };
        }
        return;
      }
      const retired = uniqueRevisions([
        ...(stored?.retiredCredentialRevisions ?? []),
        current.credentialRevision,
      ]);
      await writeStoredHevyOwnership(
        transaction,
        invalidatedHevyOwnershipValue(Date.now(), {
          clearLegacyCredential: Boolean(stored?.clearLegacyCredential),
          retiredCredentialRevisions: retired,
          revision,
        }),
      );
    });
    return recovered;
  }

  async cursor(userId: string) {
    const database = await openT1ArcDatabase();
    const value = await loadStoredCursor(database);
    return value?.userId === userId ? value.lastEventAt : undefined;
  }

  async fullReconciliationAt(userId: string) {
    const database = await openT1ArcDatabase();
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      FULL_RECONCILIATION_METADATA_KEY,
    );
    if (!row) return undefined;
    try {
      const value = JSON.parse(row.value) as Partial<StoredFullReconciliation>;
      return value.userId === userId &&
        typeof value.lastSuccessfulAt === "number" &&
        Number.isFinite(value.lastSuccessfulAt)
        ? value.lastSuccessfulAt
        : undefined;
    } catch {
      return undefined;
    }
  }

  async fullReconciliationCandidate(
    userId: string,
    connectionGeneration: number,
    credentialRevision?: number,
    ownershipRevision?: number,
  ) {
    const database = await openT1ArcDatabase();
    return loadFullReconciliationCandidate(database, {
      ...(validRevision(credentialRevision) ? { credentialRevision } : {}),
      ...(validRevision(ownershipRevision) ? { ownershipRevision } : {}),
      connectionGeneration,
      userId,
    });
  }

  async clearFullReconciliationCandidate(
    writeLease?: LocalDataWriteLease,
    ownership?: HevyConnectionOwnership,
  ) {
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      if (ownership) await assertHevyOwnership(transaction, ownership);
      await transaction.runAsync(
        "DELETE FROM app_metadata WHERE key = ?",
        FULL_RECONCILIATION_CANDIDATE_KEY,
      );
    });
  }

  async ensureConnectionOwnership(
    ownership: HevyConnectionOwnership,
    isCurrent: () => boolean = () => true,
    writeLease?: LocalDataWriteLease,
  ) {
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      if (!isCurrent()) throw new HevySyncSupersededError();
      const row = await loadHevyOwnership(transaction);
      if (row) {
        const active = parseActiveHevyOwnership(row.value);
        if (active && hevyOwnershipMatches(active, ownership)) return;
        throw new HevySyncSupersededError();
      }

      // Upgrade bridge for a connection saved by a build predating ownership
      // markers. A post-erase database always has either the reset sentinel or
      // an invalidated ownership row, so stale credentials cannot bootstrap.
      const reset = await transaction.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = ?",
        LOCAL_DATA_RESET_SENTINEL_KEY,
      );
      if (reset || !isCurrent()) throw new HevySyncSupersededError();
      await allocateHevyRevision(transaction);
      await writeStoredHevyOwnership(
        transaction,
        activeHevyOwnershipValue(ownership),
      );
    });
  }

  async activateConnection(
    ownership: HevyConnectionOwnership,
    isCurrent: () => boolean = () => true,
    writeLease?: LocalDataWriteLease,
  ) {
    let replacedAccount = false;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      if (!isCurrent()) throw new HevySyncSupersededError();
      const row = await loadHevyOwnership(transaction);
      const stored = row ? parseStoredHevyOwnership(row.value) : undefined;
      if (row && !stored) throw new HevySyncSupersededError();
      if (
        stored?.state === "active" &&
        hevyOwnershipMatches(stored, ownership)
      ) {
        await transaction.runAsync(
          "DELETE FROM app_metadata WHERE key = ?",
          LOCAL_DATA_RESET_SENTINEL_KEY,
        );
        return;
      }
      // Only the explicit reservation protocol can supersede another durable
      // action. This compatibility bridge is limited to a database with no
      // ownership row, so timestamps can never decide the winner.
      if (row) throw new HevySyncSupersededError();
      replacedAccount = await prepareForConnectionTransaction(
        transaction,
        ownership.userId,
      );
      if (!isCurrent()) throw new HevySyncSupersededError();
      await allocateHevyRevision(transaction);
      await writeStoredHevyOwnership(
        transaction,
        activeHevyOwnershipValue(ownership),
      );
      await transaction.runAsync(
        "DELETE FROM app_metadata WHERE key = ?",
        LOCAL_DATA_RESET_SENTINEL_KEY,
      );
    });
    return replacedAccount;
  }

  async prepareForConnection(userId: string) {
    let replacedAccount = false;
    await withT1ArcTransaction(async (transaction) => {
      replacedAccount = await prepareForConnectionTransaction(
        transaction,
        userId,
      );
    });
    return replacedAccount;
  }

  async markAttempt(
    attemptedAt: number,
    ownership: HevyConnectionOwnership,
    writeLease?: LocalDataWriteLease,
  ) {
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      await assertHevyOwnership(transaction, ownership);
      await updateSourceState(transaction, { attemptedAt });
    });
  }

  async markFailure(
    attemptedAt: number,
    code: string,
    message: string,
    ownership: HevyConnectionOwnership,
    writeLease?: LocalDataWriteLease,
  ) {
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      await assertHevyOwnership(transaction, ownership);
      await updateSourceState(transaction, {
        attemptedAt,
        errorCode: code,
        errorMessage: message,
      });
    });
  }

  async reconcileFullSnapshot(
    workouts: HevyWorkout[],
    snapshot: {
      connectionGeneration: number;
      credentialRevision?: number;
      cursorAt: number;
      fingerprint: string;
      ownershipRevision?: number;
      sourceWorkoutCount: number;
      syncedAt: number;
      userId: string;
    },
    writeLease?: LocalDataWriteLease,
  ): Promise<HevySyncResult> {
    const {
      connectionGeneration,
      credentialRevision,
      cursorAt,
      fingerprint,
      ownershipRevision,
      sourceWorkoutCount,
      syncedAt,
      userId,
    } = snapshot;
    let result!: HevySyncResult;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      await assertHevyOwnership(transaction, {
        connectionGeneration,
        ...(validRevision(credentialRevision) ? { credentialRevision } : {}),
        ...(validRevision(ownershipRevision) ? { ownershipRevision } : {}),
        userId,
      });
      const candidate = await loadFullReconciliationCandidate(transaction, {
        connectionGeneration,
        ...(validRevision(credentialRevision) ? { credentialRevision } : {}),
        ...(validRevision(ownershipRevision) ? { ownershipRevision } : {}),
        userId,
      });
      const confirmed = Boolean(
        candidate &&
        candidate.fingerprint === fingerprint &&
        candidate.sourceWorkoutCount === sourceWorkoutCount &&
        syncedAt >= candidate.capturedAt &&
        syncedAt - candidate.capturedAt >=
          FULL_RECONCILIATION_CONFIRMATION_DELAY_MS,
      );
      let deleted = 0;
      if (confirmed) {
        const existing = await transaction.getAllAsync<{ id: string }>(
          "SELECT id FROM hevy_workouts",
        );
        const incoming = new Set(workouts.map(({ id }) => id));
        for (const row of existing) {
          if (
            !incoming.has(row.id) &&
            (await removeWorkout(transaction, row.id))
          ) {
            deleted += 1;
          }
        }
      }
      let imported = 0;
      let updated = 0;
      let duplicatesLinked = 0;
      for (const workout of workouts) {
        const write = await upsertWorkout(transaction, workout, syncedAt);
        if (write.existed) updated += 1;
        else imported += 1;
        if (write.linkedDuplicate) duplicatesLinked += 1;
      }
      await storeCursor(transaction, cursorAt, userId);
      if (confirmed) {
        await storeFullReconciliation(transaction, syncedAt, userId);
        await transaction.runAsync(
          "DELETE FROM app_metadata WHERE key = ?",
          FULL_RECONCILIATION_CANDIDATE_KEY,
        );
      } else {
        await storeFullReconciliationCandidate(transaction, {
          capturedAt: syncedAt,
          connectionGeneration,
          ...(validRevision(credentialRevision) ? { credentialRevision } : {}),
          fingerprint,
          ...(validRevision(ownershipRevision) ? { ownershipRevision } : {}),
          sourceWorkoutCount,
          userId,
        });
      }
      const total = await updateSourceState(transaction, {
        attemptedAt: syncedAt,
        successAt: syncedAt,
      });
      result = {
        mode: "initial",
        imported,
        updated,
        deleted,
        duplicatesLinked,
        total,
        syncedAt,
      };
    });
    return result;
  }

  async applyEvents(
    events: HevyWorkoutEvent[],
    syncedAt: number,
    ownership: HevyConnectionOwnership,
    cursorAt = syncedAt,
    writeLease?: LocalDataWriteLease,
  ): Promise<HevySyncResult> {
    let result!: HevySyncResult;
    await withT1ArcTransaction(async (transaction) => {
      if (writeLease) {
        await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
      }
      await assertHevyOwnership(transaction, ownership);
      let imported = 0;
      let updated = 0;
      let deleted = 0;
      let duplicatesLinked = 0;
      for (const event of events) {
        if (event.type === "deleted") {
          if (await removeWorkout(transaction, event.id)) deleted += 1;
          continue;
        }
        const write = await upsertWorkout(transaction, event.workout, syncedAt);
        if (write.existed) updated += 1;
        else imported += 1;
        if (write.linkedDuplicate) duplicatesLinked += 1;
      }
      await storeCursor(transaction, cursorAt, ownership.userId);
      const total = await updateSourceState(transaction, {
        attemptedAt: syncedAt,
        successAt: syncedAt,
      });
      result = {
        mode: "incremental",
        imported,
        updated,
        deleted,
        duplicatesLinked,
        total,
        syncedAt,
      };
    });
    return result;
  }

  async status(): Promise<HevySourceStatus> {
    const database = await openT1ArcDatabase();
    const row = await database.getFirstAsync<{
      last_attempt_at_ms: number | null;
      last_success_at_ms: number | null;
      last_error_message: string | null;
      record_count: number;
    }>("SELECT * FROM source_sync_state WHERE source_id = ?", HEVY_SOURCE_ID);
    return {
      connected: false,
      workoutCount: row?.record_count ?? 0,
      lastAttemptAt: row?.last_attempt_at_ms ?? undefined,
      lastSuccessAt: row?.last_success_at_ms ?? undefined,
      lastError: row?.last_error_message ?? undefined,
    };
  }

  async clearImportedWorkouts() {
    return withT1ArcTransaction(clearImportedWorkoutsTransaction);
  }
}
