import type { SQLiteDatabase } from 'expo-sqlite';

import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

export const OWNED_GLUCOSE_SOURCE_IDS = [
  't1arc-librelinkup',
  'nightscout',
  'dexcom-share',
  'medtrum-easyfollow',
  'xdrip-local',
] as const;

export type OwnedGlucoseSourceId =
  (typeof OWNED_GLUCOSE_SOURCE_IDS)[number];

const ownedSourceIds = new Set<string>(OWNED_GLUCOSE_SOURCE_IDS);
const OWNERSHIP_KEY_PREFIX = 'glucose-source-connection-ownership-v1:';
const SHA256_HEX = /^[0-9a-f]{64}$/;

interface MetadataRow {
  value: string;
}

export interface SourceConnectionOwnershipState {
  readonly version: 1;
  readonly changeGeneration: number;
  readonly ownerGeneration: number;
  readonly connected: boolean;
  readonly identityDigest?: string;
}

export interface SourceConnectionCandidateLease {
  readonly sourceId: OwnedGlucoseSourceId;
  readonly localDataWriteLease: LocalDataWriteLease;
  readonly changeGeneration: number;
  readonly observedOwnerGeneration: number;
  readonly observedIdentityDigest?: string;
  readonly observedConnected: boolean;
}

export interface SourceConnectionWriteLease {
  readonly sourceId: OwnedGlucoseSourceId;
  readonly localDataWriteLease: LocalDataWriteLease;
  readonly ownerGeneration: number;
  readonly identityDigest: string;
}

export class SourceConnectionSupersededError extends Error {
  constructor(readonly sourceId: string) {
    super(`The ${sourceId} connection operation was superseded.`);
    this.name = 'SourceConnectionSupersededError';
  }
}

export class SourceConnectionOwnershipCorruptError extends Error {
  readonly recoverable = true;

  constructor(readonly sourceId: OwnedGlucoseSourceId) {
    super(`The ${sourceId} connection ownership state is invalid.`);
    this.name = 'SourceConnectionOwnershipCorruptError';
  }
}

export function isSourceConnectionOwnershipCorruptError(
  error: unknown,
): error is SourceConnectionOwnershipCorruptError {
  return error instanceof SourceConnectionOwnershipCorruptError;
}

export function isSourceConnectionSupersededError(
  error: unknown,
): error is SourceConnectionSupersededError {
  return error instanceof SourceConnectionSupersededError;
}

export function assertOwnedGlucoseSourceId(
  sourceId: string,
): asserts sourceId is OwnedGlucoseSourceId {
  if (!ownedSourceIds.has(sourceId)) {
    throw new Error(
      `The ${sourceId || 'empty'} source does not support durable connection ownership.`,
    );
  }
}

export function sourceConnectionOwnershipMetadataKey(sourceId: string) {
  assertOwnedGlucoseSourceId(sourceId);
  return `${OWNERSHIP_KEY_PREFIX}${sourceId}`;
}

function isGeneration(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseOwnershipState(
  sourceId: OwnedGlucoseSourceId,
  raw: string,
): SourceConnectionOwnershipState {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new SourceConnectionOwnershipCorruptError(sourceId);
  }
  if (!value || typeof value !== 'object') {
    throw new SourceConnectionOwnershipCorruptError(sourceId);
  }
  const candidate = value as Partial<SourceConnectionOwnershipState>;
  const validConnectedState = candidate.connected
    ? (candidate.ownerGeneration ?? 0) >= 1 &&
      typeof candidate.identityDigest === 'string' &&
      SHA256_HEX.test(candidate.identityDigest)
    : candidate.identityDigest === undefined ||
      (typeof candidate.identityDigest === 'string' &&
        SHA256_HEX.test(candidate.identityDigest));
  if (
    candidate.version !== 1 ||
    !isGeneration(candidate.changeGeneration) ||
    !isGeneration(candidate.ownerGeneration) ||
    typeof candidate.connected !== 'boolean' ||
    !validConnectedState
  ) {
    throw new SourceConnectionOwnershipCorruptError(sourceId);
  }
  return {
    version: 1,
    changeGeneration: candidate.changeGeneration as number,
    ownerGeneration: candidate.ownerGeneration as number,
    connected: candidate.connected,
    ...(candidate.identityDigest
      ? { identityDigest: candidate.identityDigest.toLowerCase() }
      : {}),
  };
}

export async function readSourceConnectionOwnershipStateInTransaction(
  transaction: SQLiteDatabase,
  sourceId: OwnedGlucoseSourceId,
) {
  const row = await transaction.getFirstAsync<MetadataRow>(
    'SELECT value FROM app_metadata WHERE key = ?',
    sourceConnectionOwnershipMetadataKey(sourceId),
  );
  return row ? parseOwnershipState(sourceId, row.value) : undefined;
}

export async function writeSourceConnectionOwnershipStateInTransaction(
  transaction: SQLiteDatabase,
  sourceId: OwnedGlucoseSourceId,
  state: SourceConnectionOwnershipState,
) {
  // Reparse our own serialization as a single validation path. This also
  // guarantees that raw identities or credentials cannot enter app_metadata.
  const serialized = JSON.stringify(state);
  parseOwnershipState(sourceId, serialized);
  await transaction.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    sourceConnectionOwnershipMetadataKey(sourceId),
    serialized,
  );
}

function disconnectedState(
  changeGeneration: number,
  ownerGeneration: number,
  identityDigest?: string,
): SourceConnectionOwnershipState {
  return {
    version: 1,
    changeGeneration,
    ownerGeneration,
    connected: false,
    ...(identityDigest ? { identityDigest } : {}),
  };
}

function assertCanAdvance(value: number, label: 'change' | 'owner') {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `The source connection ${label} generation cannot be advanced safely.`,
    );
  }
}

function candidateMatchesState(
  candidate: SourceConnectionCandidateLease,
  state: SourceConnectionOwnershipState | undefined,
) {
  const current = state ?? disconnectedState(0, 0);
  return (
    current.changeGeneration === candidate.changeGeneration &&
    current.ownerGeneration === candidate.observedOwnerGeneration &&
    current.connected === candidate.observedConnected &&
    current.identityDigest === candidate.observedIdentityDigest
  );
}

export async function beginSourceConnectionChangeInTransaction(
  transaction: SQLiteDatabase,
  sourceId: string,
  localDataWriteLease: LocalDataWriteLease,
): Promise<SourceConnectionCandidateLease> {
  // Privacy erase is the outermost ownership boundary and must always win.
  await assertLocalDataWriteLeaseInTransaction(
    transaction,
    localDataWriteLease,
  );
  assertOwnedGlucoseSourceId(sourceId);
  const current =
    (await readSourceConnectionOwnershipStateInTransaction(
      transaction,
      sourceId,
    )) ?? disconnectedState(0, 0);
  assertCanAdvance(current.changeGeneration, 'change');
  const next = {
    ...current,
    changeGeneration: current.changeGeneration + 1,
  } satisfies SourceConnectionOwnershipState;
  await writeSourceConnectionOwnershipStateInTransaction(
    transaction,
    sourceId,
    next,
  );
  return {
    sourceId,
    localDataWriteLease,
    changeGeneration: next.changeGeneration,
    observedOwnerGeneration: current.ownerGeneration,
    observedConnected: current.connected,
    ...(current.identityDigest
      ? { observedIdentityDigest: current.identityDigest }
      : {}),
  };
}

export async function beginSourceConnectionChange(
  sourceId: string,
  localDataWriteLease?: LocalDataWriteLease,
) {
  const writeLease = localDataWriteLease ?? (await acquireLocalDataWriteLease());
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  return withT1ArcTransaction((transaction) =>
    beginSourceConnectionChangeInTransaction(
      transaction,
      sourceId,
      writeLease,
    ),
  );
}

export async function activateSourceConnectionCandidateInTransaction(
  transaction: SQLiteDatabase,
  candidate: SourceConnectionCandidateLease,
  identityDigest: string,
): Promise<SourceConnectionWriteLease> {
  await assertLocalDataWriteLeaseInTransaction(
    transaction,
    candidate.localDataWriteLease,
  );
  assertOwnedGlucoseSourceId(candidate.sourceId);
  if (!SHA256_HEX.test(identityDigest)) {
    throw new Error('The source connection identity digest is invalid.');
  }
  const current = await readSourceConnectionOwnershipStateInTransaction(
    transaction,
    candidate.sourceId,
  );
  if (!candidateMatchesState(candidate, current)) {
    throw new SourceConnectionSupersededError(candidate.sourceId);
  }
  assertCanAdvance(current?.ownerGeneration ?? 0, 'owner');
  const next = {
    version: 1,
    changeGeneration: candidate.changeGeneration,
    ownerGeneration: (current?.ownerGeneration ?? 0) + 1,
    connected: true,
    identityDigest: identityDigest.toLowerCase(),
  } satisfies SourceConnectionOwnershipState;
  await writeSourceConnectionOwnershipStateInTransaction(
    transaction,
    candidate.sourceId,
    next,
  );
  return {
    sourceId: candidate.sourceId,
    localDataWriteLease: candidate.localDataWriteLease,
    ownerGeneration: next.ownerGeneration,
    identityDigest: next.identityDigest,
  };
}

export async function disconnectSourceConnectionInTransaction(
  transaction: SQLiteDatabase,
  sourceId: string,
  localDataWriteLease: LocalDataWriteLease,
) {
  await assertLocalDataWriteLeaseInTransaction(
    transaction,
    localDataWriteLease,
  );
  assertOwnedGlucoseSourceId(sourceId);
  let current: SourceConnectionOwnershipState;
  try {
    current =
      (await readSourceConnectionOwnershipStateInTransaction(
        transaction,
        sourceId,
      )) ?? disconnectedState(0, 0);
  } catch (error) {
    if (!isSourceConnectionOwnershipCorruptError(error)) throw error;
    // Do not derive a recovery lease from corrupt bytes. Jump to a reserved,
    // valid generation so any pre-recovery in-memory candidate is rejected,
    // while leaving ample room for ordinary future reconnects.
    current = disconnectedState(2 ** 52, 2 ** 52);
  }
  assertCanAdvance(current.changeGeneration, 'change');
  assertCanAdvance(current.ownerGeneration, 'owner');
  const next = disconnectedState(
    current.changeGeneration + 1,
    current.ownerGeneration + 1,
    current.identityDigest,
  );
  await writeSourceConnectionOwnershipStateInTransaction(
    transaction,
    sourceId,
    next,
  );
  return next;
}

export async function acquireSourceConnectionWriteLeaseFromDatabase(
  database: SQLiteDatabase,
  sourceId: string,
  localDataWriteLease: LocalDataWriteLease,
): Promise<SourceConnectionWriteLease | undefined> {
  await assertLocalDataWriteLeaseInTransaction(database, localDataWriteLease);
  assertOwnedGlucoseSourceId(sourceId);
  const state = await readSourceConnectionOwnershipStateInTransaction(
    database,
    sourceId,
  );
  if (!state?.connected) return undefined;
  return {
    sourceId,
    localDataWriteLease,
    ownerGeneration: state.ownerGeneration,
    identityDigest: state.identityDigest!,
  };
}

export async function assertSourceConnectionWriteLeaseInTransaction(
  transaction: SQLiteDatabase,
  lease: SourceConnectionWriteLease,
  sinkSourceId: string,
) {
  await assertLocalDataWriteLeaseInTransaction(
    transaction,
    lease.localDataWriteLease,
  );
  assertOwnedGlucoseSourceId(lease.sourceId);
  if (lease.sourceId !== sinkSourceId) {
    throw new SourceConnectionSupersededError(lease.sourceId);
  }
  assertOwnedGlucoseSourceId(sinkSourceId);
  const state = await readSourceConnectionOwnershipStateInTransaction(
    transaction,
    lease.sourceId,
  );
  if (
    !state?.connected ||
    state.ownerGeneration !== lease.ownerGeneration ||
    state.identityDigest !== lease.identityDigest
  ) {
    throw new SourceConnectionSupersededError(lease.sourceId);
  }
}

export async function assertSourceConnectionWriteLease(
  lease: SourceConnectionWriteLease,
  sinkSourceId: string = lease.sourceId,
) {
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  await withT1ArcTransaction((transaction) =>
    assertSourceConnectionWriteLeaseInTransaction(
      transaction,
      lease,
      sinkSourceId,
    ),
  );
}

export async function assertSourceConnectionActivationCurrentInTransaction(
  transaction: SQLiteDatabase,
  lease: SourceConnectionWriteLease,
  changeGeneration: number,
) {
  await assertSourceConnectionWriteLeaseInTransaction(
    transaction,
    lease,
    lease.sourceId,
  );
  const state = await readSourceConnectionOwnershipStateInTransaction(
    transaction,
    lease.sourceId,
  );
  if (state?.changeGeneration !== changeGeneration) {
    throw new SourceConnectionSupersededError(lease.sourceId);
  }
}

export async function assertSourceConnectionActivationCurrent(
  lease: SourceConnectionWriteLease,
  changeGeneration: number,
) {
  const { withT1ArcTransaction } = await import(
    '@/data/persistence/t1arcDatabase'
  );
  await withT1ArcTransaction((transaction) =>
    assertSourceConnectionActivationCurrentInTransaction(
      transaction,
      lease,
      changeGeneration,
    ),
  );
}
