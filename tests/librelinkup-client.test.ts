import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LibreLinkUpClient,
  normaliseLibreMeasurement,
  parseLibreTimestamp,
} from '@/data/libreLinkUp/LibreLinkUpClient';
import {
  DIRECT_LIBRE_ACTION_REQUIRED_BACKOFF_MS,
  DIRECT_LIBRE_ATTEMPT_LEASE_MS,
  DIRECT_LIBRE_CATCH_UP_REFRESH_MS,
  DIRECT_LIBRE_INVALID_RESPONSE_BACKOFF_MS,
  DIRECT_LIBRE_NETWORK_BACKOFF_MS,
  DIRECT_LIBRE_NORMAL_REFRESH_MS,
  DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS,
  DIRECT_LIBRE_STALE_REFRESH_MS,
  directLibreRefreshInterval,
} from '@/data/libreLinkUp/refreshPolicy';
import { LibreLinkUpError } from '@/data/libreLinkUp/types';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

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

  it('fails closed when only a local timestamp has no confirmed source timezone', () => {
    const reading = normaliseLibreMeasurement({
      Timestamp: '7/25/2026 1:30:00 PM',
      ValueInMgPerDl: 108,
      TrendArrow: 4,
    });

    expect(reading).toBeUndefined();
  });

  it('uses an explicit immutable source timezone for local timestamp fallback', () => {
    const reading = normaliseLibreMeasurement(
      {
        Timestamp: '7/25/2026 1:30:00 PM',
        ValueInMgPerDl: 108,
        TrendArrow: 4,
      },
      't1arc-librelinkup',
      'Europe/London',
    );

    expect(reading).toMatchObject({
      timestamp: Date.UTC(2026, 6, 25, 12, 30),
      mmolL: 6,
      trend: 'slightUp',
      sourceId: 't1arc-librelinkup',
    });
  });

  it('retains both source timestamps and reports disagreement for diagnosis', () => {
    const reading = normaliseLibreMeasurement(
      {
        FactoryTimestamp: '7/25/2026 12:30:00 PM',
        Timestamp: '7/25/2026 3:30:00 PM',
        ValueInMgPerDl: 126,
        TrendArrow: 3,
      },
      't1arc-librelinkup',
      'Europe/London',
    );

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

  it('keeps rapid catch-up active until data becomes stale', () => {
    expect(
      directLibreRefreshInterval(now - 7 * 60_000, undefined, now),
    ).toBe(DIRECT_LIBRE_CATCH_UP_REFRESH_MS);
    expect(
      directLibreRefreshInterval(now - (12 * 60_000 - 1), undefined, now),
    ).toBe(DIRECT_LIBRE_CATCH_UP_REFRESH_MS);
  });

  it('backs off further once data is stale', () => {
    expect(
      directLibreRefreshInterval(now - 12 * 60_000, undefined, now),
    ).toBe(DIRECT_LIBRE_STALE_REFRESH_MS);
  });

  it('backs off explicitly when LibreLinkUp rate limits the account', () => {
    expect(
      directLibreRefreshInterval(now - 6 * 60_000, 'rate-limited', now),
    ).toBe(DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS);
  });

  it('persists error-specific retry intervals between source instances', () => {
    expect(
      directLibreRefreshInterval(now - 6 * 60_000, 'network', now),
    ).toBe(DIRECT_LIBRE_NETWORK_BACKOFF_MS);
    expect(
      directLibreRefreshInterval(now - 6 * 60_000, 'invalid-response', now),
    ).toBe(DIRECT_LIBRE_INVALID_RESPONSE_BACKOFF_MS);
    expect(
      directLibreRefreshInterval(now - 6 * 60_000, 'action-required', now),
    ).toBe(DIRECT_LIBRE_ACTION_REQUIRED_BACKOFF_MS);
    expect(DIRECT_LIBRE_NETWORK_BACKOFF_MS).toBe(30_000);
    expect(DIRECT_LIBRE_INVALID_RESPONSE_BACKOFF_MS).toBe(60_000);
    expect(DIRECT_LIBRE_STALE_REFRESH_MS).toBe(60_000);
  });

  it('only lets validated network bypass transient persisted eligibility', () => {
    expect(
      directLibreRefreshInterval(
        now - 6 * 60_000,
        'invalid-response',
        now,
        'validated-network',
      ),
    ).toBe(DIRECT_LIBRE_ATTEMPT_LEASE_MS);
    expect(
      directLibreRefreshInterval(
        now - 6 * 60_000,
        'rate-limited',
        now,
        'validated-network',
      ),
    ).toBe(DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS);
    expect(
      directLibreRefreshInterval(
        now - 6 * 60_000,
        'action-required',
        now,
        'validated-network',
      ),
    ).toBe(DIRECT_LIBRE_ACTION_REQUIRED_BACKOFF_MS);
  });

  it('does not enter a rapid loop before any reading has been saved', () => {
    expect(directLibreRefreshInterval(undefined, undefined, now)).toBe(
      DIRECT_LIBRE_NORMAL_REFRESH_MS,
    );
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

  it.each([
    ['empty', {}],
    [
      'stale',
      {
        glucoseMeasurement: {
          FactoryTimestamp: '7/25/2026 12:05:00 PM',
          ValueInMgPerDl: 117,
          TrendArrow: 3,
        },
      },
    ],
  ])(
    'keeps the fresher connections measurement when graph connection is %s',
    async (_kind, graphConnection) => {
      const fetchMock = sequenceFetch(
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
              glucoseMeasurement: {
                FactoryTimestamp: '7/25/2026 12:10:00 PM',
                ValueInMgPerDl: 126,
                TrendArrow: 4,
              },
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
            ],
            connection: graphConnection,
          },
        }),
      );
      const client = new LibreLinkUpClient(
        credentials,
        async (value) => `sha256:${value}`,
        fetchMock,
      );

      const snapshot = await client.getSnapshot();

      expect(snapshot.readings.at(-1)).toMatchObject({
        timestamp: Date.UTC(2026, 6, 25, 12, 10),
        mmolL: 7,
        trend: 'slightUp',
      });
    },
  );

  it('uses the graph correction once when both currents share a timestamp', async () => {
    const fetchMock = sequenceFetch(
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
            glucoseMeasurement: {
              FactoryTimestamp: '7/25/2026 12:10:00 PM',
              ValueInMgPerDl: 126,
              TrendArrow: 4,
            },
          },
        ],
      }),
      jsonResponse({
        status: 0,
        data: {
          graphData: [],
          connection: {
            patientId: 'patient-1',
            glucoseMeasurement: {
              FactoryTimestamp: '7/25/2026 12:10:00 PM',
              ValueInMgPerDl: 144,
              TrendArrow: 2,
            },
          },
        },
      }),
    );
    const client = new LibreLinkUpClient(
      credentials,
      async (value) => `sha256:${value}`,
      fetchMock,
    );

    const snapshot = await client.getSnapshot();
    const correctedTimestamp = Date.UTC(2026, 6, 25, 12, 10);
    const corrected = snapshot.readings.filter(
      (reading) => reading.timestamp === correctedTimestamp,
    );

    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({
      mmolL: 8,
      trend: 'slightDown',
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

  it('does not expose raw fetch or native exception details', async () => {
    const fetchFailure = vi.fn(async () => {
      throw new Error(
        'NativeStatement.finalizeAsync rejected: database is locked',
      );
    }) as unknown as typeof fetch;
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      fetchFailure,
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'network',
      message:
        'Unable to reach LibreLinkUp. Check your internet connection and try again.',
    });
  });

  it('honours an explicit caller abort for the active request', async () => {
    const stalledFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;
    const controller = new AbortController();
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      stalledFetch,
      undefined,
      undefined,
      20_000,
    );

    const snapshot = client.getSnapshot(controller.signal);
    controller.abort();

    await expect(snapshot).rejects.toMatchObject({
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

  it('fails closed when the patient bound to a saved session disappears', async () => {
    const fetchMock = sequenceFetch(
      jsonResponse({
        status: 0,
        data: [{ patientId: 'different-patient', firstName: 'Sam' }],
      }),
    );
    const client = new LibreLinkUpClient(
      credentials,
      async () => 'hash',
      fetchMock,
      {
        token: 'saved-token',
        expiresAt: Date.now() + 3_600_000,
        userId: 'user-1',
        region: 'eu',
        version: '4.17.0',
        accountEmail: credentials.email,
        patientId: 'patient-1',
      },
    );

    await expect(client.getSnapshot()).rejects.toMatchObject({
      code: 'patient-selection-required',
      message: expect.stringContaining('no longer available'),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
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
