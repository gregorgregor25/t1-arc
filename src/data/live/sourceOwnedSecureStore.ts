import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  activateSourceConnectionCandidateInTransaction,
  assertOwnedGlucoseSourceId,
  beginSourceConnectionChangeInTransaction,
  disconnectSourceConnectionInTransaction,
  readSourceConnectionOwnershipStateInTransaction,
  assertSourceConnectionWriteLeaseInTransaction,
  SourceConnectionSupersededError,
  writeSourceConnectionOwnershipStateInTransaction,
  type OwnedGlucoseSourceId,
  type SourceConnectionCandidateLease,
  type SourceConnectionOwnershipState,
  type SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_ENVELOPE_ENTRIES = 4;
let transactionModulePromise:
  | Promise<typeof import('@/data/persistence/t1arcDatabase')>
  | undefined;

function loadTransactionModule() {
  transactionModulePromise ??= import('@/data/persistence/t1arcDatabase');
  return transactionModulePromise;
}

export class SourceConnectionConfigurationCorruptError extends Error {
  readonly recoverable = true;

  constructor(readonly sourceId: OwnedGlucoseSourceId) {
    super(
      `The saved ${sourceId} connection cannot be read. Disconnect it and connect it again.`,
    );
    this.name = 'SourceConnectionConfigurationCorruptError';
  }
}

export function isSourceConnectionConfigurationCorruptError(
  error: unknown,
): error is SourceConnectionConfigurationCorruptError {
  return error instanceof SourceConnectionConfigurationCorruptError;
}

export interface SourceOwnedSecureStoreField<T> {
  readonly key: string;
  readonly parse: (value: unknown) => T | undefined;
}

export interface SourceOwnedSecureStoreSpec<
  TValues extends Record<string, unknown>,
> {
  readonly sourceId: OwnedGlucoseSourceId;
  readonly primaryField: keyof TValues;
  readonly fields: {
    readonly [K in keyof TValues]: SourceOwnedSecureStoreField<TValues[K]>;
  };
  /** The callback returns only a SHA-256 digest; raw identity stays out of DB. */
  readonly identityDigest: (
    values: Readonly<Partial<TValues>>,
  ) => Promise<string>;
  /** Previous digest schemes accepted only for an exact, one-time migration. */
  readonly legacyIdentityDigests?: (
    values: Readonly<Partial<TValues>>,
  ) => Promise<readonly string[]>;
  /** Mandatory before adopting credentials without a durable owner marker. */
  readonly beforeLegacyBootstrap?: (
    context: {
      readonly transaction: SQLiteDatabase;
      readonly localDataWriteLease: LocalDataWriteLease;
      readonly identityDigest: string;
    },
  ) => Promise<void>;
  /** Required when accepting a legacy digest whose historical rows are ambiguous. */
  readonly beforeLegacyIdentityMigration?: (
    context: {
      readonly transaction: SQLiteDatabase;
      readonly localDataWriteLease: LocalDataWriteLease;
      readonly previousIdentityDigest: string;
      readonly identityDigest: string;
    },
  ) => Promise<void>;
}

export type SourceOwnedSecureStoreValues<
  TValues extends Record<string, unknown>,
> = {
  [K in keyof TValues]: TValues[K] | undefined;
};

export interface LoadedSourceOwnedSecureStoreBundle<
  TValues extends Record<string, unknown>,
> {
  readonly values: SourceOwnedSecureStoreValues<TValues>;
  readonly sourceWriteLease?: SourceConnectionWriteLease;
}

export interface SourceOwnedActivationContext {
  readonly transaction: SQLiteDatabase;
  readonly previousIdentityDigest?: string;
  readonly sourceWriteLease: SourceConnectionWriteLease;
}

export interface SourceOwnedActivationOptions {
  readonly beforeCommit?: (
    context: SourceOwnedActivationContext,
  ) => Promise<void>;
  readonly inheritUnspecifiedFieldsWhenIdentityMatches?: boolean;
}

interface SourceOwnerEntry {
  readonly ownerGeneration: number;
  readonly identityDigest: string;
  readonly payload: unknown;
}

interface SourceOwnedEnvelope {
  readonly version: 2;
  readonly localDataWriteEpoch: number;
  readonly sourceId: OwnedGlucoseSourceId;
  readonly entries: readonly SourceOwnerEntry[];
}

interface LegacyEpochEnvelope {
  readonly version: 1;
  readonly localDataWriteEpoch: number;
  readonly payload: unknown;
}

function emptyValues<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
) {
  return Object.fromEntries(
    Object.keys(spec.fields).map((field) => [field, undefined]),
  ) as SourceOwnedSecureStoreValues<TValues>;
}

function parseSuppliedValues<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  suppliedValues: Readonly<Partial<TValues>>,
) {
  const parsedValues = emptyValues(spec);
  for (const [name, field] of Object.entries(spec.fields)) {
    const supplied = suppliedValues[name as keyof TValues];
    if (supplied === undefined) continue;
    const parsed = field.parse(supplied);
    if (parsed === undefined) {
      throw new Error(`The ${spec.sourceId} ${name} value is invalid.`);
    }
    parsedValues[name as keyof TValues] = parsed as TValues[keyof TValues];
  }
  return parsedValues;
}

function validateSpec<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
) {
  assertOwnedGlucoseSourceId(spec.sourceId);
  const entries = Object.entries(spec.fields);
  if (!entries.length || !Object.hasOwn(spec.fields, spec.primaryField)) {
    throw new Error('The source-owned SecureStore specification is invalid.');
  }
  const keys = entries.map(([, field]) => field.key);
  if (
    keys.some((key) => !key) ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error('The source-owned SecureStore specification is invalid.');
  }
}

function isSafeGeneration(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isLocalEpoch(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseOwnedEnvelope(
  decoded: unknown,
): SourceOwnedEnvelope | undefined {
  if (!decoded || typeof decoded !== 'object') return undefined;
  const candidate = decoded as Partial<SourceOwnedEnvelope>;
  if (
    candidate.version !== 2 ||
    !isLocalEpoch(candidate.localDataWriteEpoch) ||
    typeof candidate.sourceId !== 'string' ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > MAX_ENVELOPE_ENTRIES
  ) {
    return undefined;
  }
  try {
    assertOwnedGlucoseSourceId(candidate.sourceId);
  } catch {
    return undefined;
  }
  const seen = new Set<number>();
  const entries: SourceOwnerEntry[] = [];
  for (const rawEntry of candidate.entries) {
    if (!rawEntry || typeof rawEntry !== 'object') return undefined;
    const entry = rawEntry as Partial<SourceOwnerEntry>;
    if (
      !isSafeGeneration(entry.ownerGeneration) ||
      typeof entry.identityDigest !== 'string' ||
      !SHA256_HEX.test(entry.identityDigest) ||
      !Object.prototype.hasOwnProperty.call(entry, 'payload') ||
      seen.has(entry.ownerGeneration as number)
    ) {
      return undefined;
    }
    seen.add(entry.ownerGeneration as number);
    entries.push({
      ownerGeneration: entry.ownerGeneration as number,
      identityDigest: entry.identityDigest.toLowerCase(),
      payload: entry.payload,
    });
  }
  return {
    version: 2,
    localDataWriteEpoch: candidate.localDataWriteEpoch as number,
    sourceId: candidate.sourceId,
    entries,
  };
}

function decodeRaw(raw: string | null) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function legacyPayload(
  decoded: unknown,
  localDataWriteLease: LocalDataWriteLease,
) {
  if (!decoded || typeof decoded !== 'object') {
    return localDataWriteLease.epoch === 0 ? decoded : undefined;
  }
  const candidate = decoded as Partial<LegacyEpochEnvelope>;
  if ((decoded as { version?: unknown }).version === 2) return undefined;
  if (
    candidate.version === 1 &&
    Object.prototype.hasOwnProperty.call(candidate, 'localDataWriteEpoch')
  ) {
    return candidate.localDataWriteEpoch === localDataWriteLease.epoch &&
      Object.prototype.hasOwnProperty.call(candidate, 'payload')
      ? candidate.payload
      : undefined;
  }
  return localDataWriteLease.epoch === 0 ? decoded : undefined;
}

function encodeEnvelope(
  localDataWriteLease: LocalDataWriteLease,
  sourceId: OwnedGlucoseSourceId,
  entries: readonly SourceOwnerEntry[],
) {
  return JSON.stringify({
    version: 2,
    localDataWriteEpoch: localDataWriteLease.epoch,
    sourceId,
    entries,
  } satisfies SourceOwnedEnvelope);
}

function activeEntry(
  envelope: SourceOwnedEnvelope | undefined,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  if (
    !envelope ||
    envelope.localDataWriteEpoch !==
      sourceWriteLease.localDataWriteLease.epoch ||
    envelope.sourceId !== sourceWriteLease.sourceId
  ) {
    return undefined;
  }
  return envelope.entries.find(
    (entry) =>
      entry.ownerGeneration === sourceWriteLease.ownerGeneration &&
      entry.identityDigest === sourceWriteLease.identityDigest,
  );
}

async function validatedIdentityDigest<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  values: Readonly<Partial<TValues>>,
) {
  const digest = (await spec.identityDigest(values)).toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new Error('The source connection identity digest is invalid.');
  }
  return digest;
}

async function validatedLegacyIdentityDigests<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  values: Readonly<Partial<TValues>>,
) {
  const digests = spec.legacyIdentityDigests
    ? await spec.legacyIdentityDigests(values)
    : [];
  return digests.map((digest) => {
    const normalized = digest.toLowerCase();
    if (!SHA256_HEX.test(normalized)) {
      throw new Error('A legacy source connection identity digest is invalid.');
    }
    return normalized;
  });
}

async function readRawFields<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
) {
  const result = {} as Record<keyof TValues, string | null>;
  for (const [name, field] of Object.entries(spec.fields)) {
    result[name as keyof TValues] = await SecureStore.getItemAsync(field.key);
  }
  return result;
}

function parseActiveValues<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  raws: Record<keyof TValues, string | null>,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  const values = emptyValues(spec);
  for (const [name, field] of Object.entries(spec.fields)) {
    const envelope = parseOwnedEnvelope(
      decodeRaw(raws[name as keyof TValues]),
    );
    const entry = activeEntry(envelope, sourceWriteLease);
    if (!entry) continue;
    values[name as keyof TValues] = field.parse(entry.payload) as
      | TValues[keyof TValues]
      | undefined;
  }
  return values;
}

function recoverBootstrapValues<TValues extends Record<string, unknown>>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  raws: Record<keyof TValues, string | null>,
  localDataWriteLease: LocalDataWriteLease,
) {
  const values = emptyValues(spec);
  let recoveredOwner:
    | { ownerGeneration: number; identityDigest: string }
    | undefined;
  for (const [name, field] of Object.entries(spec.fields)) {
    const decoded = decodeRaw(raws[name as keyof TValues]);
    const envelope = parseOwnedEnvelope(decoded);
    let payload: unknown;
    if (
      envelope?.localDataWriteEpoch === localDataWriteLease.epoch &&
      envelope.sourceId === spec.sourceId &&
      envelope.entries.length === 1
    ) {
      const entry = envelope.entries[0]!;
      recoveredOwner ??= {
        ownerGeneration: entry.ownerGeneration,
        identityDigest: entry.identityDigest,
      };
      if (
        recoveredOwner.ownerGeneration !== entry.ownerGeneration ||
        recoveredOwner.identityDigest !== entry.identityDigest
      ) {
        continue;
      }
      payload = entry.payload;
    } else {
      payload = legacyPayload(decoded, localDataWriteLease);
    }
    values[name as keyof TValues] = field.parse(payload) as
      | TValues[keyof TValues]
      | undefined;
  }
  return { values, recoveredOwner };
}

function sourceWriteLeaseFromState(
  sourceId: OwnedGlucoseSourceId,
  localDataWriteLease: LocalDataWriteLease,
  state: {
    connected: boolean;
    ownerGeneration: number;
    identityDigest?: string;
  },
) {
  return state.connected
    ? ({
        sourceId,
        localDataWriteLease,
        ownerGeneration: state.ownerGeneration,
        identityDigest: state.identityDigest!,
      } satisfies SourceConnectionWriteLease)
    : undefined;
}

async function migrateLegacyIdentityInTransaction<
  TValues extends Record<string, unknown>,
>(
  transaction: SQLiteDatabase,
  spec: SourceOwnedSecureStoreSpec<TValues>,
  writeLease: LocalDataWriteLease,
  state: SourceConnectionOwnershipState,
  raws: Record<keyof TValues, string | null>,
  values: SourceOwnedSecureStoreValues<TValues>,
  currentIdentityDigest: string,
) {
  const claimedIdentityDigest = state.identityDigest!;
  if (claimedIdentityDigest === currentIdentityDigest) {
    return sourceWriteLeaseFromState(spec.sourceId, writeLease, state)!;
  }
  let legacyDigests: readonly string[];
  try {
    legacyDigests = await validatedLegacyIdentityDigests(spec, values);
  } catch {
    throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
  }
  if (
    !legacyDigests.includes(claimedIdentityDigest) ||
    !spec.beforeLegacyIdentityMigration ||
    state.ownerGeneration >= Number.MAX_SAFE_INTEGER
  ) {
    throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
  }

  const previousLease = sourceWriteLeaseFromState(
    spec.sourceId,
    writeLease,
    state,
  )!;
  const migratedLease = {
    sourceId: spec.sourceId,
    localDataWriteLease: writeLease,
    ownerGeneration: state.ownerGeneration + 1,
    identityDigest: currentIdentityDigest,
  } satisfies SourceConnectionWriteLease;

  // Retain the exact previous entry until SQLite commits the new digest. A
  // process death during these SecureStore writes therefore still loads the
  // old lease, while a committed migration loads only the new generation.
  for (const [name, field] of Object.entries(spec.fields)) {
    const envelope = parseOwnedEnvelope(
      decodeRaw(raws[name as keyof TValues]),
    );
    const previous = activeEntry(envelope, previousLease);
    const payload = values[name as keyof TValues];
    const entries: SourceOwnerEntry[] = [];
    if (previous) entries.push(previous);
    if (payload !== undefined) {
      entries.push({
        ownerGeneration: migratedLease.ownerGeneration,
        identityDigest: migratedLease.identityDigest,
        payload,
      });
    }
    await SecureStore.setItemAsync(
      field.key,
      encodeEnvelope(writeLease, spec.sourceId, entries),
    );
  }
  await spec.beforeLegacyIdentityMigration({
    transaction,
    localDataWriteLease: writeLease,
    previousIdentityDigest: claimedIdentityDigest,
    identityDigest: currentIdentityDigest,
  });
  await writeSourceConnectionOwnershipStateInTransaction(
    transaction,
    spec.sourceId,
    {
      ...state,
      ownerGeneration: migratedLease.ownerGeneration,
      identityDigest: migratedLease.identityDigest,
    },
  );
  return migratedLease;
}

async function compactSourceOwnedSecureStoreBundle<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  const { withT1ArcTransaction } = await loadTransactionModule();
  try {
    await withT1ArcTransaction(async (transaction) => {
      await assertSourceConnectionWriteLeaseInTransaction(
        transaction,
        sourceWriteLease,
        spec.sourceId,
      );
      const raws = await readRawFields(spec);
      const values = parseActiveValues(spec, raws, sourceWriteLease);
      if (values[spec.primaryField] === undefined) {
        throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
      }
      if (
        (await validatedIdentityDigest(spec, values)) !==
        sourceWriteLease.identityDigest
      ) {
        throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
      }
      const cleanup = await Promise.allSettled(
        Object.entries(spec.fields).map(([name, field]) => {
          const payload = values[name as keyof TValues];
          return SecureStore.setItemAsync(
            field.key,
            encodeEnvelope(
              sourceWriteLease.localDataWriteLease,
              sourceWriteLease.sourceId,
              payload === undefined
                ? []
                : [
                    {
                      ownerGeneration: sourceWriteLease.ownerGeneration,
                      identityDigest: sourceWriteLease.identityDigest,
                      payload,
                    },
                  ],
            ),
          );
        }),
      );
      return cleanup.every((result) => result.status === 'fulfilled');
    });
  } catch {
    // The active DB lease remains authoritative. Retained predecessors or a
    // failed physical write are detectable and retried on the next exact load.
  }
}

async function loadSourceOwnedSecureStoreBundleInTransaction<
  TValues extends Record<string, unknown>,
>(
  transaction: SQLiteDatabase,
  spec: SourceOwnedSecureStoreSpec<TValues>,
  writeLease: LocalDataWriteLease,
): Promise<LoadedSourceOwnedSecureStoreBundle<TValues>> {
  await assertLocalDataWriteLeaseInTransaction(transaction, writeLease);
  validateSpec(spec);
  const state = await readSourceConnectionOwnershipStateInTransaction(
    transaction,
    spec.sourceId,
  );
  const raws = await readRawFields(spec);
  if (state) {
    const durableSourceWriteLease = sourceWriteLeaseFromState(
      spec.sourceId,
      writeLease,
      state,
    );
    if (!durableSourceWriteLease) {
      // A failed physical disconnect cleanup remains visible in SecureStore,
      // so every later load retries it while holding the cross-runtime writer.
      await Promise.allSettled(
        Object.values(spec.fields).map((field) =>
          SecureStore.deleteItemAsync(field.key),
        ),
      );
      return { values: emptyValues(spec), sourceWriteLease: undefined };
    }
    const values = parseActiveValues(spec, raws, durableSourceWriteLease);
    // A connected marker without its exact current-epoch primary credential
    // is corrupt, not disconnected. Surface a recoverable state so the UI
    // cannot silently adopt or overwrite an ambiguous configuration.
    if (values[spec.primaryField] === undefined) {
      throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
    }
    let currentIdentityDigest: string;
    try {
      currentIdentityDigest = await validatedIdentityDigest(spec, values);
    } catch {
      throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
    }
    const verifiedSourceWriteLease =
      await migrateLegacyIdentityInTransaction(
        transaction,
        spec,
        writeLease,
        state,
        raws,
        values,
        currentIdentityDigest,
      );
    return {
      values,
      sourceWriteLease: verifiedSourceWriteLease,
    };
  }

  const recovered = recoverBootstrapValues(spec, raws, writeLease);
  const primaryValue = recovered.values[spec.primaryField];
  if (primaryValue === undefined) {
    await writeSourceConnectionOwnershipStateInTransaction(
      transaction,
      spec.sourceId,
      {
        version: 1,
        changeGeneration: 0,
        ownerGeneration: 0,
        connected: false,
      },
    );
    await Promise.allSettled(
      Object.values(spec.fields).map((field) =>
        SecureStore.deleteItemAsync(field.key),
      ),
    );
    return { values: emptyValues(spec), sourceWriteLease: undefined };
  }

  const computedDigest = await validatedIdentityDigest(spec, recovered.values);
  if (
    recovered.recoveredOwner &&
    (recovered.recoveredOwner.ownerGeneration !== 1 ||
      recovered.recoveredOwner.identityDigest !== computedDigest)
  ) {
    throw new Error(
      `The ${spec.sourceId} source-owned credential bootstrap is invalid.`,
    );
  }
  if (!spec.beforeLegacyBootstrap) {
    throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
  }
  await spec.beforeLegacyBootstrap({
    transaction,
    localDataWriteLease: writeLease,
    identityDigest: computedDigest,
  });
  const sourceWriteLease = {
    sourceId: spec.sourceId,
    localDataWriteLease: writeLease,
    ownerGeneration: 1,
    identityDigest: computedDigest,
  } satisfies SourceConnectionWriteLease;

  // SecureStore is written before the DB marker. If the SQLite transaction
  // rolls back after a successful secure write, the one-entry envelope is a
  // recognisable bootstrap precommit and can be completed on the next load.
  for (const [name, field] of Object.entries(spec.fields)) {
    const payload = recovered.values[name as keyof TValues];
    await SecureStore.setItemAsync(
      field.key,
      encodeEnvelope(
        writeLease,
        spec.sourceId,
        payload === undefined
          ? []
          : [
              {
                ownerGeneration: 1,
                identityDigest: computedDigest,
                payload,
              },
            ],
      ),
    );
  }
  await writeSourceConnectionOwnershipStateInTransaction(
    transaction,
    spec.sourceId,
    {
      version: 1,
      changeGeneration: 0,
      ownerGeneration: 1,
      connected: true,
      identityDigest: computedDigest,
    },
  );
  return { values: recovered.values, sourceWriteLease };
}

export async function loadSourceOwnedSecureStoreBundle<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  localDataWriteLease?: LocalDataWriteLease,
): Promise<LoadedSourceOwnedSecureStoreBundle<TValues>> {
  const writeLease = localDataWriteLease ?? (await acquireLocalDataWriteLease());
  const { withT1ArcTransaction } = await loadTransactionModule();
  const loaded = await withT1ArcTransaction((transaction) =>
    loadSourceOwnedSecureStoreBundleInTransaction(
      transaction,
      spec,
      writeLease,
    ),
  );
  if (loaded.sourceWriteLease) {
    await compactSourceOwnedSecureStoreBundle(
      spec,
      loaded.sourceWriteLease,
    );
  }
  return loaded;
}

export async function beginSourceOwnedConnectionChange<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  localDataWriteLease?: LocalDataWriteLease,
) {
  const writeLease = localDataWriteLease ?? (await acquireLocalDataWriteLease());
  const { withT1ArcTransaction } = await loadTransactionModule();
  return withT1ArcTransaction(async (transaction) => {
    // Complete/record the one-time legacy bootstrap and reserve the change in
    // one writer transaction. Disconnect cannot linearize in between them.
    await loadSourceOwnedSecureStoreBundleInTransaction(
      transaction,
      spec,
      writeLease,
    );
    return beginSourceConnectionChangeInTransaction(
      transaction,
      spec.sourceId,
      writeLease,
    );
  });
}

export async function activateSourceOwnedSecureStoreBundle<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  candidate: SourceConnectionCandidateLease,
  values: Readonly<Partial<TValues>>,
  options: SourceOwnedActivationOptions = {},
) {
  validateSpec(spec);
  if (candidate.sourceId !== spec.sourceId) {
    throw new Error('The source connection candidate does not match.');
  }
  const parsedValues = parseSuppliedValues(spec, values);
  if (parsedValues[spec.primaryField] === undefined) {
    throw new Error('The source-owned primary credential is required.');
  }
  const identityDigest = await validatedIdentityDigest(spec, parsedValues);
  const { withT1ArcTransaction } = await loadTransactionModule();
  const activated = await withT1ArcTransaction(
    async (transaction: SQLiteDatabase) => {
      // This is intentionally first: global erase owns the outer boundary.
      const sourceWriteLease =
        await activateSourceConnectionCandidateInTransaction(
          transaction,
          candidate,
          identityDigest,
        );
      const activatedValues = emptyValues(spec);
      for (const [name, field] of Object.entries(spec.fields)) {
        const raw = await SecureStore.getItemAsync(field.key);
        const envelope = parseOwnedEnvelope(decodeRaw(raw));
        const previous = candidate.observedConnected
          ? envelope?.entries.find(
              (entry) =>
                envelope.localDataWriteEpoch ===
                  candidate.localDataWriteLease.epoch &&
                envelope.sourceId === candidate.sourceId &&
                entry.ownerGeneration === candidate.observedOwnerGeneration &&
                entry.identityDigest === candidate.observedIdentityDigest,
            )
          : undefined;
        const supplied = values[name as keyof TValues];
        const parsed = parsedValues[name as keyof TValues];
        const entries: SourceOwnerEntry[] = [];
        if (previous) entries.push(previous);
        const inherited =
          supplied === undefined &&
          options.inheritUnspecifiedFieldsWhenIdentityMatches !== false &&
          identityDigest === candidate.observedIdentityDigest
            ? previous?.payload
            : undefined;
        const nextPayload = parsed ?? inherited;
        if (nextPayload !== undefined) {
          activatedValues[name as keyof TValues] = nextPayload as
            TValues[keyof TValues];
          entries.push({
            ownerGeneration: sourceWriteLease.ownerGeneration,
            identityDigest: sourceWriteLease.identityDigest,
            payload: nextPayload,
          });
        }
        await SecureStore.setItemAsync(
          field.key,
          encodeEnvelope(
            candidate.localDataWriteLease,
            candidate.sourceId,
            entries,
          ),
        );
      }
      if (
        (await validatedIdentityDigest(spec, activatedValues)) !== identityDigest
      ) {
        throw new Error(
          `The ${spec.sourceId} source-owned identity changed during activation.`,
        );
      }
      await options.beforeCommit?.({
        transaction,
        previousIdentityDigest: candidate.observedIdentityDigest,
        sourceWriteLease,
      });
      return { sourceWriteLease, values: activatedValues };
    },
  );
  await compactSourceOwnedSecureStoreBundle(
    spec,
    activated.sourceWriteLease,
  );
  return activated.sourceWriteLease;
}

export async function updateSourceOwnedSecureStoreField<
  TValues extends Record<string, unknown>,
  TField extends keyof TValues,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  fieldName: TField,
  value: TValues[TField],
  sourceWriteLease: SourceConnectionWriteLease,
) {
  const { withT1ArcTransaction } = await loadTransactionModule();
  await withT1ArcTransaction(async (transaction) => {
    await assertSourceConnectionWriteLeaseInTransaction(
      transaction,
      sourceWriteLease,
      spec.sourceId,
    );
    validateSpec(spec);
    if (sourceWriteLease.sourceId !== spec.sourceId) {
      throw new Error('The source connection write lease does not match.');
    }
    const field = spec.fields[fieldName];
    const parsed = field.parse(value);
    if (parsed === undefined) {
      throw new Error(`The ${spec.sourceId} ${String(fieldName)} value is invalid.`);
    }
    const raws = await readRawFields(spec);
    const activeValues = parseActiveValues(spec, raws, sourceWriteLease);
    if (activeValues[spec.primaryField] === undefined) {
      throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
    }
    activeValues[fieldName] = parsed;
    if (
      (await validatedIdentityDigest(spec, activeValues)) !==
      sourceWriteLease.identityDigest
    ) {
      throw new SourceConnectionSupersededError(spec.sourceId);
    }
    await SecureStore.setItemAsync(
      field.key,
      encodeEnvelope(
        sourceWriteLease.localDataWriteLease,
        sourceWriteLease.sourceId,
        [
          {
            ownerGeneration: sourceWriteLease.ownerGeneration,
            identityDigest: sourceWriteLease.identityDigest,
            payload: parsed,
          },
        ],
      ),
    );
  });
}

export async function clearSourceOwnedSecureStoreField<
  TValues extends Record<string, unknown>,
  TField extends keyof TValues,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  fieldName: TField,
  sourceWriteLease: SourceConnectionWriteLease,
) {
  const { withT1ArcTransaction } = await loadTransactionModule();
  await withT1ArcTransaction(async (transaction) => {
    await assertSourceConnectionWriteLeaseInTransaction(
      transaction,
      sourceWriteLease,
      spec.sourceId,
    );
    validateSpec(spec);
    const field = spec.fields[fieldName];
    const raws = await readRawFields(spec);
    const activeValues = parseActiveValues(spec, raws, sourceWriteLease);
    if (activeValues[spec.primaryField] === undefined) {
      throw new SourceConnectionConfigurationCorruptError(spec.sourceId);
    }
    activeValues[fieldName] = undefined;
    if (
      (await validatedIdentityDigest(spec, activeValues)) !==
      sourceWriteLease.identityDigest
    ) {
      throw new SourceConnectionSupersededError(spec.sourceId);
    }
    await SecureStore.setItemAsync(
      field.key,
      encodeEnvelope(
        sourceWriteLease.localDataWriteLease,
        sourceWriteLease.sourceId,
        [],
      ),
    );
  });
}

export async function disconnectSourceOwnedSecureStoreBundle<
  TValues extends Record<string, unknown>,
>(
  spec: SourceOwnedSecureStoreSpec<TValues>,
  localDataWriteLease?: LocalDataWriteLease,
) {
  const writeLease = localDataWriteLease ?? (await acquireLocalDataWriteLease());
  const { withT1ArcTransaction } = await loadTransactionModule();
  const credentialsCleared = await withT1ArcTransaction(async (transaction) => {
    await disconnectSourceConnectionInTransaction(
      transaction,
      spec.sourceId,
      writeLease,
    );
    validateSpec(spec);
    // Keep the cross-runtime writer lock until cleanup settles. Otherwise a
    // replacement could commit a new envelope after this marker transaction
    // but before an old disconnect's delayed delete reaches SecureStore.
    const cleanup = await Promise.allSettled(
      Object.values(spec.fields).map((field) =>
        SecureStore.deleteItemAsync(field.key),
      ),
    );
    return cleanup.every((result) => result.status === 'fulfilled');
  });
  // allSettled makes the marker authoritative even when physical cleanup
  // fails; the old owner remains inert and the transaction still commits.
  return { credentialsCleared };
}

export async function digestSourceConnectionIdentity(
  sourceId: OwnedGlucoseSourceId,
  normalizedIdentityParts: readonly string[],
) {
  assertOwnedGlucoseSourceId(sourceId);
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({
      version: 1,
      sourceId,
      identity: normalizedIdentityParts,
    }),
  );
}
