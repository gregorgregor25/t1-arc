import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';
import { therapyStatesForRange } from '@/domain/therapyStates';
import { ImportedInsulinSource } from '@/data/live/ImportedInsulinSource';
import { THERAPY_STATE_PREDECESSOR_INDEX_SQL } from '@/data/persistence/therapyStatePredecessorIndex';

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
    sqlite.exec(THERAPY_STATE_PREDECESSOR_INDEX_SQL);
  });
  afterEach(() => sqlite.close());

  it('reads existing and newly imported Nightscout basal percentages without changing backup values', async () => {
    const store = new SqliteHealthRecordStore();
    const insertLegacy = sqlite.prepare(`INSERT INTO insulin_basal
      (id, source_id, start_ms, end_ms, rate_units_per_hour, units, percentage, imported_at_ms)
      VALUES (?, ?, ?, ?, 0.5, 0.25, ?, ?)`);
    insertLegacy.run('ns-old', 'nightscout', T0, T0 + 30 * MINUTE, -25, T0);
    insertLegacy.run('glooko-old', 'glooko', T0, T0 + 30 * MINUTE, 75, T0);
    await save(store, 'new-basal', T0 + HOUR, [
      { _id: 'new', eventType: 'Temp Basal', date: T0 + 30 * MINUTE, duration: 30, rate: 0.5, percent: 25 },
    ]);

    const readings = await store.getBasalDeliveries({ start: T0, end: T0 + HOUR });
    expect(readings).toHaveLength(3);
    expect(readings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ns-old', percentage: 75, units: 0.25 }),
      expect.objectContaining({ id: 'glooko-old', percentage: 75, units: 0.25 }),
      expect.objectContaining({ id: 'nightscout:basal:new', percentage: 125, units: 0.25 }),
    ]));
    expect(sqlite.prepare('SELECT percentage FROM insulin_basal WHERE id = ?')
      .get('nightscout:basal:new')?.percentage).toBe(25);
  });

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

  it('loads multiweek predecessors through the normal source without parsing intervening doses', async () => {
    const store = new SqliteHealthRecordStore();
    const day = 24 * HOUR;
    const now = T0 + 40 * day;
    await save(store, 'earlier', now, [
      { _id: 'open', date: T0, eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 },
      { _id: 'profile-old', date: T0, eventType: 'Profile Switch', profile: 'Example', percentage: 70, originalDuration: 0 },
      { _id: 'profile-new', date: T0 + day, eventType: 'Profile Switch', profile: 'Example', percentage: 85, originalDuration: 0 },
      { _id: 'overlay', date: T0 + 2 * day, eventType: 'OpenAPS Offline', mode: 'SUSPENDED_BY_USER', duration: 30 },
      ...Array.from({ length: 100 }, (_, index) => ({
        _id: `smb-${index}`, date: T0 + (index + 1) * HOUR,
        eventType: 'Correction Bolus', insulin: 0.2,
      })),
    ]);
    const range = { start: now - day, end: now };
    const records = await store.getTherapyStateRecords(range, true);
    expect(records).toHaveLength(3);
    expect(records.every(record => !record.id.includes('smb-'))).toBe(true);
    const source = new ImportedInsulinSource(store, undefined, [], () => now);
    expect(await source.getTherapyStates(range)).toEqual([
      expect.objectContaining({ loopMode: 'open-loop', start: T0, end: now }),
      expect.objectContaining({ percentage: 85, start: T0 + day, end: now }),
    ]);
  });

  it('continues past withdrawn predecessors and respects an old cross-route resume', async () => {
    const store = new SqliteHealthRecordStore();
    const day = 24 * HOUR;
    const now = T0 + 100 * day;
    await save(store, 'older', now, [
      { _id: 'open', date: T0, eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 },
      { _id: 'suspend', date: T0, eventType: 'Pump Suspend' },
      ...Array.from({ length: 65 }, (_, index) => ({
        _id: `withdrawn-${index}`, date: T0 + (index + 1) * day,
        eventType: 'OpenAPS Offline', mode: 'CLOSED_LOOP', duration: 0, isValid: false,
      })),
    ]);
    const insert = sqlite.prepare(`INSERT INTO import_raw_records
      (id, source_id, record_kind, timestamp_ms, source_file, source_row, payload_json,
       first_import_batch_id, first_seen_at_ms, last_import_batch_id, last_seen_at_ms)
      VALUES (?, 'aaps-local', 'aaps-local-treatment', ?, 'phone sender unverified', 1, ?, 'local', ?, 'local', ?)`);
    insert.run('local-resume', T0 + 70 * day,
      JSON.stringify({ eventType: 'Pump Resume', date: T0 + 70 * day }), now, now);
    const source = new ImportedInsulinSource(store, undefined, [], () => now);
    expect(await source.getTherapyStates({ start: now - day, end: now })).toEqual([
      expect.objectContaining({ loopMode: 'open-loop', start: T0, end: now }),
    ]);
  });
});
