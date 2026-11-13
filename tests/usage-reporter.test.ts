import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { noteMonitoringDay } from '@/data/usageReporting/monitoringDay';
import {
  clearUsageReportingAsync,
  getUsageConsentAsync,
  noteMonitoringDayAsync,
  reportUsageOnOpenAsync,
  setUsageConsentAsync,
  USAGE_ENDPOINT,
  type UsageFetch,
} from '@/data/usageReporting/usageReporter';
import {
  USAGE_CONSENT_KEY,
  USAGE_STATE_KEY,
} from '@/data/usageReporting/usageReportingStore';

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failReads: false,
  setItem: vi.fn(),
  beforeSet: undefined as ((key: string) => Promise<void> | undefined) | undefined,
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (mocks.failReads) throw new Error('keystore unavailable');
    return mocks.store.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    await mocks.beforeSet?.(k);
    mocks.setItem(k, v);
    mocks.store.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    mocks.store.delete(k);
  },
}));

const NOW = new Date('2026-11-13T09:00:00Z').getTime();
const DAY = 86_400_000;

function okFetch() {
  return vi.fn<UsageFetch>().mockResolvedValue({ ok: true, status: 204 });
}

function sentBodies(fetchMock: ReturnType<typeof okFetch>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body) as Record<string, unknown>);
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('usage reporter', () => {
  beforeEach(async () => {
    mocks.failReads = false;
    mocks.beforeSet = undefined;
    await clearUsageReportingAsync();
    mocks.store.clear();
    mocks.setItem.mockClear();
  });

  it('reports by default, without any prompt or stored choice', async () => {
    expect(await getUsageConsentAsync()).toBe('enabled');
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' });
    // The first weekly count waits for a full week of history.
    expect(sentBodies(fetchMock).map((b) => b.kind)).toEqual(['day']);
  });

  it('never calls the network once switched off, and deletes history', async () => {
    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW, appVersion: '1.7.20' });
    expect(mocks.store.has(USAGE_STATE_KEY)).toBe(true);
    await setUsageConsentAsync(false);
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
    expect(await getUsageConsentAsync()).toBe('disabled');
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW + DAY, appVersion: '1.7.20' });
    await noteMonitoringDayAsync(NOW + DAY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
  });

  it('stops before the next message when switched off during a send', async () => {
    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW, appVersion: '1.7.20' });
    let release: () => void = () => undefined;
    const fetchMock = vi.fn<UsageFetch>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 204 });
        }),
    );
    const report = reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW + 7 * DAY, appVersion: '1.7.20' });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await setUsageConsentAsync(false);
    release();
    await report;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
  });

  it('aborts the request in flight when switched off or erased', async () => {
    for (const stop of [() => setUsageConsentAsync(false), () => clearUsageReportingAsync()]) {
      await clearUsageReportingAsync();
      mocks.store.clear();
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn<UsageFetch>().mockImplementation((_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });
      const report = reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' });
      await settle();
      expect(signal?.aborted).toBe(false);
      await stop();
      expect(signal?.aborted).toBe(true);
      await report;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('sends nothing when switched off while the open is still reading the switch', async () => {
    const fetchMock = okFetch();
    const report = reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' });
    const off = setUsageConsentAsync(false);
    await Promise.all([report, off]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
  });

  it('sends nothing and keeps no history for an open that starts while the switch-off is saving', async () => {
    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW, appVersion: '1.7.20' });
    let releaseSave: () => void = () => undefined;
    mocks.beforeSet = (key) =>
      key === USAGE_CONSENT_KEY
        ? new Promise<void>((resolve) => {
            releaseSave = resolve;
          })
        : undefined;
    const off = setUsageConsentAsync(false);
    await settle();
    // The consent write has not landed yet; a new open starts now.
    const fetchMock = okFetch();
    const report = reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW + DAY, appVersion: '1.7.20' });
    await settle();
    mocks.beforeSet = undefined;
    releaseSave();
    await Promise.all([off, report]);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
    expect(await getUsageConsentAsync()).toBe('disabled');
  });

  for (const [label, erase] of [
    ['erasure', () => clearUsageReportingAsync()],
    ['switching off', () => setUsageConsentAsync(false)],
  ] as const) {
    it(`${label} waits for a pending history save before deleting`, async () => {
      let releaseSave: () => void = () => undefined;
      mocks.beforeSet = (key) =>
        key === USAGE_STATE_KEY
          ? new Promise<void>((resolve) => {
              releaseSave = resolve;
            })
          : undefined;
      // A monitoring-day write is past its checks and waiting on storage.
      const noted = noteMonitoringDayAsync(NOW);
      await settle();
      const erased = erase();
      await settle();
      mocks.beforeSet = undefined;
      releaseSave();
      await Promise.all([noted, erased]);
      await settle();
      expect(mocks.store.has(USAGE_STATE_KEY)).toBe(false);
    });
  }

  it('posts minimal JSON with no credentials, cookies or identifying headers', async () => {
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(USAGE_ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('omit');
      expect(Object.keys(init.headers)).toEqual(['Content-Type']);
    }
    expect(sentBodies(fetchMock)).toEqual([{ schema: 1, kind: 'day', appVersion: '1.7.20' }]);
  });

  it('does not resend after success, and retries after failure', async () => {
    const failing = vi.fn<UsageFetch>().mockRejectedValue(new Error('offline'));
    await reportUsageOnOpenAsync({ fetchImpl: failing, now: NOW, appVersion: '1.7.20' });
    expect(failing).toHaveBeenCalledTimes(1);
    const rejected = vi.fn<UsageFetch>().mockResolvedValue({ ok: false, status: 503 });
    await reportUsageOnOpenAsync({ fetchImpl: rejected, now: NOW + 500, appVersion: '1.7.20' });
    const ok = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: ok, now: NOW + 1000, appVersion: '1.7.20' });
    expect(sentBodies(ok).map((b) => b.kind)).toEqual(['day']);
    const again = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: again, now: NOW + 2000, appVersion: '1.7.20' });
    expect(again).not.toHaveBeenCalled();
    const tomorrow = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: tomorrow, now: NOW + DAY, appVersion: '1.7.20' });
    expect(sentBodies(tomorrow).map((b) => b.kind)).toEqual(['day']);
  });

  it('counts monitoring days in the next weekly message', async () => {
    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW, appVersion: '1.7.20' });
    for (let day = 1; day <= 7; day += 1) {
      await expect(noteMonitoringDayAsync(NOW + day * DAY)).resolves.toBe(true);
    }
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW + 7 * DAY, appVersion: '1.7.20' });
    const week = sentBodies(fetchMock).find((b) => b.kind === 'week');
    // Previous seven local days: the first open plus six collector days.
    expect(week).toEqual({ schema: 1, kind: 'week', appVersion: '1.7.20', daysOpened: 1, daysMonitoring: 6 });
  });

  it('writes the monitoring day at most once per day', async () => {
    await noteMonitoringDayAsync(NOW);
    await noteMonitoringDayAsync(NOW + 60_000);
    await noteMonitoringDayAsync(NOW + 120_000);
    expect(mocks.setItem).toHaveBeenCalledTimes(1);
  });

  it('caches the recorded day so collector ticks skip secure storage', async () => {
    const reads = vi.spyOn(await import('expo-secure-store'), 'getItemAsync');
    noteMonitoringDay(NOW);
    await settle();
    expect(mocks.store.has(USAGE_STATE_KEY)).toBe(true);
    reads.mockClear();
    noteMonitoringDay(NOW + 60_000);
    noteMonitoringDay(NOW + 120_000);
    await settle();
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  });

  it('never throws into the caller when storage fails', async () => {
    mocks.failReads = true;
    const fetchMock = okFetch();
    await expect(
      reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' }),
    ).resolves.toBeUndefined();
    await expect(noteMonitoringDayAsync(NOW)).resolves.toBe(false);
    expect(() => noteMonitoringDay(NOW)).not.toThrow();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing for a build without a plain release version', async () => {
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: 'unknown' });
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20-dev+abc' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one run between overlapping opens', async () => {
    const fetchMock = okFetch();
    await Promise.all([
      reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' }),
      reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW, appVersion: '1.7.20' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erasure clears the activity history and keeps an opt-out', async () => {
    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW, appVersion: '1.7.20' });
    await clearUsageReportingAsync();
    expect(mocks.store.size).toBe(0);
    expect(await getUsageConsentAsync()).toBe('enabled');

    await reportUsageOnOpenAsync({ fetchImpl: okFetch(), now: NOW + DAY, appVersion: '1.7.20' });
    await setUsageConsentAsync(false);
    await clearUsageReportingAsync();
    expect([...mocks.store.keys()]).toEqual([USAGE_CONSENT_KEY]);
    expect(await getUsageConsentAsync()).toBe('disabled');
    const fetchMock = okFetch();
    await reportUsageOnOpenAsync({ fetchImpl: fetchMock, now: NOW + 2 * DAY, appVersion: '1.7.20' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports on app open and when the app returns to the foreground', () => {
    const app = readFileSync('App.tsx', 'utf8');
    // Same native version source as About and support reports.
    expect(app).toContain("reportUsageOnOpenAsync({ appVersion: Application.nativeApplicationVersion ?? 'unknown' })");
    expect(app.match(/reportUsageOnOpen\(\);/g)).toHaveLength(2);
  });

  it('keeps usage counters out of encrypted portable backups', () => {
    for (const file of readdirSync('src/data/backup')) {
      const source = readFileSync(join('src/data/backup', file), 'utf8');
      expect(source).not.toMatch(/usage-?reporting/i);
    }
  });
});
