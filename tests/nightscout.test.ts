import { describe, expect, it, vi } from 'vitest';

import {
  nightscoutDraftFromSaved,
  normalizeNightscoutConnection,
  resolveNightscoutDraftConnection,
} from '@/data/nightscout/connection';
import { nightscoutRequestHeaders } from '@/data/nightscout/auth';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NIGHTSCOUT_SOURCE_ID, NightscoutError } from '@/data/nightscout/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 0 })),
  isLocalDataWriteSupersededError: (error: unknown) =>
    error instanceof Error &&
    (error.name === 'LocalDataWriteSupersededError' ||
      error.name === 'LocalDataErasePendingError'),
}));

describe('Nightscout connection', () => {
  it('extracts a pasted read token and removes it from the saved site URL', () => {
    expect(
      normalizeNightscoutConnection(
        ' https://example-nightscout.test/?token=reader-a1b2c3#ignored ',
      ),
    ).toEqual({
      baseUrl: 'https://example-nightscout.test',
      accessToken: 'reader-a1b2c3',
      apiSecret: undefined,
      includeIobCob: true,
    });
  });

  it('refuses cleartext sites so tokens and readings are not exposed', () => {
    expect(() =>
      normalizeNightscoutConnection('http://example.test', 'reader'),
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid-connection',
      }),
    );
  });

  it('reuses blank credentials only on the same full normalized base URL', () => {
    const saved = normalizeNightscoutConnection(
      'https://Example.Test/nightscout/',
      'saved-token',
      'saved-secret',
    );
    expect(
      resolveNightscoutDraftConnection({
        site: 'https://example.test/nightscout/',
        accessToken: '',
        apiSecret: '',
        includeIobCob: true,
        saved,
      }),
    ).toMatchObject({
      accessToken: 'saved-token',
      apiSecret: 'saved-secret',
    });
    expect(
      resolveNightscoutDraftConnection({
        site: 'https://example.test/another-path',
        accessToken: '',
        apiSecret: '',
        includeIobCob: true,
        saved,
      }),
    ).toMatchObject({
      accessToken: undefined,
      apiSecret: undefined,
    });
    expect(
      resolveNightscoutDraftConnection({
        site: 'https://different.example.test',
        accessToken: '',
        apiSecret: '',
        includeIobCob: true,
        saved,
      }),
    ).toEqual({
      baseUrl: 'https://different.example.test',
      accessToken: undefined,
      apiSecret: undefined,
      includeIobCob: true,
    });
  });

  it('accepts an explicitly pasted token on a changed origin and restores a cancelled draft', () => {
    const saved = normalizeNightscoutConnection(
      'https://old.example.test',
      'old-token',
      undefined,
      false,
    );
    expect(
      resolveNightscoutDraftConnection({
        site: 'https://new.example.test/?token=new-token',
        accessToken: '',
        apiSecret: '',
        includeIobCob: true,
        saved,
      }),
    ).toMatchObject({
      baseUrl: 'https://new.example.test',
      accessToken: 'new-token',
      apiSecret: undefined,
    });
    expect(nightscoutDraftFromSaved(saved)).toEqual({
      site: 'https://old.example.test',
      accessToken: '',
      apiSecret: '',
      includeIobCob: false,
    });
  });

  it('hashes a legacy API secret before placing it in a request header', async () => {
    const digest = async (secret: string) => `sha1:${secret}`;
    await expect(
      nightscoutRequestHeaders(
        normalizeNightscoutConnection(
          'https://example.test',
          undefined,
          'legacy secret',
        ),
        digest,
      ),
    ).resolves.toEqual({
      Accept: 'application/json',
      'api-secret': 'sha1:legacy secret',
    });
  });
});

describe('Nightscout glucose source', () => {
  it('normalises SGV history, protects the token in query encoding and deduplicates refreshes', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const requested: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(
        JSON.stringify([
          {
            _id: 'entry-2',
            sgv: 126,
            direction: 'FortyFiveUp',
            date: now - 5 * 60_000,
            dateString: '2026-07-27T04:55:00.000Z',
            device: 'nightscout-fixture',
          },
          {
            _id: 'entry-1',
            sgv: 108,
            direction: 'Flat',
            date: now - 10 * 60_000,
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      {
        baseUrl: 'https://example.test',
        accessToken: 'reader + private',
      },
      store,
      fetcher,
      () => now,
    );

    await source.importInitialHistory(14);
    await source.importHistoryRange(
      now - 28 * 86_400_000,
      now - 14 * 86_400_000,
    );
    await source.refresh();

    expect(requested[0]).toContain('token=reader%20%2B%20private');
    expect(requested[0]).toContain('find%5Bdate%5D%5B%24gte%5D=');
    expect(requested[1]).toContain('find%5Bdate%5D%5B%24gte%5D=');
    expect(requested[1]).toContain('find%5Bdate%5D%5B%24lt%5D=');
    expect(requested[2]).not.toContain('find%5Bdate%5D');
    const readings = await source.getReadings({
      start: now - 60 * 60_000,
      end: now,
    });
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({
      mmolL: 6,
      trend: 'flat',
      sourceId: NIGHTSCOUT_SOURCE_ID,
    });
    expect(readings[1]).toMatchObject({
      id: `${NIGHTSCOUT_SOURCE_ID}:entry-2`,
      mmolL: 7,
      trend: 'slightUp',
      sourceId: NIGHTSCOUT_SOURCE_ID,
      sourceFactoryTimestamp: '2026-07-27T04:55:00.000Z',
      sourceDeviceId: 'nightscout-fixture',
    });
    await expect(source.getStatus(now)).resolves.toMatchObject({
      freshness: 'current',
      isLive: true,
      recordCount: 2,
    });
  });

  it('reports authentication failure without storing a reading', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      {
        baseUrl: 'https://secure.example.test',
        accessToken: 'wrong-token',
      },
      store,
      (async () => new Response('', { status: 401 })) as typeof fetch,
      () => now,
    );

    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<NightscoutError>>({
        code: 'authentication',
      }),
    );
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastErrorCode: 'authentication',
      recordCount: 0,
    });
  });

  it('rejects an advertised oversized glucose response before reading its body', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const body = {
      cancel: vi.fn(async () => undefined),
      getReader: vi.fn(),
    };
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ 'Content-Length': '5120001' }),
      body,
      arrayBuffer,
    } as unknown as Response;
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () => response) as typeof fetch,
      () => now,
    );

    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<NightscoutError>>({
        code: 'invalid-response',
        message: expect.stringMatching(/larger than T1 Arc accepts/),
      }),
    );
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(body.getReader).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastErrorCode: 'invalid-response',
      recordCount: 0,
    });
  });

  it('does not let advertised-body cancellation failure mask the size error', async () => {
    const cancelError = new Error('Transport refused cancellation');
    const cancel = vi.fn(async () => {
      throw cancelError;
    });
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      new MemoryGlucoseHistoryStore(),
      (async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers({ 'Content-Length': '5120001' }),
          body: { cancel, getReader: vi.fn() },
          arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
        }) as unknown as Response) as typeof fetch,
    );

    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<NightscoutError>>({
        code: 'invalid-response',
        message: expect.stringMatching(/larger than T1 Arc accepts/),
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an oversized unadvertised glucose body before parsing JSON', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const oversizedBody = JSON.stringify([
      {
        _id: 'multibyte-oversized',
        sgv: 108,
        direction: 'Flat',
        date: now - 60_000,
        padding: 'é'.repeat(2_560_000),
      },
    ]);
    const encodedBody = new TextEncoder().encode(oversizedBody);
    expect(oversizedBody.length).toBeLessThan(5_120_000);
    expect(encodedBody.byteLength).toBeGreaterThan(5_120_000);
    const parseSpy = vi.spyOn(JSON, 'parse');
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers(),
          body: null,
          arrayBuffer: async () => encodedBody.buffer,
        }) as Response) as typeof fetch,
      () => now,
    );

    try {
      await expect(source.refresh()).rejects.toEqual(
        expect.objectContaining<Partial<NightscoutError>>({
          code: 'invalid-response',
          message: expect.stringMatching(/larger than T1 Arc accepts/),
        }),
      );
      expect(parseSpy).not.toHaveBeenCalled();
      await expect(source.getLatestReading()).resolves.toBeUndefined();
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('cancels an unadvertised streamed response as soon as its byte limit is crossed', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array(5_120_000),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array([1]),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      new MemoryGlucoseHistoryStore(),
      (async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers(),
          body: { getReader: () => reader },
          arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
          text: vi.fn(async () => '[]'),
          json: vi.fn(async () => []),
        }) as unknown as Response) as typeof fetch,
      () => now,
    );

    await expect(source.refresh()).rejects.toThrow(
      /larger than T1 Arc accepts/,
    );
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it('accepts exactly 5,000 representative Nightscout entries', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const intervalMs = 5 * 60_000;
    const earliest = now - 5_000 * intervalMs;
    const entries = Array.from({ length: 5_000 }, (_, index) => {
      const date = earliest + index * intervalMs;
      return {
        _id: `entry-${index}`,
        device: 'xDrip-DexcomG5',
        date,
        dateString: new Date(date).toISOString(),
        sgv: 90 + (index % 80),
        delta: 1.2,
        direction: 'Flat',
        noise: 1,
        filtered: 123_456,
        unfiltered: 124_000,
        rssi: 100,
        type: 'sgv',
        sysTime: new Date(date).toISOString(),
        utcOffset: 0,
      };
    });
    const body = JSON.stringify(entries);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(
      1_000_000,
    );
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () => new Response(body, { status: 200 })) as typeof fetch,
      () => now,
    );

    await source.importHistoryRange(earliest, now);

    await expect(store.getBounds(NIGHTSCOUT_SOURCE_ID)).resolves.toEqual({
      earliest,
      latest: now - intervalMs,
      count: 5_000,
    });
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: now,
      recordCount: 5_000,
    });
  });

  it('ignores ancient and future-dated rows so they cannot mask a current reading', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () =>
        new Response(
          JSON.stringify([
            {
              _id: 'future',
              sgv: 270,
              direction: 'SingleUp',
              date: now + 5 * 60_000 + 1,
            },
            {
              _id: 'current',
              sgv: 108,
              direction: 'Flat',
              date: now - 60_000,
            },
            {
              _id: 'ancient',
              sgv: 45,
              direction: 'SingleDown',
              date: Date.UTC(1999, 11, 31, 23, 59, 59, 999),
            },
          ]),
          { status: 200 },
        )) as typeof fetch,
      () => now,
    );

    await source.refresh();

    await expect(source.getLatestReading()).resolves.toMatchObject({
      id: `${NIGHTSCOUT_SOURCE_ID}:current`,
      mmolL: 6,
      timestamp: now - 60_000,
    });
    await expect(store.getBounds(NIGHTSCOUT_SOURCE_ID)).resolves.toMatchObject({
      count: 1,
      latest: now - 60_000,
    });
  });

  it('prunes persisted implausible rows without losing valid history or sync metadata', async () => {
    const now = Date.UTC(2026, 6, 27, 5, 0);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: `${NIGHTSCOUT_SOURCE_ID}:ancient`,
        sourceId: NIGHTSCOUT_SOURCE_ID,
        timestamp: Date.UTC(1999, 11, 31, 23, 59, 59, 999),
        receivedAt: now - 20 * 60_000,
        mmolL: 4,
        trend: 'down',
        quality: 'measured',
      },
      {
        id: `${NIGHTSCOUT_SOURCE_ID}:valid-existing`,
        sourceId: NIGHTSCOUT_SOURCE_ID,
        timestamp: now - 10 * 60_000,
        receivedAt: now - 10 * 60_000,
        mmolL: 5.5,
        trend: 'flat',
        quality: 'measured',
      },
      {
        id: `${NIGHTSCOUT_SOURCE_ID}:future`,
        sourceId: NIGHTSCOUT_SOURCE_ID,
        timestamp: now + 5 * 60_000 + 1,
        receivedAt: now - 5 * 60_000,
        mmolL: 15,
        trend: 'up',
        quality: 'measured',
      },
    ]);
    const existingSyncState = {
      sourceId: NIGHTSCOUT_SOURCE_ID,
      lastAttemptAt: now - 20 * 60_000,
      lastSuccessAt: now - 20 * 60_000,
      lastErrorCode: 'network',
      lastErrorMessage: 'Previous failure',
      recordCount: 3,
    };
    await store.saveSyncState(existingSyncState);
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () =>
        new Response(
          JSON.stringify([
            {
              _id: 'new-current',
              sgv: 117,
              direction: 'Flat',
              date: now - 60_000,
            },
          ]),
          { status: 200 },
        )) as typeof fetch,
      () => now,
    );

    await expect(source.getLatestReading()).resolves.toMatchObject({
      id: `${NIGHTSCOUT_SOURCE_ID}:valid-existing`,
    });
    await expect(source.getStatus(now)).resolves.toMatchObject({
      dataThrough: now - 10 * 60_000,
      recordCount: 1,
    });
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toEqual(existingSyncState);

    await source.refresh();

    await expect(source.getLatestReading()).resolves.toMatchObject({
      id: `${NIGHTSCOUT_SOURCE_ID}:new-current`,
      timestamp: now - 60_000,
    });
    await expect(store.getBounds(NIGHTSCOUT_SOURCE_ID)).resolves.toEqual({
      earliest: now - 10 * 60_000,
      latest: now - 60_000,
      count: 2,
    });
  });

  it('uses the explicit status time for the future-skew pruning boundary', async () => {
    const statusNow = Date.UTC(2026, 6, 27, 5, 0);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: `${NIGHTSCOUT_SOURCE_ID}:current`,
        sourceId: NIGHTSCOUT_SOURCE_ID,
        timestamp: statusNow - 60_000,
        receivedAt: statusNow - 60_000,
        mmolL: 6,
        trend: 'flat',
        quality: 'measured',
      },
      {
        id: `${NIGHTSCOUT_SOURCE_ID}:future-by-one-ms`,
        sourceId: NIGHTSCOUT_SOURCE_ID,
        timestamp: statusNow + 5 * 60_000 + 1,
        receivedAt: statusNow,
        mmolL: 15,
        trend: 'up',
        quality: 'measured',
      },
    ]);
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      fetch,
      () => statusNow + 1,
    );

    await expect(source.getStatus(statusNow)).resolves.toMatchObject({
      dataThrough: statusNow - 60_000,
      recordCount: 1,
    });
    await expect(store.getBounds(NIGHTSCOUT_SOURCE_ID)).resolves.toEqual({
      earliest: statusNow - 60_000,
      latest: statusNow - 60_000,
      count: 1,
    });
  });

  it('preserves the last success through failure and clears the error on recovery', async () => {
    let now = Date.UTC(2026, 6, 27, 5, 0);
    let shouldFail = false;
    const store = new MemoryGlucoseHistoryStore();
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test' },
      store,
      (async () =>
        shouldFail
          ? new Response('', { status: 503 })
          : new Response(
              JSON.stringify([
                {
                  _id: `entry-${now}`,
                  sgv: 108,
                  direction: 'Flat',
                  date: now - 60_000,
                },
              ]),
              { status: 200 },
            )) as typeof fetch,
      () => now,
    );

    await source.refresh();
    const firstState = await store.getSyncState(NIGHTSCOUT_SOURCE_ID);
    expect(firstState).toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: now,
      recordCount: 1,
    });
    expect(firstState?.lastErrorCode).toBeUndefined();

    const firstSuccessAt = now;
    now += 5 * 60_000;
    shouldFail = true;
    await expect(source.refresh()).rejects.toEqual(
      expect.objectContaining<Partial<NightscoutError>>({ code: 'network' }),
    );
    await expect(
      store.getSyncState(NIGHTSCOUT_SOURCE_ID),
    ).resolves.toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: firstSuccessAt,
      lastErrorCode: 'network',
      recordCount: 1,
    });

    now += 5 * 60_000;
    shouldFail = false;
    await source.refresh();
    const recoveredState = await store.getSyncState(NIGHTSCOUT_SOURCE_ID);
    expect(recoveredState).toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: now,
      recordCount: 2,
    });
    expect(recoveredState?.lastErrorCode).toBeUndefined();
    expect(recoveredState?.lastErrorMessage).toBeUndefined();
  });

  it('clears current IOB and COB before a failed Pebble lookup', async () => {
    const now = Date.UTC(2026, 7, 19, 0, 30);
    const cleared: string[] = [];
    const saved: unknown[] = [];
    const source = new NightscoutGlucoseSource(
      {
        baseUrl: 'https://example.test',
        includeIobCob: true,
      },
      new MemoryGlucoseHistoryStore(),
      (async (input: string | URL | Request) =>
        String(input).includes('/pebble')
          ? new Response('', { status: 503 })
          : new Response(
              JSON.stringify([{ _id: 'current', sgv: 108, date: now }]),
              { status: 200 },
            )) as typeof fetch,
      () => now,
      undefined,
      async (snapshot) => {
        saved.push(snapshot);
      },
      async () => {
        cleared.push('cleared');
      },
    );

    await expect(source.importInitialHistory()).resolves.toBeDefined();
    expect(cleared).toEqual(['cleared']);
    expect(saved).toEqual([]);
  });

  it('stores a Pebble snapshot with its validated upstream datetime', async () => {
    const now = Date.UTC(2026, 7, 19, 1, 0);
    const upstreamTime = now - 2 * 60_000;
    const snapshots: { timestamp: number }[] = [];
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test', includeIobCob: true },
      new MemoryGlucoseHistoryStore(),
      (async (input: string | URL | Request) =>
        String(input).includes('/pebble')
          ? new Response(
              JSON.stringify({
                bgs: [{ iob: 1.4, cob: 7, datetime: upstreamTime }],
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify([{ _id: 'current', sgv: 108, date: now }]),
              { status: 200 },
            )) as typeof fetch,
      () => now,
      undefined,
      async (snapshot) => {
        snapshots.push(snapshot);
      },
      async () => undefined,
    );

    await source.importInitialHistory();
    expect(snapshots).toEqual([
      expect.objectContaining({ timestamp: upstreamTime }),
    ]);
  });

  it('does not swallow erase supersession from optional IOB/COB persistence', async () => {
    const now = Date.UTC(2026, 7, 19, 1, 0);
    const stale = new Error('superseded');
    stale.name = 'LocalDataWriteSupersededError';
    const source = new NightscoutGlucoseSource(
      { baseUrl: 'https://example.test', includeIobCob: true },
      new MemoryGlucoseHistoryStore(),
      (async (input: string | URL | Request) =>
        String(input).includes('/pebble')
          ? new Response(
              JSON.stringify({
                bgs: [{ iob: 1.4, cob: 7, datetime: now }],
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify([{ _id: 'current', sgv: 108, date: now }]),
              { status: 200 },
            )) as typeof fetch,
      () => now,
      undefined,
      async () => {
        throw stale;
      },
      async () => undefined,
    );

    await expect(source.importInitialHistory()).rejects.toBe(stale);
  });
});
