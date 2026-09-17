import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isSqliteBusyError,
  retrySqliteBusy,
} from '@/data/persistence/sqliteBusyRetry';

const temporaryDirectories: string[] = [];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 't1arc-sqlite-lock-'));
  temporaryDirectories.push(directory);
  return join(directory, 'concurrency.db');
}

function waitForWorkerMessage(worker: Worker, expected: string) {
  return new Promise<void>((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (message !== expected) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLite busy retry', () => {
  it('retries a real concurrent writer after the lock owner commits', async () => {
    const databasePath = temporaryDatabasePath();
    const database = new DatabaseSync(databasePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 0;
      CREATE TABLE writes (value TEXT NOT NULL);
    `);

    const holder = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        const database = new DatabaseSync(workerData.databasePath);
        database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;');
        database.prepare('INSERT INTO writes (value) VALUES (?)').run('holder');
        parentPort.postMessage('locked');
        parentPort.once('message', (message) => {
          if (message !== 'release') return;
          database.exec('COMMIT');
          database.close();
          parentPort.postMessage('released');
        });
      `,
      { eval: true, workerData: { databasePath } },
    );
    const released = waitForWorkerMessage(holder, 'released');

    try {
      await waitForWorkerMessage(holder, 'locked');
      let attempts = 0;
      await retrySqliteBusy(
        async () => {
          attempts += 1;
          try {
            database.exec(
              `BEGIN IMMEDIATE;
               INSERT INTO writes (value) VALUES ('retried');
               COMMIT;`,
            );
          } catch (error) {
            if (attempts === 1) holder.postMessage('release');
            throw error;
          }
        },
        { maxWaitMs: 2_000, initialDelayMs: 10, maximumDelayMs: 50 },
      );
      await released;

      expect(attempts).toBeGreaterThan(1);
      expect(
        database.prepare('SELECT value FROM writes ORDER BY rowid').all(),
      ).toEqual([{ value: 'holder' }, { value: 'retried' }]);
    } finally {
      database.close();
      await holder.terminate();
    }
  });

  it('recognises the Android native-statement lock wording', () => {
    expect(
      isSqliteBusyError(
        new Error(
          'NativeStatement.finalizeAsync rejected: database is locked',
        ),
      ),
    ).toBe(true);
  });

  it('does not begin another operation after sleep exhausts the budget', async () => {
    const lockError = new Error('database is locked');
    let elapsedMs = 0;
    let attempts = 0;

    await expect(
      retrySqliteBusy(
        async () => {
          attempts += 1;
          throw lockError;
        },
        {
          maxWaitMs: 100,
          initialDelayMs: 100,
          now: () => elapsedMs,
          sleep: async (delayMs) => {
            elapsedMs += delayMs;
          },
        },
      ),
    ).rejects.toBe(lockError);
    expect(attempts).toBe(1);
    expect(elapsedMs).toBe(100);
  });

  it('passes the shrinking budget into every retry operation', async () => {
    const lockError = new Error('database is locked');
    let elapsedMs = 0;
    const receivedBudgets: number[] = [];

    await retrySqliteBusy(
      async (remainingBudgetMs) => {
        receivedBudgets.push(remainingBudgetMs);
        if (receivedBudgets.length === 1) {
          elapsedMs = 98;
          throw lockError;
        }
      },
      {
        maxWaitMs: 100,
        initialDelayMs: 1,
        now: () => elapsedMs,
        sleep: async (delayMs) => {
          elapsedMs += delayMs;
        },
      },
    );

    expect(receivedBudgets).toEqual([100, 1]);
  });
});
