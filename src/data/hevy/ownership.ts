export const HEVY_CONNECTION_OWNERSHIP_KEY = "hevy-connection-ownership-v1";
export const HEVY_CONNECTION_REVISION_KEY = "hevy-connection-revision-v1";

export interface HevyConnectionOwnership {
  connectionGeneration: number;
  credentialRevision?: number;
  ownershipRevision?: number;
  userId: string;
}

export interface HevyCredentialReference {
  connectionGeneration: number;
  credentialRevision?: number;
  userId: string;
}

interface StoredHevyOwnershipBase {
  clearLegacyCredential?: boolean;
  retiredCredentialRevisions?: number[];
  revision?: number;
  version?: 2;
}

export interface StoredActiveHevyOwnership
  extends HevyCredentialReference, StoredHevyOwnershipBase {
  state: "active";
}

export interface StoredPendingHevyOwnership
  extends HevyCredentialReference, StoredHevyOwnershipBase {
  credentialRevision: number;
  previousActive?: HevyCredentialReference;
  revision: number;
  state: "pending";
  version: 2;
}

export interface StoredInvalidatedHevyOwnership extends StoredHevyOwnershipBase {
  cleanupThroughRevision?: number;
  invalidatedAt: number;
  state: "invalidated";
}

export interface StoredDisconnectedHevyOwnership extends StoredHevyOwnershipBase {
  cleanupThroughRevision?: number;
  connectionGeneration?: number;
  disconnectedAt: number;
  state: "disconnected";
  userId?: string;
}

export type StoredHevyOwnership =
  | StoredActiveHevyOwnership
  | StoredDisconnectedHevyOwnership
  | StoredInvalidatedHevyOwnership
  | StoredPendingHevyOwnership;

export interface HevyCredentialSnapshot extends HevyCredentialReference {
  credentialRevision: number;
  retiredCredentialRevisions: number[];
  revision: number;
  state: "active" | "pending";
}

export interface HevyCredentialCleanupPlan {
  clearLegacyCredential: boolean;
  credentialRevisions: number[];
  /** Exact SQLite value that authorized this immutable cleanup set. */
  ownershipValue?: string;
  /** The current owner is unusable and becomes a tombstone after cleanup. */
  invalidateAfterCleanup?: boolean;
}

export class HevySyncSupersededError extends Error {
  constructor() {
    super("This Hevy sync was superseded by a connection or data change.");
    this.name = "HevySyncSupersededError";
  }
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function credentialRevisions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(validRevision))].sort(
    (left, right) => left - right,
  );
}

function credentialReference(
  value: unknown,
): HevyCredentialReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parsed = value as Record<string, unknown>;
  if (
    typeof parsed.userId !== "string" ||
    parsed.userId.length === 0 ||
    !validGeneration(parsed.connectionGeneration)
  ) {
    return undefined;
  }
  if (
    parsed.credentialRevision !== undefined &&
    !validRevision(parsed.credentialRevision)
  ) {
    return undefined;
  }
  return {
    connectionGeneration: parsed.connectionGeneration,
    ...(validRevision(parsed.credentialRevision)
      ? { credentialRevision: parsed.credentialRevision }
      : {}),
    userId: parsed.userId,
  };
}

export function activeHevyOwnershipValue(
  ownership: HevyConnectionOwnership,
  retiredCredentialRevisions: number[] = [],
  clearLegacyCredential = false,
) {
  const modern = validRevision(ownership.ownershipRevision);
  const retired = credentialRevisions(retiredCredentialRevisions);
  return JSON.stringify({
    ...(clearLegacyCredential ? { clearLegacyCredential: true } : {}),
    connectionGeneration: ownership.connectionGeneration,
    ...(validRevision(ownership.credentialRevision)
      ? { credentialRevision: ownership.credentialRevision }
      : {}),
    ...(retired.length > 0 ? { retiredCredentialRevisions: retired } : {}),
    ...(modern
      ? { revision: ownership.ownershipRevision, version: 2 as const }
      : {}),
    state: "active" as const,
    userId: ownership.userId,
  } satisfies StoredActiveHevyOwnership);
}

export function invalidatedHevyOwnershipValue(
  invalidatedAt = Date.now(),
  options: {
    cleanupThroughRevision?: number;
    clearLegacyCredential?: boolean;
    retiredCredentialRevisions?: number[];
    revision?: number;
  } = {},
) {
  return JSON.stringify({
    ...(validRevision(options.cleanupThroughRevision)
      ? { cleanupThroughRevision: options.cleanupThroughRevision }
      : {}),
    ...(options.clearLegacyCredential ? { clearLegacyCredential: true } : {}),
    invalidatedAt,
    ...(validRevision(options.revision)
      ? {
          retiredCredentialRevisions: credentialRevisions(
            options.retiredCredentialRevisions,
          ),
          revision: options.revision,
          version: 2 as const,
        }
      : {}),
    state: "invalidated" as const,
  } satisfies StoredInvalidatedHevyOwnership);
}

export function disconnectedHevyOwnershipValue(
  ownership: HevyConnectionOwnership,
  disconnectedAt = Date.now(),
  options: {
    cleanupThroughRevision?: number;
    clearLegacyCredential?: boolean;
    retiredCredentialRevisions?: number[];
    revision?: number;
  } = {},
) {
  return JSON.stringify({
    ...(validRevision(options.cleanupThroughRevision)
      ? { cleanupThroughRevision: options.cleanupThroughRevision }
      : {}),
    ...(options.clearLegacyCredential ? { clearLegacyCredential: true } : {}),
    connectionGeneration: ownership.connectionGeneration,
    disconnectedAt,
    ...(validRevision(options.revision)
      ? {
          retiredCredentialRevisions: credentialRevisions(
            options.retiredCredentialRevisions,
          ),
          revision: options.revision,
          version: 2 as const,
        }
      : {}),
    state: "disconnected" as const,
    userId: ownership.userId,
  } satisfies StoredDisconnectedHevyOwnership);
}

export function pendingHevyOwnershipValue(
  snapshot: HevyCredentialSnapshot,
  previousActive?: HevyCredentialReference,
  clearLegacyCredential = false,
) {
  return JSON.stringify({
    ...(clearLegacyCredential ? { clearLegacyCredential: true } : {}),
    connectionGeneration: snapshot.connectionGeneration,
    credentialRevision: snapshot.credentialRevision,
    ...(previousActive ? { previousActive } : {}),
    retiredCredentialRevisions: credentialRevisions(
      snapshot.retiredCredentialRevisions,
    ),
    revision: snapshot.revision,
    state: "pending" as const,
    userId: snapshot.userId,
    version: 2 as const,
  } satisfies StoredPendingHevyOwnership);
}

export function parseStoredHevyOwnership(
  value: string,
): StoredHevyOwnership | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      (parsed.clearLegacyCredential !== undefined &&
        typeof parsed.clearLegacyCredential !== "boolean") ||
      (parsed.cleanupThroughRevision !== undefined &&
        !validRevision(parsed.cleanupThroughRevision)) ||
      (parsed.retiredCredentialRevisions !== undefined &&
        (!Array.isArray(parsed.retiredCredentialRevisions) ||
          !Array.from(parsed.retiredCredentialRevisions).every(validRevision)))
    ) {
      return undefined;
    }
    const retiredCredentialRevisions = credentialRevisions(
      parsed.retiredCredentialRevisions,
    );
    const base = {
      ...(parsed.clearLegacyCredential === true
        ? { clearLegacyCredential: true }
        : {}),
      ...(validRevision(parsed.revision) ? { revision: parsed.revision } : {}),
      ...(parsed.version === 2 ? { version: 2 as const } : {}),
      retiredCredentialRevisions,
    };

    const tombstone =
      parsed.state === "invalidated" || parsed.state === "disconnected";
    if (tombstone) {
      const legacyTuple =
        parsed.version === undefined && parsed.revision === undefined;
      const modernTuple =
        parsed.version === 2 && validRevision(parsed.revision);
      if (
        (!legacyTuple && !modernTuple) ||
        parsed.credentialRevision !== undefined ||
        parsed.previousActive !== undefined
      ) {
        return undefined;
      }
    }

    if (
      parsed.state === "invalidated" &&
      validGeneration(parsed.invalidatedAt)
    ) {
      return {
        ...base,
        ...(validRevision(parsed.cleanupThroughRevision)
          ? { cleanupThroughRevision: parsed.cleanupThroughRevision }
          : {}),
        invalidatedAt: parsed.invalidatedAt,
        state: "invalidated",
      };
    }

    if (
      parsed.state === "disconnected" &&
      validGeneration(parsed.disconnectedAt)
    ) {
      const reference = credentialReference(parsed);
      return {
        ...base,
        ...(validRevision(parsed.cleanupThroughRevision)
          ? { cleanupThroughRevision: parsed.cleanupThroughRevision }
          : {}),
        ...(reference
          ? {
              connectionGeneration: reference.connectionGeneration,
              userId: reference.userId,
            }
          : {}),
        disconnectedAt: parsed.disconnectedAt,
        state: "disconnected",
      };
    }

    const reference = credentialReference(parsed);
    if (
      !reference ||
      (parsed.state !== "active" && parsed.state !== "pending") ||
      parsed.cleanupThroughRevision !== undefined ||
      (parsed.state === "active" && parsed.previousActive !== undefined)
    ) {
      return undefined;
    }
    if (parsed.state === "pending") {
      if (
        parsed.version !== 2 ||
        !validRevision(parsed.revision) ||
        !validRevision(reference.credentialRevision)
      ) {
        return undefined;
      }
      const revision = parsed.revision;
      const credentialRevision = reference.credentialRevision;
      const previousActive = credentialReference(parsed.previousActive);
      if (parsed.previousActive !== undefined && !previousActive) {
        return undefined;
      }
      const fallbackCredentialRevision = previousActive?.credentialRevision;
      if (
        credentialRevision !== revision ||
        (validRevision(fallbackCredentialRevision) &&
          fallbackCredentialRevision >= revision) ||
        retiredCredentialRevisions.some(
          (retiredRevision) =>
            retiredRevision >= revision ||
            retiredRevision === credentialRevision ||
            retiredRevision === fallbackCredentialRevision,
        )
      ) {
        return undefined;
      }
      return {
        ...base,
        ...reference,
        credentialRevision,
        ...(previousActive ? { previousActive } : {}),
        revision,
        state: "pending",
        version: 2,
      };
    }
    const legacy =
      parsed.version === undefined &&
      parsed.revision === undefined &&
      parsed.credentialRevision === undefined;
    const modern =
      parsed.version === 2 &&
      validRevision(parsed.revision) &&
      validRevision(reference.credentialRevision);
    if (!legacy && !modern) return undefined;
    if (
      modern &&
      (Number(reference.credentialRevision) >= Number(parsed.revision) ||
        retiredCredentialRevisions.some(
          (retiredRevision) =>
            retiredRevision >= Number(parsed.revision) ||
            retiredRevision === reference.credentialRevision,
        ))
    ) {
      return undefined;
    }
    return {
      ...base,
      ...reference,
      state: "active",
    };
  } catch {
    return undefined;
  }
}

export function parseDisconnectedHevyOwnership(
  value: string,
): HevyConnectionOwnership | undefined {
  const parsed = parseStoredHevyOwnership(value);
  return parsed?.state === "disconnected" &&
    parsed.userId &&
    parsed.connectionGeneration !== undefined
    ? {
        connectionGeneration: parsed.connectionGeneration,
        ...(validRevision(parsed.revision)
          ? { ownershipRevision: parsed.revision }
          : {}),
        userId: parsed.userId,
      }
    : undefined;
}

export function parseActiveHevyOwnership(
  value: string,
): HevyConnectionOwnership | undefined {
  const parsed = parseStoredHevyOwnership(value);
  return parsed?.state === "active"
    ? {
        connectionGeneration: parsed.connectionGeneration,
        ...(validRevision(parsed.credentialRevision)
          ? { credentialRevision: parsed.credentialRevision }
          : {}),
        ...(validRevision(parsed.revision)
          ? { ownershipRevision: parsed.revision }
          : {}),
        userId: parsed.userId,
      }
    : undefined;
}

export function hevyCredentialSnapshot(
  stored: StoredHevyOwnership | undefined,
): HevyCredentialSnapshot | undefined {
  return (stored?.state === "active" || stored?.state === "pending") &&
    validRevision(stored.revision) &&
    validRevision(stored.credentialRevision)
    ? {
        connectionGeneration: stored.connectionGeneration,
        credentialRevision: stored.credentialRevision,
        retiredCredentialRevisions: credentialRevisions(
          stored.retiredCredentialRevisions,
        ),
        revision: stored.revision,
        state: stored.state,
        userId: stored.userId,
      }
    : undefined;
}

export function hevyOwnershipMatches(
  left: HevyConnectionOwnership,
  right: HevyConnectionOwnership,
) {
  const revisionScoped =
    left.ownershipRevision !== undefined ||
    left.credentialRevision !== undefined ||
    right.ownershipRevision !== undefined ||
    right.credentialRevision !== undefined;
  return (
    left.connectionGeneration === right.connectionGeneration &&
    left.userId === right.userId &&
    (!revisionScoped ||
      (left.ownershipRevision === right.ownershipRevision &&
        left.credentialRevision === right.credentialRevision))
  );
}
