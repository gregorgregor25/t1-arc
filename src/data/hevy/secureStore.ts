import * as SecureStore from "expo-secure-store";

import { acquireLocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";
import type { LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";

import { HevyWorkoutRepository } from "./repository";
import { HevySyncSupersededError } from "./ownership";
import type {
  HevyCredentialCleanupPlan,
  HevyCredentialSnapshot,
} from "./ownership";
import type { HevyConnection } from "./types";

const HEVY_CREDENTIAL_KEY_PREFIX = "t1arc.hevy.connection.v2.";
const MAX_LOAD_RECONCILIATIONS = 8;

interface StoredHevyConnectionEnvelopeV3 {
  connection: HevyConnection;
  credentialRevision: number;
  version: 3;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validConnection(value: unknown): value is HevyConnection {
  if (!value || typeof value !== "object") return false;
  const connection = value as Partial<HevyConnection>;
  return (
    typeof connection.apiKey === "string" &&
    connection.apiKey.length > 0 &&
    typeof connection.connectedAt === "number" &&
    Number.isFinite(connection.connectedAt) &&
    Boolean(connection.user) &&
    typeof connection.user?.id === "string" &&
    connection.user.id.length > 0 &&
    typeof connection.user?.name === "string"
  );
}

function parseScopedConnection(value: string, credentialRevision: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("The saved Hevy connection is unreadable.");
  }
  if (parsed && typeof parsed === "object") {
    const envelope = parsed as Partial<StoredHevyConnectionEnvelopeV3>;
    if (
      envelope.version === 3 &&
      envelope.credentialRevision === credentialRevision &&
      validConnection(envelope.connection)
    ) {
      return envelope.connection;
    }
  }
  throw new Error("The saved Hevy connection is unreadable.");
}

function storedConnectionValue(
  connection: HevyConnection,
  credentialRevision: number,
) {
  const {
    credentialRevision: _credential,
    ownershipRevision: _ownership,
    ...stored
  } = connection;
  return JSON.stringify({
    connection: stored,
    credentialRevision,
    version: 3,
  } satisfies StoredHevyConnectionEnvelopeV3);
}

export function hevyCredentialKey(credentialRevision: number) {
  if (!validRevision(credentialRevision)) {
    throw new Error("The Hevy credential revision is invalid.");
  }
  return `${HEVY_CREDENTIAL_KEY_PREFIX}${credentialRevision}`;
}

async function deleteAndVerifyCredential(key: string) {
  let deletionFailed = false;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    deletionFailed = true;
  }
  const retained = await SecureStore.getItemAsync(key);
  if (deletionFailed || retained !== null) {
    throw new Error("The saved Hevy credentials could not be fully removed.");
  }
}

async function applyCleanupPlan(
  repository: HevyWorkoutRepository,
  plan: HevyCredentialCleanupPlan,
  writeLease?: LocalDataWriteLease,
) {
  const keys = [
    ...new Set(
      plan.credentialRevisions.filter(validRevision).map(hevyCredentialKey),
    ),
  ];
  const results = await Promise.allSettled(keys.map(deleteAndVerifyCredential));
  if (results.some(({ status }) => status === "rejected")) {
    throw new Error("The saved Hevy credentials could not be fully removed.");
  }
  if (plan.ownershipValue) {
    await repository.acknowledgeCredentialCleanup(plan, writeLease);
  }
}

function ownedConnection(
  connection: HevyConnection,
  snapshot: HevyCredentialSnapshot,
): HevyConnection {
  return {
    ...connection,
    credentialRevision: snapshot.credentialRevision,
    ownershipRevision: snapshot.revision,
  };
}

function credentialMatchesSnapshot(
  connection: HevyConnection,
  snapshot: HevyCredentialSnapshot,
) {
  return (
    connection.connectedAt === snapshot.connectionGeneration &&
    connection.user.id === snapshot.userId
  );
}

export async function loadHevyConnection(writeLease?: LocalDataWriteLease) {
  const localDataWriteLease =
    writeLease ?? (await acquireLocalDataWriteLease());
  const repository = new HevyWorkoutRepository();
  for (let attempt = 0; attempt < MAX_LOAD_RECONCILIATIONS; attempt += 1) {
    await applyCleanupPlan(
      repository,
      await repository.credentialCleanupPlan(),
      localDataWriteLease,
    );
    const snapshot = await repository.credentialSnapshot();
    if (snapshot) {
      const key = hevyCredentialKey(snapshot.credentialRevision);
      const value = await SecureStore.getItemAsync(key);
      if (!value) {
        await repository.recoverMissingCredential(
          snapshot,
          localDataWriteLease,
        );
        continue;
      }

      let connection: HevyConnection;
      try {
        connection = parseScopedConnection(value, snapshot.credentialRevision);
        if (!credentialMatchesSnapshot(connection, snapshot)) {
          throw new Error("The saved Hevy connection is unreadable.");
        }
      } catch (error) {
        if (
          !(await repository.isCredentialSnapshotCurrent(
            snapshot,
            localDataWriteLease,
          ))
        ) {
          continue;
        }
        await SecureStore.deleteItemAsync(key).catch(() => undefined);
        await repository.recoverMissingCredential(
          snapshot,
          localDataWriteLease,
        );
        throw error;
      }

      let active = snapshot;
      if (snapshot.state === "pending") {
        try {
          active = await repository.activateReservedConnection(
            snapshot,
            undefined,
            localDataWriteLease,
          );
        } catch (error) {
          if (
            error instanceof HevySyncSupersededError ||
            !(await repository.isCredentialSnapshotCurrent(
              snapshot,
              localDataWriteLease,
            ))
          ) {
            continue;
          }
          throw error;
        }
      }
      if (
        !(await repository.isCredentialSnapshotCurrent(
          active,
          localDataWriteLease,
        ))
      ) {
        continue;
      }
      await applyCleanupPlan(
        repository,
        await repository.credentialCleanupPlan(),
        localDataWriteLease,
      );
      return ownedConnection(connection, active);
    }

    return undefined;
  }
  throw new HevySyncSupersededError();
}

export async function savePendingHevyConnection(
  connection: HevyConnection,
  reservation: HevyCredentialSnapshot,
) {
  await SecureStore.setItemAsync(
    hevyCredentialKey(reservation.credentialRevision),
    storedConnectionValue(connection, reservation.credentialRevision),
  );
}

export async function saveHevyConnection(
  connection: HevyConnection,
  ownership?: HevyCredentialSnapshot,
) {
  const credentialRevision =
    ownership?.credentialRevision ?? connection.credentialRevision;
  if (!validRevision(credentialRevision)) {
    throw new Error("The Hevy credential revision is unavailable.");
  }
  await SecureStore.setItemAsync(
    hevyCredentialKey(credentialRevision),
    storedConnectionValue(connection, credentialRevision),
  );
}

export async function clearHevyCredentialRevision(credentialRevision: number) {
  await SecureStore.deleteItemAsync(hevyCredentialKey(credentialRevision));
}

export async function clearHevyConnection(writeLease?: LocalDataWriteLease) {
  const repository = new HevyWorkoutRepository();
  const plan = await repository.credentialCleanupPlan();
  await applyCleanupPlan(repository, plan, writeLease);
}
