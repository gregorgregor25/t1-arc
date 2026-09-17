import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTOMATION_RUN_STALE_AFTER_MS,
  beginAutomationRun,
  finishAutomationRun,
  isInterruptedAutomationRun,
  listAutomationRuns,
  reconcileInterruptedAutomationRuns,
} from '@/data/background/automationRunLog';

const { database, openT1ArcDatabase, randomUUID, withT1ArcTransaction } =
  vi.hoisted(() => {
    const database = {
      runAsync: vi.fn(),
      getAllAsync: vi.fn(),
      getFirstAsync: vi.fn(),
    };
    return {
      database,
      openT1ArcDatabase: vi.fn(async () => database),
      randomUUID: vi.fn(() => 'run-id'),
      withT1ArcTransaction: vi.fn(
        async (work: (transaction: typeof database) => Promise<unknown>) =>
          work(database),
      ),
    };
  });

vi.mock('expo-crypto', () => ({ randomUUID }));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase,
  withT1ArcTransaction,
}));

const writeEpoch = vi.hoisted(() => ({
  assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  assertLocalDataWriteLeaseInTransaction:
    writeEpoch.assertLocalDataWriteLeaseInTransaction,
}));

const NOW = Date.UTC(2026, 6, 28, 9);

describe('automation run recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.runAsync.mockResolvedValue({ changes: 0 });
    database.getAllAsync.mockResolvedValue([]);
    database.getFirstAsync.mockResolvedValue(undefined);
  });

  it('asserts an optional erase lease before recording a run', async () => {
    const lease = { epoch: 4 };
    const order: string[] = [];
    writeEpoch.assertLocalDataWriteLeaseInTransaction.mockImplementationOnce(
      async () => {
        order.push('assert');
      },
    );
    database.runAsync.mockImplementation(async () => {
      order.push('write');
      return { changes: 0 };
    });

    await beginAutomationRun('health-connect', NOW, lease);

    expect(order[0]).toBe('assert');
    expect(
      writeEpoch.assertLocalDataWriteLeaseInTransaction,
    ).toHaveBeenCalledWith(database, lease);
  });

  it('asserts an optional erase lease before finishing a run', async () => {
    const lease = { epoch: 4 };
    const order: string[] = [];
    writeEpoch.assertLocalDataWriteLeaseInTransaction.mockImplementationOnce(
      async () => {
        order.push('assert');
      },
    );
    database.runAsync.mockImplementation(async () => {
      order.push('write');
      return { changes: 1 };
    });
    database.getFirstAsync.mockResolvedValue({ connector: 'health-connect' });

    await finishAutomationRun(
      'run-id',
      { outcome: 'success', completedAt: NOW },
      lease,
    );

    expect(order[0]).toBe('assert');
    expect(
      writeEpoch.assertLocalDataWriteLeaseInTransaction,
    ).toHaveBeenCalledWith(database, lease);
  });

  it('does not record a run when its erase lease is superseded', async () => {
    const error = new Error(
      'This local-data operation was superseded by a privacy erase.',
    );
    error.name = 'LocalDataWriteSupersededError';
    writeEpoch.assertLocalDataWriteLeaseInTransaction.mockRejectedValueOnce(
      error,
    );

    await expect(
      beginAutomationRun('health-connect', NOW, { epoch: 4 }),
    ).rejects.toBe(error);

    expect(database.runAsync).not.toHaveBeenCalled();
  });

  it('closes runs left active after Android stopped the process', async () => {
    database.runAsync.mockResolvedValueOnce({ changes: 2 });

    await expect(reconcileInterruptedAutomationRuns(NOW)).resolves.toBe(2);

    expect(database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("outcome = 'failed'"),
      AUTOMATION_RUN_STALE_AFTER_MS,
      expect.stringContaining('Android stopped this update'),
      NOW - AUTOMATION_RUN_STALE_AFTER_MS,
    );
  });

  it('reconciles old work before recording a new run', async () => {
    await beginAutomationRun('health-connect', NOW);

    expect(database.runAsync).toHaveBeenCalledTimes(2);
    expect(database.runAsync.mock.calls[0]?.[0]).toContain(
      "WHERE outcome = 'running'",
    );
    expect(database.runAsync.mock.calls[1]).toEqual([
      expect.stringContaining('INSERT INTO automation_runs'),
      'run-id',
      'health-connect',
      NOW,
    ]);
  });

  it('reconciles before returning the visible audit history', async () => {
    database.getAllAsync.mockResolvedValue([
      {
        id: 'old-run',
        connector: 'glooko',
        trigger: 'background',
        started_at_ms: NOW - 30 * 60 * 1000,
        completed_at_ms: NOW - 15 * 60 * 1000,
        outcome: 'failed',
        records_processed: 0,
        records_removed: 0,
        detail:
          'Android stopped this update before it reported completion. T1 Arc will try again automatically.',
      },
    ]);

    const runs = await listAutomationRuns(10);

    expect(database.runAsync).toHaveBeenCalledOnce();
    expect(database.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('FROM automation_runs'),
      10,
    );
    expect(isInterruptedAutomationRun(runs[0]!)).toBe(true);
  });
});
