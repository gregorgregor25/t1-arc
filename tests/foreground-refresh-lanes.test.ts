import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createForegroundRefreshLanes } from '@/data/live/foregroundRefreshLanes';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes,no) => { resolve=yes; reject=no; });
  return {promise,resolve,reject};
}

describe('foreground glucose refresh isolation', () => {
  it('keeps polling glucose while health import is unresolved, without duplicate full imports', async () => {
    const lanes = createForegroundRefreshLanes();
    const bulk = deferred();
    const full = vi.fn(() => bulk.promise);
    const glucose = vi.fn(async () => undefined);
    const first = lanes.run('full',full);
    expect(lanes.run('full',full)).toBe(first);
    await lanes.run('glucose',glucose);
    await lanes.run('glucose',glucose);
    expect(full).toHaveBeenCalledOnce();
    expect(glucose).toHaveBeenCalledTimes(2);
    expect(lanes.busy).toBe(true);
    bulk.resolve(); await first;
    expect(lanes.busy).toBe(false);
  });

  it('coalesces a running glucose request and recovers after failure', async () => {
    const lanes = createForegroundRefreshLanes();
    const slow = deferred();
    const request = vi.fn(() => slow.promise);
    const first = lanes.run('glucose',request);
    expect(lanes.run('glucose',request)).toBe(first);
    const failure = expect(first).rejects.toThrow('offline');
    slow.reject(new Error('offline')); await failure;
    expect(request).toHaveBeenCalledOnce();
    expect(lanes.busy).toBe(false);
    await lanes.run('glucose',async () => undefined);
  });

  it('drains BOTH lanes before an account switch, including a failed lane', async () => {
    const lanes = createForegroundRefreshLanes();
    const glucose = deferred(); const bulk = deferred();
    const first = lanes.run('glucose',() => glucose.promise);
    const second = lanes.run('full',() => bulk.promise);
    let drained = false;
    const waiting = lanes.waitForIdle().then(() => { drained=true; });
    const failure = expect(first).rejects.toThrow('network');
    glucose.reject(new Error('network')); await failure;
    expect(drained).toBe(false);
    bulk.resolve(); await second; await waiting;
    expect(drained).toBe(true);
    expect(lanes.busy).toBe(false);
  });

  it('wires both account and erase barriers to the two-lane coordinator', () => {
    const source = readFileSync(new URL('../src/providers/DataProvider.tsx',import.meta.url),'utf8');
    expect(source).toContain('includeHealthConnect ? "full" : "glucose"');
    const account = source.slice(source.indexOf('const activateLibreSnapshot'),source.indexOf('const connectNightscout'));
    expect(account.indexOf('libreActivationInFlight.current = true')).toBeLessThan(account.indexOf('await foregroundRefreshes.waitForIdle()'));
    const erase = source.slice(source.indexOf('const eraseAllLocalHealthData'),source.indexOf('const deleteManualContext'));
    expect(erase).toContain('foregroundRefreshes.busy');
    expect(source).not.toContain('syncInFlight.current');
  });
});
