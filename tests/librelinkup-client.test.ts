import { describe, expect, it, vi } from 'vitest';

import {
  LibreLinkUpClient,
  normaliseLibreMeasurement,
  parseLibreTimestamp,
} from '@/data/libreLinkUp/LibreLinkUpClient';
import {
  DIRECT_LIBRE_CATCH_UP_REFRESH_MS,
  DIRECT_LIBRE_NORMAL_REFRESH_MS,
  DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS,
  directLibreRefreshInterval,
} from '@/data/libreLinkUp/refreshPolicy';
import { persistVerifiedLibreSnapshot } from '@/data/libreLinkUp/activateSnapshot';
import { LibreLinkUpError } from '@/data/libreLinkUp/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

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
    if (!response) throw new Error('Unexpected request');
    return response;
  }) as unknown as typeof globalThis.fetch;
}

const credentials = {
  email: 'follower@example.com',
  password: 'not-a-real-password',
  topLevelDomain: 'io' as const,
};

describe('LibreLinkUp normalisation', () => {
  it('parses Libre factory timestamps as UTC', () => {
    expect(
      parseLibreTimestamp('7/25/2026 12:05:00 AM', true),
    ).toBe(Date.UTC(2026, 6, 25, 0, 5));
    expect(
      parseLibreTimestamp('7/25/2026 1:05:00 PM', true),
    ).toBe(Date.UTC(2026, 6, 25, 13, 5));
  });

  it('uses Europe/London when only the local timestamp is available', () => {
    const reading = normaliseLibreMeasurement({
      Timestamp: '7/25/2026 1:30:00 PM',
      ValueInMgPerDl: 108,
      TrendArrow: 4,
    });

    expect(reading).toMatchObject({
      timestamp: Date.UTC(2026, 6, 25, 12, 30),
      mmolL: 6,
      trend: 'slightUp',
      sourceId: 'daymark-librelinkup',
    });
  });

  it('retains both source timestamps and reports disagreement for diagnosis', () => {
    const reading = normaliseLibreMeasurement({
      FactoryTimestamp: '7/25/2026 12:30:00 PM',
      Timestamp: '7/25/2026 3:30:00 PM',
      ValueInMgPerDl: 126,
      TrendArrow: 3,
    });

    expect(reading).toMatchObject({
      sourceFactoryTimestamp: '7/25/2026 12:30:00 PM',
      sourceLocalTimestamp: '7/25/2026 3:30:00 PM',
      timestampDiscrepancyMinutes: 120,
    });
  });
});

describe('LibreLinkUp refresh policy', () => {
  const now = Date.parse('2026-07-27T12:00:00+01:00');

  it('checks rapidly when the next five-minute reading is expected', () => {
    expect(
      directLibreRefreshInterval(now - 4.5 * 60_000, undefined, now),
    ).toBe(DIRECT_LIBRE_CATCH_UP_REFRESH_MS);
  });

  it('uses the lower-impact baseline between expected readings', () => {
    expect(
      directLibreRefreshInterval(now - 2 * 60_000, undefined, now),
    ).toBe(DIRECT_LIBRE_NORMAL_REFRESH_MS);
  });

  it('returns to baseline once data is stale instead of polling aggressively', () => {
    expect(
      directLibreRefreshInterval(now - 13 * 60_000, undefined, now),
    ).toBe(DIRECT_LIBRE_NORMAL_REFRESH_MS);
  });

  it('backs off explicitly when LibreLinkUp rate limits the account', () => {
    expect(
      directLibreRefreshInterval(now - 6 * 60_000, 'rate-limited', now),
    ).toBe(DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS);
  });
});

describe('LibreLinkUp activation', () => {
  it('persists the verified snapshot before the personal dashboard opens', async () => {
    const activatedAt = Date.parse('2026-07-26T09:00:00+01:00');
    const reading = normaliseLibreMeasurement({
      FactoryTimestamp: '7/26/2026 7:59:00 AM',
      Timestamp: '7/26/2026 8:59:00 AM',
      ValueInMgPerDl: 126,
      TrendArrow: 3,
    })!;
    const store = new MemoryGlucoseHistoryStore();

    const bounds = await persistVerifiedLibreSnapshot(
      store,
      {
        readings: [reading],
        patients: [{ id: 'patient-1', name: 'Example' }],
        selectedPatientId: 'patient-1',
        session: {
          token: 'not-real',
          expiresAt: activatedAt + 60_000,
          userId: 'user-1',
          region: 'eu',
          version: '4.17.0',
          accountEmail: credentials.email,
          patientId: 'patient-1',
        },
      },
      activatedAt,
    );

    expect(bounds.count).toBe(1);
    expect(await store.getLatestReading('daymark-librelinkup')).toEqual(
      reading,
    );
    expect(await store.getSyncState('daymark-librelinkup')).toMatchObject({
      lastAttemptAt: activatedAt,
      lastSuccessAt: activatedAt,
      recordCount: 1,
    });
  });
});

describe('LibreLinkUp direct client', () => {
  it('follows the account region and returns deduplicated readings', async () => {
    const fetchMock = sequenceFetch(
      jsonResponse({ status: 0, data: { redirect: true, region: 'eu' } }),
      jsonResponse({
        status: 0,
        data: {
          user: { id: 'user-1' },
          authTicket: { token: 'token-1', expires: 4_102_444_800 },
        },
      }),
      jsonResponse({
        status: 0,
        data: [
          {
            patientId: 'patient-1',
            firstName: 'Alex',
            lastName: 'Example',
          },
        ],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [
            {
              FactoryTimestamp: '7/25/2026 12:00:00 PM',
              ValueInMgPerDl: 108,
              TrendArrow: 3,
            },
            {
              FactoryTimestamp: '7/25/2026 12:05:00 PM',
              ValueInMgPerDl: 117,
              TrendArrow: 4,
            },
          ],
          connection: {
            patientId: 'patient-1',
            glucoseMeasurement: {
              FactoryTimestamp: '7/25/2026 12:05:00 PM',
              ValueInMgPerDl: 117,
              TrendArrow: 4,
            },
          },
        },
      }),
    );
    const savedSessions: string[] = [];
    const client = new LibreLinkUpClient(
      credentials,
      async (value) => `sha256:${value}`,
      fetchMock,
      undefined,
      async (session) => {
        savedSessions.push(session.region);
      },
    );

    const snapshot = await client.getSnapshot();

    expect(snapshot.selectedPatientId).toBe('patient-1');
    expect(snapshot.patients).toEqual([
      { id: 'patient-1', name: 'Alex Example' },
    ]);
    expect(snapshot.readings.map((reading) => reading.mmolL)).toEqual([6, 6.5]);
    expect(snapshot.session).toMatchObject({
      region: 'eu',
      token: 'token-1',
      userId: 'user-1',
      patientId: 'patient-1',
    });
    expect(savedSessions).toContain('eu');

    const calls = (
      fetchMock as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as unknown[][];
    expect(calls.map((call) => call[0])).toEqual([
      'https://api.libreview.io/llu/auth/login',
      'https://api-eu.libreview.io/llu/auth/login',
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections/patient-1/graph',
    ]);
    const connectionOptions = calls[2]![1] as RequestInit;
    expect(connectionOptions.headers).toMatchObject({
      product: 'llu.android',
      version: '4.17.0',
      'Account-Id': 'sha256:user-1',
      Authorization: 'Bearer token-1',
    });
  });

  it('does not accept account terms automatically', async () => {
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      sequenceFetch(
        jsonResponse({
          status: 4,
          data: { step: { type: 'tou' } },
        }),
      ),
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      name: 'LibreLinkUpError',
      code: 'action-required',
      apiStatus: 4,
    } satisfies Partial<LibreLinkUpError>);
  });

  it('labels unreadable encrypted responses as unsupported', async () => {
    const encryptedResponse = new Response('encrypted-payload', {
      status: 200,
    });
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      sequenceFetch(encryptedResponse),
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'unsupported-api',
    });
  });

  it('surfaces rate limiting without retrying', async () => {
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      sequenceFetch(jsonResponse({ status: 0 }, 429)),
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });

  it('times out a stalled source request', async () => {
    const stalledFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      stalledFetch,
      undefined,
      undefined,
      5,
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'network',
      message: 'LibreLinkUp request timed out.',
    });
  });

  it('does not reuse a session saved for another account', async () => {
    const fetchMock = sequenceFetch(
      jsonResponse({ status: 2, data: {} }),
    );
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      fetchMock,
      {
        token: 'another-account-token',
        expiresAt: Date.now() + 3_600_000,
        userId: 'another-user',
        region: 'eu',
        version: '4.17.0',
        accountEmail: 'someone-else@example.com',
      },
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'invalid-credentials',
    });
    const firstCall = (
      fetchMock as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe('https://api.libreview.io/llu/auth/login');
    expect(firstCall[1].headers).not.toHaveProperty('Authorization');
  });

  it('reauthenticates once when a saved token is rejected', async () => {
    const fetchMock = sequenceFetch(
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
              FactoryTimestamp: '7/25/2026 12:05:00 PM',
              ValueInMgPerDl: 117,
              TrendArrow: 4,
            },
          ],
        },
      }),
    );
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      fetchMock,
      {
        token: 'expired-server-side',
        expiresAt: Date.now() + 3_600_000,
        userId: 'user-1',
        region: 'eu',
        version: '4.17.0',
        accountEmail: credentials.email,
      },
    );

    const snapshot = await client.getSnapshot();

    expect(snapshot.session.token).toBe('new-token');
    const calls = (
      fetchMock as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as unknown[][];
    expect(calls.map((call) => call[0])).toEqual([
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/auth/login',
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections/patient-1/graph',
    ]);
  });

  it('keeps non-JSON server errors distinct from encrypted success responses', async () => {
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      sequenceFetch(new Response('<html>Unavailable</html>', { status: 503 })),
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'network',
      message: 'LibreLinkUp request failed with HTTP 503.',
    });
  });
});
