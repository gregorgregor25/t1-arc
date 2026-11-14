export type ForegroundRefreshAction = 'none' | 'read-stored' | 'network';

/** The subset of the native display status that decides collector ownership. */
export type NativeCollectorStatus = {
  supported: boolean;
  enabled: boolean;
  serviceRunning: boolean;
  /** Absent from older native modules. */
  syncLoopActive?: boolean;
  /** Wall-clock ms of the last headless sync the service started; absent from older native modules. */
  lastHeadlessSyncStartedAt?: number;
};

/**
 * Longer than the longest native wait (5 min 20 s after a five-minute
 * reading), so a healthy collector always counts as running.
 */
export const NATIVE_COLLECTOR_RECENT_SYNC_MS = 6 * 60_000;
const NATIVE_COLLECTOR_CLOCK_SKEW_MS = 60_000;

/**
 * The native service owns glucose sync only while its sync loop runs and it
 * has actually started a headless sync recently. The service can be alive
 * without a loop (notifications were off when it started) or with a stuck
 * headless task; the visible app then keeps fetching.
 */
export function nativeCollectorOwnsGlucoseSync(
  status: NativeCollectorStatus | undefined,
  now: number,
): boolean {
  if (!status?.supported || !status.enabled || !status.serviceRunning) return false;
  if (status.syncLoopActive !== true) return false;
  const startedAt = status.lastHeadlessSyncStartedAt;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  const age = now - startedAt;
  return age >= -NATIVE_COLLECTOR_CLOCK_SKEW_MS && age <= NATIVE_COLLECTOR_RECENT_SYNC_MS;
}

/**
 * While the native collector owns glucose sync, the visible UI only re-reads
 * SQLite. It never repeats the network fetch the collector already performs.
 */
export function foregroundGlucoseRefreshAction(
  appState: string,
  nativeCollectorRunning: boolean,
): ForegroundRefreshAction {
  if (appState !== 'active') return 'none';
  return nativeCollectorRunning ? 'read-stored' : 'network';
}

export function shouldPollAutomationStatus(appState: string, focused: boolean): boolean {
  return focused && appState === 'active';
}
