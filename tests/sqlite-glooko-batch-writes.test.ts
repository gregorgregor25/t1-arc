import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import type { GlucoseReading, BasalDelivery, MealEvent } from '@/domain/models';

const { database, transaction, openT1ArcDatabase, withT1ArcTransaction } =
  vi.hoisted(() => {
    const transaction = {
      getFirstAsync: vi.fn(),
      getAllAsync: vi.fn(),
      runAsync: vi.fn(),
    };
    return {
      database: {},
      transaction,
      openT1ArcDatabase: vi.fn(async () => ({})),
      withT1ArcTransaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<void>) =>
          work(transaction),
      ),
    };
  });

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase,
  withT1ArcTransaction,
}));

describe('large Glooko SQLite writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openT1ArcDatabase.mockResolvedValue(database);
    transaction.getFirstAsync.mockResolvedValue(undefined);
    transaction.getAllAsync.mockResolvedValue([]);
    transaction.runAsync.mockResolvedValue({ changes: 0 });
  });

  it('measures native statement count for a representative 90-day history', async () => {
    const start = Date.parse('2026-06-01T00:00:00Z');
    const basal: BasalDelivery[] = Array.from({ length: 4320 }, (_, index) => ({
      id: `basal-${index}`, sourceId: 'glooko-export', start: start + index * 1_800_000,
      end: start + (index + 1) * 1_800_000, rateUnitsPerHour: 0.8, units: 0.4,
    }));
    const context: MealEvent[] = Array.from({ length: 270 }, (_, index) => ({
      id: `meal-${index}`, sourceId: 'glooko-export', origin: 'imported', kind: 'meal',
      start: start + index * 28_800_000, title: 'Fixture meal', mealType: 'lunch', carbsGrams: 45,
    }));
    await new SqliteHealthRecordStore().writeImport({ id: 'perf', sourceId: 'glooko-export',
      fileName: 'synthetic-90-day.zip', fileSha256: 'perf', importedAt: start,
      skippedCount: 0, warnings: [] }, basal, [], context);
    const writes = transaction.runAsync.mock.calls.filter(([sql]) => /INSERT OR IGNORE INTO (insulin_basal|context_events)/.test(String(sql)));
    console.info(`T1ArcImportStatementCount records=4590 statements=${writes.length}`);
    expect(writes).toHaveLength(117);
    expect(writes.every((call) => call.length <= 901)).toBe(true);
    expect(writes.flatMap((call) => call.slice(1)).length).toBe(4320 * 13 + 270 * 29);
  });

  it('writes exact raw rows in bounded multi-row statements', async () => {
    const rawRecords = Array.from({ length: 81 }, (_, index) => ({
      id: `raw-${index}`,
      sourceId: 'glooko-export',
      recordKind: 'cgm',
      timestamp: 1_000 + index,
      sourceFile: 'cgm_data_1.csv',
      sourceRow: index + 2,
      payloadJson: JSON.stringify({ Timestamp: String(index) }),
      importedAt: 2_000,
    }));

    await new SqliteHealthRecordStore().writeImport(
      {
        id: 'glooko-export:large-raw',
        sourceId: 'glooko-export',
        fileName: 'export.zip',
        fileSha256: 'large-raw',
        importedAt: 2_000,
        skippedCount: 0,
        warnings: [],
      },
      [],
      [],
      [],
      undefined,
      [],
      rawRecords,
    );

    const writes = transaction.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO import_raw_records'),
    );
    expect(writes).toHaveLength(3);
    expect(writes.map((call) => call.length)).toEqual([441, 441, 12]);
    expect(writes[0]?.[0]).toContain('ON CONFLICT(id) DO UPDATE SET');
  });

  it('upserts CGM readings in bounded multi-row statements', async () => {
    const readings: GlucoseReading[] = Array.from(
      { length: 81 },
      (_, index) => ({
        id: `reading-${index}`,
        sourceId: 'glooko-cgm',
        timestamp: 1_000 + index,
        receivedAt: 1_000 + index,
        mmolL: 6,
        trend: 'flat',
        quality: 'measured',
      }),
    );

    await new SqliteGlucoseHistoryStore().upsertReadings(readings);

    const writes = transaction.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO glucose_readings'),
    );
    expect(writes).toHaveLength(3);
    expect(writes.map((call) => call.length)).toEqual([561, 561, 15]);
    expect(writes[0]?.[0]).toContain(
      'ON CONFLICT(source_id, timestamp_ms, source_device_id) DO UPDATE SET',
    );
    expect(writes[0]?.[0]).not.toContain('id = excluded.id');
  });
});
