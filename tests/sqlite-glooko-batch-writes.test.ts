import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import type { GlucoseReading } from '@/domain/models';

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
