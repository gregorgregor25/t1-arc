export type ForegroundRefreshAction = 'none' | 'read-stored' | 'network';

/** The subset of the native display status that decides collector ownership. */
export type NativeCollectorStatus = {
  supported: boolean;
  enabled: boolean;
  serviceRunning: boolean;
};

/**
 * The native foreground service runs the headless glucose sync on its own
 * adaptive cadence only while it is supported, switched on and alive.
 */
export function nativeCollectorOwnsGlucoseSync(status: NativeCollectorStatus | undefined): boolean {
  return status !== undefined && status.supported && status.enabled && status.serviceRunning;
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
