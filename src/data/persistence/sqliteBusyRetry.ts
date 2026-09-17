export interface SqliteBusyRetryOptions {
  maxWaitMs?: number;
  initialDelayMs?: number;
  maximumDelayMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export function isSqliteBusyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('database is locked') ||
    message.includes('database table is locked') ||
    message.includes('sqlite_busy') ||
    message.includes('sqlite_locked')
  );
}

/**
 * Retries an entire, already-rolled-back SQLite operation for the bounded
 * period supplied by the caller. SQLCipher's busy handler covers SQLITE_BUSY,
 * but Android can report SQLITE_LOCKED while finalising a native statement;
 * that result bypasses busy_timeout and therefore needs explicit backoff.
 */
export async function retrySqliteBusy<T>(
  operation: (remainingBudgetMs: number) => Promise<T>,
  options: SqliteBusyRetryOptions = {},
) {
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const maximumDelayMs = options.maximumDelayMs ?? 1_000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const startedAt = now();
  let delayMs = options.initialDelayMs ?? 50;

  while (true) {
    const remainingBeforeAttemptMs = Math.max(
      0,
      maxWaitMs - (now() - startedAt),
    );
    try {
      return await operation(remainingBeforeAttemptMs);
    } catch (error) {
      if (!isSqliteBusyError(error)) throw error;
      const remainingMs = maxWaitMs - (now() - startedAt);
      if (remainingMs <= 0) throw error;
      await sleep(Math.min(delayMs, remainingMs));
      // The sleep may have consumed the final millisecond of the budget. The
      // operation also receives the shrinking remainder so its own native
      // busy_timeout cannot extend the total wait by another fixed window.
      if (now() - startedAt >= maxWaitMs) throw error;
      delayMs = Math.min(maximumDelayMs, Math.max(delayMs + 1, delayMs * 2));
    }
  }
}
