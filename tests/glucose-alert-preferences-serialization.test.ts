import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  invalidateGlucoseAlertsForSourceReplacement,
  loadGlucoseAlertPreferences,
  reconcileGlucoseAlerts,
  resetGlucoseAlertState,
  saveGlucoseAlertPreferences,
} from '@/data/glucoseAlerts/glucoseAlertPreferences';
import type { GlucoseReading } from '@/domain/models';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    showAlert: vi.fn(async () => true),
    cancelAlerts: vi.fn(async () => true),
    mirrorOwner: vi.fn(async () => true),
  };
});

vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.getItem,
  setItemAsync: mocks.setItem,
  deleteItemAsync: mocks.deleteItem,
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    showGlucoseAlertAsync: mocks.showAlert,
    cancelGlucoseAlertsAsync: mocks.cancelAlerts,
    setGlucoseAlertMonitoringEnabledAsync: mocks.mirrorOwner,
  },
}));

const PREFERENCES_KEY = 't1arc.glucose-alert-preferences.v1';
const STATE_KEY = 't1arc.glucose-alert-state.v1';
const NOW = Date.UTC(2026, 7, 24, 20, 0, 0);

function lowReading(): GlucoseReading {
  return {
    id: 'low-reading',
    timestamp: NOW,
    receivedAt: NOW,
    mmolL: 3.4,
    trend: 'down',
    quality: 'measured',
    sourceId: 'test-source',
  };
}

describe('glucose alert operation serialization', () => {
  beforeEach(() => {
    mocks.values.clear();
    mocks.values.set(
      PREFERENCES_KEY,
      JSON.stringify({
        enabled: true,
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      }),
    );
    mocks.getItem.mockReset().mockImplementation(
      async (key: string) => mocks.values.get(key) ?? null,
    );
    mocks.setItem.mockReset().mockImplementation(
      async (key: string, value: string) => {
        mocks.values.set(key, value);
      },
    );
    mocks.deleteItem.mockReset().mockImplementation(async (key: string) => {
      mocks.values.delete(key);
    });
    mocks.showAlert.mockReset().mockResolvedValue(true);
    mocks.cancelAlerts.mockReset().mockResolvedValue(true);
    mocks.mirrorOwner.mockReset().mockResolvedValue(true);
  });

  it('does not repair native ownership while loading a possibly stale JS snapshot', async () => {
    const preferences = await loadGlucoseAlertPreferences();

    expect(preferences.enabled).toBe(true);
    expect(mocks.mirrorOwner).not.toHaveBeenCalled();
  });

  it('mirrors ownership only from an explicit durable preference save', async () => {
    const events: string[] = [];
    mocks.setItem.mockImplementation(async (key: string, value: string) => {
      events.push('secure-store');
      mocks.values.set(key, value);
    });
    mocks.mirrorOwner.mockImplementation(async () => {
      events.push('native-owner');
      return true;
    });

    await saveGlucoseAlertPreferences({
      enabled: false,
      lowEnabled: true,
      lowThresholdMmolL: 3.9,
      highEnabled: true,
      highThresholdMmolL: 13.9,
      staleEnabled: false,
      repeatMinutes: 30,
    });

    expect(events).toEqual(['native-owner', 'secure-store']);
    expect(mocks.mirrorOwner).toHaveBeenCalledWith(false);
  });

  it('surfaces a failed native owner commit without retrying it from load', async () => {
    mocks.mirrorOwner.mockRejectedValueOnce(
      new Error('Native owner commit failed'),
    );

    await expect(
      saveGlucoseAlertPreferences({
        enabled: false,
        lowEnabled: true,
        lowThresholdMmolL: 3.9,
        highEnabled: true,
        highThresholdMmolL: 13.9,
        staleEnabled: false,
        repeatMinutes: 30,
      }),
    ).rejects.toThrow('Native owner commit failed');

    const reloaded = await loadGlucoseAlertPreferences();
    expect(reloaded.enabled).toBe(true);
    expect(mocks.mirrorOwner).toHaveBeenCalledTimes(1);
  });

  it('posts one alert for two concurrent reconciliations of the same zone', async () => {
    const reading = lowReading();

    const [first, second] = await Promise.all([
      reconcileGlucoseAlerts(reading, reading.trend, NOW),
      reconcileGlucoseAlerts(reading, reading.trend, NOW),
    ]);

    expect(first.notified).toBe(true);
    expect(second.notified).toBe(false);
    expect(mocks.showAlert).toHaveBeenCalledOnce();
  });

  it('orders reset after an in-flight reconciliation', async () => {
    const events: string[] = [];
    let releaseAlert: (() => void) | undefined;
    mocks.showAlert.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          events.push('show:start');
          releaseAlert = () => {
            events.push('show:end');
            resolve(true);
          };
        }),
    );
    mocks.cancelAlerts.mockImplementation(async () => {
      events.push('cancel');
      return true;
    });
    mocks.setItem.mockImplementation(async (key: string, value: string) => {
      events.push('state:set');
      mocks.values.set(key, value);
    });
    mocks.deleteItem.mockImplementation(async (key: string) => {
      events.push('state:delete');
      mocks.values.delete(key);
    });

    const reconciliation = reconcileGlucoseAlerts(
      lowReading(),
      'down',
      NOW,
    );
    await vi.waitFor(() => expect(mocks.showAlert).toHaveBeenCalledOnce());

    const reset = resetGlucoseAlertState();
    await Promise.resolve();
    expect(mocks.deleteItem).not.toHaveBeenCalled();

    releaseAlert?.();
    await Promise.all([reconciliation, reset]);

    expect(events).toEqual([
      'cancel',
      'show:start',
      'show:end',
      'state:set',
      'state:delete',
      'cancel',
    ]);
    expect(mocks.values.has(STATE_KEY)).toBe(false);
  });

  it('cancels native alerts before clearing replacement hysteresis state', async () => {
    mocks.values.set(
      STATE_KEY,
      JSON.stringify({ activeZone: 'low', lastNotifiedAt: NOW }),
    );
    let releaseCancel!: (value: boolean) => void;
    mocks.cancelAlerts.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseCancel = resolve;
        }),
    );

    const replacement = invalidateGlucoseAlertsForSourceReplacement();
    await vi.waitFor(() => expect(mocks.cancelAlerts).toHaveBeenCalledOnce());
    expect(mocks.values.has(STATE_KEY)).toBe(true);
    expect(mocks.deleteItem).not.toHaveBeenCalled();

    releaseCancel(true);
    await replacement;

    expect(mocks.values.has(STATE_KEY)).toBe(false);
    expect(mocks.cancelAlerts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteItem.mock.invocationCallOrder[0]!,
    );
  });

  it('retains hysteresis state when native replacement cancellation fails closed', async () => {
    mocks.values.set(
      STATE_KEY,
      JSON.stringify({ activeZone: 'high', lastNotifiedAt: NOW }),
    );
    mocks.cancelAlerts.mockResolvedValueOnce(false);

    await expect(
      invalidateGlucoseAlertsForSourceReplacement(),
    ).rejects.toThrow(/could not be cancelled/i);
    expect(mocks.values.has(STATE_KEY)).toBe(true);
    expect(mocks.deleteItem).not.toHaveBeenCalled();
  });

  it('continues with the next operation after an operation fails', async () => {
    let rejectFirstRead: ((reason: Error) => void) | undefined;
    mocks.getItem.mockImplementationOnce(
      () =>
        new Promise<string | null>((_resolve, reject) => {
          rejectFirstRead = reject;
        }),
    );

    const failed = reconcileGlucoseAlerts(lowReading(), 'down', NOW);
    const retry = reconcileGlucoseAlerts(lowReading(), 'down', NOW);
    await vi.waitFor(() => expect(mocks.getItem).toHaveBeenCalledTimes(2));
    rejectFirstRead?.(new Error('Secure storage unavailable'));

    await expect(failed).rejects.toThrow('Secure storage unavailable');
    await expect(retry).resolves.toMatchObject({ notified: true });

    expect(mocks.showAlert).toHaveBeenCalledOnce();
  });
});
