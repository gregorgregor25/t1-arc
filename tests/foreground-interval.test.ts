import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStateStatus } from 'react-native';

import { startForegroundInterval, type ForegroundAppState } from '@/hooks/foregroundInterval';

function fakeAppState(initial: AppStateStatus) {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState: ForegroundAppState & { emit(state: AppStateStatus): void; listenerCount(): number } = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state) {
      appState.currentState = state;
      listeners.forEach((listener) => listener(state));
    },
    listenerCount: () => listeners.size,
  };
  return appState;
}

describe('foreground-only intervals', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops in the background and resumes with an immediate refresh', () => {
    const appState = fakeAppState('active');
    const task = vi.fn();
    startForegroundInterval(task, 30_000, appState, { runOnResume: true });
    vi.advanceTimersByTime(60_000);
    expect(task).toHaveBeenCalledTimes(2);

    appState.emit('background');
    vi.advanceTimersByTime(10 * 60_000);
    expect(task).toHaveBeenCalledTimes(2);

    appState.emit('active');
    expect(task).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    expect(task).toHaveBeenCalledTimes(4);
  });

  it('does not start while mounted in the background', () => {
    const appState = fakeAppState('background');
    const task = vi.fn();
    startForegroundInterval(task, 15_000, appState);
    vi.advanceTimersByTime(60_000);
    expect(task).not.toHaveBeenCalled();
    appState.emit('active');
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps one timer through brief inactive states and repeated active events', () => {
    const appState = fakeAppState('active');
    const task = vi.fn();
    startForegroundInterval(task, 30_000, appState);
    appState.emit('inactive');
    appState.emit('active');
    appState.emit('active');
    vi.advanceTimersByTime(30_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('stops the timer and the listener when cleaned up', () => {
    const appState = fakeAppState('active');
    const task = vi.fn();
    const stop = startForegroundInterval(task, 30_000, appState, { runOnResume: true });
    stop();
    expect(appState.listenerCount()).toBe(0);
    appState.emit('active');
    vi.advanceTimersByTime(60_000);
    expect(task).not.toHaveBeenCalled();
  });
});
