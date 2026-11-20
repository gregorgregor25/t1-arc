import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { readTherapyStatePredecessors } from '@/data/persistence/therapyStatePredecessors';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import { therapyStateEventFromTreatment } from '@/domain/therapyStates';
import {
  THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL,
  THERAPY_STATE_PREDECESSOR_INDEX_SQL,
  THERAPY_STATE_PREDECESSOR_GROUP_SQL,
} from '@/data/persistence/therapyStatePredecessorIndex';

const BEFORE = Date.parse('2030-03-05T00:00:00Z');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE import_raw_records (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, record_kind TEXT NOT NULL,
    timestamp_ms INTEGER, source_file TEXT NOT NULL, source_row INTEGER NOT NULL,
    payload_json TEXT NOT NULL, first_import_batch_id TEXT NOT NULL,
    first_seen_at_ms INTEGER NOT NULL, last_import_batch_id TEXT NOT NULL,
    last_seen_at_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_import_raw_records_source_kind
    ON import_raw_records(source_id, record_kind, timestamp_ms);
  CREATE INDEX idx_import_raw_records_source_time
    ON import_raw_records(source_id, timestamp_ms);`);
  return db;
}

function writer(db: DatabaseSync) {
  const statement = db.prepare(`INSERT INTO import_raw_records
    VALUES (?, ?, 'nightscout-treatment', ?, 'synthetic.json', 1, ?, 'batch', 1, 'batch', 1)`);
  return (id: string, date: number, payload: unknown, source = 'nightscout') =>
    statement.run(id, source, date, typeof payload === 'string' ? payload : JSON.stringify({ date, ...payload as object }));
}

function reader(db: DatabaseSync) {
  const plans: string[] = [];
  let returnedRows = 0;
  const adapter = {
    async getAllAsync(sql: string, ...params: SQLInputValue[]) {
      plans.push(...db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params)
        .map(row => String(row.detail)));
      const rows = db.prepare(sql).all(...params);
      returnedRows += rows.length;
      return rows;
    },
  } as unknown as SQLiteDatabase;
  return { plans, read: () => readTherapyStatePredecessors(adapter, BEFORE),
    get returnedRows() { return returnedRows; } };
}

describe('indexed therapy-state predecessors', () => {
  it('classifies current, older and unknown running modes like the domain parser', () => {
    const db = database();
    try {
      const insert = writer(db);
      const modes = [undefined, '', 'CLOSED_LOOP', 'CLOSED_LOOP_LGS', 'OPEN_LOOP',
        'DISABLED_LOOP', 'SUPER_BOLUS', 'DISCONNECTED_PUMP', 'SUSPENDED_BY_PUMP',
        'SUSPENDED_BY_USER', 'SUSPENDED_BY_DST', 'FUTURE_MODE'];
      const reasons = [undefined, 'DISABLE_LOOP', 'DISCONNECT_PUMP', 'SUSPEND', 'SUPER_BOLUS'];
      for (const [modeIndex, mode] of modes.entries()) {
        for (const [reasonIndex, reason] of reasons.entries()) {
          const id = `mode-${modeIndex}-${reasonIndex}`;
          const treatment = { eventType: 'OpenAPS Offline', date: BEFORE - 1, mode, reason };
          insert(id, BEFORE - 1, treatment);
          const parsed = therapyStateEventFromTreatment(treatment, {
            sourceId: 'nightscout', sourceFile: 'synthetic.json', rawRecordId: id,
          })!;
          expect(db.prepare(`SELECT ${THERAPY_STATE_PREDECESSOR_GROUP_SQL} AS family
            FROM import_raw_records WHERE id = ?`).get(id)?.family)
            .toBe(parsed.temporaryOverlay ? 'loop-overlay' : 'loop-ongoing');
        }
      }
    } finally {
      db.close();
    }
  });

  it('matches domain sanitization of surrounding whitespace and internal controls', () => {
    const db = database();
    try {
      const insert = writer(db);
      const spaces = [0, ...Array.from({ length: 31 }, (_, index) => index + 1), 127,
        160, 5760, ...Array.from({ length: 11 }, (_, index) => 8192 + index),
        8232, 8233, 8239, 8287, 12288, 65279];
      for (const point of spaces) {
        const character = String.fromCodePoint(point);
        const id = `space-${point}`;
        const treatment = {
          eventType: `${character}OpenAPS Offline${character}`,
          mode: `${character}OPEN_LOOP${character}`, date: BEFORE - 1,
        };
        insert(id, BEFORE - 1, treatment);
        expect(therapyStateEventFromTreatment(treatment, {
          sourceId: 'nightscout', sourceFile: 'synthetic.json', rawRecordId: id,
        })).toMatchObject({ kind: 'loop-mode', temporaryOverlay: false });
        expect(db.prepare(`SELECT ${THERAPY_STATE_PREDECESSOR_GROUP_SQL} AS family
          FROM import_raw_records WHERE id = ?`).get(id)?.family)
          .toBe(point < 128 ? 'exceptional' : 'loop-ongoing');
      }
      for (const point of [0, 9, 10, 31, 127]) {
        const id = `internal-${point}`;
        insert(id, BEFORE - 1, {
          eventType: `OpenAPS${String.fromCodePoint(point)}Offline`,
          mode: 'OPEN_LOOP', reason: 'Activity',
        });
        expect(db.prepare(`SELECT ${THERAPY_STATE_PREDECESSOR_GROUP_SQL} AS family
          FROM import_raw_records WHERE id = ?`).get(id)?.family).toBe('exceptional');
      }
    } finally {
      db.close();
    }
  });

  it.each([
    ['\tOpenAPS Offline\n', '\tOPEN_LOOP\n'],
    ['\u00a0OpenAPS Offline\ufeff', '\u2003OPEN_LOOP\u202f'],
    ['\u0000OpenAPS Offline\u0000', '\u0000OPEN_LOOP\u0000'],
    ['OpenAPS\u0000Offline', 'OPEN_LOOP'],
    ['OpenAPS Offline', 'OPEN_\tLOOP'],
  ])('keeps SQLite and memory predecessor reads aligned for %j / %j', async (eventType, mode) => {
    const db = database();
    try {
      const at = BEFORE - 30 * 86_400_000;
      const payload = { eventType, mode, date: at, duration: 0 };
      writer(db)('edge', at, payload);
      db.exec(THERAPY_STATE_PREDECESSOR_INDEX_SQL);
      const memory = new MemoryHealthRecordStore();
      await memory.writeImport({
        id: 'batch', sourceId: 'nightscout', fileName: 'synthetic.json', fileSha256: '0'.repeat(64),
        importedAt: BEFORE, skippedCount: 0, warnings: [],
      }, [], [], [], undefined, [], [{
        id: 'edge', sourceId: 'nightscout', recordKind: 'nightscout-treatment',
        sourceFile: 'synthetic.json', sourceRow: 1, importedAt: BEFORE,
        timestamp: at, payloadJson: JSON.stringify(payload),
      }]);
      expect((await reader(db).read()).map(row => row.id)).toEqual(
        (await memory.getTherapyStateRecords({ start: BEFORE, end: BEFORE + 1 }, true)).map(row => row.id),
      );
      expect((await reader(db).read()).map(row => row.id)).toEqual(['edge']);
    } finally {
      db.close();
    }
  });

  it('seeks rare and absent states in a large pre-existing treatment database', async () => {
    const db = database();
    try {
      const insert = writer(db);
      db.exec('BEGIN');
      for (let index = 0; index < 50_000; index++) {
        insert(`dose-${index}`, BEFORE - (50_000 - index) * 60_000,
          { eventType: index % 2 ? 'Correction Bolus' : 'Carb Correction', insulin: 0.2,
            reason: 'Unrelated source note\nwith another line', mode: 'Unrelated\nmode', type: 'Unrelated\ntype' });
      }
      insert('open', BEFORE - 60 * 86_400_000,
        { eventType: 'OpenAPS Offline', mode: 'OPEN_LOOP', duration: 0 });
      insert('malformed', BEFORE - 1, '{old malformed evidence');
      db.exec('COMMIT');

      const before = db.prepare('SELECT COUNT(*) AS count, SUM(LENGTH(payload_json)) AS bytes FROM import_raw_records').get();
      const baseline = reader(db);
      let started = performance.now();
      expect((await baseline.read()).map(row => row.id)).toEqual(['open']);
      const unindexedMs = performance.now() - started;
      started = performance.now();
      db.exec(THERAPY_STATE_PREDECESSOR_INDEX_SQL);
      const indexCreationMs = performance.now() - started;
      db.exec(THERAPY_STATE_PREDECESSOR_INDEX_SQL);
      expect(db.prepare('SELECT COUNT(*) AS count, SUM(LENGTH(payload_json)) AS bytes FROM import_raw_records').get()).toEqual(before);
      expect(db.prepare(`SELECT COUNT(*) AS count FROM import_raw_records
        INDEXED BY idx_import_raw_therapy_predecessor WHERE ${THERAPY_STATE_PREDECESSOR_ELIGIBLE_SQL}`).get()?.count).toBe(1);

      const indexed = reader(db);
      started = performance.now();
      expect((await indexed.read()).map(row => row.id)).toEqual(['open']);
      const firstIndexedMs = performance.now() - started;
      started = performance.now();
      for (let index = 0; index < 20; index++) await indexed.read();
      const repeatedAverageMs = (performance.now() - started) / 20;
      expect(indexed.plans.every(plan => plan.includes('USING INDEX idx_import_raw_therapy_predecessor'))).toBe(true);
      expect(indexed.returnedRows).toBe(21);
      console.info(JSON.stringify({
        ordinaryRecords: 50_000, indexedTherapyRecords: 1,
        unindexedMs, indexCreationMs, firstIndexedMs, repeatedAverageMs,
        queriesPerRead: indexed.plans.length / 21, returnedRowsPerRead: indexed.returnedRows / 21,
        plan: indexed.plans[0],
      }));
    } finally {
      db.close();
    }
  });

  it('updates the index for corrected, erased and restored raw evidence', async () => {
    const db = database();
    try {
      const insert = writer(db);
      insert('mode', BEFORE - 30 * 86_400_000,
        { eventType: 'OpenAPS Offline', mode: 'UNKNOWN', duration: 0 });
      db.exec(THERAPY_STATE_PREDECESSOR_INDEX_SQL);
      const access = reader(db);
      expect((await access.read()).map(row => row.id)).toEqual(['mode']);
      // A corrected payload has exactly the same source ID and event time.
      db.prepare('UPDATE import_raw_records SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify({ date: BEFORE - 30 * 86_400_000, eventType: 'OpenAPS Offline', mode: 'CLOSED_LOOP', duration: 0 }), 'mode');
      expect(JSON.parse((await access.read())[0]!.payloadJson).mode).toBe('CLOSED_LOOP');
      const backupRow = db.prepare('SELECT * FROM import_raw_records').get()!;
      const columns = db.prepare('PRAGMA table_info(import_raw_records)').all();
      db.exec('DELETE FROM import_raw_records');
      expect(await access.read()).toEqual([]);
      db.prepare('INSERT INTO import_raw_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(...Object.values(backupRow) as SQLInputValue[]);
      expect((await access.read()).map(row => row.id)).toEqual(['mode']);
      expect(db.prepare('PRAGMA table_info(import_raw_records)').all()).toEqual(columns);
    } finally {
      db.close();
    }
  });
});
