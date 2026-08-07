import { beforeEach, describe, expect, it, vi } from 'vitest';

const { database, openDaymarkDatabase, randomUUID } = vi.hoisted(() => {
  const database = {
    runAsync: vi.fn(),
    getAllAsync: vi.fn(),
    getFirstAsync: vi.fn(),
  };
  return {
    database,
    openDaymarkDatabase: vi.fn(async () => database),
    randomUUID: vi.fn(() => 'run-id'),
  };
});

vi.mock('expo-crypto', () => ({ randomUUID }));
vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase,
}));

import {
  AUTOMATION_RUN_STALE_AFTER_MS,
  beginAutomationRun,
  isInterruptedAutomationRun,
  listAutomationRuns,
  reconcileInterruptedAutomationRuns,
} from '@/data/background/automationRunLog';

const NOW = Date.UTC(2026, 6, 28, 9);

describe('automation run recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.runAsync.mockResolvedValue({ changes: 0 });
    database.getAllAsync.mockResolvedValue([]);
    database.getFirstAsync.mockResolvedValue(undefined);
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
