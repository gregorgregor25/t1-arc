import { beforeEach, expect, it, vi } from 'vitest';

import { LOCAL_DATA_WRITE_EPOCH_KEY } from '@/data/privacy/localDataWriteEpoch';
import { sourceConnectionOwnershipMetadataKey } from '@/data/live/sourceConnectionOwnership';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import { loadOwnedXdripConnection } from '@/data/xdrip/secureStore';

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

const database = vi.hoisted(() => {
  const durable = new Map<string, string>();
  let active = durable;
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
      const pending = new Map(durable);
      active = pending;
      try {
        const result = await task(transaction);
        durable.clear();
        pending.forEach((value, key) => durable.set(key, value));
        return result;
      } finally {
        active = durable;
      }
    },
  };
});

const privacy = vi.hoisted(() => ({
  clearGlucose: vi.fn(async () => undefined),
  commitSnapshot: vi.fn(async () => ({ count: 0 })),
  clearHealth: vi.fn(async () => undefined),
  clearInsights: vi.fn(async () => undefined),
  invalidateAlerts: vi.fn(async () => undefined),
  clearNativeOwner: vi.fn(async () => ({ supported: true })),
}));

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
vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  clearOwnedGlucoseSourceDataInTransaction: privacy.clearGlucose,
  commitVerifiedSnapshotInTransaction: privacy.commitSnapshot,
}));
vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  clearOwnedHealthSourceDataInTransaction: privacy.clearHealth,
}));
vi.mock('@/data/insights/insightReportRepository', () => ({
  clearSavedInsightReportsInTransaction: privacy.clearInsights,
}));
vi.mock('@/data/glucoseAlerts/glucoseAlertPreferences', () => ({
  invalidateGlucoseAlertsForSourceReplacement: privacy.invalidateAlerts,
}));
vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    clearPrivateGlucoseForWriteEpochAsync: privacy.clearNativeOwner,
  },
}));

const XDRIP_CONNECTION_KEY = 't1arc.xdrip.connection.v1';

beforeEach(() => {
  secureStore.values.clear();
  secureStore.values.set(
    XDRIP_CONNECTION_KEY,
    JSON.stringify({ endpointUrl: 'http://127.0.0.1:17580/sgv.json' }),
  );
  database.durable.clear();
  database.durable.set(LOCAL_DATA_WRITE_EPOCH_KEY, '0');
  vi.clearAllMocks();
});

it('bootstraps xDrip after a no-Wear native clear and advances an unchanged SGV by date', async () => {
  // The Android bridge fulfils only after classifying the exact absent-Wear
  // aggregate. JS must then publish the durable owner instead of stranding it.
  const loaded = await loadOwnedXdripConnection({ epoch: 0 });

  expect(loaded.sourceWriteLease).toMatchObject({
    sourceId: 'xdrip-local',
    ownerGeneration: 1,
  });
  expect(privacy.clearNativeOwner).toHaveBeenCalledWith(
    0,
    'No personal glucose reading',
  );
  expect(privacy.clearGlucose).toHaveBeenCalledWith(
    database.transaction,
    'xdrip-local',
  );
  expect(privacy.clearInsights).toHaveBeenCalledWith(database.transaction);
  expect(
    database.durable.get(
      sourceConnectionOwnershipMetadataKey('xdrip-local'),
    ),
  ).toContain('"connected":true');

  const firstDate = Date.UTC(2026, 7, 25, 13, 0);
  let observedDate = firstDate;
  let observedAt = firstDate + 60_000;
  const source = new XdripGlucoseSource(
    loaded.values.connection!,
    new MemoryGlucoseHistoryStore(),
    (async () =>
      new Response(
        JSON.stringify({ sgv: 108, direction: 'Flat', date: observedDate }),
        { status: 200 },
      )) as typeof fetch,
    () => observedAt,
  );

  await source.refresh();
  observedDate = firstDate + 5 * 60_000;
  observedAt = observedDate + 60_000;
  await source.refresh();

  await expect(source.getLatestReading()).resolves.toMatchObject({
    mmolL: 6,
    timestamp: observedDate,
  });
  await expect(source.getStatus(observedAt)).resolves.toMatchObject({
    dataThrough: observedDate,
    recordCount: 2,
    freshness: 'current',
  });
});
