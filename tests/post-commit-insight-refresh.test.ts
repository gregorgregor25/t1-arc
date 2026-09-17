import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createPostCommitInsightRefreshCoordinator,
  createPostCommitInsightRefreshRequest,
} from '@/data/insights/postCommitInsightRefresh';

vi.mock('@/data/insights/insightReviewGenerator', () => ({
  generateInsightReviewIfDue: vi.fn(async () => undefined),
}));

vi.mock('@/data/insights/insightReportRepository', () => ({
  markInsightReviewDirty: vi.fn(async () => undefined),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function providerSection(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('post-commit insight refresh', () => {
  it('acknowledges only after the durable marker and never awaits generation', async () => {
    const marker = deferred();
    const refresh = deferred();
    const scheduledTasks: (() => void)[] = [];
    const runRefresh = vi.fn(() => refresh.promise);
    const coordinator = createPostCommitInsightRefreshCoordinator({
      runRefresh,
      scheduleTask: (task) => {
        scheduledTasks.push(task);
      },
    });
    const request = createPostCommitInsightRefreshRequest({
      markDirty: vi.fn(() => marker.promise),
      coordinator,
    });
    let acknowledged = false;
    const acknowledgement = request({ epoch: 4 }).then(() => {
      acknowledged = true;
    });

    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(scheduledTasks).toHaveLength(0);

    marker.resolve();
    await acknowledgement;
    expect(acknowledged).toBe(true);
    expect(scheduledTasks).toHaveLength(1);
    expect(runRefresh).not.toHaveBeenCalled();

    scheduledTasks.shift()?.();
    await Promise.resolve();
    expect(runRefresh).toHaveBeenCalledOnce();
    expect(acknowledged).toBe(true);
    refresh.resolve();
  });

  it('coalesces bursts and performs one follow-up for a write during generation', async () => {
    const firstRefresh = deferred();
    const scheduledTasks: (() => void)[] = [];
    const runRefresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockResolvedValue(undefined);
    const coordinator = createPostCommitInsightRefreshCoordinator({
      runRefresh,
      scheduleTask: (task) => {
        scheduledTasks.push(task);
      },
    });

    coordinator.schedule();
    coordinator.schedule();
    coordinator.schedule();
    expect(scheduledTasks).toHaveLength(1);

    scheduledTasks.shift()?.();
    await Promise.resolve();
    expect(runRefresh).toHaveBeenCalledOnce();

    coordinator.schedule();
    coordinator.schedule();
    coordinator.schedule();
    expect(scheduledTasks).toHaveLength(0);

    firstRefresh.resolve();
    await vi.waitFor(() => expect(runRefresh).toHaveBeenCalledTimes(2));
  });

  it('keeps forced review generation outside ordinary save acknowledgements', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/providers/DataProvider.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const handlers = [
      {
        source: providerSection(
          source,
          'const saveManualContext = useCallback',
          'const logFood = useCallback',
        ),
        primaryWrite: '.saveManualContext(event, {',
      },
      {
        source: providerSection(
          source,
          'const logFood = useCallback',
          'const updateFoodPortions = useCallback',
        ),
        primaryWrite: 'persistFoodLog(draft, writeLease, {',
      },
      {
        source: providerSection(
          source,
          'const updateFoodPortions = useCallback',
          'const updateFoodLog = useCallback',
        ),
        primaryWrite: 'persistFoodLogPortions(log, amounts, writeLease, {',
      },
      {
        source: providerSection(
          source,
          'const updateFoodLog = useCallback',
          'const clearImportedGlookoData = useCallback',
        ),
        primaryWrite: 'persistFoodLogUpdate(log, draft, writeLease, {',
      },
    ];

    for (const handler of handlers) {
      expect(handler.source).not.toContain('generateInsightReviewIfDue');
      expect(handler.source).not.toContain(
        'withLocalDataWriteLeaseTransaction',
      );
      expect(handler.source).toContain('requestPostCommitInsightRefresh');
      expect(handler.source.indexOf(handler.primaryWrite)).toBeLessThan(
        handler.source.indexOf('requestPostCommitInsightRefresh'),
      );
    }

    const manualSave = handlers[0]?.source ?? '';
    expect(manualSave).toContain(
      'insightInvalidation: existing\n' +
        '                ? "clear-saved-reports"\n' +
        '                : "mark-dirty"',
    );
    expect(manualSave).toContain('inputAlreadyInvalidated: true');
    expect(manualSave).not.toContain('clearSavedInsightReports(writeLease)');

    for (const foodSave of handlers.slice(1)) {
      expect(foodSave.source).toContain('insightInvalidation:');
      expect(foodSave.source).toContain('inputAlreadyInvalidated: true');
      expect(foodSave.source).not.toContain('clearSavedInsightReports(writeLease)');
    }

    const startupResume = providerSection(
      source,
      'void configure();',
      'const observeLatestStoredGlucose = useCallback',
    );
    expect(startupResume).toContain('resumePendingInsightRefresh()');

    const refreshBounds = providerSection(
      source,
      'const refreshEarliestLiveDate = useCallback',
      'const scheduleCommittedDataWritePublication = useCallback',
    );
    expect(refreshBounds).toContain(
      'assertLocalDataWriteLeaseCurrent(writeLease)',
    );
    expect(refreshBounds).not.toContain('withLocalDataWriteLeaseTransaction');
  });
});
