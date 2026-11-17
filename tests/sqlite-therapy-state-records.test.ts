import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';
import { therapyStatesForRange } from '@/domain/therapyStates';

const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: async () => state.database,
  withT1ArcTransaction: async (
    work: (database: unknown) => Promise<unknown>,
  ) => {
    const adapter = state.database as Adapter;
    adapter.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(adapter);
      adapter.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      adapter.sqlite.exec('ROLLBACK');
      throw error;
    }
  },
}));

class Adapter {
  failContext = false;
  constructor(readonly sqlite: DatabaseSync) {}
  async runAsync(sql: string, ...params: SQLInputValue[]) {
    if (
      this.failContext &&
      sql.includes('INSERT OR IGNORE INTO context_events')
    )
      throw new Error('fixture write failure');
    const result = this.sqlite.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }
  async getFirstAsync(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).get(...params) ?? null;
  }
  async getAllAsync(sql: string, ...params: SQLInputValue[]) {
    return this.sqlite.prepare(sql).all(...params);
  }
}

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => '0'.repeat(64)),
}));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse('2026-11-10T17:00:00Z');

function treatment(duration: number) {
  return {
    _id: 'tt-activity',
    created_at: '2026-11-10T17:00:00.000Z',
    date: T0,
    eventType: 'Temporary Target',
    reason: 'Activity',
    targetBottom: 140,
    targetTop: 140,
    units: 'mg/dl',
    duration,
  };
}

async function save(
  store: SqliteHealthRecordStore,
  name: string,
  importedAt: number,
  treatments: Record<string, unknown>[],
) {
  const normalized = normalizeNightscoutTreatments(treatments, [], importedAt);
  await store.writeImport(
    {
      id: `nightscout:${name}`,
      sourceId: 'nightscout',
      fileName: name,
      fileSha256: name.padEnd(64, '0'),
      importedAt,
      skippedCount: 0,
      warnings: [],
    },
    normalized.basal,
    normalized.boluses,
    normalized.context,
    undefined,
    [],
    normalized.rawRecords,
    { revisedRecordIds: normalized.revisedRecordIds },
  );
}

describe('therapy-state records in real SQLite', () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    // Windows checkouts may use CRLF line endings.
    const schema = readFileSync('src/data/persistence/t1arcDatabase.ts', 'utf8').replace(/\r\n/g, '\n');
    for (const table of [
      'insulin_basal',
      'insulin_bolus',
      'insulin_daily_totals',
      'context_events',
      'context_notes',
      'import_batches',
      'import_source_payloads',
      'import_raw_records',
      'glooko_report_payloads',
      'health_connect_sources',
      'app_metadata',
    ]) {
      const sql = schema.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n    \\);`),
      )?.[0];
      if (!sql) throw new Error(`Production schema not found: ${table}`);
      sqlite.exec(sql);
    }
    state.database = new Adapter(sqlite);
  });
  afterEach(() => sqlite.close());

  it('returns only therapy-state candidates and keeps the newest copy of a shortened record', async () => {
    const store = new SqliteHealthRecordStore();
    await save(store, 'first', T0 + MINUTE, [
      treatment(90),
      { _id: 'smb', created_at: '2026-11-10T17:05:00.000Z', date: T0 + 5 * MINUTE, eventType: 'Correction Bolus', insulin: 0.3 },
    ]);
    // AAPS cancelled the target after 20 minutes and re-uploaded the record.
    await save(store, 'second', T0 + 30 * MINUTE, [treatment(20)]);
    // An older copy arriving late must not overwrite the newer one.
    await save(store, 'stale', T0 + 10 * MINUTE, [treatment(90)]);

    const records = await store.getTherapyStateRecords({ start: T0 - HOUR, end: T0 + HOUR });
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]!.payloadJson)).toMatchObject({ duration: 20 });
    const [state] = therapyStatesForRange(records, { start: T0 - HOUR, end: T0 + 3 * HOUR }, T0 + 3 * HOUR);
    expect(state).toMatchObject({
      kind: 'temporary-target',
      targetReason: 'activity',
      end: T0 + 20 * MINUTE,
      endBasis: 'programmed',
    });
    expect(await store.getTherapyStateRecords({ start: T0 + HOUR, end: T0 + 2 * HOUR })).toEqual([]);
  });
});
