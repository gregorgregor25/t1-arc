import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS } from '@/data/persistence/GlucoseHistoryStore';

import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';

const fake = vi.hoisted(() => {
  type Row = {
    source_id: string;
    last_attempt_at_ms: number | null;
    last_success_at_ms: number | null;
    last_error_code: string | null;
    last_error_message: string | null;
    record_count: number;
  };
  let row: Row | undefined;
  let readings: { sourceId: string; timestamp: number }[] = [];
  const transaction = {
    getFirstAsync: vi.fn(async () => (row ? { ...row } : null)),
    runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (sql.includes('DELETE FROM glucose_readings')) {
        const [sourceId, minimum, maximum] = parameters as [
          string,
          number,
          number,
        ];
        const before = readings.length;
        readings = readings.filter(
          (reading) =>
            reading.sourceId !== sourceId ||
            (reading.timestamp >= minimum && reading.timestamp <= maximum),
        );
        return { changes: before - readings.length, lastInsertRowId: 0 };
      }
      if (sql.includes('SET last_attempt_at_ms = ?') && row) {
        row.last_attempt_at_ms = parameters[0] as number;
      }
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };
  return {
    database: {},
    transaction,
    setRow(next: Row) {
      row = { ...next };
    },
    getRow() {
      return row ? { ...row } : undefined;
    },
    setReadings(next: { sourceId: string; timestamp: number }[]) {
      readings = next.map((reading) => ({ ...reading }));
    },
    getReadings() {
      return readings.map((reading) => ({ ...reading }));
    },
    reset() {
      row = undefined;
      readings = [];
      transaction.getFirstAsync.mockClear();
      transaction.runAsync.mockClear();
    },
  };
});

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => fake.database),
  withT1ArcTransaction: vi.fn(
    async (task: (transaction: typeof fake.transaction) => Promise<unknown>) =>
      task(fake.transaction),
  ),
}));

describe('SQLite glucose source lease', () => {
  beforeEach(() => fake.reset());

  it('routes non-CAS sync-state writes through the transaction lane', async () => {
    const store = new SqliteGlucoseHistoryStore();

    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: 100,
      lastSuccessAt: 100,
      recordCount: 1,
    });

    expect(fake.transaction.runAsync).toHaveBeenCalledOnce();
    expect(fake.transaction.runAsync.mock.calls[0]?.[0]).toContain(
      'INSERT INTO source_sync_state',
    );
  });

  it('reclaims an attempt left implausibly in the future', async () => {
    const now = 1_000_000;
    const future = now + SOURCE_SYNC_CLOCK_ROLLBACK_TOLERANCE_MS + 1;
    fake.setRow({
      source_id: 't1arc-librelinkup',
      last_attempt_at_ms: future,
      last_success_at_ms: 900_000,
      last_error_code: 'network',
      last_error_message: 'Offline',
      record_count: 12,
    });
    const store = new SqliteGlucoseHistoryStore();

    await expect(
      store.claimSyncAttempt('t1arc-librelinkup', now, 60_000, {
        sourceId: 't1arc-librelinkup',
        lastAttemptAt: future,
        lastSuccessAt: 900_000,
        lastErrorCode: 'network',
        lastErrorMessage: 'Offline',
        recordCount: 12,
      }),
    ).resolves.toBe(true);
    expect(fake.getRow()?.last_attempt_at_ms).toBe(now);
  });

  it('does not claim from retry policy state that changed before the transaction', async () => {
    fake.setRow({
      source_id: 't1arc-librelinkup',
      last_attempt_at_ms: 100,
      last_success_at_ms: 90,
      last_error_code: 'rate-limited',
      last_error_message: 'Wait before retrying',
      record_count: 12,
    });
    const store = new SqliteGlucoseHistoryStore();

    await expect(
      store.claimSyncAttempt('t1arc-librelinkup', 60_100, 60_000, {
        sourceId: 't1arc-librelinkup',
        lastAttemptAt: 100,
        lastSuccessAt: 90,
        recordCount: 12,
      }),
    ).resolves.toBe(false);
    expect(fake.transaction.runAsync).not.toHaveBeenCalled();
  });

  it('atomically prunes only out-of-range source rows and preserves sync state', async () => {
    fake.setRow({
      source_id: 'nightscout',
      last_attempt_at_ms: 100,
      last_success_at_ms: 90,
      last_error_code: 'network',
      last_error_message: 'Offline',
      record_count: 5,
    });
    fake.setReadings([
      { sourceId: 'nightscout', timestamp: 999 },
      { sourceId: 'nightscout', timestamp: 1_000 },
      { sourceId: 'nightscout', timestamp: 2_000 },
      { sourceId: 'nightscout', timestamp: 3_000 },
      { sourceId: 'nightscout', timestamp: 3_001 },
      { sourceId: 'other', timestamp: 4_000 },
    ]);
    const store = new SqliteGlucoseHistoryStore();

    await expect(
      store.pruneReadingsOutsideRange('nightscout', 1_000, 3_000),
    ).resolves.toBe(2);

    expect(fake.getReadings()).toEqual([
      { sourceId: 'nightscout', timestamp: 1_000 },
      { sourceId: 'nightscout', timestamp: 2_000 },
      { sourceId: 'nightscout', timestamp: 3_000 },
      { sourceId: 'other', timestamp: 4_000 },
    ]);
    expect(fake.getRow()).toEqual({
      source_id: 'nightscout',
      last_attempt_at_ms: 100,
      last_success_at_ms: 90,
      last_error_code: 'network',
      last_error_message: 'Offline',
      record_count: 5,
    });
    expect(fake.transaction.runAsync).toHaveBeenCalledOnce();
    const [sql, ...parameters] = fake.transaction.runAsync.mock.calls[0] ?? [];
    expect(String(sql).replace(/\s+/g, ' ').trim()).toBe(
      'DELETE FROM glucose_readings WHERE source_id = ? AND (timestamp_ms < ? OR timestamp_ms > ?)',
    );
    expect(parameters).toEqual(['nightscout', 1_000, 3_000]);
  });
});
