import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { GlucoseReading } from '@/domain/models';

const secureStore = vi.hoisted(() => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  sha256: vi.fn(async (value: string) => `sha256:${value}`),
}));

vi.mock('@/data/libreLinkUp/secureStore', () => ({
  loadLibreLinkUpSession: secureStore.loadSession,
  saveLibreLinkUpSession: secureStore.saveSession,
  sha256: secureStore.sha256,
}));

const credentials = {
  email: 'follower@example.com',
  password: 'not-a-real-password',
  topLevelDomain: 'io' as const,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sequenceFetch(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const response = queue.shift();
    if (!response) throw new Error('Unexpected LibreLinkUp request.');
    return response;
  }) as unknown as typeof globalThis.fetch;
}

function delayedSequenceFetch(delayMs: number, ...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const response = queue.shift();
        if (!response) {
          reject(new Error('Unexpected LibreLinkUp request.'));
          return;
        }
        const timeout = setTimeout(() => resolve(response), delayMs);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
  ) as unknown as typeof globalThis.fetch;
}

function reusableSession() {
  return {
    token: 'saved-token',
    expiresAt: Date.UTC(2100, 0, 1),
    userId: 'user-1',
    region: 'eu',
    version: '4.17.0',
    accountEmail: credentials.email,
    patientId: 'patient-1',
  };
}

describe('Direct LibreLinkUp source orchestration', () => {
  beforeEach(() => {
    secureStore.loadSession.mockReset().mockResolvedValue(reusableSession());
    secureStore.saveSession.mockReset().mockResolvedValue(undefined);
    secureStore.sha256.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads persisted status without claiming or fetching a new snapshot', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn(async () => {
      throw new Error('Status must not fetch.');
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 'saved-reading',
        sourceId: 't1arc-librelinkup',
        timestamp: now - 60_000,
        receivedAt: now - 59_000,
        mmolL: 6.4,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    const claim = vi.spyOn(store, 'claimSyncAttempt');
    const complete = vi.spyOn(store, 'completeSyncAttempt');

    await expect(
      new DirectLibreLinkUpSource(credentials, store).getStatus(now),
    ).resolves.toMatchObject({
      freshness: 'current',
      dataThrough: now - 60_000,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(secureStore.loadSession).not.toHaveBeenCalled();
  });

  it('reads persisted glucose without waiting for a source request', async () => {
    const now = Date.parse('2026-08-24T14:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => {
        // Intentionally unresolved to verify persisted reads remain non-blocking.
      }),
    ) as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 't1arc-librelinkup:saved',
        sourceId: 't1arc-librelinkup',
        timestamp: now - 60_000,
        receivedAt: now - 59_000,
        mmolL: 7.2,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    const source = new DirectLibreLinkUpSource(credentials, store);

    await expect(source.getLatestReading()).resolves.toMatchObject({
      mmolL: 7.2,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(secureStore.loadSession).not.toHaveBeenCalled();
  });

  it('allows a bounded slow re-authentication chain to finish after 40 seconds', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.setSystemTime(now);
    secureStore.loadSession.mockResolvedValue({
      ...reusableSession(),
      token: 'expired-server-side',
    });
    const fetchMock = delayedSequenceFetch(
      11_000,
      new Response('', { status: 401 }),
      jsonResponse({
        status: 0,
        data: {
          user: { id: 'user-1' },
          authTicket: { token: 'new-token', expires: 4_102_444_800 },
        },
      }),
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: 117,
              TrendArrow: 3,
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();

    const refresh = new DirectLibreLinkUpSource(credentials, store).refresh();
    await vi.advanceTimersByTimeAsync(45_000);

    await expect(refresh).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      (await store.getLatestReading('t1arc-librelinkup'))?.mmolL,
    ).toBe(6.5);
  });

  it('cancels a hung request and clears the shared owner before a later recovery', async () => {
    let now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const controller = new AbortController();
    let callIndex = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        const currentCall = callIndex++;
        activeRequests += 1;
        maximumActiveRequests = Math.max(
          maximumActiveRequests,
          activeRequests,
        );
        if (currentCall === 0) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                activeRequests -= 1;
                const error = new Error('Aborted');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          });
        }
        activeRequests -= 1;
        if (currentCall === 1) {
          return Promise.resolve(
            jsonResponse({
              status: 0,
              data: [{ patientId: 'patient-1', firstName: 'Alex' }],
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 0,
            data: {
              graphData: [
                {
                  FactoryTimestamp: '8/19/2026 10:59:00 AM',
                  ValueInMgPerDl: 117,
                  TrendArrow: 3,
                },
              ],
            },
          }),
        );
      },
    ) as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    const hung = new DirectLibreLinkUpSource(credentials, store, {
      signal: controller.signal,
    }).refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(hung).rejects.toMatchObject({ code: 'network' });

    now += 30_000;
    await expect(
      new DirectLibreLinkUpSource(credentials, store).refresh(),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maximumActiveRequests).toBe(1);
    expect(await store.getSyncState('t1arc-librelinkup')).toMatchObject({
      lastSuccessAt: now,
      recordCount: 1,
    });
  });

  it('claims one refresh and conditionally completes one snapshot across instances', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = sequenceFetch(
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: 117,
              TrendArrow: 3,
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    const completeAttempt = vi.spyOn(store, 'completeSyncAttempt');
    const first = new DirectLibreLinkUpSource(credentials, store);
    const second = new DirectLibreLinkUpSource(credentials, store);

    await Promise.all([first.refresh(), second.refresh()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(completeAttempt).toHaveBeenCalledTimes(1);
    expect(completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 't1arc-librelinkup',
        lastAttemptAt: now,
        lastSuccessAt: now,
        recordCount: 1,
      }),
      now,
    );
    expect(await store.getSyncState('t1arc-librelinkup')).toEqual({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now,
      lastSuccessAt: now,
      recordCount: 1,
    });
  });

  it('does not coalesce a replacement owner behind the superseded account', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    let releaseOldConnection!: (response: Response) => void;
    let callIndex = 0;
    const connections = () =>
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      });
    const graph = (value: number) =>
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: value,
              TrendArrow: 3,
            },
          ],
        },
      });
    const fetchMock = vi.fn(async () => {
      const current = callIndex++;
      if (current === 0) {
        return new Promise<Response>((resolve) => {
          releaseOldConnection = resolve;
        });
      }
      if (current === 1) return connections();
      if (current === 2) return graph(126);
      if (current === 3) return graph(117);
      throw new Error('Unexpected LibreLinkUp request.');
    }) as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const owner = (ownerGeneration: number, identity: string) => ({
      sourceId: 't1arc-librelinkup' as const,
      localDataWriteLease: { epoch: 0 },
      ownerGeneration,
      identityDigest: identity.repeat(64),
    });
    const oldRefresh = new DirectLibreLinkUpSource(
      credentials,
      new MemoryGlucoseHistoryStore(),
      { sourceWriteLease: owner(1, 'a') },
    ).refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const replacementStore = new MemoryGlucoseHistoryStore();
    const replacementRefresh = new DirectLibreLinkUpSource(
      credentials,
      replacementStore,
      { sourceWriteLease: owner(2, 'b') },
    ).refresh();

    await expect(replacementRefresh).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      await replacementStore.getLatestReading('t1arc-librelinkup'),
    ).toMatchObject({ mmolL: 7 });

    releaseOldConnection(connections());
    await expect(oldRefresh).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('coalesces a validated-network edge behind a failed owner, then retries without overlap', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.setSystemTime(now);
    const recoveryResponses = [
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: 117,
              TrendArrow: 3,
            },
          ],
        },
      }),
    ];
    let callIndex = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          const currentCall = callIndex++;
          activeRequests += 1;
          maximumActiveRequests = Math.max(
            maximumActiveRequests,
            activeRequests,
          );
          if (currentCall === 0) {
            setTimeout(() => {
              activeRequests -= 1;
              reject(new Error('Network changed during request.'));
            }, 10_000);
            return;
          }
          const response = recoveryResponses.shift();
          activeRequests -= 1;
          if (response) resolve(response);
          else reject(new Error('Unexpected LibreLinkUp request.'));
        }),
    ) as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    const owner = new DirectLibreLinkUpSource(credentials, store).refresh();
    const ownerOutcome = owner.then(
      () => 'fulfilled' as const,
      () => 'rejected' as const,
    );
    await vi.advanceTimersByTimeAsync(0);
    const recovery = new DirectLibreLinkUpSource(credentials, store, {
      refreshReason: 'validated-network',
    }).refresh();

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(ownerOutcome).resolves.toBe('rejected');
    await expect(recovery).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maximumActiveRequests).toBe(1);
    expect(await store.getSyncState('t1arc-librelinkup')).toMatchObject({
      lastAttemptAt: now + 30_000,
      lastSuccessAt: now + 30_000,
      recordCount: 1,
    });
  });

  it('persists one concurrent failure and preserves its typed backoff error', async () => {
    let now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = sequenceFetch(jsonResponse({ status: 0 }, 429));
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    const completeAttempt = vi.spyOn(store, 'completeSyncAttempt');
    const claimAttempt = vi.spyOn(store, 'claimSyncAttempt');
    const first = new DirectLibreLinkUpSource(credentials, store);
    const second = new DirectLibreLinkUpSource(credentials, store);

    const results = await Promise.allSettled([
      first.refresh(),
      second.refresh(),
    ]);

    expect(results.some((result) => result.status === 'rejected')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(completeAttempt).toHaveBeenCalledTimes(1);
    expect(await store.getSyncState('t1arc-librelinkup')).toMatchObject({
      lastAttemptAt: now,
      lastErrorCode: 'rate-limited',
      recordCount: 0,
    });

    claimAttempt.mockClear();
    now += 60_000;
    const duringBackoff = new DirectLibreLinkUpSource(credentials, store);
    await expect(duringBackoff.refresh()).rejects.toMatchObject({
      code: 'rate-limited',
      message: expect.stringContaining('rate-limited'),
    });
    expect(claimAttempt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not open a claim transaction before the persisted interval is due', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    const reading: GlucoseReading = {
      id: 't1arc-librelinkup:recent',
      sourceId: 't1arc-librelinkup',
      timestamp: now - 60_000,
      receivedAt: now - 55_000,
      mmolL: 6.5,
      trend: 'flat',
      quality: 'measured',
    };
    await store.upsertReadings([reading]);
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now - 15_000,
      lastSuccessAt: now - 15_000,
      recordCount: 1,
    });
    const claimAttempt = vi.spyOn(store, 'claimSyncAttempt');

    await new DirectLibreLinkUpSource(credentials, store).refresh();

    expect(claimAttempt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a current timestamp current while retaining a transient source error', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 't1arc-librelinkup:current-cached',
        sourceId: 't1arc-librelinkup',
        timestamp: now - 60_000,
        receivedAt: now - 55_000,
        mmolL: 6.5,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now,
      lastSuccessAt: now - 60_000,
      lastErrorCode: 'network',
      lastErrorMessage: 'Temporary network problem.',
      recordCount: 1,
    });

    const status = await new DirectLibreLinkUpSource(
      credentials,
      store,
    ).getStatus(now);

    expect(status).toMatchObject({
      freshness: 'current',
      dataThrough: now - 60_000,
      errorCode: 'network',
      detail: expect.stringContaining('Temporary network problem.'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an unrecognised persisted error code to the safe network fallback', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now,
      lastErrorCode: 'future-error-code',
      lastErrorMessage: 'A newer build recorded this error.',
      recordCount: 0,
    });

    await expect(
      new DirectLibreLinkUpSource(credentials, store).refresh(),
    ).rejects.toMatchObject({
      code: 'network',
      message: 'A newer build recorded this error.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a validated-network trigger to bypass one transient persisted delay', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = sequenceFetch(
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: 117,
              TrendArrow: 3,
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 't1arc-librelinkup:cached',
        sourceId: 't1arc-librelinkup',
        timestamp: now - 7 * 60_000,
        receivedAt: now - 7 * 60_000,
        mmolL: 6.2,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now - 30_000,
      lastSuccessAt: now - 7 * 60_000,
      lastErrorCode: 'invalid-response',
      lastErrorMessage: 'Temporary response problem.',
      recordCount: 1,
    });

    await new DirectLibreLinkUpSource(credentials, store).refresh();
    expect(fetchMock).not.toHaveBeenCalled();

    await new DirectLibreLinkUpSource(credentials, store, {
      refreshReason: 'validated-network',
    }).refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const state = await store.getSyncState('t1arc-librelinkup');
    expect(state).toMatchObject({ recordCount: 2 });
    expect(state).not.toHaveProperty('lastErrorCode');
  });

  it.each(['rate-limited', 'action-required'] as const)(
    'never lets validated-network bypass %s backoff',
    async (lastErrorCode) => {
      const now = Date.parse('2026-08-19T12:00:00+01:00');
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
      vi.stubGlobal('fetch', fetchMock);
      const store = new MemoryGlucoseHistoryStore();
      await store.upsertReadings([
        {
          id: 't1arc-librelinkup:cached',
          sourceId: 't1arc-librelinkup',
          timestamp: now - 7 * 60_000,
          receivedAt: now - 7 * 60_000,
          mmolL: 6.2,
          trend: 'flat',
          quality: 'measured',
        },
      ]);
      await store.saveSyncState({
        sourceId: 't1arc-librelinkup',
        lastAttemptAt: now - 60_000,
        lastSuccessAt: now - 7 * 60_000,
        lastErrorCode,
        lastErrorMessage: 'Durable backoff.',
        recordCount: 1,
      });
      const claimAttempt = vi.spyOn(store, 'claimSyncAttempt');

      await new DirectLibreLinkUpSource(credentials, store, {
        refreshReason: 'validated-network',
      }).refresh();

      expect(claimAttempt).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('consumes validated-network once without bypassing the attempt lease', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-19T12:00:00+01:00');
    vi.setSystemTime(now);
    const fetchMock = sequenceFetch(
      jsonResponse({
        status: 0,
        data: [{ patientId: 'patient-1', firstName: 'Alex' }],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '8/19/2026 10:59:00 AM',
              ValueInMgPerDl: 117,
              TrendArrow: 3,
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 't1arc-librelinkup:cached',
        sourceId: 't1arc-librelinkup',
        timestamp: now - 7 * 60_000,
        receivedAt: now - 7 * 60_000,
        mmolL: 6.2,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    await store.saveSyncState({
      sourceId: 't1arc-librelinkup',
      lastAttemptAt: now - 10_000,
      lastSuccessAt: now - 7 * 60_000,
      lastErrorCode: 'invalid-response',
      lastErrorMessage: 'Temporary response problem.',
      recordCount: 1,
    });
    const claimAttempt = vi.spyOn(store, 'claimSyncAttempt');
    const source = new DirectLibreLinkUpSource(credentials, store, {
      refreshReason: 'validated-network',
    });

    const refresh = source.refresh();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(refresh).resolves.toBeUndefined();
    await source.refresh();

    expect(claimAttempt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
