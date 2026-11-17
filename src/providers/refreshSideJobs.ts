/**
 * Ordering rules for one foreground data refresh. Pure apart from timers, so
 * they are unit tested without rendering the provider.
 *
 * The glucose source refresh decides when the "Checking…" indicator ends. The
 * slower side jobs (Health Connect, saved insights, Nightscout history) start
 * at the same time but never hold the indicator: a slow or stuck side job must
 * not leave the spinner on.
 */

export type RefreshSideJobPhase = 'started' | 'finished';

export type RefreshSideJobName = 'health_sync' | 'insight_review' | 'history_sync';

/** Diagnostic names only: no data, counts or errors enter the support log. */
export const REFRESH_SIDE_JOB_DIAGNOSTICS = {
  health_sync: { started: 'health_sync_started', finished: 'health_sync_finished' },
  insight_review: { started: 'insight_review_started', finished: 'insight_review_finished' },
  history_sync: { started: 'history_sync_started', finished: 'history_sync_finished' },
} as const satisfies Record<RefreshSideJobName, Record<RefreshSideJobPhase, string>>;

/**
 * True when a Nightscout history pass finished a block during this refresh,
 * so screens should re-read the stored records.
 */
export function nightscoutHistoryStoredRecords(value: unknown, startedAt: number) {
  if (!value || typeof value !== 'object') return false;
  const lastSuccessAt = (value as { lastSuccessAt?: unknown }).lastSuccessAt;
  return (
    typeof lastSuccessAt === 'number' &&
    Number.isFinite(lastSuccessAt) &&
    lastSuccessAt >= startedAt
  );
}

export interface RefreshSideJob<Name extends string = string> {
  name: Name;
  run(): Promise<unknown>;
}

export type RefreshSideJobResult<Name extends string = string> =
  | { name: Name; status: 'fulfilled'; value: unknown }
  | { name: Name; status: 'rejected'; reason: unknown };

export interface SourceThenSideJobsOptions<SourceValue, Name extends string> {
  source(): Promise<SourceValue>;
  sideJobs: readonly RefreshSideJob<Name>[];
  /** Runs once the source refresh settles, before any side job is awaited. */
  onSourceSettled(result: PromiseSettledResult<SourceValue>): Promise<void> | void;
  /** Names only; never pass data or errors to diagnostics. */
  onSideJobEvent?(name: Name, phase: RefreshSideJobPhase): void;
}

export interface SourceThenSideJobsResult<SourceValue, Name extends string> {
  source: PromiseSettledResult<SourceValue>;
  sideJobs: RefreshSideJobResult<Name>[];
}

function settle<Value>(start: () => Promise<Value>) {
  let promise: Promise<Value>;
  try {
    promise = start();
  } catch (error) {
    promise = Promise.reject(error);
  }
  return promise.then(
    (value): PromiseSettledResult<Value> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseSettledResult<Value> => ({
      status: 'rejected',
      reason,
    }),
  );
}

export async function runSourceThenSideJobs<SourceValue, Name extends string>(
  options: SourceThenSideJobsOptions<SourceValue, Name>,
): Promise<SourceThenSideJobsResult<SourceValue, Name>> {
  const source = settle(options.source);
  const sideJobs = options.sideJobs.map((job) => {
    options.onSideJobEvent?.(job.name, 'started');
    return settle(job.run).then((result): RefreshSideJobResult<Name> => {
      options.onSideJobEvent?.(job.name, 'finished');
      return result.status === 'fulfilled'
        ? { name: job.name, status: 'fulfilled', value: result.value }
        : { name: job.name, status: 'rejected', reason: result.reason };
    });
  });
  const sourceResult = await source;
  await options.onSourceSettled(sourceResult);
  return { source: sourceResult, sideJobs: await Promise.all(sideJobs) };
}

/** How long the refresh indicator may stay on before it is cleared anyway. */
export const REFRESH_INDICATOR_WATCHDOG_MS = 60_000;

export interface WatchdogTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: WatchdogTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Calls `onTimeout` once if `stop` was not called within `timeoutMs`.
 * Returns `stop`, which is safe to call more than once.
 */
export function startRefreshIndicatorWatchdog(
  onTimeout: () => void,
  timeoutMs = REFRESH_INDICATOR_WATCHDOG_MS,
  timers: WatchdogTimers = defaultTimers,
) {
  let active = true;
  const handle = timers.setTimeout(() => {
    if (!active) return;
    active = false;
    onTimeout();
  }, timeoutMs);
  return () => {
    if (!active) return;
    active = false;
    timers.clearTimeout(handle);
  };
}

type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStateLike {
  readonly currentState: AppStateName | string | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: AppStateName | string) => void,
  ): { remove(): void };
}

/**
 * A stop signal for slow foreground work. It fires when the app moves to the
 * background, so an import started by opening the app does not keep the
 * phone busy after the person leaves it. The background job picks up later.
 */
export function createAppBackgroundAbort(appState: AppStateLike) {
  const state = { aborted: appState.currentState === 'background' };
  if (state.aborted) {
    return { signal: state as { readonly aborted: boolean }, dispose: () => undefined };
  }
  const subscription = appState.addEventListener('change', (next) => {
    if (next === 'background') state.aborted = true;
  });
  let disposed = false;
  return {
    signal: state as { readonly aborted: boolean },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      subscription.remove();
    },
  };
}
