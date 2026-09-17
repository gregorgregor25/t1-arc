import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  completePendingEraseSanitization,
  completePendingEraseSanitizationWithRetry,
  ERASE_SANITIZATION_PENDING_KEY,
  EraseSanitizationCheckpointIncompleteError,
  resumePendingEraseSanitizationAtStartup,
  runSecureEraseTransaction,
} from '@/data/persistence/eraseSanitization';

interface FakeDatabaseOptions {
  secureDelete?: unknown;
  pending?: boolean;
  checkpoint?: Record<string, unknown> | null;
  markerRemainsAfterDelete?: boolean;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 't1arc-erase-sanitize-'));
  temporaryDirectories.push(directory);
  return join(directory, 'health.db');
}

function nodeDatabaseAdapter(database: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      database.exec(sql);
    },
    getFirstAsync: async (sql: string, ...parameters: unknown[]) =>
      (database.prepare(sql).get(...(parameters as never[])) ?? null) as
        | Record<string, unknown>
        | null,
    runAsync: async (sql: string, ...parameters: unknown[]) => {
      const result = database.prepare(sql).run(...(parameters as never[]));
      return { changes: Number(result.changes) };
    },
    closeAsync: async () => {
      database.close();
    },
  };
}

function fakeDatabase(options: FakeDatabaseOptions = {}) {
  const events: string[] = [];
  let markerPending = options.pending ?? false;
  const database = {
    execAsync: vi.fn(async (sql: string) => {
      events.push(`exec:${sql.trim().replace(/\s+/g, ' ')}`);
    }),
    getFirstAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      events.push(
        `get:${sql.trim().replace(/\s+/g, ' ')}:${parameters.join(',')}`,
      );
      if (/PRAGMA\s+secure_delete/i.test(sql)) {
        return { secure_delete: options.secureDelete ?? 1 };
      }
      if (/PRAGMA\s+wal_checkpoint/i.test(sql)) {
        return options.checkpoint ?? { busy: 0, log: 0, checkpointed: 0 };
      }
      if (/FROM\s+app_metadata/i.test(sql)) {
        return markerPending ? { value: '1' } : null;
      }
      return null;
    }),
    runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      events.push(
        `run:${sql.trim().replace(/\s+/g, ' ')}:${parameters.join(',')}`,
      );
      if (/INSERT\s+INTO\s+app_metadata/i.test(sql)) markerPending = true;
      if (
        /DELETE\s+FROM\s+app_metadata/i.test(sql) &&
        !options.markerRemainsAfterDelete
      ) {
        markerPending = false;
      }
      return { changes: 1 };
    }),
    closeAsync: vi.fn(async () => {
      events.push('close');
    }),
  };
  return { database, events, markerPending: () => markerPending };
}

describe('local-data erase sanitization', () => {
  it('fails closed before BEGIN when secure_delete cannot be verified', async () => {
    const { database, events } = fakeDatabase({ secureDelete: 0 });
    const erase = vi.fn(async () => undefined);

    await expect(
      runSecureEraseTransaction(database as never, erase),
    ).rejects.toThrow(/secure deletion could not be verified/i);

    expect(erase).not.toHaveBeenCalled();
    expect(events.some((event) => event.includes('BEGIN IMMEDIATE'))).toBe(
      false,
    );
    expect(
      events.some((event) => event.includes(ERASE_SANITIZATION_PENDING_KEY)),
    ).toBe(false);
  });

  it('sets secure_delete before BEGIN and commits the pending marker with the deletes', async () => {
    const { database, events, markerPending } = fakeDatabase();

    await runSecureEraseTransaction(database as never, async (transaction) => {
      await transaction.runAsync('DELETE FROM glucose_readings');
      await transaction.runAsync(
        'INSERT INTO app_metadata (key, value) VALUES (?, ?)',
        'local-data-reset-sentinel-v1',
        '1',
      );
      return 'removed';
    });

    const secureSet = events.findIndex((event) =>
      event.includes('exec:PRAGMA secure_delete = ON'),
    );
    const secureRead = events.findIndex((event) =>
      event.includes('get:PRAGMA secure_delete'),
    );
    const begin = events.findIndex((event) =>
      event.includes('exec:BEGIN IMMEDIATE'),
    );
    const healthDelete = events.findIndex((event) =>
      event.includes('DELETE FROM glucose_readings'),
    );
    const resetSentinel = events.findIndex((event) =>
      event.includes('local-data-reset-sentinel-v1'),
    );
    const pendingMarker = events.findIndex((event) =>
      event.includes(ERASE_SANITIZATION_PENDING_KEY),
    );
    const commit = events.findIndex((event) => event.includes('exec:COMMIT'));

    expect(secureSet).toBeGreaterThanOrEqual(0);
    expect(secureRead).toBeGreaterThan(secureSet);
    expect(begin).toBeGreaterThan(secureRead);
    expect(healthDelete).toBeGreaterThan(begin);
    expect(pendingMarker).toBeGreaterThan(resetSentinel);
    expect(commit).toBeGreaterThan(pendingMarker);
    expect(markerPending()).toBe(true);
  });

  it('rolls back without writing a completion marker when the logical erase fails', async () => {
    const { database, events, markerPending } = fakeDatabase();

    await expect(
      runSecureEraseTransaction(database as never, async () => {
        throw new Error('delete failed');
      }),
    ).rejects.toThrow('delete failed');

    expect(events.some((event) => event.includes('exec:ROLLBACK'))).toBe(true);
    expect(markerPending()).toBe(false);
  });

  it.each([
    [{ busy: 1, log: 4, checkpointed: 0 }, 'busy'],
    [{ busy: 0, log: 4, checkpointed: 3 }, 'incomplete'],
    [{ busy: 0, log: 3, checkpointed: 3 }, 'not truncated'],
    [{ busy: 0, log: 4 }, 'malformed'],
    [{ busy: 0, log: -1, checkpointed: -1 }, 'outside WAL mode'],
  ])(
    'does not clear the marker when a checkpoint is %s',
    async (checkpoint, _description) => {
      const { database, markerPending } = fakeDatabase({
        pending: true,
        checkpoint,
      });

      await expect(
        completePendingEraseSanitization(database as never),
      ).rejects.toBeInstanceOf(
        EraseSanitizationCheckpointIncompleteError,
      );
      expect(database.runAsync).not.toHaveBeenCalled();
      expect(markerPending()).toBe(true);
    },
  );

  it('accepts Expo checkpoint column names case-insensitively and clears only after success', async () => {
    const { database, events, markerPending } = fakeDatabase({
      pending: true,
      checkpoint: { BUSY: 0, LOG: 0, CHECKPOINTED: 0 },
    });

    await expect(
      completePendingEraseSanitization(database as never),
    ).resolves.toBe(true);

    const checkpoint = events.findIndex((event) =>
      event.includes('get:PRAGMA wal_checkpoint(TRUNCATE)'),
    );
    const markerClear = events.findIndex(
      (event) =>
        event.includes('DELETE FROM app_metadata') &&
        event.includes(ERASE_SANITIZATION_PENDING_KEY),
    );
    expect(checkpoint).toBeGreaterThanOrEqual(0);
    expect(markerClear).toBeGreaterThan(checkpoint);
    expect(markerPending()).toBe(false);
  });

  it('does not claim success if the pending marker remains after its delete', async () => {
    const { database } = fakeDatabase({
      pending: true,
      markerRemainsAfterDelete: true,
    });

    await expect(
      completePendingEraseSanitization(database as never),
    ).rejects.toThrow(/marker could not be cleared/i);
  });

  it('retries an equal-nonzero checkpoint on a fresh connection and closes every attempt', async () => {
    const first = fakeDatabase({
      pending: true,
      checkpoint: { busy: 0, log: 2, checkpointed: 2 },
    });
    const second = fakeDatabase({
      pending: true,
      checkpoint: { busy: 0, log: 0, checkpointed: 0 },
    });
    const databases = [first.database, second.database];
    let elapsedMs = 0;

    await expect(
      completePendingEraseSanitizationWithRetry(
        async () => databases.shift() as never,
        {
          maxWaitMs: 100,
          initialDelayMs: 1,
          now: () => elapsedMs,
          sleep: async (delayMs) => {
            elapsedMs += delayMs;
          },
        },
      ),
    ).resolves.toBe(true);

    expect(first.database.closeAsync).toHaveBeenCalledOnce();
    expect(second.database.closeAsync).toHaveBeenCalledOnce();
  });

  it('leaves the marker pending when bounded checkpoint retries are exhausted', async () => {
    const attempt = fakeDatabase({
      pending: true,
      checkpoint: { busy: 0, log: 2, checkpointed: 1 },
    });
    let elapsedMs = 0;

    await expect(
      completePendingEraseSanitizationWithRetry(
        async () => attempt.database as never,
        {
          maxWaitMs: 10,
          initialDelayMs: 10,
          now: () => elapsedMs,
          sleep: async (delayMs) => {
            elapsedMs += delayMs;
          },
        },
      ),
    ).rejects.toBeInstanceOf(
      EraseSanitizationCheckpointIncompleteError,
    );

    expect(attempt.markerPending()).toBe(true);
    expect(attempt.database.closeAsync).toHaveBeenCalledOnce();
  });

  it('resumes a pending marker during startup without recursing on normal opens', async () => {
    const pending = fakeDatabase({ pending: true });
    const complete = vi.fn(async () => true);

    await expect(
      resumePendingEraseSanitizationAtStartup(
        pending.database as never,
        complete,
      ),
    ).resolves.toBe(true);
    expect(complete).toHaveBeenCalledOnce();

    const clean = fakeDatabase({ pending: false });
    complete.mockClear();
    await expect(
      resumePendingEraseSanitizationAtStartup(
        clean.database as never,
        complete,
      ),
    ).resolves.toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it('truncates with an idle startup connection and leaves no pre-erase payload in the marker-clear WAL', async () => {
    const databasePath = temporaryDatabasePath();
    const secret = 'pre-erase-private-health-payload-7e4d993a';
    const startup = new DatabaseSync(databasePath);
    startup.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA secure_delete = ON;
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE private_health_payloads (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO private_health_payloads (payload) VALUES ('${secret}');
      BEGIN IMMEDIATE;
      DELETE FROM private_health_payloads;
      INSERT INTO app_metadata (key, value)
      VALUES ('${ERASE_SANITIZATION_PENDING_KEY}', '1');
      COMMIT;
    `);
    // This models openAndMigrate's completed autocommit reads. The prepared
    // statement is finalized after get(), so the connection stays open but
    // does not retain a WAL snapshot.
    startup.prepare('SELECT COUNT(*) AS count FROM app_metadata').get();
    const checkpoint = new DatabaseSync(databasePath);
    checkpoint.exec('PRAGMA busy_timeout = 0;');

    try {
      await expect(
        resumePendingEraseSanitizationAtStartup(
          nodeDatabaseAdapter(startup) as never,
          () =>
            completePendingEraseSanitization(
              nodeDatabaseAdapter(checkpoint) as never,
            ),
        ),
      ).resolves.toBe(true);
      expect(
        startup
          .prepare('SELECT value FROM app_metadata WHERE key = ?')
          .get(ERASE_SANITIZATION_PENDING_KEY),
      ).toBeUndefined();
    } finally {
      checkpoint.close();
      startup.close();
    }

    for (const path of [databasePath, `${databasePath}-wal`]) {
      if (!existsSync(path)) continue;
      expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    }
  });

  it('fails startup closed behind a real held WAL reader and succeeds after it releases', async () => {
    const databasePath = temporaryDatabasePath();
    const setup = new DatabaseSync(databasePath);
    setup.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE app_metadata (
        key TEXT NOT NULL PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE pages (value TEXT NOT NULL);
      INSERT INTO pages (value) VALUES ('base');
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    const heldReader = new DatabaseSync(databasePath);
    heldReader.exec('BEGIN;');
    heldReader.prepare('SELECT value FROM pages').get();
    setup.exec(`
      INSERT INTO pages (value) VALUES ('new-wal-frame');
      INSERT INTO app_metadata (key, value)
      VALUES ('${ERASE_SANITIZATION_PENDING_KEY}', '1');
    `);
    const startup = new DatabaseSync(databasePath);
    const checkpoint = new DatabaseSync(databasePath);
    checkpoint.exec('PRAGMA busy_timeout = 0;');

    try {
      await expect(
        resumePendingEraseSanitizationAtStartup(
          nodeDatabaseAdapter(startup) as never,
          () =>
            completePendingEraseSanitization(
              nodeDatabaseAdapter(checkpoint) as never,
            ),
        ),
      ).rejects.toBeInstanceOf(
        EraseSanitizationCheckpointIncompleteError,
      );
      expect(
        setup
          .prepare('SELECT value FROM app_metadata WHERE key = ?')
          .get(ERASE_SANITIZATION_PENDING_KEY),
      ).toEqual({ value: '1' });

      heldReader.exec('ROLLBACK;');
      await expect(
        resumePendingEraseSanitizationAtStartup(
          nodeDatabaseAdapter(startup) as never,
          () =>
            completePendingEraseSanitization(
              nodeDatabaseAdapter(checkpoint) as never,
            ),
        ),
      ).resolves.toBe(true);
    } finally {
      checkpoint.close();
      startup.close();
      if (heldReader.isOpen) heldReader.close();
      setup.close();
    }
  });
});
