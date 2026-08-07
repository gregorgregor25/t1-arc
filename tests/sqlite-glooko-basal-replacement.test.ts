import { beforeEach, describe, expect, it, vi } from 'vitest';

const { database, transaction, openDaymarkDatabase, withDaymarkTransaction } =
  vi.hoisted(() => {
    const transaction = {
      getFirstAsync: vi.fn(),
      runAsync: vi.fn(),
    };
    return {
      database: {},
      transaction,
      openDaymarkDatabase: vi.fn(async () => ({})),
      withDaymarkTransaction: vi.fn(
        async (work: (value: typeof transaction) => Promise<void>) =>
          work(transaction),
      ),
    };
  });

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase,
  withDaymarkTransaction,
}));

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

describe('SQLite retained Glooko basal correction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openDaymarkDatabase.mockResolvedValue(database);
    transaction.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM import_batches')) {
        return {
          id: 'glooko-export:archive',
          source_id: 'glooko-export',
          file_name: 'export.zip',
          file_sha256: 'archive-sha',
          imported_at_ms: 1_000,
          data_start_ms: null,
          data_through_ms: null,
          basal_count: 1,
          bolus_count: 0,
          context_count: 0,
          daily_total_count: 0,
          duplicate_count: 0,
          skipped_count: 0,
          warnings_json: '[]',
        };
      }
      if (sql.includes('FROM import_source_payloads')) {
        return { import_batch_id: 'glooko-export:archive' };
      }
      return undefined;
    });
    transaction.runAsync.mockImplementation(async (sql: string) => ({
      changes:
        sql.includes('DELETE FROM insulin_basal') ||
        sql.includes('INSERT OR IGNORE INTO insulin_basal')
          ? 1
          : 0,
    }));
  });

  it('deletes the matching estimate before inserting its exact replacement in one transaction', async () => {
    const start = Date.parse('2026-08-06T00:00:00+01:00');
    const end = start + 5 * 60 * 1000;
    const store = new SqliteHealthRecordStore();
    const result = await store.writeImport(
      {
        id: 'glooko-export:archive',
        sourceId: 'glooko-export',
        fileName: 'export.zip',
        fileSha256: 'archive-sha',
        importedAt: 1_000,
        skippedCount: 0,
        warnings: [],
      },
      [
        {
          id: 'corrected-id',
          sourceId: 'glooko-export',
          start,
          end,
          rateUnitsPerHour: 0.9,
          units: 0.075,
          unitsEstimated: false,
          sourceFile: 'basal_data_1.csv',
          sourceRow: 2,
          sourceDeviceId: 'PDM-ANONYMISED',
        },
      ],
      [],
      [],
    );

    expect(withDaymarkTransaction).toHaveBeenCalledOnce();
    const deleteCall = transaction.runAsync.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM insulin_basal'),
    );
    const insertCall = transaction.runAsync.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT OR IGNORE INTO insulin_basal'),
    );
    expect(deleteCall).toEqual([
      expect.stringContaining('AND units_estimated = 1'),
      'glooko-export',
      'basal_data_1.csv',
      2,
      'PDM-ANONYMISED',
      start,
      end,
      'corrected-id',
    ]);
    expect(transaction.runAsync.mock.calls.indexOf(deleteCall!)).toBeLessThan(
      transaction.runAsync.mock.calls.indexOf(insertCall!),
    );
    expect(result).toMatchObject({
      alreadyImported: true,
      insertedBasal: 1,
      duplicateCount: 0,
      batch: { basalCount: 1 },
    });
  });
});
