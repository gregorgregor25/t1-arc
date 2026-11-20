import { beforeEach, describe, expect, it, vi } from 'vitest';

import { therapyStateRouteIsCurrent } from '@/components/nowCardPresentation';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import {
  activateNightscoutConnection,
  beginNightscoutConnectionChange,
  clearNightscoutConnection,
  disconnectNightscoutConnection,
  loadNightscoutTreatmentSyncAt,
  saveNightscoutTreatmentSyncAt,
} from '@/data/nightscout/secureStore';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { LOCAL_DATA_WRITE_EPOCH_KEY } from '@/data/privacy/localDataWriteEpoch';

const secure = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
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
  const transaction = {
    getFirstAsync: vi.fn(async (_query: string, key: string) => {
      const value = metadata.get(key);
      return value === undefined ? null : { value };
    }),
    runAsync: vi.fn(async (query: string, key: string, value?: string) => {
      if (/^DELETE/i.test(query.trim())) metadata.delete(key);
      else if (value !== undefined) metadata.set(key, value);
      return { changes: 1 };
    }),
  };
  return { metadata, transaction };
});

vi.mock('expo-secure-store', () => secure);
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: async () => database.transaction,
  withT1ArcTransaction: async (task: (transaction: object) => Promise<unknown>) =>
    task(database.transaction),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async (_algorithm: string, material: string) => {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(material).digest('hex');
  },
}));

const connection = { baseUrl: 'https://poll.example.test', accessToken: 'synthetic-read-token' };
const T0 = Date.parse('2030-01-02T12:00:00Z');
const MINUTE = 60_000;
const json = (payload: unknown) => new Response(JSON.stringify(payload), {
  headers: { 'content-type': 'application/json' },
});

async function connect(baseUrl = connection.baseUrl) {
  return activateNightscoutConnection(
    await beginNightscoutConnectionChange(),
    { ...connection, baseUrl },
  );
}

describe('successful current-window Nightscout treatment polls', () => {
  beforeEach(() => {
    secure.values.clear();
    database.metadata.clear();
    database.metadata.set(LOCAL_DATA_WRITE_EPOCH_KEY, '0');
    vi.clearAllMocks();
  });

  it('advances the receipt for unchanged content while retaining its original import timestamp', async () => {
    const lease = await connect();
    const records = new MemoryHealthRecordStore();
    let now = T0;
    const fetcher = vi.fn(async () => json([])) as unknown as typeof fetch;
    const importer = new NightscoutTreatmentImporter(
      connection, records, fetcher, () => now,
      (at) => saveNightscoutTreatmentSyncAt(at, lease),
    );
    const first = await importer.refresh();
    expect(await loadNightscoutTreatmentSyncAt()).toBe(T0);
    now += 40 * MINUTE;
    const repeated = await importer.refresh();
    expect(repeated.batch.id).toBe(first.batch.id);
    expect(repeated.batch.importedAt).toBe(T0);
    expect(await loadNightscoutTreatmentSyncAt()).toBe(now);
    expect(therapyStateRouteIsCurrent(repeated.batch.importedAt, now)).toBe(false);
    expect(therapyStateRouteIsCurrent(await loadNightscoutTreatmentSyncAt(), now)).toBe(true);
  });

  it('leaves the last successful receipt intact when the next poll fails', async () => {
    const lease = await connect();
    await saveNightscoutTreatmentSyncAt(T0, lease);
    const importer = new NightscoutTreatmentImporter(
      connection,
      new MemoryHealthRecordStore(),
      vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch,
      () => T0 + 10 * MINUTE,
      (at) => saveNightscoutTreatmentSyncAt(at, lease),
    );
    await expect(importer.refresh()).rejects.toThrow();
    expect(await loadNightscoutTreatmentSyncAt()).toBe(T0);
  });

  it('does not mark a failed database write or a historical backfill as a current poll', async () => {
    const lease = await connect();
    const records = new MemoryHealthRecordStore();
    const write = vi.spyOn(records, 'writeImport').mockRejectedValueOnce(new Error('write failed'));
    const receipt = vi.fn((at: number) => saveNightscoutTreatmentSyncAt(at, lease));
    const importer = new NightscoutTreatmentImporter(
      connection, records, vi.fn(async () => json([])) as unknown as typeof fetch,
      () => T0, receipt,
    );
    await expect(importer.refresh()).rejects.toThrow('write failed');
    expect(receipt).not.toHaveBeenCalled();
    write.mockRestore();
    await importer.importRange(T0 - 10 * 86_400_000, T0 - 8 * 86_400_000);
    expect(receipt).not.toHaveBeenCalled();
    expect(await loadNightscoutTreatmentSyncAt()).toBeUndefined();
  });

  it('invalidates an earlier receipt on reconnection, including the same site', async () => {
    const first = await connect();
    await saveNightscoutTreatmentSyncAt(T0, first);
    const replacement = await connect();
    expect(await loadNightscoutTreatmentSyncAt()).toBeUndefined();
    await expect(saveNightscoutTreatmentSyncAt(T0 + MINUTE, first)).rejects.toThrow(/superseded/i);
    await saveNightscoutTreatmentSyncAt(T0 + 2 * MINUTE, replacement);
    expect(await loadNightscoutTreatmentSyncAt()).toBe(T0 + 2 * MINUTE);
    await connect('https://replacement.example.test');
    expect(await loadNightscoutTreatmentSyncAt()).toBeUndefined();
  });

  it('hides receipts on disconnect and prevents a late poll from restoring them', async () => {
    const lease = await connect();
    await saveNightscoutTreatmentSyncAt(T0, lease);
    await disconnectNightscoutConnection();
    expect(await loadNightscoutTreatmentSyncAt()).toBeUndefined();
    await expect(saveNightscoutTreatmentSyncAt(T0 + MINUTE, lease)).rejects.toThrow(/superseded/i);
  });

  it('fences a receipt write after erase and physically removes its saved value', async () => {
    const lease = await connect();
    await saveNightscoutTreatmentSyncAt(T0, lease);
    database.metadata.set(LOCAL_DATA_WRITE_EPOCH_KEY, '1');
    await expect(loadNightscoutTreatmentSyncAt()).rejects.toThrow(/cannot be read/i);
    await expect(saveNightscoutTreatmentSyncAt(T0 + MINUTE, lease)).rejects.toThrow(/privacy erase/i);
    await clearNightscoutConnection();
    expect(secure.values.has('t1arc.nightscout.treatment-sync.v1')).toBe(false);
  });
});
