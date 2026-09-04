import * as Crypto from "expo-crypto";

import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
} from "@/data/privacy/localDataWriteEpoch";
import type { LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";

import {
  eventTimestamp,
  HevyClient,
  HevyError,
  normalizeHevyApiKey,
} from "./client";
import {
  disconnectAndClearHevyData,
  disconnectHevyConnectionOwnership,
  FULL_RECONCILIATION_CONFIRMATION_DELAY_MS,
  HevyWorkoutRepository,
} from "./repository";
import {
  clearHevyConnection,
  loadHevyConnection,
  savePendingHevyConnection,
} from "./secureStore";
import type {
  HevyConnection,
  HevySyncResult,
  HevyWorkout,
  HevyWorkoutEvent,
} from "./types";
import { isCompletedHevyWorkout } from "./completion";
import { HevySyncSupersededError } from "./ownership";
import type { HevyConnectionOwnership } from "./ownership";
import { HEVY_SYNC_INTERVAL_MS } from "./policy";
import { HevySyncCoordinator } from "./syncCoordinator";
import type { HevySyncLease } from "./syncCoordinator";

export { HEVY_SYNC_INTERVAL_MS } from "./policy";

const EVENT_OVERLAP_MS = 60_000;
export const HEVY_FULL_RECONCILIATION_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const hevySyncInFlight = new Map<string, Promise<HevySyncResult>>();
const hevySyncCoordinator = new HevySyncCoordinator();

function connectionIdentity(connection: HevyConnection) {
  return `${connection.user.id}\u0000${connection.apiKey}`;
}

function cursorBeforePending(pending: HevyWorkoutEvent[], fallback: number) {
  return pending.length
    ? Math.min(fallback, ...pending.map(eventTimestamp))
    : fallback;
}

export function hevySnapshotFingerprint(workouts: HevyWorkout[]) {
  const identities = workouts
    .map(({ id, updated_at }) => [id, updated_at] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(identities),
  );
}

export function isHevyFullReconciliationDue(
  lastSuccessfulAt: number | undefined,
  now: number,
) {
  return (
    lastSuccessfulAt === undefined ||
    !Number.isFinite(lastSuccessfulAt) ||
    lastSuccessfulAt > now ||
    now - lastSuccessfulAt >= HEVY_FULL_RECONCILIATION_INTERVAL_MS
  );
}

function enqueueHevyWork<T>(work: (lease: HevySyncLease) => Promise<T>) {
  return hevySyncCoordinator.run(work);
}

function ensureCurrentLease(lease: HevySyncLease) {
  if (!lease.isCurrent()) throw new HevySyncSupersededError();
}

function connectionOwnership(
  connection: HevyConnection,
): HevyConnectionOwnership {
  return {
    connectionGeneration: Number.isFinite(connection.connectedAt)
      ? connection.connectedAt
      : 0,
    ...(Number.isSafeInteger(connection.credentialRevision) &&
    Number(connection.credentialRevision) > 0
      ? { credentialRevision: connection.credentialRevision }
      : {}),
    ...(Number.isSafeInteger(connection.ownershipRevision) &&
    Number(connection.ownershipRevision) > 0
      ? { ownershipRevision: connection.ownershipRevision }
      : {}),
    userId: connection.user.id,
  };
}

export async function connectAndSyncHevy(apiKeyValue: string) {
  const apiKey = normalizeHevyApiKey(apiKeyValue);
  // Authentication, credential ownership and sync form one invocation-ordered
  // unit. A slow older authentication therefore cannot finish after and
  // overwrite a newer connection attempt.
  return enqueueHevyWork(async (lease) => {
    const repository = new HevyWorkoutRepository();
    let reservation:
      | Awaited<ReturnType<HevyWorkoutRepository["reserveConnection"]>>
      | undefined;
    let activated = false;
    let writeLease: LocalDataWriteLease | undefined;
    try {
      writeLease = await acquireLocalDataWriteLease();
      const client = new HevyClient(apiKey, fetch, { signal: lease.signal });
      const user = await client.getUser();
      await assertLocalDataWriteLeaseCurrent(writeLease);
      ensureCurrentLease(lease);
      const candidate: HevyConnection = {
        apiKey,
        user,
        connectedAt: Date.now(),
      };
      // A staged snapshot belongs to one saved-account generation. Explicitly
      // connecting (including replacing an account) always starts a fresh pair
      // so stale verification metadata cannot confirm a different connection.
      // Persist an explicit pending envelope before changing database
      // ownership. SQLite first allocates an immutable credential revision and
      // preserves the prior active owner in the pending row. A process death
      // before the scoped credential write rolls back to that prior owner; a
      // process death afterwards can finish this exact activation.
      const reserved = await repository.reserveConnection(
        connectionOwnership(candidate),
        lease.isCurrent,
        writeLease,
      );
      reservation = reserved;
      const pendingConnection: HevyConnection = {
        ...candidate,
        credentialRevision: reserved.credentialRevision,
        ownershipRevision: reserved.revision,
      };
      await repository.withCurrentCredentialReservation(
        reserved,
        writeLease,
        () => savePendingHevyConnection(pendingConnection, reserved),
      );
      ensureCurrentLease(lease);
      if (
        !(await repository.isCredentialSnapshotCurrent(reserved, writeLease))
      ) {
        throw new HevySyncSupersededError();
      }
      const active = await repository.activateReservedConnection(
        reserved,
        lease.isCurrent,
        writeLease,
      );
      activated = true;
      const connection: HevyConnection = {
        ...candidate,
        credentialRevision: active.credentialRevision,
        ownershipRevision: active.revision,
      };
      ensureCurrentLease(lease);
      await repository.clearFullReconciliationCandidate(
        writeLease,
        connectionOwnership(connection),
      );
      ensureCurrentLease(lease);
      // Deletes only immutable predecessor slots recorded by the active SQLite
      // owner. It cannot target a reconnect allocated after this activation.
      await clearHevyConnection(writeLease);
      // Authentication succeeded, so retain the connection even if the first
      // history crawl is interrupted or rate-limited. The background worker can
      // then retry hands-free without asking the user for the API key again.
      const result = await performHevySync(connection, lease, writeLease);
      return { connection, result };
    } catch (error) {
      if (!activated && reservation && writeLease) {
        // First make the pending owner permanently unusable. Only then remove
        // its immutable credential slot; a failed delete remains in the
        // durable cleanup plan and can never be activated by a later loader.
        await repository.abortCredentialReservation(reservation, writeLease);
        await clearHevyConnection(writeLease);
      }
      if (!lease.isCurrent()) throw new HevySyncSupersededError();
      throw error;
    }
  });
}

async function performHevySync(
  connection: HevyConnection,
  lease: HevySyncLease,
  writeLease: LocalDataWriteLease,
) {
  const syncedAt = Date.now();
  const repository = new HevyWorkoutRepository();
  const ownership = connectionOwnership(connection);
  ensureCurrentLease(lease);
  await repository.ensureConnectionOwnership(
    ownership,
    lease.isCurrent,
    writeLease,
  );
  ensureCurrentLease(lease);
  await repository.markAttempt(syncedAt, ownership, writeLease);
  try {
    const client = new HevyClient(connection.apiKey, fetch, {
      signal: lease.signal,
    });
    const cursor = await repository.cursor(connection.user.id);
    await assertLocalDataWriteLeaseCurrent(writeLease);
    const connectionGeneration = ownership.connectionGeneration;
    const fullReconciliationDue =
      cursor === undefined ||
      isHevyFullReconciliationDue(
        await repository.fullReconciliationAt(connection.user.id),
        syncedAt,
      );
    const candidate =
      fullReconciliationDue && cursor !== undefined
        ? await repository.fullReconciliationCandidate(
            connection.user.id,
            connectionGeneration,
            ownership.credentialRevision,
            ownership.ownershipRevision,
          )
        : undefined;
    const candidateTimestampValid = Boolean(
      candidate && candidate.capturedAt <= syncedAt,
    );
    const candidateReady = Boolean(
      candidateTimestampValid &&
      candidate &&
      syncedAt - candidate.capturedAt >=
        FULL_RECONCILIATION_CONFIRMATION_DELAY_MS,
    );
    if (
      fullReconciliationDue &&
      (cursor === undefined ||
        !candidate ||
        !candidateTimestampValid ||
        candidateReady)
    ) {
      await assertLocalDataWriteLeaseCurrent(writeLease);
      const workouts = await client.getAllWorkouts();
      ensureCurrentLease(lease);
      const fingerprint = await hevySnapshotFingerprint(workouts);
      ensureCurrentLease(lease);
      const completed = workouts.filter((workout) =>
        isCompletedHevyWorkout(workout, syncedAt),
      );
      const pending = workouts
        .filter((workout) => !isCompletedHevyWorkout(workout, syncedAt))
        .map((workout): HevyWorkoutEvent => ({ type: "updated", workout }));
      // Start the independent-confirmation window only after the verified
      // crawl finishes. The event cursor remains anchored before the crawl so
      // a concurrent update is recovered by the normal overlap feed.
      const snapshotCapturedAt = Date.now();
      ensureCurrentLease(lease);
      return await repository.reconcileFullSnapshot(
        completed,
        {
          connectionGeneration,
          credentialRevision: ownership.credentialRevision,
          cursorAt: cursorBeforePending(pending, syncedAt),
          fingerprint,
          ownershipRevision: ownership.ownershipRevision,
          sourceWorkoutCount: workouts.length,
          syncedAt: snapshotCapturedAt,
          userId: connection.user.id,
        },
        writeLease,
      );
    }
    await assertLocalDataWriteLeaseCurrent(writeLease);
    const events = await client.getWorkoutEvents(
      Math.max(0, cursor - EVENT_OVERLAP_MS),
    );
    ensureCurrentLease(lease);
    const completedEvents = events.filter(
      (event) =>
        event.type === "deleted" ||
        isCompletedHevyWorkout(event.workout, syncedAt),
    );
    const pendingEvents = events.filter(
      (event) =>
        event.type === "updated" &&
        !isCompletedHevyWorkout(event.workout, syncedAt),
    );
    return await repository.applyEvents(
      completedEvents,
      syncedAt,
      ownership,
      cursorBeforePending(pendingEvents, syncedAt),
      writeLease,
    );
  } catch (error) {
    if (isLocalDataWriteSupersededError(error)) throw error;
    if (error instanceof HevySyncSupersededError || !lease.isCurrent()) {
      throw new HevySyncSupersededError();
    }
    const reason =
      error instanceof HevyError
        ? error
        : new HevyError("network", "The Hevy sync could not be completed.");
    // Preserve the source error even if recording diagnostic state encounters
    // a separate local-storage problem.
    await repository
      .markFailure(syncedAt, reason.code, reason.message, ownership, writeLease)
      .catch(() => undefined);
    throw reason;
  }
}

export async function syncHevyConnection(providedConnection?: HevyConnection) {
  const connection = providedConnection ?? (await loadHevyConnection());
  if (!connection) {
    throw new HevyError(
      "unauthorised",
      "Connect a Hevy account before syncing.",
    );
  }

  const identity = connectionIdentity(connection);
  const active = hevySyncInFlight.get(identity);
  if (active) return active;

  // Different accounts must not share a result, but their database writes must
  // remain serial. A credential change therefore waits for older work and then
  // performs its own authenticated request. Calls for the same connection still
  // coalesce through the identity map above.
  const run = enqueueHevyWork(async (lease) => {
    const writeLease = await acquireLocalDataWriteLease();
    // A saved-account check may have been queued behind a new connection.
    // Re-read ownership at execution time so stale credentials can never run
    // after the newer account has replaced them.
    const executionConnection =
      providedConnection ?? (await loadHevyConnection(writeLease));
    if (!executionConnection) {
      throw new HevyError(
        "unauthorised",
        "Connect a Hevy account before syncing.",
      );
    }
    ensureCurrentLease(lease);
    return performHevySync(executionConnection, lease, writeLease);
  });
  hevySyncInFlight.set(identity, run);
  try {
    return await run;
  } finally {
    if (hevySyncInFlight.get(identity) === run) {
      hevySyncInFlight.delete(identity);
    }
  }
}

export async function syncHevyIfDue(now = Date.now()) {
  const connection = await loadHevyConnection();
  if (!connection) return undefined;
  const status = await new HevyWorkoutRepository().status();
  if (
    status.lastAttemptAt !== undefined &&
    status.lastAttemptAt <= now &&
    now - status.lastAttemptAt < HEVY_SYNC_INTERVAL_MS
  ) {
    return undefined;
  }
  return syncHevyConnection();
}

export function beginHevyDataChange() {
  // Older identity promises must not be joined after their generation has been
  // invalidated. Their real work remains tracked by the coordinator drain.
  hevySyncInFlight.clear();
  return hevySyncCoordinator.beginExclusiveChange();
}

/**
 * Disconnects the account under the same ownership barrier used by privacy
 * erasure. The durable disconnected marker preserves which account owns kept
 * workouts while preventing any old foreground or headless sync from writing.
 */
export async function disconnectHevy(
  options: {
    removeImportedWorkouts?: boolean;
  } = {},
) {
  const barrier = beginHevyDataChange();
  try {
    if (options.removeImportedWorkouts) {
      // The durable tombstone and private-row purge share one SQLite COMMIT.
      // A crash therefore retains both the prior connection and its rows, or
      // retains neither; there is no disconnected state with orphaned rows.
      await disconnectAndClearHevyData();
    } else {
      await disconnectHevyConnectionOwnership();
    }
    await clearHevyConnection();
    await barrier.ready;
    // A connect attempt could already have entered the native credential write
    // when the barrier invalidated it. Assert disconnection after it drains.
    await clearHevyConnection();
    const repository = new HevyWorkoutRepository();
    if (!options.removeImportedWorkouts) {
      await repository.clearFullReconciliationCandidate();
    }
  } finally {
    barrier.release();
  }
}
