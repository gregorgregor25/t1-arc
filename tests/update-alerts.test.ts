import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstalledAppIdentity, PublicReleaseCheck } from '@/data/updates/publicRelease';
import {
  getPendingUpdateAsync,
  getUpdateAlertsSettingAsync,
  loadUpdateAlertState,
  runAutomaticUpdateCheckAsync,
  setUpdateAlertsEnabledAsync,
  UPDATE_ALERTS_SETTING_KEY,
  UPDATE_ALERTS_STATE_KEY,
} from '@/data/updates/updateAlerts';
import { noteUpdateCheckOpportunity } from '@/data/updates/updateCheckOpportunity';
import {
  automaticCheckDue,
  installedVersionCode,
  isPublicReleaseVersion,
  isUpdateAlertState,
  nextAutomaticCheckAt,
  pendingUpdateFor,
  shouldNotify,
  UPDATE_CHECK_INTERVAL_MS,
} from '@/domain/updateAlerts';

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  failReads: false,
  failWrites: false,
  show: vi.fn<(version: string) => Promise<boolean>>(),
  cancel: vi.fn<() => Promise<void>>(),
  check: vi.fn<(installed: unknown, options: { signal: AbortSignal }) => Promise<unknown>>(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    if (mocks.failReads) throw new Error('keystore unavailable');
    return mocks.store.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (mocks.failWrites) throw new Error('keystore unavailable');
    mocks.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mocks.store.delete(key);
  },
}));

vi.mock('expo-application', () => ({
  applicationId: 'io.github.gregorgregor25.t1arc',
  nativeApplicationVersion: '1.7.21',
  nativeBuildVersion: '86',
}));

vi.mock('../modules/t1arc-community-reminder', () => ({
  default: {
    showUpdateNotificationAsync: mocks.show,
    cancelUpdateNotificationAsync: mocks.cancel,
  },
}));

vi.mock('@/data/updates/publicRelease', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/updates/publicRelease')>()),
  checkPublicRelease: mocks.check,
}));

const DAY = UPDATE_CHECK_INTERVAL_MS;
const NOW = new Date('2026-11-20T09:00:00Z').getTime();
const PUBLIC: InstalledAppIdentity = { applicationId: 'io.github.gregorgregor25.t1arc', version: '1.7.21', buildNumber: '86' };

function available(version = '1.7.22', versionCode = 96): PublicReleaseCheck {
  return {
    kind: 'available',
    version,
    versionCode,
    notes: 'Release notes',
    releaseUrl: `https://github.com/gregorgregor25/t1-arc/releases/tag/v${version}`,
    apkUrl: `https://github.com/gregorgregor25/t1-arc/releases/download/v${version}/T1-Arc-v${version}.apk`,
  };
}

const notifier = { show: mocks.show, cancel: mocks.cancel };

function run(now: number, result: PublicReleaseCheck = available(), installed: InstalledAppIdentity = PUBLIC) {
  const check = vi.fn(async (_installed: InstalledAppIdentity, _options: { signal: AbortSignal }) => result);
  return { check, done: runAutomaticUpdateCheckAsync({ installed, now, check, notifier }) };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function storedState() {
  return JSON.parse(mocks.store.get(UPDATE_ALERTS_STATE_KEY) ?? 'null') as Record<string, unknown> | null;
}

beforeEach(() => {
  mocks.store.clear();
  mocks.failReads = false;
  mocks.failWrites = false;
  mocks.show.mockReset().mockResolvedValue(true);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.check.mockReset().mockResolvedValue(available());
});

describe('update alert rules', () => {
  it('treats only plain x.y.z versions as public releases', () => {
    expect(isPublicReleaseVersion('1.7.22')).toBe(true);
    for (const version of ['1.7.21-aaps.4', 'v1.7.22', '1.7', '', null, undefined]) {
      expect(isPublicReleaseVersion(version)).toBe(false);
    }
  });

  it('checks at most once a day and does not wait for a clock that moved back', () => {
    expect(automaticCheckDue({}, NOW)).toBe(true);
    expect(automaticCheckDue({ lastCheckedAt: NOW }, NOW + DAY - 1)).toBe(false);
    expect(automaticCheckDue({ lastCheckedAt: NOW }, NOW + DAY)).toBe(true);
    expect(automaticCheckDue({ lastCheckedAt: NOW }, NOW - 1)).toBe(true);
    expect(nextAutomaticCheckAt({ lastCheckedAt: NOW }, NOW + 1)).toBe(NOW + DAY);
    expect(nextAutomaticCheckAt({}, NOW)).toBe(NOW);
  });

  it('announces each release once and a later release again', () => {
    expect(shouldNotify({}, 96)).toBe(true);
    expect(shouldNotify({ notifiedVersionCode: 96 }, 96)).toBe(false);
    expect(shouldNotify({ notifiedVersionCode: 96 }, 95)).toBe(false);
    expect(shouldNotify({ notifiedVersionCode: 96 }, 98)).toBe(true);
  });

  it('keeps a pending release only while it is newer than the installation', () => {
    const state = { pending: { version: '1.7.22', versionCode: 96 } };
    expect(pendingUpdateFor(state, 86)).toEqual(state.pending);
    expect(pendingUpdateFor(state, 96)).toBeUndefined();
    expect(pendingUpdateFor(state, undefined)).toBeUndefined();
    expect(installedVersionCode('86')).toBe(86);
    for (const code of [null, '', '0', '-1', '8.6', 'abc']) expect(installedVersionCode(code)).toBeUndefined();
  });

  it('rejects malformed stored state', () => {
    expect(isUpdateAlertState({ lastCheckedAt: NOW, notifiedVersionCode: 96, pending: { version: '1.7.22', versionCode: 96 } })).toBe(true);
    for (const value of [
      null, [], 'x', { lastCheckedAt: 'yesterday' }, { notifiedVersionCode: 0 },
      { pending: { version: '1.7.22-beta', versionCode: 96 } }, { pending: { version: '1.7.22' } }, { pending: null },
    ]) {
      expect(isUpdateAlertState(value)).toBe(false);
    }
  });
});

describe('automatic update check', () => {
  it('is on by default and announces a newer verified release once', async () => {
    expect(await getUpdateAlertsSettingAsync()).toBe('enabled');
    const first = run(NOW);
    expect(await first.done).toBe(NOW + DAY);
    expect(first.check).toHaveBeenCalledTimes(1);
    expect(first.check.mock.calls[0]?.[0]).toEqual(PUBLIC);
    expect(mocks.show).toHaveBeenCalledWith('1.7.22');
    expect(storedState()).toEqual({ lastCheckedAt: NOW, pending: { version: '1.7.22', versionCode: 96 }, notifiedVersionCode: 96 });

    // Same release the next day: checked again, not announced again.
    const second = run(NOW + DAY);
    await second.done;
    expect(second.check).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledTimes(1);

    // A later release is announced.
    const third = run(NOW + 2 * DAY, available('1.7.23', 98));
    await third.done;
    expect(mocks.show).toHaveBeenLastCalledWith('1.7.23');
    expect(storedState()).toMatchObject({ notifiedVersionCode: 98, pending: { version: '1.7.23', versionCode: 98 } });
  });

  it('makes at most one request a day, whatever the outcome', async () => {
    await run(NOW, { kind: 'error', message: 'offline' }).done;
    const again = run(NOW + DAY - 60_000);
    expect(await again.done).toBe(NOW + DAY);
    expect(again.check).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(storedState()).toEqual({ lastCheckedAt: NOW });
  });

  it('never checks on a test build or another package, and sends nothing', async () => {
    for (const installed of [
      { ...PUBLIC, version: '1.7.21-aaps.4', buildNumber: '94' },
      { ...PUBLIC, applicationId: 'io.github.gregorgregor25.t1arc.dev' },
      { ...PUBLIC, buildNumber: null },
    ]) {
      const attempt = run(NOW, available(), installed);
      expect(await attempt.done).toBe(Number.POSITIVE_INFINITY);
      expect(attempt.check).not.toHaveBeenCalled();
    }
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.store.size).toBe(0);
  });

  it('does nothing when switched off, and switching off removes the alert', async () => {
    await run(NOW).done;
    await setUpdateAlertsEnabledAsync(false, notifier);
    expect(mocks.store.get(UPDATE_ALERTS_SETTING_KEY)).toBe('disabled');
    expect(mocks.cancel).toHaveBeenCalled();
    expect(storedState()).not.toHaveProperty('pending');

    const off = run(NOW + 2 * DAY);
    await off.done;
    expect(off.check).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledTimes(1);

    await setUpdateAlertsEnabledAsync(true, notifier);
    expect(await getUpdateAlertsSettingAsync()).toBe('enabled');
    const on = run(NOW + 3 * DAY);
    await on.done;
    expect(on.check).toHaveBeenCalledTimes(1);
    // Already announced before the switch was turned off.
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('does not announce when switched off while GitHub is being checked', async () => {
    let finish: (value: PublicReleaseCheck) => void = () => undefined;
    const check = vi.fn((_installed: InstalledAppIdentity, { signal }: { signal: AbortSignal }) =>
      new Promise<PublicReleaseCheck>((resolve) => {
        finish = resolve;
        signal.addEventListener('abort', () => resolve({ kind: 'error', message: 'cancelled' }));
      }));
    const done = runAutomaticUpdateCheckAsync({ installed: PUBLIC, now: NOW, check, notifier });
    await settle();
    expect(check).toHaveBeenCalledTimes(1);
    await setUpdateAlertsEnabledAsync(false, notifier);
    finish(available());
    await done;
    expect(check.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(mocks.show).not.toHaveBeenCalled();
    expect(storedState()).not.toHaveProperty('pending');
  });

  it('removes the alert once the announced release is installed', async () => {
    await run(NOW).done;
    mocks.cancel.mockClear();
    // Updated to 1.7.22 (96) before the next check is due.
    const updated = run(NOW + 60_000, available(), { ...PUBLIC, version: '1.7.22', buildNumber: '96' });
    await updated.done;
    expect(updated.check).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(storedState()).toEqual({ lastCheckedAt: NOW, notifiedVersionCode: 96 });
  });

  it('clears a pending release when GitHub reports this version is current', async () => {
    await run(NOW).done;
    mocks.cancel.mockClear();
    await run(NOW + DAY, { kind: 'current', message: 'current' }).done;
    expect(mocks.cancel).toHaveBeenCalled();
    expect(storedState()).toEqual({ lastCheckedAt: NOW + DAY, notifiedVersionCode: 96 });
  });

  it('tries the notification again the next day when Android did not show it', async () => {
    mocks.show.mockResolvedValueOnce(false);
    await run(NOW).done;
    expect(storedState()).not.toHaveProperty('notifiedVersionCode');
    await run(NOW + DAY).done;
    expect(mocks.show).toHaveBeenCalledTimes(2);
    expect(storedState()).toMatchObject({ notifiedVersionCode: 96 });
  });

  it('never reaches GitHub or throws when secure storage fails', async () => {
    mocks.failReads = true;
    const unreadable = run(NOW);
    await expect(unreadable.done).resolves.toBe(NOW + DAY / 24);
    expect(unreadable.check).not.toHaveBeenCalled();
    mocks.failReads = false;
    mocks.failWrites = true;
    const unwritable = run(NOW);
    await expect(unwritable.done).resolves.toBe(NOW + DAY / 24);
    expect(unwritable.check).not.toHaveBeenCalled();
  });

  it('runs one check at a time', async () => {
    const check = vi.fn(async (_installed: InstalledAppIdentity, _options: { signal: AbortSignal }) => available());
    const first = runAutomaticUpdateCheckAsync({ installed: PUBLIC, now: NOW, check, notifier });
    const second = runAutomaticUpdateCheckAsync({ installed: PUBLIC, now: NOW, check, notifier });
    expect(second).toBe(first);
    await first;
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('offers the pending release to About only while alerts are on and it is newer', async () => {
    await run(NOW).done;
    expect(await getPendingUpdateAsync(PUBLIC)).toEqual({ version: '1.7.22', versionCode: 96 });
    expect(await getPendingUpdateAsync({ ...PUBLIC, version: '1.7.22', buildNumber: '96' })).toBeUndefined();
    expect(await getPendingUpdateAsync({ ...PUBLIC, version: '1.7.21-aaps.4', buildNumber: '94' })).toBeUndefined();
    await setUpdateAlertsEnabledAsync(false, notifier);
    expect(await getPendingUpdateAsync(PUBLIC)).toBeUndefined();
  });

  it('reads invalid stored state as empty', async () => {
    mocks.store.set(UPDATE_ALERTS_STATE_KEY, '{"lastCheckedAt":"soon"}');
    expect(await loadUpdateAlertState()).toEqual({});
    mocks.store.set(UPDATE_ALERTS_STATE_KEY, 'not json');
    expect(await loadUpdateAlertState()).toEqual({});
  });
});

describe('update check opportunity hook', () => {
  it('runs one detached check and then stays in memory until the next one is due', async () => {
    const start = Date.now();
    noteUpdateCheckOpportunity(start);
    noteUpdateCheckOpportunity(start);
    await vi.waitFor(() => expect(storedState()).toMatchObject({ notifiedVersionCode: 96 }));
    await settle();
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith('1.7.22');
    mocks.failReads = true;
    // Cached: neither storage nor GitHub is touched again today.
    expect(() => noteUpdateCheckOpportunity(start + 60_000)).not.toThrow();
    await settle();
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it('is wired into app opens and the glucose collector without awaiting it', () => {
    const root = join(__dirname, '..');
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    const collector = readFileSync(join(root, 'src/data/glucoseDisplay/glucoseDisplayCoordinator.ts'), 'utf8');
    expect(app.match(/^\s*noteUpdateCheckOpportunity\(\);/gm)).toHaveLength(2);
    expect(collector).toMatch(/^\s*noteUpdateCheckOpportunity\(\);/m);
    expect(collector).not.toMatch(/await\s+noteUpdateCheckOpportunity/);
  });
});
