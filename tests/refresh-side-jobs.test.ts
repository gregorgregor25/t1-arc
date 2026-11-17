import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAppBackgroundAbort,
  nightscoutHistoryStoredRecords,
  REFRESH_INDICATOR_WATCHDOG_MS,
  REFRESH_SIDE_JOB_DIAGNOSTICS,
  runSourceThenSideJobs,
  startRefreshIndicatorWatchdog,
  type AppStateLike,
} from '@/providers/refreshSideJobs';
import { DIAGNOSTIC_CODES } from '@/data/support/diagnostics';

afterEach(() => {
  vi.useRealTimers();
});

function never<Value>() {
  return new Promise<Value>(() => {
    // Never settles.
  });
}

describe('source refresh first, side jobs after', () => {
  it('ends the indicator when the source settles, even if a side job never finishes', async () => {
    const order: string[] = [];
    let indicatorOn = true;
    const settled = new Promise<void>((resolve) => {
      void runSourceThenSideJobs({
        source: async () => {
          order.push('source');
          return 'stored';
        },
        sideJobs: [{ name: 'health_sync', run: () => never() }],
        onSourceSettled: (result) => {
          order.push(`settled:${result.status}`);
          indicatorOn = false;
          resolve();
        },
      });
    });
    await settled;
    expect(indicatorOn).toBe(false);
    expect(order).toEqual(['source', 'settled:fulfilled']);
  });

  it('reports a failed source to the settle step and still collects side jobs', async () => {
    const sourceError = new Error('Source unavailable.');
    const seen: PromiseSettledResult<unknown>[] = [];
    const result = await runSourceThenSideJobs({
      source: () => Promise.reject(sourceError),
      sideJobs: [
        { name: 'health_sync', run: async () => ({ categories: 1 }) },
        { name: 'insight_review', run: () => Promise.reject(new Error('x')) },
        {
          name: 'history_sync',
          run: () => {
            throw new Error('thrown synchronously');
          },
        },
      ],
      onSourceSettled: (settled) => {
        seen.push(settled);
      },
    });
    expect(seen).toEqual([{ status: 'rejected', reason: sourceError }]);
    expect(result.sideJobs.map((job) => [job.name, job.status])).toEqual([
      ['health_sync', 'fulfilled'],
      ['insight_review', 'rejected'],
      ['history_sync', 'rejected'],
    ]);
  });

  it('starts side jobs alongside the source and records names at start and end', async () => {
    const events: string[] = [];
    let releaseSource: (value: string) => void = () => undefined;
    const run = runSourceThenSideJobs({
      source: () =>
        new Promise<string>((resolve) => {
          releaseSource = resolve;
        }),
      sideJobs: [
        { name: 'health_sync', run: async () => undefined },
        { name: 'history_sync', run: async () => undefined },
      ],
      onSourceSettled: () => {
        events.push('source settled');
      },
      onSideJobEvent: (name, phase) =>
        events.push(REFRESH_SIDE_JOB_DIAGNOSTICS[name][phase]),
    });
    expect(events).toEqual(['health_sync_started', 'history_sync_started']);
    releaseSource('done');
    await run;
    expect(events.slice(0, 2)).toEqual(['health_sync_started', 'history_sync_started']);
    expect([...events].sort()).toEqual(
      [
        'health_sync_finished',
        'health_sync_started',
        'history_sync_finished',
        'history_sync_started',
        'source settled',
      ].sort(),
    );
  });

  it('uses only diagnostic names the support log accepts', () => {
    const names = Object.values(REFRESH_SIDE_JOB_DIAGNOSTICS).flatMap((phases) =>
      Object.values(phases),
    );
    for (const name of [...names, 'refresh_watchdog']) {
      expect(DIAGNOSTIC_CODES).toContain(name);
    }
  });
});

describe('refresh indicator watchdog', () => {
  it('clears a stuck indicator after one minute', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startRefreshIndicatorWatchdog(onTimeout);
    vi.advanceTimersByTime(REFRESH_INDICATOR_WATCHDOG_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REFRESH_INDICATOR_WATCHDOG_MS * 2);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does nothing once the refresh finished normally', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const stop = startRefreshIndicatorWatchdog(onTimeout);
    stop();
    stop();
    vi.advanceTimersByTime(REFRESH_INDICATOR_WATCHDOG_MS * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

function fakeAppState(initial: string) {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike & { emit(state: string): void; listenerCount(): number } = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit: (state) => {
      for (const listener of listeners) listener(state);
    },
    listenerCount: () => listeners.size,
  };
  return appState;
}

describe('stop slow work when the app goes to the background', () => {
  it('stops when the app moves to the background', () => {
    const appState = fakeAppState('active');
    const stop = createAppBackgroundAbort(appState);
    expect(stop.signal.aborted).toBe(false);
    appState.emit('inactive');
    expect(stop.signal.aborted).toBe(false);
    appState.emit('background');
    expect(stop.signal.aborted).toBe(true);
    stop.dispose();
    expect(appState.listenerCount()).toBe(0);
  });

  it('is already stopped when started in the background', () => {
    const appState = fakeAppState('background');
    const stop = createAppBackgroundAbort(appState);
    expect(stop.signal.aborted).toBe(true);
    expect(appState.listenerCount()).toBe(0);
    stop.dispose();
  });
});

describe('Nightscout history refresh signal', () => {
  it('counts only a block stored during this refresh', () => {
    const startedAt = Date.UTC(2030, 0, 5, 9);
    expect(nightscoutHistoryStoredRecords({ lastSuccessAt: startedAt + 1 }, startedAt)).toBe(true);
    expect(nightscoutHistoryStoredRecords({ lastSuccessAt: startedAt - 1 }, startedAt)).toBe(false);
    expect(nightscoutHistoryStoredRecords({}, startedAt)).toBe(false);
    expect(nightscoutHistoryStoredRecords(undefined, startedAt)).toBe(false);
  });
});

describe('DataProvider refresh contracts', () => {
  const provider = readFileSync('src/providers/DataProvider.tsx', 'utf8');
  const performRefresh = provider.slice(
    provider.indexOf('const performRefresh'),
    provider.indexOf('const refreshData'),
  );

  it('clears the indicator when the source settles, not after side jobs', () => {
    const settle = performRefresh.slice(
      performRefresh.indexOf('onSourceSettled:'),
      performRefresh.indexOf('const healthConnectRefresh'),
    );
    expect(settle).toContain('if (visible) setSyncing(false);');
    expect(settle).toContain('stopIndicatorWatchdog();');
    const afterSideJobs = performRefresh.slice(
      performRefresh.indexOf('const healthConnectRefresh'),
      performRefresh.indexOf('backgroundStop.dispose()'),
    );
    expect(afterSideJobs).not.toContain('setSyncing(');
  });

  it('starts a watchdog with the visible indicator and records it by name', () => {
    expect(performRefresh).toContain(
      'if (visible) stopIndicatorWatchdog = startIndicatorWatchdog();',
    );
    const watchdog = provider.slice(
      provider.indexOf('const startIndicatorWatchdog'),
      provider.indexOf('const performRefresh'),
    );
    expect(watchdog).toContain("recordDiagnostic('refresh_watchdog')");
    expect(watchdog).toContain('setSyncing(false)');
  });

  it('checks Health Connect on a 30-minute app-open interval and stops on background', () => {
    expect(performRefresh).toContain('HEALTH_CONNECT_MANUAL_SYNC_INTERVAL_MS');
    expect(performRefresh).toContain('HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS');
    expect(performRefresh).toContain('createAppBackgroundAbort(AppState)');
    expect(performRefresh).toContain(
      '{ signal: backgroundStop.signal, allowWindowCheck: true }',
    );
    expect(performRefresh).toContain('backgroundStop.dispose()');
  });

  it('publishes a revision after a successful full pass, even when silent', () => {
    const settle = performRefresh.slice(
      performRefresh.indexOf('onSourceSettled:'),
      performRefresh.indexOf('const healthConnectRefresh'),
    );
    expect(settle).toContain('sourceStored = includeHealthConnect;');
    expect(settle).toContain('if (shouldPublishAtEnd || sourceStored) {');
    // The glucose display keeps its original conditions.
    expect(settle).toContain(
      'if (repositoryState.mode === "live" && shouldInvalidate) {',
    );
  });

  it('runs a visible full pass right after a source was connected or changed', () => {
    const connect = provider.slice(
      provider.indexOf('const connectNightscout'),
      provider.indexOf('const disconnectNightscout'),
    );
    const marks = connect.split('sourceChangeRefreshPending.current = true;').length - 1;
    expect(marks).toBe(2);
    expect(connect.split('await seedNightscoutHistoryOnConnect(sourceWriteLease);').length - 1).toBe(2);
    const positions = (needle: string) => {
      const found: number[] = [];
      for (let at = connect.indexOf(needle); at >= 0; at = connect.indexOf(needle, at + 1)) {
        found.push(at);
      }
      return found;
    };
    const pendingAt = positions('sourceChangeRefreshPending.current = true;');
    const modeAt = positions('await changeDataMode("live", writeLease);');
    expect(modeAt).toHaveLength(2);
    pendingAt.forEach((at, index) => expect(at).toBeLessThan(modeAt[index]!));
    const reload = provider.slice(
      provider.indexOf('const reloadSources = useCallback'),
      provider.indexOf('const changeDataMode'),
    );
    expect(reload).toContain('if (options?.refreshNow && repositoryState.mode === "live") {');
    const effect = provider.slice(
      provider.indexOf('if (sourceChangeRefreshPending.current) {'),
      provider.indexOf('const initialHealthRefresh'),
    );
    expect(effect).toContain('sourceChangeRefreshPending.current = false;');
    expect(effect).toContain('void refreshData();');
    const fill = readFileSync('src/components/AapsSourceCard.tsx', 'utf8');
    expect(fill).toContain("seedNightscoutHistoryAfterSourceChange('fill-enabled')");
    expect(fill).toContain('await onDataChanged?.({ refreshNow: saved.enabled });');
  });
});
