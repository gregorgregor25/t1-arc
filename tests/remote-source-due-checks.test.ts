import { describe, expect, it, vi } from 'vitest';

import type { GlucoseRefreshOptions, GlucoseSource } from '@/data/contracts';
import { DexcomShareGlucoseSource } from '@/data/dexcomShare/DexcomShareGlucoseSource';
import { CompositeGlucoseSource } from '@/data/live/CompositeGlucoseSource';
import { MedtrumGlucoseSource } from '@/data/medtrum/MedtrumGlucoseSource';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import type { GlucoseReading } from '@/domain/models';

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 0 })),
  isLocalDataWriteSupersededError: () => false,
}));

const s = 1_000;
const m = 60_000;
const start = Date.UTC(2026, 10, 13, 8, 0);

function stored(sourceId: string, timestamp: number): GlucoseReading {
  return {
    id: `${sourceId}:${timestamp}`,
    sourceId,
    timestamp,
    receivedAt: timestamp,
    mmolL: 6.4,
    trend: 'flat',
    quality: 'measured',
  };
}

const unexpectedFetch = (async () => {
  throw new Error('A source that is not due must not open a request.');
}) as typeof fetch;

describe('Dexcom Share due checks and read window', () => {
  it('reads a full day first, skips until due, then asks only for the missing minutes', async () => {
    let clock = start;
    const reads: URL[] = [];
    let latestServed = start - 2 * m;
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('AuthenticatePublisherAccount')) return Response.json('account-id');
      if (url.pathname.endsWith('LoginPublisherAccountById')) return Response.json('session-id');
      reads.push(url);
      // Share returns recent history, so the five-minute spacing is stored.
      return Response.json(
        [latestServed, latestServed - 5 * m].map((at) => ({
          WT: `Date(${at})`, ST: `Date(${at})`, DT: `Date(${at})`, Value: 115, Trend: 'Flat',
        })),
      );
    }) as typeof fetch;
    const source = new DexcomShareGlucoseSource(
      { username: 'publisher@example.test', password: 'test-password', region: 'international' },
      new MemoryGlucoseHistoryStore(),
      fetcher,
      () => clock,
    );

    await source.refresh();
    expect(reads).toHaveLength(1);
    expect(reads[0]!.searchParams.get('minutes')).toBe('1440');
    expect(reads[0]!.searchParams.get('maxCount')).toBe('288');

    clock = start + 1 * m;
    await source.refresh();
    expect(reads).toHaveLength(1);

    // The native tick 20 s after the next reading is due.
    latestServed = start + 3 * m;
    clock = start + 3 * m + 20 * s;
    await source.refresh();
    expect(reads).toHaveLength(2);
    expect(reads[1]!.searchParams.get('minutes')).toBe('16');
    expect(reads[1]!.searchParams.get('maxCount')).toBe('4');

    // A native cadence probe 90 s after that reading fetches the latest only.
    clock = start + 4 * m + 30 * s;
    await source.refresh({ reason: 'cadence-probe' });
    expect(reads).toHaveLength(3);
    expect(reads[2]!.searchParams.get('minutes')).toBe('12');

    clock = start + 4 * m + 50 * s;
    await source.refresh({ force: true });
    expect(reads).toHaveLength(4);
    expect(reads[3]!.searchParams.get('minutes')).toBe('1440');
  });
});

describe('Nightscout due checks', () => {
  it('skips a fresh source and fetches when forced', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([stored('nightscout', start - 6 * m), stored('nightscout', start - 1 * m)]);
    await store.saveSyncState({ sourceId: 'nightscout', lastAttemptAt: start - 50 * s, recordCount: 2 });
    const fetcher = vi.fn(async () => Response.json([]));
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      fetcher as unknown as typeof fetch,
      () => start,
      undefined,
      async () => undefined,
      async () => undefined,
    );

    await source.refresh();
    expect(fetcher).not.toHaveBeenCalled();

    await source.refresh({ force: true });
    expect(fetcher).toHaveBeenCalled();
  });
});

describe('xDrip due checks', () => {
  it('keeps fetching every native one-minute tick for a minute source', async () => {
    let clock = start;
    let latestServed = start - 20 * s;
    const fetcher = vi.fn(async () =>
      Response.json([{ sgv: 110, direction: 'Flat', date: latestServed }, { sgv: 108, direction: 'Flat', date: latestServed - m }]),
    );
    const source = new XdripGlucoseSource(
      { endpointUrl: 'http://127.0.0.1:17580/sgv.json' } as ConstructorParameters<typeof XdripGlucoseSource>[0],
      new MemoryGlucoseHistoryStore(),
      fetcher as unknown as typeof fetch,
      () => clock,
    );

    await source.refresh();
    for (let tick = 1; tick <= 3; tick += 1) {
      latestServed += m;
      clock = start + tick * m;
      await source.refresh();
    }
    expect(fetcher).toHaveBeenCalledTimes(4);

    // A duplicate trigger seconds later is coalesced.
    clock += 5 * s;
    await source.refresh();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('Medtrum due checks', () => {
  it('does not sign in or fetch while the next reading cannot exist yet', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([stored('medtrum-easyfollow', start - 6 * m), stored('medtrum-easyfollow', start - 1 * m)]);
    await store.saveSyncState({ sourceId: 'medtrum-easyfollow', lastAttemptAt: start - 50 * s, recordCount: 2 });
    const source = new MedtrumGlucoseSource(
      { username: 'follower@example.test', password: 'test-password', region: 'eu', patientId: 'p1' } as ConstructorParameters<typeof MedtrumGlucoseSource>[0],
      store,
      unexpectedFetch,
      () => start,
    );
    await expect(source.refresh()).resolves.toBeUndefined();
  });
});

describe('composite refresh forcing', () => {
  it('runs a forced pass after a routine refresh that is already in flight', async () => {
    let release!: () => void;
    const calls: (GlucoseRefreshOptions | undefined)[] = [];
    const source: GlucoseSource = {
      sourceId: 'nightscout',
      refresh: vi.fn(async (options?: GlucoseRefreshOptions) => {
        calls.push(options);
        if (calls.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      }),
      getReadings: async () => [],
      getLatestReading: async () => undefined,
      getStatus: async () => ({ id: 'nightscout', label: 'Nightscout', freshness: 'missing', origin: 'live' }) as never,
    };
    const composite = new CompositeGlucoseSource([source], new MemoryGlucoseHistoryStore());

    const routine = composite.refresh();
    const coalesced = composite.refresh();
    const forced = composite.refresh({ force: true });
    await Promise.resolve();
    release();
    await Promise.all([routine, coalesced, forced]);

    expect(calls).toEqual([undefined, { force: true }]);
  });
});
