import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureRegionalProfileRuntimeHydrated,
  observeRegionalProfile,
  resetRegionalProfileRuntimeHydrationForTests,
  saveRegionalProfile,
} from '@/data/regionalProfile';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import {
  getRuntimeRegionalDefaults,
  setRuntimeRegionalProfile,
} from '@/domain/regionalProfileRuntime';
import { weeklyReviewSchedule } from '@/domain/weeklyReviewSchedule';
import { zonedDateTimeToTimestamp } from '@/domain/time';

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

const STORED_US_PROFILE = {
  ...DEFAULT_REGIONAL_PROFILE,
  region: 'us' as const,
  countryCode: 'US',
  languageTag: 'en-US',
  analysisTimeZone: 'America/New_York',
  followDeviceTimeZone: false,
  clinicalJurisdiction: 'US',
};

describe('headless regional runtime hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegionalProfileRuntimeHydrationForTests();
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
    secureStore.getItemAsync.mockImplementation(async (key: string) =>
      key === 't1arc.regional-profile.v2'
        ? JSON.stringify(STORED_US_PROFILE)
        : null,
    );
    secureStore.setItemAsync.mockResolvedValue(undefined);
  });

  it('gives remounted consumers the latest saved profile, not the cold-start snapshot', async () => {
    await ensureRegionalProfileRuntimeHydrated();
    const updated = {
      ...STORED_US_PROFILE,
      countryCode: 'GB',
      languageTag: 'en-GB',
      glucoseUnit: 'mmolL' as const,
      measurementSystem: 'metric' as const,
    };
    await saveRegionalProfile(updated);
    await expect(ensureRegionalProfileRuntimeHydrated()).resolves.toEqual(
      updated,
    );
    const listener = vi.fn();
    const unsubscribe = observeRegionalProfile(listener);
    try {
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(updated));
      expect(secureStore.getItemAsync).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('does not let an older pending storage read replace a newly saved profile', async () => {
    let finishRead!: (value: string) => void;
    secureStore.getItemAsync.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    const hydration = ensureRegionalProfileRuntimeHydrated();
    const updated = { ...STORED_US_PROFILE, glucoseUnit: 'mmolL' as const };
    await saveRegionalProfile(updated);
    finishRead(JSON.stringify(STORED_US_PROFILE));
    await expect(hydration).resolves.toEqual(updated);
    expect(getRuntimeRegionalDefaults().glucoseUnit).toBe('mmolL');
  });

  it('does not publish a profile whose durable save failed', async () => {
    await ensureRegionalProfileRuntimeHydrated();
    secureStore.setItemAsync.mockRejectedValueOnce(
      new Error('vault unavailable'),
    );
    await expect(
      saveRegionalProfile({ ...STORED_US_PROFILE, glucoseUnit: 'mmolL' }),
    ).rejects.toThrow('vault unavailable');
    await expect(ensureRegionalProfileRuntimeHydrated()).resolves.toEqual(
      STORED_US_PROFILE,
    );
  });

  it('loads the saved profile once before a cold headless runtime schedules work', async () => {
    await Promise.all([
      ensureRegionalProfileRuntimeHydrated(),
      ensureRegionalProfileRuntimeHydrated(),
    ]);

    expect(secureStore.getItemAsync).toHaveBeenCalledOnce();
    expect(getRuntimeRegionalDefaults()).toMatchObject({
      locale: 'en-US',
      timeZone: 'America/New_York',
      glucoseUnit: 'mgDl',
    });

    const dueAt = zonedDateTimeToTimestamp(
      '2026-11-01',
      8,
      31,
      0,
      'America/New_York',
    );
    expect(
      weeklyReviewSchedule(dueAt, undefined, {
        weekday: 0,
        hour: 8,
        minute: 30,
      }),
    ).toMatchObject({ weekKey: '2026-11-01', due: true });
  });

  it('fails closed and permits a later retry when secure storage cannot be read', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(
      new Error('vault unavailable'),
    );

    await expect(ensureRegionalProfileRuntimeHydrated()).rejects.toThrow(
      'vault unavailable',
    );
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify(STORED_US_PROFILE),
    );
    await expect(ensureRegionalProfileRuntimeHydrated()).resolves.toEqual(
      STORED_US_PROFILE,
    );
  });

  it.each([
    'index.ts',
    'src/data/background/glookoSyncTask.ts',
    'src/data/background/healthConnectSyncTask.ts',
    'src/data/background/hevySyncTask.ts',
    'src/data/background/insightReviewTask.ts',
    'src/data/background/libreSyncTask.ts',
  ])('keeps %s behind the regional-runtime hydration fence', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toMatch(/await ensureRegionalProfileRuntimeHydrated\(\)/);
  });
});
