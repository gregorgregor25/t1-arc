import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import {
  ensureNotificationEvidenceProvenance,
  NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY,
} from '@/data/persistence/notificationEvidenceProvenanceMigration';

function databaseAdapter(database: DatabaseSync, options?: { failBackfill?: boolean }) {
  let failBackfill = options?.failBackfill ?? false;
  const statements: string[] = [];
  return {
    statements,
    execAsync: async (sql: string) => {
      statements.push(sql);
      database.exec(sql);
    },
    getAllAsync: async <T>(sql: string, ...parameters: unknown[]) => {
      statements.push(sql);
      return database
        .prepare(sql)
        .all(...(parameters as SQLInputValue[])) as T[];
    },
    getFirstAsync: async <T>(sql: string, ...parameters: unknown[]) => {
      statements.push(sql);
      return (database
        .prepare(sql)
        .get(...(parameters as SQLInputValue[])) ?? null) as T | null;
    },
    runAsync: async (sql: string, ...parameters: unknown[]) => {
      statements.push(sql);
      if (failBackfill && sql.includes('UPDATE notification_source_events')) {
        failBackfill = false;
        throw new Error('simulated interruption');
      }
      const result = database
        .prepare(sql)
        .run(...(parameters as SQLInputValue[]));
      return { changes: Number(result.changes) };
    },
  };
}

function createLegacySchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE app_metadata (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE notification_source_events (
      id TEXT NOT NULL PRIMARY KEY
    );
    INSERT INTO notification_source_events (id) VALUES ('legacy-event');
  `);
}

function columnNames(database: DatabaseSync) {
  return database
    .prepare('PRAGMA table_info("notification_source_events")')
    .all()
    .map((row) => String(row.name));
}

describe('notification evidence provenance migration', () => {
  it('rolls back the added column and marker when the unknown backfill is interrupted', async () => {
    const database = new DatabaseSync(':memory:');
    createLegacySchema(database);

    await expect(
      ensureNotificationEvidenceProvenance(
        databaseAdapter(database, { failBackfill: true }),
      ),
    ).rejects.toThrow('simulated interruption');

    expect(columnNames(database)).not.toContain('reconciliation_scope');
    expect(
      database
        .prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY),
    ).toBeUndefined();
    database.close();
  });

  it('atomically adds, backfills unknown, marks completion, then preserves later local rows', async () => {
    const database = new DatabaseSync(':memory:');
    createLegacySchema(database);
    const first = databaseAdapter(database);

    await ensureNotificationEvidenceProvenance(first);

    expect(
      database
        .prepare(
          'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
        )
        .get('legacy-event'),
    ).toEqual({ reconciliation_scope: 'unknown' });
    expect(
      database
        .prepare('SELECT value FROM app_metadata WHERE key = ?')
        .get(NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY),
    ).toEqual({ value: 'complete' });

    const begin = first.statements.findIndex((sql) => /BEGIN IMMEDIATE/i.test(sql));
    const alter = first.statements.findIndex((sql) => /ALTER TABLE/i.test(sql));
    const backfill = first.statements.findIndex((sql) =>
      /UPDATE notification_source_events/i.test(sql),
    );
    const marker = first.statements.findIndex((sql) =>
      /INSERT INTO app_metadata/i.test(sql),
    );
    const commit = first.statements.findIndex((sql) => /^COMMIT/i.test(sql.trim()));
    expect(begin).toBeLessThan(alter);
    expect(alter).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(marker);
    expect(marker).toBeLessThan(commit);

    database
      .prepare(
        `INSERT INTO notification_source_events (id, reconciliation_scope)
         VALUES (?, 'local')`,
      )
      .run('new-local-event');
    await ensureNotificationEvidenceProvenance(databaseAdapter(database));
    expect(
      database
        .prepare(
          'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
        )
        .get('new-local-event'),
    ).toEqual({ reconciliation_scope: 'local' });
    database.close();
  });

  it('recovers an already-added unmarked column without trusting default-local legacy rows', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE notification_source_events (
        id TEXT NOT NULL PRIMARY KEY,
        reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
          reconciliation_scope IN ('local', 'restored', 'unknown')
        )
      );
      INSERT INTO notification_source_events (id) VALUES ('partial-event');
    `);

    await ensureNotificationEvidenceProvenance(databaseAdapter(database));

    expect(
      database
        .prepare(
          'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
        )
        .get('partial-event'),
    ).toEqual({ reconciliation_scope: 'unknown' });
    database.close();
  });

  it('upgrades the former two-way constraint while preserving known restored rows', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE notification_source_events (
        id TEXT NOT NULL PRIMARY KEY,
        package_name TEXT NOT NULL,
        posted_at_ms INTEGER NOT NULL,
        notification_when_ms INTEGER,
        received_at_ms INTEGER NOT NULL,
        is_ongoing INTEGER NOT NULL CHECK (is_ongoing IN (0, 1)),
        payload_json TEXT NOT NULL,
        parser_version INTEGER NOT NULL,
        parsed_glucose_id TEXT,
        parsed_iob_units REAL,
        parsed_pump_mode TEXT,
        reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
          reconciliation_scope IN ('local', 'restored')
        ),
        imported_at_ms INTEGER NOT NULL
      );
      CREATE INDEX idx_notification_source_package_time
        ON notification_source_events(package_name, posted_at_ms);
      CREATE INDEX idx_notification_source_imported
        ON notification_source_events(imported_at_ms);
      CREATE INDEX idx_notification_source_received
        ON notification_source_events(received_at_ms, id);
      INSERT INTO notification_source_events VALUES
        ('legacy-local', 'package', 1, NULL, 2, 1, '{}', 1, NULL, NULL, NULL, 'local', 3),
        ('known-restored', 'package', 4, NULL, 5, 1, '{}', 1, NULL, NULL, NULL, 'restored', 6);
    `);

    await ensureNotificationEvidenceProvenance(databaseAdapter(database));

    expect(
      database
        .prepare(
          `SELECT id, reconciliation_scope
             FROM notification_source_events
            ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: 'known-restored', reconciliation_scope: 'restored' },
      { id: 'legacy-local', reconciliation_scope: 'unknown' },
    ]);
    const table = database
      .prepare(
        `SELECT sql FROM sqlite_master
          WHERE type = 'table' AND name = 'notification_source_events'`,
      )
      .get() as { sql: string };
    expect(table.sql).toContain("'unknown'");
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND name LIKE 'idx_notification_source_%'
            ORDER BY name`,
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      'idx_notification_source_imported',
      'idx_notification_source_package_time',
      'idx_notification_source_received',
    ]);
    database.close();
  });

  it('uses a read-only fast path once the durable three-way schema marker is complete', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE notification_source_events (
        id TEXT NOT NULL PRIMARY KEY,
        reconciliation_scope TEXT NOT NULL DEFAULT 'local' CHECK (
          reconciliation_scope IN ('local', 'restored', 'unknown')
        )
      );
      INSERT INTO app_metadata (key, value)
      VALUES ('${NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY}', 'complete');
      INSERT INTO notification_source_events (id) VALUES ('current-local');
    `);
    const adapter = databaseAdapter(database);

    await ensureNotificationEvidenceProvenance(adapter);

    expect(adapter.statements.some((sql) => /BEGIN|COMMIT|ROLLBACK/i.test(sql))).toBe(
      false,
    );
    expect(
      adapter.statements.some((sql) => /ALTER|UPDATE|INSERT/i.test(sql)),
    ).toBe(false);
    expect(
      database
        .prepare(
          'SELECT reconciliation_scope FROM notification_source_events WHERE id = ?',
        )
        .get('current-local'),
    ).toEqual({ reconciliation_scope: 'local' });
    database.close();
  });
});
