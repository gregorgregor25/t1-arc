import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

import {
  parseHevyEventPage,
  parseHevyUser,
  parseHevyWorkoutCount,
  parseHevyWorkoutPage,
} from './validation';
import type { HevyWorkout, HevyWorkoutEvent } from './types';

const HEVY_API_URL = 'https://api.hevyapp.com';
const PAGE_SIZE = 10;
const MAX_PAGES = 500;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_INTERVAL_MS = 3_000;
const DEFAULT_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 65_000;
const PRODUCTION_REQUEST_GATE = { nextRequestAt: 0 };

function invalidResponse(error: unknown) {
  return new HevyError(
    'invalid-response',
    error instanceof Error && error.message.startsWith('Hevy returned')
      ? `${error.message} Your existing workouts are unchanged.`
      : 'Hevy returned an unexpected response. Your existing workouts are unchanged.',
  );
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function parseHevyRetryAfterMs(
  value: string | null,
  now: number,
  fallbackMs: number,
) {
  const trimmed = value?.trim();
  let delay: number | undefined;
  if (trimmed && /^\d+$/.test(trimmed)) {
    delay = Number(trimmed) * 1_000;
  } else if (trimmed) {
    const retryAt = Date.parse(trimmed);
    if (Number.isFinite(retryAt)) delay = Math.max(0, retryAt - now);
  }
  return Math.max(0, Number.isFinite(delay) ? (delay as number) : fallbackMs);
}

export interface HevyRequestGate {
  nextRequestAt: number;
}

export interface HevyClientOptions {
  minimumRequestIntervalMs?: number;
  maxRateLimitRetries?: number;
  retryAfterFallbackMs?: number;
  now?: () => number;
  requestGate?: HevyRequestGate;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
}

export type HevyErrorCode =
  | 'invalid-key'
  | 'unauthorised'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'invalid-response';

export class HevyError extends Error {
  constructor(
    readonly code: HevyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeHevyApiKey(value: string) {
  const key = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    )
  ) {
    throw new HevyError(
      'invalid-key',
      'Enter the API key shown in Hevy web settings. It should be a UUID.',
    );
  }
  return key;
}

export class HevyClient {
  private readonly minimumRequestIntervalMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly retryAfterFallbackMs: number;
  private readonly now: () => number;
  private readonly requestGate: HevyRequestGate;
  private readonly signal: AbortSignal | undefined;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    options: HevyClientOptions = {},
  ) {
    this.minimumRequestIntervalMs = Math.max(
      0,
      options.minimumRequestIntervalMs ??
        (fetchImpl === fetch ? DEFAULT_REQUEST_INTERVAL_MS : 0),
    );
    this.maxRateLimitRetries = Math.max(
      0,
      Math.floor(options.maxRateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES),
    );
    this.retryAfterFallbackMs = Math.max(
      0,
      options.retryAfterFallbackMs ?? DEFAULT_RETRY_AFTER_MS,
    );
    this.now = options.now ?? Date.now;
    this.requestGate =
      options.requestGate ??
      (fetchImpl === fetch
        ? PRODUCTION_REQUEST_GATE
        : { nextRequestAt: 0 });
    this.signal = options.signal;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private abortError() {
    const error = new Error('The Hevy request was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  private throwIfAborted() {
    if (this.signal?.aborted) throw this.abortError();
  }

  private async sleepUntil(milliseconds: number) {
    this.throwIfAborted();
    if (!this.signal) {
      await this.sleep(milliseconds);
      return;
    }

    const signal = this.signal;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(this.abortError()));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void Promise.resolve()
        .then(() => this.sleep(milliseconds))
        .then(
          () => finish(resolve),
          (error) => finish(() => reject(error)),
        );
    });
    this.throwIfAborted();
  }

  private async waitForRequestSlot() {
    this.throwIfAborted();
    const waitMs = Math.max(0, this.requestGate.nextRequestAt - this.now());
    if (waitMs > 0) await this.sleepUntil(waitMs);
    this.throwIfAborted();
    const startedAt = this.now();
    this.requestGate.nextRequestAt =
      Math.max(startedAt, this.requestGate.nextRequestAt) +
      this.minimumRequestIntervalMs;
  }

  private async fetchResponse(path: string) {
    await this.waitForRequestSlot();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    this.signal?.addEventListener('abort', cancel, { once: true });
    if (this.signal?.aborted) cancel();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${HEVY_API_URL}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'api-key': this.apiKey },
        signal: controller.signal,
      });
      let value: unknown;
      if (response.ok) {
        try {
          // Keep the response body under the same timeout and ownership signal
          // as the header fetch. A stalled stream must not hold privacy erase.
          value = await response.json();
        } catch (error) {
          if (this.signal?.aborted) throw this.abortError();
          if (controller.signal.aborted) throw error;
          throw new HevyError(
            'invalid-response',
            'Hevy returned an unreadable response. Your existing workouts are unchanged.',
          );
        }
      }
      return { response, value };
    } catch (error) {
      if (this.signal?.aborted) throw this.abortError();
      if (error instanceof HevyError) throw error;
      throw new HevyError(
        'network',
        error instanceof Error && error.name === 'AbortError'
          ? 'The Hevy request timed out. Your existing workouts are unchanged.'
          : 'T1 Arc could not reach Hevy. Check the connection and try again.',
      );
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', cancel);
    }
  }

  private async request(path: string) {
    for (let rateLimitAttempt = 0; ; rateLimitAttempt += 1) {
      const { response, value } = await this.fetchResponse(path);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new HevyError(
            'unauthorised',
            'Hevy did not accept this API key. Confirm that the account has Hevy Pro and create a current key in Hevy web settings.',
          );
        }
        if (response.status === 429) {
          if (rateLimitAttempt < this.maxRateLimitRetries) {
            const fallbackMs =
              this.retryAfterFallbackMs * 2 ** rateLimitAttempt;
            await this.sleepUntil(
              parseHevyRetryAfterMs(
                response.headers.get('Retry-After'),
                this.now(),
                fallbackMs,
              ),
            );
            continue;
          }
          throw new HevyError(
            'rate-limited',
            'Hevy is still limiting requests after automatic retries. T1 Arc will try again later. Your existing workouts are unchanged.',
          );
        }
        if (response.status >= 500) {
          throw new HevyError(
            'server',
            'Hevy is temporarily unavailable. Your existing workouts are unchanged.',
          );
        }
        throw new HevyError(
          'server',
          `Hevy returned HTTP ${response.status}. Your existing workouts are unchanged.`,
        );
      }
      return value;
    }
  }

  async getUser() {
    const response = await this.request('/v1/user/info');
    try {
      return parseHevyUser(response);
    } catch (error) {
      throw invalidResponse(error);
    }
  }

  private async getWorkoutCount() {
    const response = await this.request('/v1/workouts/count');
    try {
      return parseHevyWorkoutCount(response);
    } catch (error) {
      throw invalidResponse(error);
    }
  }

  private async getWorkoutSnapshot() {
    // Hevy does not expose a snapshot token. Bracket pagination with its
    // official count endpoint and reject any inconsistent view so full
    // reconciliation can never delete good local history after truncation.
    const countBefore = await this.getWorkoutCount();
    if (countBefore > MAX_PAGES * PAGE_SIZE) {
      throw new HevyError(
        'invalid-response',
        'The Hevy history is larger than T1 Arc can import safely in one operation. Your existing workouts are unchanged.',
      );
    }

    const expectedPageCount =
      countBefore === 0 ? 0 : Math.ceil(countBefore / PAGE_SIZE);
    const workouts: HevyWorkout[] = [];
    let reportedPageCount: number | undefined;

    for (let page = 1; page <= Math.max(1, expectedPageCount); page += 1) {
      const value = await this.request(
        `/v1/workouts?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      let response;
      try {
        response = parseHevyWorkoutPage(value);
      } catch (error) {
        throw invalidResponse(error);
      }

      if (response.page !== page) {
        throw invalidResponse(
          new Error(
            `Hevy returned workout page ${response.page} while page ${page} was requested.`,
          ),
        );
      }
      if (response.pageCount > MAX_PAGES) {
        throw new HevyError(
          'invalid-response',
          'The Hevy history is larger than T1 Arc can import safely in one operation. Your existing workouts are unchanged.',
        );
      }
      if (reportedPageCount === undefined) {
        reportedPageCount = response.pageCount;
      } else if (response.pageCount !== reportedPageCount) {
        throw invalidResponse(
          new Error(
            'Hevy returned a workout page count that changed while T1 Arc was reading history.',
          ),
        );
      }
      if (response.pageCount !== expectedPageCount) {
        throw invalidResponse(
          new Error(
            'Hevy returned a workout page count that does not match the account total.',
          ),
        );
      }
      if (expectedPageCount === 0 && response.workouts.length !== 0) {
        throw invalidResponse(
          new Error('Hevy returned workouts for an account with no workouts.'),
        );
      }

      workouts.push(...response.workouts);
    }

    const countAfter = await this.getWorkoutCount();
    if (countAfter !== countBefore) {
      throw invalidResponse(
        new Error(
          'Hevy returned a workout total that changed while T1 Arc was reading history.',
        ),
      );
    }
    if (workouts.length !== countBefore) {
      throw invalidResponse(
        new Error('Hevy returned an incomplete workout history.'),
      );
    }
    if (new Set(workouts.map(({ id }) => id)).size !== workouts.length) {
      throw invalidResponse(
        new Error('Hevy returned overlapping workout history pages.'),
      );
    }
    return workouts;
  }

  async getAllWorkouts() {
    // One exact, count-bracketed crawl is staged non-destructively by the
    // repository. A later scheduled crawl must have the same ID fingerprint
    // before any locally stored workout can be pruned.
    return this.getWorkoutSnapshot();
  }

  async getWorkoutEvents(since: number) {
    const events: HevyWorkoutEvent[] = [];
    const sinceIso = encodeURIComponent(new Date(since).toISOString());
    let reportedPageCount: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const value = await this.request(
        `/v1/workouts/events?page=${page}&pageSize=${PAGE_SIZE}&since=${sinceIso}`,
      );
      let response;
      try {
        response = parseHevyEventPage(value);
      } catch (error) {
        throw invalidResponse(error);
      }

      if (response.page !== page) {
        throw invalidResponse(
          new Error(
            `Hevy returned workout event page ${response.page} while page ${page} was requested.`,
          ),
        );
      }
      if (response.pageCount > MAX_PAGES) {
        throw new HevyError(
          'invalid-response',
          'The Hevy update feed is larger than T1 Arc can process safely in one operation. Your existing workouts are unchanged.',
        );
      }
      if (reportedPageCount === undefined) {
        reportedPageCount = response.pageCount;
      } else if (response.pageCount !== reportedPageCount) {
        throw invalidResponse(
          new Error(
            'Hevy returned a workout event page count that changed while T1 Arc was reading updates.',
          ),
        );
      }
      if (response.pageCount === 0 && response.events.length !== 0) {
        throw invalidResponse(
          new Error('Hevy returned workout events for an empty event feed.'),
        );
      }

      events.push(...response.events);
      if (page >= response.pageCount) {
        // Hevy documents this feed as newest-to-oldest, including across pages.
        // Apply it in reverse so an older update cannot overwrite a newer one.
        // This also avoids relying on deleted_at, which the API contract makes
        // optional for deletion events.
        return events.reverse();
      }
    }
    throw new HevyError(
      'invalid-response',
      'The Hevy update feed is larger than T1 Arc can process safely in one operation.',
    );
  }
}

export function eventTimestamp(event: HevyWorkoutEvent) {
  const timestamp =
    event.type === 'updated' ? event.workout.updated_at : event.deleted_at;
  return parseExternalAbsoluteTimestamp(timestamp) ?? Number.NEGATIVE_INFINITY;
}
