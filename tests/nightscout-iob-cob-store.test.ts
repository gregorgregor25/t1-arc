import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadDisplayableNightscoutIobCobSnapshot,
  loadNightscoutIobCobSnapshot,
  NIGHTSCOUT_IOB_COB_DISPLAY_MAX_AGE_MS,
  NIGHTSCOUT_IOB_COB_MAX_AGE_MS,
  saveNightscoutIobCobSnapshot,
} from '@/data/nightscout/iobCobStore';
import {
  activateNightscoutConnection,
  beginNightscoutConnectionChange,
} from '@/data/nightscout/secureStore';
import { NightscoutConnection } from '@/data/nightscout/types';

const secure = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    clear() {
      values.clear();
    },
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, next: string) => {
      values.set(key, next);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

const database = vi.hoisted(() => {
  const metadata = new Map<string, string>();
  return {
    metadata,
    clear() {
      metadata.clear();
    },
    transaction: {
      getFirstAsync: vi.fn(async (_query: string, key: string) => {
        const value = metadata.get(key);
        return value === undefined ? null : { value };
      }),
      runAsync: vi.fn(
        async (query: string, ...parameters: (string | number)[]) => {
          if (query.includes('INSERT INTO app_metadata')) {
            metadata.set(String(parameters[0]), String(parameters[1]));
          }
          return { changes: 1 };
        },
      ),
    },
  };
});

vi.mock('expo-secure-store', () => secure);
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 0 }),
  assertLocalDataWriteLeaseCurrent: async () => undefined,
  assertLocalDataWriteLeaseInTransaction: async () => undefined,
}));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  withT1ArcTransaction: async (task: (transaction: object) => Promise<unknown>) =>
    task(database.transaction),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(
    async (_algorithm: string, material: string) => {
      let hash = 0;
      for (const character of material) {
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      }
      return hash.toString(16).padStart(64, '0');
    },
  ),
}));

const first: NightscoutConnection = {
  baseUrl: 'https://one.example.test',
  accessToken: 'one-token',
};
const second: NightscoutConnection = {
  baseUrl: 'https://two.example.test',
  accessToken: 'two-token',
};

describe('Nightscout IOB and COB snapshot store', () => {
  beforeEach(() => {
    secure.clear();
    database.clear();
    vi.clearAllMocks();
  });

  async function connect(connection: NightscoutConnection) {
    const candidate = await beginNightscoutConnectionChange({ epoch: 0 });
    return activateNightscoutConnection(candidate, connection);
  }

  it('returns a fresh snapshot only to the connection that produced it', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const snapshot = { iobUnits: 1.2, cobGrams: 8, timestamp: now - 60_000 };
    const sourceWriteLease = await connect(first);
    await saveNightscoutIobCobSnapshot(first, snapshot, sourceWriteLease);
    await expect(loadNightscoutIobCobSnapshot(first, now)).resolves.toEqual(
      snapshot,
    );
    await expect(
      loadNightscoutIobCobSnapshot(second, now),
    ).resolves.toBeUndefined();

    await saveNightscoutIobCobSnapshot(first, snapshot, sourceWriteLease);
    await expect(
      loadNightscoutIobCobSnapshot(
        { ...first, accessToken: 'different-account-token' },
        now,
      ),
    ).resolves.toBeUndefined();
  });

  it('fails closed without racing an automatic SecureStore delete', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const sourceWriteLease = await connect(first);
    await saveNightscoutIobCobSnapshot(first, {
      iobUnits: 1.2,
      timestamp: now - NIGHTSCOUT_IOB_COB_MAX_AGE_MS - 1,
    }, sourceWriteLease);
    secure.deleteItemAsync.mockClear();
    await expect(
      loadNightscoutIobCobSnapshot(first, now),
    ).resolves.toBeUndefined();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('keeps a reported estimate for glance surfaces for up to an hour', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const sourceWriteLease = await connect(first);
    const older = { iobUnits: -0.3, cobGrams: 0, timestamp: now - 30 * 60_000 };
    await saveNightscoutIobCobSnapshot(first, older, sourceWriteLease);
    await expect(loadNightscoutIobCobSnapshot(first, now)).resolves.toBeUndefined();
    await expect(loadDisplayableNightscoutIobCobSnapshot(now)).resolves.toEqual(older);
    await expect(
      loadDisplayableNightscoutIobCobSnapshot(
        older.timestamp + NIGHTSCOUT_IOB_COB_DISPLAY_MAX_AGE_MS + 1,
      ),
    ).resolves.toBeUndefined();
  });

  it('shows no glance estimate after the connection changes or IOB/COB is turned off', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const snapshot = { iobUnits: 1.2, timestamp: now - 60_000 };
    const firstLease = await connect(first);
    await saveNightscoutIobCobSnapshot(first, snapshot, firstLease);
    await connect({ ...first, includeIobCob: false });
    await expect(loadDisplayableNightscoutIobCobSnapshot(now)).resolves.toBeUndefined();

    const secondLease = await connect(second);
    await saveNightscoutIobCobSnapshot(first, snapshot, secondLease);
    await expect(loadDisplayableNightscoutIobCobSnapshot(now)).resolves.toBeUndefined();
  });

  it('fails closed on a malformed medically sensitive value', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const sourceWriteLease = await connect(first);
    await secure.setItemAsync(
      't1arc.nightscout.iob-cob.v1',
      JSON.stringify({
        version: 2,
        localDataWriteEpoch: 0,
        sourceId: 'nightscout',
        entries: [
          {
            ownerGeneration: sourceWriteLease.ownerGeneration,
            identityDigest: sourceWriteLease.identityDigest,
            payload: {
              version: 2,
              connectionFingerprint: '0'.repeat(64),
              snapshot: { iobUnits: 'not-a-number', timestamp: now },
            },
          },
        ],
      }),
    );
    await expect(
      loadNightscoutIobCobSnapshot(first, now),
    ).resolves.toBeUndefined();
  });
});
