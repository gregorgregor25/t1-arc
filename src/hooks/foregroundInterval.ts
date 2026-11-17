import type { AppStateStatus } from 'react-native';

/** The part of React Native's AppState this helper needs; injectable for tests. */
export interface ForegroundAppState {
  currentState: AppStateStatus | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}

export interface ForegroundIntervalOptions {
  /** Runs the task as soon as the app becomes active again. */
  runOnResume?: boolean;
}

/**
 * A repeating timer that stops while the app is in the background and
 * restarts when it becomes active, so a screen that nobody can see does not
 * wake the phone. Headless sync can keep JavaScript running in the
 * background, which is why the timer itself is stopped rather than skipped.
 * Returns a function that stops the timer and the listener.
 */
export function startForegroundInterval(
  task: () => void,
  intervalMs: number,
  appState: ForegroundAppState,
  options: ForegroundIntervalOptions = {},
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const start = () => {
    if (timer === undefined) timer = setInterval(task, intervalMs);
  };
  const pause = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };
  if (appState.currentState !== 'background') start();
  const subscription = appState.addEventListener('change', (state) => {
    if (stopped) return;
    if (state === 'background') {
      pause();
    } else if (state === 'active') {
      start();
      if (options.runOnResume) task();
    }
  });
  return () => {
    stopped = true;
    pause();
    subscription.remove();
  };
}
