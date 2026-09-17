import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createCoalescedPostCommitTask } from '@/data/postCommitTaskCoordinator';
import {
  createSavePipelineTrace,
  SAVE_PIPELINE_TRACE_PREFIX,
} from '@/data/performance/savePipelineTrace';

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

describe('save-pipeline performance evidence', () => {
  it('emits fixed-schema local timings without results or error details', async () => {
    const messages: string[] = [];
    let currentTime = 100;
    const trace = createSavePipelineTrace('manual-context-create', {
      enabled: true,
      now: () => {
        currentTime += 5;
        return currentTime;
      },
      log: (message) => messages.push(message),
    });

    await trace.run(() =>
      trace.measure('primary-write', async () => ({
        privateHealthValue: 'must-not-appear',
      })),
    );

    const failedTrace = createSavePipelineTrace('food-log-update', {
      enabled: true,
      now: () => {
        currentTime += 5;
        return currentTime;
      },
      log: (message) => messages.push(message),
    });
    await expect(
      failedTrace.run(() =>
        failedTrace.measure('primary-write', async () => {
          throw new Error('private meal name and glucose value');
        }),
      ),
    ).rejects.toThrow('private meal name');

    expect(messages).toHaveLength(4);
    for (const message of messages) {
      expect(message).toMatch(
        /^\[T1ArcSavePerf\] trace=\d+ operation=[a-z-]+ phase=[a-z-]+ status=(ok|error) duration_ms=\d+\.\d{2}$/,
      );
    }
    expect(messages.join('\n')).not.toContain('must-not-appear');
    expect(messages.join('\n')).not.toContain('private meal');
    expect(messages.every((message) => message.startsWith(
      SAVE_PIPELINE_TRACE_PREFIX,
    ))).toBe(true);
  });

  it('is silent outside development tracing', async () => {
    const log = vi.fn();
    const trace = createSavePipelineTrace('food-log-create', {
      log,
    });

    await expect(
      trace.run(() => trace.measure('primary-write', async () => 42)),
    ).resolves.toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it('allows an explicit privacy-safe release profiling build', async () => {
    const previous = process.env.EXPO_PUBLIC_T1ARC_SAVE_PERF;
    process.env.EXPO_PUBLIC_T1ARC_SAVE_PERF = '1';
    const log = vi.fn();
    try {
      const trace = createSavePipelineTrace('food-log-create', { log });
      await trace.run(() => trace.measure('primary-write', async () => 42));
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls.flat().join('\n')).not.toContain('42');
    } finally {
      if (previous === undefined) {
        delete process.env.EXPO_PUBLIC_T1ARC_SAVE_PERF;
      } else {
        process.env.EXPO_PUBLIC_T1ARC_SAVE_PERF = previous;
      }
    }
  });

  it('coalesces pending bounds work and reruns once with the latest lease', async () => {
    const firstRun = deferred();
    const scheduledTasks: (() => void)[] = [];
    const inputs: number[] = [];
    const run = vi.fn(async (input: number, isActive: () => boolean) => {
      expect(isActive()).toBe(true);
      inputs.push(input);
      if (inputs.length === 1) await firstRun.promise;
    });
    const coordinator = createCoalescedPostCommitTask({
      run,
      scheduleTask: (task) => {
        scheduledTasks.push(task);
      },
    });

    coordinator.schedule(1);
    coordinator.schedule(2);
    expect(scheduledTasks).toHaveLength(1);

    scheduledTasks.shift()?.();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(inputs).toEqual([2]);

    coordinator.schedule(3);
    coordinator.schedule(4);
    expect(scheduledTasks).toHaveLength(0);
    firstRun.resolve();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(inputs).toEqual([2, 4]);
  });

  it('cancels stale publication without permanently disabling later work', async () => {
    const firstRun = deferred();
    const scheduledTasks: (() => void)[] = [];
    const activeChecks: (() => boolean)[] = [];
    const run = vi.fn(async (_input: number, isActive: () => boolean) => {
      activeChecks.push(isActive);
      if (activeChecks.length === 1) await firstRun.promise;
    });
    const coordinator = createCoalescedPostCommitTask({
      run,
      scheduleTask: (task) => {
        scheduledTasks.push(task);
      },
    });

    coordinator.schedule(1);
    scheduledTasks.shift()?.();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    coordinator.cancelPending();
    expect(activeChecks[0]?.()).toBe(false);
    coordinator.schedule(2);
    firstRun.resolve();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(activeChecks[1]?.()).toBe(true);
  });

  it('keeps full bounds scans outside ordinary save acknowledgements', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/providers/DataProvider.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const saveManual = providerSection(
      source,
      'const saveManualContext = useCallback',
      'const logFood = useCallback',
    );
    const createFood = providerSection(
      source,
      'const logFood = useCallback',
      'const updateFoodPortions = useCallback',
    );
    const updatePortions = providerSection(
      source,
      'const updateFoodPortions = useCallback',
      'const updateFoodLog = useCallback',
    );
    const updateFood = providerSection(
      source,
      'const updateFoodLog = useCallback',
      'const clearImportedGlookoData = useCallback',
    );
    const deleteManual = providerSection(
      source,
      'const deleteManualContext = useCallback',
      'const value = useMemo<DataContextValue>',
    );

    for (const handler of [
      saveManual,
      createFood,
      updatePortions,
      updateFood,
      deleteManual,
    ]) {
      expect(handler).toContain('createSavePipelineTrace');
      expect(handler).not.toContain('await refreshEarliestLiveDate');
      expect(handler.indexOf('"primary-write"')).toBeLessThan(
        handler.indexOf('"ui-publication"'),
      );
    }

    expect(saveManual).toContain('operationGeneration,\n              event.start');
    expect(createFood).toContain(
      'operationGeneration,\n              result.log.timestamp',
    );
    expect(updateFood).toContain(
      'schedulePostCommitBoundsRefresh(writeLease, operationGeneration)',
    );
    expect(deleteManual).toContain(
      'schedulePostCommitBoundsRefresh(writeLease, operationGeneration)',
    );
    expect(createFood).not.toContain('schedulePostCommitBoundsRefresh');
    expect(updatePortions).not.toContain('schedulePostCommitBoundsRefresh');

    const boundsRefresh = providerSection(
      source,
      'const refreshEarliestLiveDate = useCallback',
      'const scheduleCommittedDataWritePublication = useCallback',
    );
    expect(boundsRefresh).toContain('await Promise.all([');
    expect(boundsRefresh).toContain('"glucose-bounds"');
    expect(boundsRefresh).toContain('"insulin-bounds"');
    expect(boundsRefresh).toContain('"context-bounds"');
    expect(boundsRefresh).toContain('"health-connect-bounds"');
    expect(boundsRefresh).not.toContain('withLocalDataWriteLeaseTransaction');

    const publication = providerSection(
      source,
      'const scheduleCommittedDataWritePublication = useCallback',
      'const postCommitBoundsRefresh = useMemo',
    );
    expect(publication).toContain('startTransition(() => {');
    expect(publication).toContain('requestAnimationFrame(() => {');
    expect(publication.indexOf('requestAnimationFrame(() => {')).toBeGreaterThan(
      publication.indexOf('assertLocalDataWriteLeaseCurrent(writeLease)'),
    );
    expect(publication).toContain('setRevision((value) => value + 1)');
  });
});
