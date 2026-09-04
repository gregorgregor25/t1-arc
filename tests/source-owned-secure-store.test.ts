import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DATA_WRITE_EPOCH_KEY,
} from '@/data/privacy/localDataWriteEpoch';
import { sourceConnectionOwnershipMetadataKey } from '@/data/live/sourceConnectionOwnership';

import {
  activateSourceOwnedSecureStoreBundle,
  beginSourceOwnedConnectionChange,
  disconnectSourceOwnedSecureStoreBundle,
  loadSourceOwnedSecureStoreBundle,
  isSourceConnectionConfigurationCorruptError,
  SourceConnectionConfigurationCorruptError,
  updateSourceOwnedSecureStoreField,
  type SourceOwnedSecureStoreSpec,
} from '@/data/live/sourceOwnedSecureStore';

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    failSetKey: undefined as string | undefined,
    failDelete: false,
    getGate: undefined as Promise<void> | undefined,
    deleteGate: undefined as Promise<void> | undefined,
    onGet: undefined as (() => void) | undefined,
    onDelete: undefined as (() => void) | undefined,
    getItemAsync: vi.fn(async (key: string) => {
      secureStore.onGet?.();
      await secureStore.getGate;
      return values.get(key) ?? null;
    }),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      if (key === secureStore.failSetKey) throw new Error('secure write failed');
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      secureStore.onDelete?.();
      await secureStore.deleteGate;
      if (secureStore.failDelete) throw new Error('secure delete failed');
      values.delete(key);
    }),
  };
});

const database = vi.hoisted(() => {
  const durable = new Map<string, string>();
  let active = durable;
  let transactionTail = Promise.resolve();
  const transaction = {
    getFirstAsync: vi.fn(async (_sql: string, key: string) =>
      active.has(key) ? { value: active.get(key)! } : null,
    ),
    runAsync: vi.fn(async (sql: string, key: string, value?: string) => {
      if (/^DELETE/i.test(sql.trim())) active.delete(key);
      else if (value !== undefined) active.set(key, value);
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };
  return {
    durable,
    transaction,
    async run<T>(task: (value: typeof transaction) => Promise<T>) {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const pending = new Map(durable);
      active = pending;
      try {
        const result = await task(transaction);
        durable.clear();
        pending.forEach((value, key) => durable.set(key, value));
        return result;
      } finally {
        active = durable;
        release();
      }
    },
    reset() {
      durable.clear();
      durable.set(LOCAL_DATA_WRITE_EPOCH_KEY, '0');
      active = durable;
      transactionTail = Promise.resolve();
      transaction.getFirstAsync.mockClear();
      transaction.runAsync.mockClear();
    },
  };
});

vi.mock('expo-secure-store', () => secureStore);
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => 'c'.repeat(64)),
}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => database.transaction),
  withT1ArcTransaction: vi.fn(
    async <T>(task: (transaction: typeof database.transaction) => Promise<T>) =>
      database.run(task),
  ),
}));

interface TestCredentials {
  email: string;
  password: string;
}

interface TestSession {
  token: string;
}

const IDENTITY_A = 'a'.repeat(64);
const IDENTITY_B = 'b'.repeat(64);
const CREDENTIALS_KEY = 'test.credentials';
const SESSION_KEY = 'test.session';
const legacyBootstrapBoundary = vi.fn(async () => undefined);

const spec: SourceOwnedSecureStoreSpec<{
  credentials: TestCredentials;
  session: TestSession;
}> = {
  sourceId: 'nightscout',
  primaryField: 'credentials',
  fields: {
    credentials: {
      key: CREDENTIALS_KEY,
      parse(value) {
        const candidate = value as Partial<TestCredentials> | null;
        return candidate &&
          typeof candidate.email === 'string' &&
          typeof candidate.password === 'string'
          ? { email: candidate.email, password: candidate.password }
          : undefined;
      },
    },
    session: {
      key: SESSION_KEY,
      parse(value) {
        const candidate = value as Partial<TestSession> | null;
        return candidate && typeof candidate.token === 'string'
          ? { token: candidate.token }
          : undefined;
      },
    },
  },
  identityDigest: async (values) =>
    values.credentials?.email === 'old@example.com' ? IDENTITY_A : IDENTITY_B,
  beforeLegacyBootstrap: legacyBootstrapBoundary,
};

function rawOwnedEntries(key: string) {
  const raw = secureStore.values.get(key);
  return raw
    ? (JSON.parse(raw) as {
        version: number;
        entries: { ownerGeneration: number; payload: unknown }[];
      })
    : undefined;
}

describe('source-owned SecureStore bundles', () => {
  beforeEach(() => {
    database.reset();
    secureStore.values.clear();
    secureStore.failSetKey = undefined;
    secureStore.failDelete = false;
    secureStore.getGate = undefined;
    secureStore.deleteGate = undefined;
    secureStore.onGet = undefined;
    secureStore.onDelete = undefined;
    vi.clearAllMocks();
  });

  it('purges unknown-provenance source data before publishing a legacy credential owner', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    secureStore.values.set(SESSION_KEY, JSON.stringify({ token: 'session' }));

    const loaded = await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });

    expect(loaded.values).toEqual({
      credentials: { email: 'old@example.com', password: 'secret' },
      session: { token: 'session' },
    });
    expect(loaded.sourceWriteLease).toMatchObject({
      sourceId: 'nightscout',
      ownerGeneration: 1,
      identityDigest: IDENTITY_A,
    });
    const state = database.durable.get(
      sourceConnectionOwnershipMetadataKey('nightscout'),
    );
    expect(state).toContain(IDENTITY_A);
    expect(state).not.toContain('old@example.com');
    expect(state).not.toContain('secret');
    expect(rawOwnedEntries(CREDENTIALS_KEY)).toMatchObject({ version: 2 });
    expect(legacyBootstrapBoundary).toHaveBeenCalledOnce();
    expect(legacyBootstrapBoundary.mock.invocationCallOrder[0]).toBeLessThan(
      database.transaction.runAsync.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('fails closed instead of adopting legacy credentials without a privacy boundary', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );

    await expect(
      loadSourceOwnedSecureStoreBundle(
        { ...spec, beforeLegacyBootstrap: undefined },
        { epoch: 0 },
      ),
    ).rejects.toBeInstanceOf(SourceConnectionConfigurationCorruptError);
    expect(
      database.durable.has(sourceConnectionOwnershipMetadataKey('nightscout')),
    ).toBe(false);
  });

  it('does not publish a bootstrap owner when its privacy purge fails', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );

    await expect(
      loadSourceOwnedSecureStoreBundle(
        {
          ...spec,
          beforeLegacyBootstrap: async () => {
            throw new Error('privacy purge failed');
          },
        },
        { epoch: 0 },
      ),
    ).rejects.toThrow('privacy purge failed');
    expect(
      database.durable.has(sourceConnectionOwnershipMetadataKey('nightscout')),
    ).toBe(false);
    expect(rawOwnedEntries(CREDENTIALS_KEY)?.version).toBeUndefined();
  });

  it('marks an empty legacy bootstrap complete and never accepts a later raw value', async () => {
    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: { credentials: undefined, session: undefined },
      sourceWriteLease: undefined,
    });
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'late' }),
    );

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: { credentials: undefined, session: undefined },
      sourceWriteLease: undefined,
    });
  });

  it('marks malformed legacy credentials as unknown provenance for the next verified activation', async () => {
    secureStore.values.set(CREDENTIALS_KEY, '{malformed');
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const candidate = await beginSourceOwnedConnectionChange(spec, { epoch: 0 });
    const beforeCommit = vi.fn(async () => undefined);

    await activateSourceOwnedSecureStoreBundle(
      spec,
      candidate,
      {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
      },
      { beforeCommit },
    );

    expect(beforeCommit).toHaveBeenCalledWith(
      expect.objectContaining({ previousIdentityDigest: undefined }),
    );
  });

  it('keeps the active owner usable while a replacement is only being verified', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });

    await beginSourceOwnedConnectionChange(spec, { epoch: 0 });

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: {
        credentials: { email: 'old@example.com', password: 'secret' },
      },
      sourceWriteLease: { ownerGeneration: 1 },
    });
  });

  it('preserves the old owner if a multi-key activation fails after its first secure write', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'old-secret' }),
    );
    secureStore.values.set(SESSION_KEY, JSON.stringify({ token: 'old-token' }));
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const candidate = await beginSourceOwnedConnectionChange(spec, { epoch: 0 });
    secureStore.failSetKey = SESSION_KEY;

    await expect(
      activateSourceOwnedSecureStoreBundle(spec, candidate, {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
        session: { token: 'new-token' },
      }),
    ).rejects.toThrow('secure write failed');
    secureStore.failSetKey = undefined;

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: {
        credentials: {
          email: 'old@example.com',
          password: 'old-secret',
        },
        session: { token: 'old-token' },
      },
      sourceWriteLease: { ownerGeneration: 1 },
    });
    // Loading the still-authoritative old owner also compacts the failed
    // candidate entry after the SQLite rollback has completed.
    expect(rawOwnedEntries(CREDENTIALS_KEY)?.entries).toHaveLength(1);
  });

  it('commits a verified replacement and rejects replay of the same candidate', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'old-secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const candidate = await beginSourceOwnedConnectionChange(spec, { epoch: 0 });
    const replacement = {
      credentials: {
        email: 'new@example.com',
        password: 'new-secret',
      },
      session: { token: 'new-token' },
    };

    await expect(
      activateSourceOwnedSecureStoreBundle(spec, candidate, replacement),
    ).resolves.toMatchObject({ ownerGeneration: 2, identityDigest: IDENTITY_B });
    await expect(
      activateSourceOwnedSecureStoreBundle(spec, candidate, replacement),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({ values: replacement });
    expect(rawOwnedEntries(CREDENTIALS_KEY)?.entries).toEqual([
      expect.objectContaining({ ownerGeneration: 2 }),
    ]);
  });

  it('compacts the current exact-lease envelopes without clobbering a queued same-owner update', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'old-secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const candidate = await beginSourceOwnedConnectionChange(spec, { epoch: 0 });
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let commitStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const activation = activateSourceOwnedSecureStoreBundle(
      spec,
      candidate,
      {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
        session: { token: 'activation-token' },
      },
      {
        beforeCommit: async () => {
          commitStarted();
          await commitGate;
        },
      },
    );
    await started;
    const expectedLease = {
      sourceId: 'nightscout' as const,
      localDataWriteLease: { epoch: 0 },
      ownerGeneration: 2,
      identityDigest: IDENTITY_B,
    };
    const update = updateSourceOwnedSecureStoreField(
      spec,
      'session',
      { token: 'newer-token' },
      expectedLease,
    );

    releaseCommit();
    await Promise.all([activation, update]);

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: { session: { token: 'newer-token' } },
    });
    expect(rawOwnedEntries(SESSION_KEY)?.entries).toEqual([
      expect.objectContaining({
        ownerGeneration: 2,
        payload: { token: 'newer-token' },
      }),
    ]);
  });

  it('migrates an explicitly recognised legacy identity without trusting a different owner', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    secureStore.values.set(SESSION_KEY, JSON.stringify({ token: 'session' }));
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const beforeLegacyIdentityMigration = vi.fn(async () => undefined);
    const migratedSpec: typeof spec = {
      ...spec,
      identityDigest: async () => IDENTITY_B,
      legacyIdentityDigests: async () => [IDENTITY_A],
      beforeLegacyIdentityMigration,
    };

    await expect(
      loadSourceOwnedSecureStoreBundle(migratedSpec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: {
        credentials: { email: 'old@example.com', password: 'secret' },
        session: { token: 'session' },
      },
      sourceWriteLease: {
        ownerGeneration: 2,
        identityDigest: IDENTITY_B,
      },
    });
    expect(rawOwnedEntries(CREDENTIALS_KEY)?.entries).toEqual([
      expect.objectContaining({ ownerGeneration: 2 }),
    ]);
    expect(beforeLegacyIdentityMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        previousIdentityDigest: IDENTITY_A,
        identityDigest: IDENTITY_B,
        localDataWriteLease: { epoch: 0 },
      }),
    );
  });

  it('refuses a legacy identity migration without an explicit data-purge boundary', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });

    await expect(
      loadSourceOwnedSecureStoreBundle(
        {
          ...spec,
          identityDigest: async () => IDENTITY_B,
          legacyIdentityDigests: async () => [IDENTITY_A],
        },
        { epoch: 0 },
      ),
    ).rejects.toBeInstanceOf(SourceConnectionConfigurationCorruptError);
  });

  it('rejects an active envelope whose payload no longer matches its claimed identity', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const envelope = rawOwnedEntries(CREDENTIALS_KEY)!;
    envelope.entries[0]!.payload = {
      email: 'new@example.com',
      password: 'secret',
    };
    secureStore.values.set(CREDENTIALS_KEY, JSON.stringify(envelope));

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).rejects.toBeInstanceOf(SourceConnectionConfigurationCorruptError);
  });

  it('rejects a generic field update that would change the active owner identity', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    const loaded = await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });

    await expect(
      updateSourceOwnedSecureStoreField(
        spec,
        'credentials',
        { email: 'new@example.com', password: 'secret' },
        loaded.sourceWriteLease!,
      ),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
  });

  it('rolls back credential ownership when staged verified data cannot commit', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'old-secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const candidate = await beginSourceOwnedConnectionChange(spec, { epoch: 0 });

    await expect(
      activateSourceOwnedSecureStoreBundle(
        spec,
        candidate,
        {
          credentials: {
            email: 'new@example.com',
            password: 'new-secret',
          },
        },
        {
          beforeCommit: async () => {
            throw new Error('snapshot commit failed');
          },
        },
      ),
    ).rejects.toThrow('snapshot commit failed');

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: {
        credentials: {
          email: 'old@example.com',
          password: 'old-secret',
        },
      },
      sourceWriteLease: { ownerGeneration: 1, identityDigest: IDENTITY_A },
    });
  });

  it('disconnects durably even when physical SecureStore cleanup fails', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    secureStore.failDelete = true;

    await expect(
      disconnectSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toEqual({ credentialsCleared: false });
    expect(secureStore.values.has(CREDENTIALS_KEY)).toBe(true);
    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: { credentials: undefined, session: undefined },
      sourceWriteLease: undefined,
    });
    secureStore.failDelete = false;
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    expect(secureStore.values.has(CREDENTIALS_KEY)).toBe(false);
  });

  it('holds the writer boundary across delayed disconnect cleanup so a replacement is not deleted', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    let releaseDelete!: () => void;
    secureStore.deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      deleteStarted = resolve;
    });
    secureStore.onDelete = deleteStarted;

    const disconnect = disconnectSourceOwnedSecureStoreBundle(spec, {
      epoch: 0,
    });
    await started;
    const reconnect = (async () => {
      const candidate = await beginSourceOwnedConnectionChange(spec, {
        epoch: 0,
      });
      return activateSourceOwnedSecureStoreBundle(spec, candidate, {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
        session: { token: 'new-token' },
      });
    })();

    await Promise.resolve();
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(
      CREDENTIALS_KEY,
      expect.stringContaining('new@example.com'),
    );
    releaseDelete();
    await disconnect;
    await reconnect;

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
      },
    });
  });

  it('atomically reserves a connect candidate with legacy bootstrap before a later disconnect', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    let releaseGet!: () => void;
    secureStore.getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let getStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      getStarted = resolve;
    });
    secureStore.onGet = getStarted;

    const candidatePromise = beginSourceOwnedConnectionChange(spec, {
      epoch: 0,
    });
    await started;
    const disconnectPromise = disconnectSourceOwnedSecureStoreBundle(spec, {
      epoch: 0,
    });
    releaseGet();
    const candidate = await candidatePromise;
    await disconnectPromise;

    await expect(
      activateSourceOwnedSecureStoreBundle(spec, candidate, {
        credentials: {
          email: 'new@example.com',
          password: 'new-secret',
        },
      }),
    ).rejects.toMatchObject({ name: 'SourceConnectionSupersededError' });
    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 }),
    ).resolves.toMatchObject({
      values: { credentials: undefined },
      sourceWriteLease: undefined,
    });
  });

  it('fails closed on an invalid owned envelope instead of falling back to its payload', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    const envelope = rawOwnedEntries(CREDENTIALS_KEY)!;
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({
        ...envelope,
        entries: [
          {
            ...envelope.entries[0],
            ownerGeneration: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      }),
    );

    const error = await loadSourceOwnedSecureStoreBundle(spec, {
      epoch: 0,
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(SourceConnectionConfigurationCorruptError);
    expect(isSourceConnectionConfigurationCorruptError(error)).toBe(true);
    expect(error).toMatchObject({ recoverable: true, sourceId: 'nightscout' });
  });

  it('treats an envelope from a previous privacy epoch as inert', async () => {
    secureStore.values.set(
      CREDENTIALS_KEY,
      JSON.stringify({ email: 'old@example.com', password: 'secret' }),
    );
    await loadSourceOwnedSecureStoreBundle(spec, { epoch: 0 });
    database.durable.set(LOCAL_DATA_WRITE_EPOCH_KEY, '1');

    await expect(
      loadSourceOwnedSecureStoreBundle(spec, { epoch: 1 }),
    ).rejects.toBeInstanceOf(SourceConnectionConfigurationCorruptError);
  });
});
