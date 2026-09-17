export const NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY =
  'notification-evidence-provenance-v1';

interface NotificationEvidenceProvenanceDatabase {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...parameters: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...parameters: unknown[]): Promise<T | null>;
  runAsync(
    sql: string,
    ...parameters: unknown[]
  ): Promise<{ changes: number }>;
}

const RECONCILIATION_SCOPE_DECLARATION = `TEXT NOT NULL DEFAULT 'local' CHECK (
  reconciliation_scope IN ('local', 'restored', 'unknown')
)`;

const NOTIFICATION_SOURCE_EVENTS_WITH_PROVENANCE_SQL = `
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
    reconciliation_scope ${RECONCILIATION_SCOPE_DECLARATION},
    imported_at_ms INTEGER NOT NULL
  )`;

const NOTIFICATION_SOURCE_EVENT_COLUMNS = `
  id, package_name, posted_at_ms, notification_when_ms,
  received_at_ms, is_ongoing, payload_json, parser_version,
  parsed_glucose_id, parsed_iob_units, parsed_pump_mode,
  reconciliation_scope, imported_at_ms`;

async function rebuildTwoWayScopeTable(
  database: NotificationEvidenceProvenanceDatabase,
) {
  await database.execAsync(`
    DROP INDEX IF EXISTS idx_notification_source_package_time;
    DROP INDEX IF EXISTS idx_notification_source_imported;
    DROP INDEX IF EXISTS idx_notification_source_received;

    ALTER TABLE notification_source_events
      RENAME TO notification_source_events_before_provenance_v2;

    ${NOTIFICATION_SOURCE_EVENTS_WITH_PROVENANCE_SQL};

    INSERT INTO notification_source_events (
      ${NOTIFICATION_SOURCE_EVENT_COLUMNS}
    )
    SELECT
      id, package_name, posted_at_ms, notification_when_ms,
      received_at_ms, is_ongoing, payload_json, parser_version,
      parsed_glucose_id, parsed_iob_units, parsed_pump_mode,
      CASE reconciliation_scope
        WHEN 'restored' THEN 'restored'
        ELSE 'unknown'
      END,
      imported_at_ms
    FROM notification_source_events_before_provenance_v2;

    DROP TABLE notification_source_events_before_provenance_v2;

    CREATE INDEX idx_notification_source_package_time
      ON notification_source_events(package_name, posted_at_ms);
    CREATE INDEX idx_notification_source_imported
      ON notification_source_events(imported_at_ms);
    CREATE INDEX idx_notification_source_received
      ON notification_source_events(received_at_ms, id);
  `);
}

function supportsThreeWayScope(sql: string | null | undefined) {
  return Boolean(
    sql?.includes('reconciliation_scope') && sql.includes("'unknown'"),
  );
}

async function hasCompletedThreeWayScope(
  database: NotificationEvidenceProvenanceDatabase,
) {
  const marker = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY,
  );
  if (marker?.value !== 'complete') return false;
  const table = await database.getFirstAsync<{ sql: string | null }>(
    `SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'notification_source_events'`,
  );
  return supportsThreeWayScope(table?.sql);
}

/**
 * Adds notification evidence provenance and classifies every pre-marker local
 * row as unknown in the same SQLite transaction. The durable marker prevents a
 * later app open from reclassifying captures written after migration.
 */
export async function ensureNotificationEvidenceProvenance(
  database: NotificationEvidenceProvenanceDatabase,
) {
  // Current installations only take two read locks. Do not make a routine app
  // or Headless JS open compete with the latency-critical glucose writer.
  if (await hasCompletedThreeWayScope(database)) return;

  await database.execAsync('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const columns = await database.getAllAsync<{ name: string }>(
      'PRAGMA table_info("notification_source_events")',
    );
    const table = await database.getFirstAsync<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'notification_source_events'`,
    );
    const marker = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key = ?',
      NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY,
    );
    const hadScope = columns.some(
      (column) => column.name === 'reconciliation_scope',
    );
    const supportsUnknown = supportsThreeWayScope(table?.sql);
    const complete = marker?.value === 'complete';

    if (!hadScope) {
      await database.execAsync(
        `ALTER TABLE notification_source_events
           ADD COLUMN reconciliation_scope ${RECONCILIATION_SCOPE_DECLARATION}`,
      );
    } else if (!supportsUnknown) {
      // A development build briefly shipped a two-way CHECK constraint. Rebuild
      // it transactionally so an interrupted upgrade cannot strand default-local
      // legacy rows or a schema that rejects the honest unknown state.
      await rebuildTwoWayScopeTable(database);
    }

    if (!complete || !hadScope || !supportsUnknown) {
      await database.runAsync(
        `UPDATE notification_source_events
            SET reconciliation_scope = 'unknown'
          WHERE reconciliation_scope = 'local'`,
      );
      await database.runAsync(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        NOTIFICATION_EVIDENCE_PROVENANCE_MIGRATION_KEY,
        'complete',
      );
    }

    await database.execAsync('COMMIT;');
  } catch (error) {
    await database.execAsync('ROLLBACK;').catch(() => undefined);
    throw error;
  }
}
