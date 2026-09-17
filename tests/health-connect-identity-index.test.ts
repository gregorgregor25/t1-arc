import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEALTH_CONNECT_IDENTITY_INDEX_SQL } from '@/data/persistence/healthConnectIdentityIndex';
import { resolveAndPromoteHealthConnectRecordId } from '@/data/healthConnect/healthConnectReconciliation';
import type { HealthConnectRecord } from '../modules/t1arc-health-connect/src/T1ArcHealthConnect.types';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE health_connect_records (
    id TEXT PRIMARY KEY, external_id TEXT NOT NULL, parent_external_id TEXT,
    kind TEXT NOT NULL, source_package TEXT NOT NULL,
    start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
    payload_json TEXT NOT NULL, reconciliation_scope TEXT NOT NULL,
    UNIQUE(kind, source_package, external_id));
    CREATE INDEX idx_health_connect_kind_time ON health_connect_records(kind,start_ms,end_ms);
    CREATE INDEX idx_health_connect_source_time ON health_connect_records(source_package,start_ms);`);
  const plans: string[] = [];
  const adapter = {
    getAllAsync: async <T>(sql: string, ...params: SQLInputValue[]) => {
      plans.push(...db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params)
        .map((row) => String(row.detail)));
      return db.prepare(sql).all(...params) as T[];
    },
    runAsync: async (sql: string, ...params: SQLInputValue[]) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
  };
  const insert = (id: string, client: string | null, source = 'example.health') =>
    db.prepare('INSERT INTO health_connect_records VALUES (?, ?, NULL, ?, ?, 1, 2, ?, ?)')
      .run(id, id, 'nutrition', source, client === null ? '{invalid legacy JSON' : JSON.stringify({clientRecordId:client}), 'restored');
  const record: HealthConnectRecord = {
    externalId: 'new-store-id', kind: 'nutrition', sourcePackage: 'example.health',
    startTimeMs: 1, endTimeMs: 2, lastModifiedTimeMs: 3,
    recordingMethod: 1, clientRecordId: 'provider-match', clientRecordVersion: 1,
  };
  return {db, plans, adapter, insert, record};
}

describe('indexed portable Health Connect identity', () => {
  it('seeks the full provider identity rather than scanning a restored category', async () => {
    const {db, plans, adapter, insert, record} = fixture();
    try {
      db.exec('BEGIN');
      for(let i=0;i<10000;i++) insert('retained-'+i, 'provider-'+i);
      insert('match', '  provider-match  ');
      insert('invalid', null);
      insert('different-source', 'provider-match', 'example.other');
      db.exec('COMMIT');
      const before = db.prepare('SELECT * FROM health_connect_records ORDER BY id').all();
      db.exec(HEALTH_CONNECT_IDENTITY_INDEX_SQL);
      db.exec(HEALTH_CONNECT_IDENTITY_INDEX_SQL);
      expect(db.prepare('SELECT * FROM health_connect_records ORDER BY id').all()).toEqual(before);
      expect(await resolveAndPromoteHealthConnectRecordId(adapter,record,'unused')).toBe('match');
      expect(plans.some((plan) => /idx_health_connect_provider_identity.*<expr>=\?/.test(plan))).toBe(true);
      expect(db.prepare('SELECT reconciliation_scope FROM health_connect_records WHERE id=?').get('match'))
        .toEqual({reconciliation_scope:'current'});
      expect(db.prepare('SELECT reconciliation_scope FROM health_connect_records WHERE id=?').get('different-source'))
        .toEqual({reconciliation_scope:'restored'});
      // Expression index follows ordinary upserts; no stale side table/cache.
      db.prepare('UPDATE health_connect_records SET payload_json=? WHERE id=?')
        .run(JSON.stringify({clientRecordId:'changed'}),'match');
      expect(await resolveAndPromoteHealthConnectRecordId(adapter,record,'new-row')).toBe('new-row');
    } finally { db.close(); }
  });

  it('retains ambiguity rejection with the index present', async () => {
    const {db,adapter,insert,record} = fixture();
    try {
      insert('one','provider-match'); insert('two','provider-match');
      db.exec(HEALTH_CONNECT_IDENTITY_INDEX_SQL);
      await expect(resolveAndPromoteHealthConnectRecordId(adapter,record,'unused')).rejects.toThrow(/ambiguous/);
      expect(db.prepare('SELECT COUNT(*) AS n FROM health_connect_records WHERE reconciliation_scope=?').get('restored'))
        .toEqual({n:2});
    } finally { db.close(); }
  });

  it('installs the index on upgrades after legacy table reconstruction', () => {
    const source = readFileSync(new URL('../src/data/persistence/t1arcDatabase.ts',import.meta.url),'utf8');
    const migration = source.indexOf('await ensureHealthConnectExtendedKinds(database)');
    const index = source.indexOf('await database.execAsync(HEALTH_CONNECT_IDENTITY_INDEX_SQL)');
    expect(index).toBeGreaterThan(migration);
    expect(index).toBeLessThan(source.indexOf('`PRAGMA user_version ='));
  });
});
