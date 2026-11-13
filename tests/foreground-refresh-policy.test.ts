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
  it('treats the collector as owning sync only when supported, enabled and running', () => {
    expect(nativeCollectorOwnsGlucoseSync({ supported: true, enabled: true, serviceRunning: true })).toBe(true);
    expect(nativeCollectorOwnsGlucoseSync({ supported: true, enabled: true, serviceRunning: false })).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ supported: true, enabled: false, serviceRunning: true })).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync({ supported: false, enabled: true, serviceRunning: true })).toBe(false);
    expect(nativeCollectorOwnsGlucoseSync(undefined)).toBe(false);
  });
});

describe('foreground refresh wiring', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('re-reads SQLite instead of fetching when the native collector runs', () => {
    const source = read('../src/providers/DataProvider.tsx');
    const start = source.indexOf('const refreshInterval = setInterval');
    const cadence = source.slice(start, source.indexOf('const subscription', start));
    expect(cadence).toContain('T1ArcGlucoseDisplay.getStatusAsync()');
    expect(cadence).toContain('nativeCollectorOwnsGlucoseSync');
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
