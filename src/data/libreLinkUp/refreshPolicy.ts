export const DIRECT_LIBRE_NORMAL_REFRESH_MS = 60_000;
export const DIRECT_LIBRE_CATCH_UP_REFRESH_MS = 15_000;
export const DIRECT_LIBRE_EXPECTED_READING_MS = 5 * 60_000;
export const DIRECT_LIBRE_CATCH_UP_LEAD_MS = 30_000;
export const DIRECT_LIBRE_STALE_BACKOFF_MS = 12 * 60_000;
export const DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

export function directLibreRefreshInterval(
  latestReadingAt?: number,
  lastErrorCode?: string,
  now = Date.now(),
) {
  if (lastErrorCode === 'rate-limited') {
    return DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS;
  }
  if (latestReadingAt === undefined) {
    return DIRECT_LIBRE_CATCH_UP_REFRESH_MS;
  }
  const age = Math.max(0, now - latestReadingAt);
  const catchUpStartsAt =
    DIRECT_LIBRE_EXPECTED_READING_MS - DIRECT_LIBRE_CATCH_UP_LEAD_MS;
  return age >= catchUpStartsAt && age < DIRECT_LIBRE_STALE_BACKOFF_MS
    ? DIRECT_LIBRE_CATCH_UP_REFRESH_MS
    : DIRECT_LIBRE_NORMAL_REFRESH_MS;
}
