/**
 * When and for how long Health Connect is read. Kept free of native and
 * database imports so the background task and tests can use it directly.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** A pull-to-refresh or other explicit refresh may check again this soon. */
export const HEALTH_CONNECT_MANUAL_SYNC_INTERVAL_MS = 5 * MINUTE_MS;
/** Opening the app checks Health Connect at most this often. */
export const HEALTH_CONNECT_APP_OPEN_SYNC_INTERVAL_MS = 30 * MINUTE_MS;
/** The Android background job checks Health Connect at most this often. */
export const HEALTH_CONNECT_BACKGROUND_SYNC_INTERVAL_MS = 3 * HOUR_MS;
/** Stop well inside Android's 10-minute job limit; the next run continues. */
export const HEALTH_CONNECT_BACKGROUND_TIME_BUDGET_MS = 4 * MINUTE_MS;
/**
 * The changes feed reports edits, late arrivals and deletions, so a valid
 * token needs no window re-read. A short re-read at most once a day is a
 * safety net for providers whose change feed misses something.
 */
export const HEALTH_CONNECT_WINDOW_CHECK_INTERVAL_MS = 24 * HOUR_MS;
export const HEALTH_CONNECT_WINDOW_CHECK_SPAN_MS = 48 * HOUR_MS;

/**
 * Lets the caller that started a sync stop it cleanly: when the app moves to
 * the background, or when a background job reaches its time budget. A stopped
 * run keeps every committed batch and change token; the next run continues.
 */
export interface HealthConnectSyncControl {
  /** Any AbortSignal works; only `aborted` is read. */
  signal?: { readonly aborted: boolean };
  /** Wall-clock time (ms) after which no new page or batch is started. */
  deadlineAt?: number;
  /**
   * Allows the short daily window re-read. Off for background jobs, so that
   * check runs when the app is open.
   */
  allowWindowCheck?: boolean;
}

export function healthConnectSyncShouldStop(
  control: HealthConnectSyncControl | undefined,
  now = Date.now(),
) {
  return Boolean(
    control?.signal?.aborted ||
      (control?.deadlineAt !== undefined && now >= control.deadlineAt),
  );
}

/**
 * Decides whether a category with a valid changes token also needs the short
 * daily window re-read.
 */
export function healthConnectWindowCheckDue(
  lastWindowCheckAt: number | undefined,
  now: number,
  allowWindowCheck: boolean,
) {
  if (!allowWindowCheck) return false;
  return (
    lastWindowCheckAt === undefined ||
    lastWindowCheckAt > now ||
    now - lastWindowCheckAt >= HEALTH_CONNECT_WINDOW_CHECK_INTERVAL_MS
  );
}

/**
 * Due rule shared by app-open, explicit refresh and background callers. Each
 * caller passes its own interval. A clock that moved backwards counts as due.
 */
export function healthConnectSyncDue(
  categories: readonly string[],
  states: readonly { category: string; lastAttemptAt?: number }[],
  now: number,
  minimumIntervalMs: number,
) {
  const lastAttempt = new Map(
    states.map((state) => [state.category, state.lastAttemptAt]),
  );
  return categories.some((category) => {
    const attemptedAt = lastAttempt.get(category);
    return (
      attemptedAt === undefined ||
      attemptedAt > now ||
      now - attemptedAt >= minimumIntervalMs
    );
  });
}
