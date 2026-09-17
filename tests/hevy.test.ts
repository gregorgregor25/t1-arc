import { describe, expect, it, vi } from 'vitest';

import {
  HevyClient,
  HevyError,
  normalizeHevyApiKey,
  parseHevyRetryAfterMs,
} from '@/data/hevy/client';
import { hevyWorkoutToActivity } from '@/data/hevy/mapping';
import { parseHevyWorkout } from '@/data/hevy/validation';
import { isCompletedHevyWorkout } from '@/data/hevy/completion';

const KEY = '123e4567-e89b-42d3-a456-426614174000';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function workout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-one',
    title: 'Upper body',
    routine_id: 'routine-one',
    description: 'Steady session',
    start_time: '2026-08-14T17:00:00.000Z',
    end_time: '2026-08-14T18:00:00.000Z',
    updated_at: '2026-08-14T18:05:00.000Z',
    created_at: '2026-08-14T18:05:00.000Z',
    exercises: [
      {
        index: 0,
        title: 'Bench Press (Barbell)',
        notes: 'Controlled reps',
        exercise_template_id: 'bench',
        supersets_id: null,
        sets: [
          {
            index: 0,
            type: 'normal',
            weight_kg: 80,
            reps: 8,
            distance_meters: null,
            duration_seconds: null,
            rpe: 8.5,
            custom_metric: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Hevy read-only integration', () => {
  it('validates the UUID-shaped Pro API key before making a request', () => {
    expect(normalizeHevyApiKey(` ${KEY} `)).toBe(KEY);
    expect(() => normalizeHevyApiKey('not-a-key')).toThrow(HevyError);
  });

  it('rejects offsetless provider times instead of using the phone timezone', () => {
    expect(() =>
      parseHevyWorkout(workout({ start_time: '2026-08-14T17:00:00' })),
    ).toThrow(/invalid workout start time/i);
    expect(() =>
      parseHevyWorkout(workout({ updated_at: '2026-08-14T18:05:00' })),
    ).toThrow(/invalid workout update time/i);
  });

  it('parses Retry-After delay seconds, HTTP dates and malformed fallbacks', () => {
    const now = Date.parse('2026-08-18T20:00:00.000Z');
    expect(parseHevyRetryAfterMs('12', now, 65_000)).toBe(12_000);
    expect(
      parseHevyRetryAfterMs('Tue, 18 Aug 2026 20:02:00 GMT', now, 65_000),
    ).toBe(120_000);
    expect(parseHevyRetryAfterMs('not-a-delay', now, 65_000)).toBe(65_000);
  });

  it('honours Retry-After and retries a rate-limited request automatically', async () => {
    let now = 1_000;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'user', name: 'Hevy user' } }),
          { status: 200 },
        ),
      );
    const client = new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
      {
        maxRateLimitRetries: 1,
        minimumRequestIntervalMs: 0,
        now: () => now,
        sleep,
      },
    );

    await expect(client.getUser()).resolves.toMatchObject({ id: 'user' });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses exponential fallback and eventually fails closed on repeated 429s', async () => {
    let now = 1_000;
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const fetchMock = vi.fn(async () => new Response('', { status: 429 }));
    const client = new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
      {
        maxRateLimitRetries: 2,
        minimumRequestIntervalMs: 0,
        now: () => now,
        retryAfterFallbackMs: 100,
        sleep,
      },
    );

    await expect(client.getUser()).rejects.toMatchObject({
      code: 'rate-limited',
      message: expect.stringContaining('existing workouts are unchanged'),
    });
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      100, 200,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('paces request starts across separate clients sharing one gate', async () => {
    let now = 0;
    const gate = { nextRequestAt: 0 };
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { id: 'user', name: 'Hevy user' } }),
      ),
    );
    const options = {
      minimumRequestIntervalMs: 3_000,
      now: () => now,
      requestGate: gate,
      sleep,
    };

    await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
      options,
    ).getUser();
    await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
      options,
    ).getUser();

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('cancels a pending rate-limit sleep without waiting for its timer', async () => {
    const sleeping = deferred<void>();
    const sleep = vi.fn(() => sleeping.promise);
    const controller = new AbortController();
    const client = new HevyClient(
      KEY,
      vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch,
      {
        maxRateLimitRetries: 1,
        minimumRequestIntervalMs: 0,
        signal: controller.signal,
        sleep,
      },
    );
    const request = client.getUser();
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce());

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    sleeping.resolve();
  });

  it('keeps a stalled response body under the ownership abort signal', async () => {
    const bodyStarted = deferred<void>();
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        ({
          headers: new Headers(),
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  const error = new Error('body aborted');
                  error.name = 'AbortError';
                  reject(error);
                },
                { once: true },
              );
              bodyStarted.resolve();
            }),
        }) as Response,
    );
    const request = new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
      { minimumRequestIntervalMs: 0, signal: controller.signal },
    ).getUser();
    await bodyStarted.promise;

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps exact exercises and sets into a strength activity without losing provenance', () => {
    const activity = hevyWorkoutToActivity(parseHevyWorkout(workout()), 1234);
    expect(activity).toMatchObject({
      id: 'hevy:workout-one',
      title: 'Upper body',
      activityType: 'strength',
      durationMinutes: 60,
      intensity: 'vigorous',
      sourceId: 'hevy',
      origin: 'imported',
    });
    expect(activity.strengthWorkout?.exercises[0]).toMatchObject({
      title: 'Bench Press (Barbell)',
      sets: [{ weightKilograms: 80, reps: 8, rpe: 8.5 }],
    });
  });

  it('verifies and retains a complete multi-page Hevy history', async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const value = String(url);
        if (value.endsWith('/v1/workouts/count')) {
          return new Response(JSON.stringify({ workout_count: 11 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const page = value.includes('page=2') ? 2 : 1;
        const firstId = page === 1 ? 1 : 11;
        const pageSize = page === 1 ? 10 : 1;
        return new Response(
          JSON.stringify({
            page,
            page_count: 2,
            workouts: Array.from({ length: pageSize }, (_, index) =>
              workout({ id: `workout-${firstId + index}` }),
            ),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = new HevyClient(KEY, fetchImpl);
    const workouts = await client.getAllWorkouts();
    expect(workouts).toHaveLength(11);
    expect(workouts.at(-1)?.id).toBe('workout-11');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('pageSize=10');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'api-key': KEY,
    });
  });

  it('accepts a verified account with no workout history', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      return new Response(
        JSON.stringify(
          value.endsWith('/v1/workouts/count')
            ? { workout_count: 0 }
            : { page: 1, page_count: 0, workouts: [] },
        ),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a repeated or mismatched workout page', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith('/v1/workouts/count')) {
        return new Response(JSON.stringify({ workout_count: 11 }));
      }
      const requestedPage = value.includes('page=2') ? 2 : 1;
      return new Response(
        JSON.stringify({
          page: requestedPage === 2 ? 1 : requestedPage,
          page_count: 2,
          workouts: Array.from(
            { length: requestedPage === 1 ? 10 : 1 },
            (_, index) =>
              workout({ id: `workout-${requestedPage}-${index}` }),
          ),
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects overlapping page contents even when page numbers advance', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith('/v1/workouts/count')) {
        return new Response(JSON.stringify({ workout_count: 11 }));
      }
      const page = value.includes('page=2') ? 2 : 1;
      return new Response(
        JSON.stringify({
          page,
          page_count: 2,
          workouts:
            page === 1
              ? Array.from({ length: 10 }, (_, index) =>
                  workout({ id: `workout-${index + 1}` }),
                )
              : [workout({ id: 'workout-10' })],
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('overlapping workout history pages'),
    });
  });

  it('rejects a page count that changes during full history pagination', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith('/v1/workouts/count')) {
        return new Response(JSON.stringify({ workout_count: 11 }));
      }
      const page = value.includes('page=2') ? 2 : 1;
      return new Response(
        JSON.stringify({
          page,
          page_count: page === 1 ? 2 : 3,
          workouts: Array.from(
            { length: page === 1 ? 10 : 1 },
            (_, index) => workout({ id: `workout-${page}-${index}` }),
          ),
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('page count'),
    });
  });

  it('rejects a truncated history whose row count does not match Hevy’s count', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/workouts/count')) {
        return new Response(JSON.stringify({ workout_count: 2 }));
      }
      return new Response(
        JSON.stringify({
          page: 1,
          page_count: 1,
          workouts: [workout({ id: 'only-workout' })],
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('incomplete workout history'),
    });
  });

  it('fails safely when the account total changes during pagination', async () => {
    let countChecks = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/workouts/count')) {
        countChecks += 1;
        return new Response(
          JSON.stringify({ workout_count: countChecks === 1 ? 1 : 2 }),
        );
      }
      return new Response(
        JSON.stringify({
          page: 1,
          page_count: 1,
          workouts: [workout()],
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('workout total that changed'),
    });
  });

  it('rejects negative official workout counts before reading history', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ workout_count: -1 })),
    );

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { page: -1, page_count: 1, label: 'page number' },
    { page: 1, page_count: -1, label: 'page count' },
  ])('rejects a negative workout $label', async (pagination) => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/v1/workouts/count')
            ? { workout_count: 1 }
            : { ...pagination, workouts: [workout()] },
        ),
      ),
    );

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getAllWorkouts(),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('orders overlapping incremental events from oldest to newest', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 1,
            page_count: 1,
            events: [
              {
                type: 'deleted',
                id: 'old-workout',
                deleted_at: '2026-08-15T10:00:00.000Z',
              },
              {
                type: 'updated',
                workout: workout({
                  id: 'updated-workout',
                  updated_at: '2026-08-15T09:00:00.000Z',
                }),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const events = await new HevyClient(KEY, fetchImpl).getWorkoutEvents(0);
    expect(events.map(({ type }) => type)).toEqual(['updated', 'deleted']);
  });

  it('rejects a repeated incremental event page before advancing the cursor', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const requestedPage = String(url).includes('page=2') ? 2 : 1;
      return new Response(
        JSON.stringify({
          page: requestedPage === 2 ? 1 : requestedPage,
          page_count: 2,
          events: [{ type: 'deleted', id: `workout-${requestedPage}` }],
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getWorkoutEvents(0),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a changing incremental event page count', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const page = String(url).includes('page=2') ? 2 : 1;
      return new Response(
        JSON.stringify({
          page,
          page_count: page === 1 ? 2 : 3,
          events: [{ type: 'deleted', id: `workout-${page}` }],
        }),
      );
    });

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getWorkoutEvents(0),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('event page count'),
    });
  });

  it('accepts deletion events without the optional deleted_at field', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 1,
            page_count: 1,
            events: [{ type: 'deleted', id: 'removed-workout' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const events = await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    expect(events).toEqual([{ type: 'deleted', id: 'removed-workout' }]);
  });

  it('accepts Hevy’s empty incremental page without an events field', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ page: 1, page_count: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const events = await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    expect(events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts Hevy’s empty workouts alias on the events endpoint', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ page: 1, page_count: 1, workouts: [] }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );

    const events = await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    expect(events).toEqual([]);
  });

  it('strictly parses event-shaped items in Hevy’s workouts alias', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 1,
            page_count: 1,
            workouts: [{ type: 'deleted', id: 'removed-workout' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const events = await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    expect(events).toEqual([{ type: 'deleted', id: 'removed-workout' }]);
  });

  it('rejects plain workout rows in Hevy’s workouts event alias', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 1,
            page_count: 1,
            workouts: [workout()],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getWorkoutEvents(0),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message:
        'Hevy returned an unknown workout event. Your existing workouts are unchanged.',
    });
  });

  it('prefers canonical events when both event array names are present', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 1,
            page_count: 1,
            events: [{ type: 'deleted', id: 'canonical-event' }],
            workouts: [{ type: 'deleted', id: 'alias-event' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const events = await new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    expect(events).toEqual([{ type: 'deleted', id: 'canonical-event' }]);
  });

  it('rejects a non-empty event page without an events field', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ page: 1, page_count: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getWorkoutEvents(0),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message:
        'Hevy returned an event page without events (page=1, page_count=1; fields=page:number, page_count:number). Your existing workouts are unchanged.',
    });
  });

  it('reports only privacy-safe event envelope diagnostics', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: 2,
            page_count: 3,
            data: {
              events: [
                {
                  workout: {
                    title: 'Private workout title',
                    notes: 'Private workout notes',
                  },
                },
              ],
            },
            error: 'Private server value',
            metadata: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const promise = new HevyClient(
      KEY,
      fetchMock as unknown as typeof fetch,
    ).getWorkoutEvents(0);

    await expect(promise).rejects.toMatchObject({
      code: 'invalid-response',
      message:
        'Hevy returned an event page without events (page=2, page_count=3; fields=data:object, error:string, metadata:null, page:number, page_count:number). Your existing workouts are unchanged.',
    });
    await expect(promise).rejects.not.toThrow(/Private/);
  });

  it('surfaces a safe response-contract error instead of a generic sync failure', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ page: 1, page_count: 1, events: [{}] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      new HevyClient(
        KEY,
        fetchMock as unknown as typeof fetch,
      ).getWorkoutEvents(0),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message:
        'Hevy returned an unknown workout event. Your existing workouts are unchanged.',
    });
  });

  it('fails closed when Hevy changes a required timestamp shape', () => {
    expect(() =>
      parseHevyWorkout(workout({ start_time: 'not-a-date' })),
    ).toThrow(/start time/);
  });

  it('imports only workouts whose declared end time has passed', () => {
    const parsed = parseHevyWorkout(workout());
    expect(
      isCompletedHevyWorkout(parsed, Date.parse('2026-08-14T18:00:01.000Z')),
    ).toBe(true);
    expect(
      isCompletedHevyWorkout(parsed, Date.parse('2026-08-14T17:30:00.000Z')),
    ).toBe(false);
  });
});
