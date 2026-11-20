import { describe, expect, it, vi } from 'vitest';

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

const { transaction, withT1ArcTransaction } = vi.hoisted(() => {
  const transaction = {
    runAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
    getFirstAsync: vi.fn(async () => null),
    getAllAsync: vi.fn(async () => []),
  };
  return {
    transaction,
    withT1ArcTransaction: vi.fn(async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
    ),
  };
});

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => transaction),
  withT1ArcTransaction,
}));

describe('SQLite import revisions', () => {
  it('removes only imported rows of the batch source before inserting revised records', async () => {
    const store = new SqliteHealthRecordStore();
    const result = await store.writeImport(
      {
        id: 'nightscout:batch',
        sourceId: 'nightscout',
        fileName: 'Nightscout API treatments and profile',
        fileSha256: 'a'.repeat(64),
        importedAt: 1,
        skippedCount: 0,
        warnings: [],
      },
      [],
      [{ id: 'nightscout:bolus:x', sourceId: 'nightscout', timestamp: 10, units: 2 }],
      [],
      undefined,
      [],
      [],
      { revisedRecordIds: ['nightscout:bolus:x', 'nightscout:meal:x'] },
    );
    const statements = transaction.runAsync.mock.calls.map(
      (call) => call as unknown as [string, ...unknown[]],
    );
    const deletes = statements.filter(([sql]) => /^\s*DELETE FROM/.test(sql));
    expect(deletes.map(([sql]) => sql.replace(/\s+/g, ' ').trim())).toEqual([
      'DELETE FROM insulin_basal WHERE source_id = ? AND id IN (?, ?)',
      'DELETE FROM insulin_bolus WHERE source_id = ? AND id IN (?, ?)',
      "DELETE FROM context_events WHERE source_id = ? AND origin = 'imported' AND id IN (?, ?)",
      "DELETE FROM context_notes WHERE source_id = ? AND origin = 'imported' AND id IN (?, ?)",
    ]);
    deletes.forEach(([, ...parameters]) => {
      expect(parameters).toEqual(['nightscout', 'nightscout:bolus:x', 'nightscout:meal:x']);
    });
    // The re-inserted revision is not reported as a new record.
    expect(result.insertedBoluses).toBe(0);
  });
});
