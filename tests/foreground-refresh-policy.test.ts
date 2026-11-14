import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  foregroundGlucoseRefreshAction,
  nativeCollectorOwnsGlucoseSync,
  shouldPollAutomationStatus,
} from '@/domain/foregroundRefreshPolicy';

describe('foreground refresh policy', () => {
  it('does nothing in the background', () => {
    expect(foregroundGlucoseRefreshAction('background', false)).toBe('none');
    expect(foregroundGlucoseRefreshAction('inactive', true)).toBe('none');
  });
  it('reads storage when the native collector owns sync', () => {
    expect(foregroundGlucoseRefreshAction('active', true)).toBe('read-stored');
  });
  it('fetches when no collector is running', () => {
    expect(foregroundGlucoseRefreshAction('active', false)).toBe('network');
  });
  it('polls automation status only while focused and active', () => {
    expect(shouldPollAutomationStatus('active', true)).toBe(true);
    expect(shouldPollAutomationStatus('background', true)).toBe(false);
    expect(shouldPollAutomationStatus('active', false)).toBe(false);
  });
  it('treats the collector as owning sync only when its sync loop recently started a headless sync', () => {
    const now = 1_800_000_000_000;
    const live = { supported: true, enabled: true, serviceRunning: true, syncLoopActive: true, lastHeadlessSyncStartedAt: now - 60_000 };
    expect(nativeCollectorOwnsGlucoseSync(live, now)).toBe(true);
    // The longest native wait is 5 min 20 s after a five-minute reading.
    expect(nativeCollectorOwnsGlucoseSync({ ...live, lastHeadlessSyncStartedAt: now - 5 * 60_000 - 50_000 }, now)).toBe(true);
    expect(nativeCollectorOwnsGlucoseSync({ ...live, lastHeadlessSyncStartedAt: now - 6 * 60_000 - 1 }, now)).toBe(false);
    // The service can be alive without a sync loop, e.g. notifications were off when it started.
    expect(nativeCollectorOwnsGlucoseSync({ ...live, syncLoopActive: false }, now)).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ ...live, serviceRunning: false }, now)).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ ...live, enabled: false }, now)).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ ...live, supported: false }, now)).toBe(false);
    // An older native module without these fields keeps the network refresh.
    expect(nativeCollectorOwnsGlucoseSync({ supported: true, enabled: true, serviceRunning: true }, now)).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ ...live, lastHeadlessSyncStartedAt: undefined }, now)).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync(undefined, now)).toBe(false);
  });
});

describe('foreground refresh wiring', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('re-reads SQLite instead of fetching when the native collector runs', () => {
    const source = read('../src/providers/DataProvider.tsx');
    const start = source.indexOf('const refreshInterval = setInterval');
    const cadence = source.slice(start, source.indexOf('const subscription', start));
    expect(cadence).toContain('T1ArcGlucoseDisplay.getStatusAsync()');
    expect(cadence).toContain('nativeCollectorOwnsGlucoseSync(status, Date.now())');
    expect(cadence).toContain('foregroundGlucoseRefreshAction(');
    expect(cadence).toMatch(/action === "network"\) await refreshGlucoseSilently\(\)/);
    expect(cadence).toMatch(/action === "read-stored"\) await publishLatestStoredGlucose\(\)/);
    // A failed status read keeps the previous network behaviour.
    expect(cadence).toContain('.catch(() => false)');
  });

  it('does not poll automation status while the app is backgrounded', () => {
    const source = read('../src/components/AutomationStatusCard.tsx');
    const start = source.indexOf('const interval = setInterval');
    const timer = source.slice(start, source.indexOf('}, 60_000)', start));
    expect(timer).toContain('shouldPollAutomationStatus(AppState.currentState, active.current)');
  });
});

describe('native collector status', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('reports whether the sync loop runs and when it last started a headless sync', () => {
    const kotlin = read('../modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt');
    expect(kotlin).toContain('"syncLoopActive" to T1ArcGlucoseDisplayService.syncLoopRunning');
    expect(kotlin).toContain('"lastHeadlessSyncStartedAt" to T1ArcGlucoseDisplayService.lastHeadlessSyncStartedAtMs?.toDouble()');
    const start = kotlin.indexOf('private fun requestHeadlessSync');
    const request = kotlin.slice(start, kotlin.indexOf('private fun enqueueValidatedNetworkSync', start));
    expect(request.indexOf('lastHeadlessSyncStartedAtMs = System.currentTimeMillis()')).toBeGreaterThan(request.indexOf('startService('));
  });
});
