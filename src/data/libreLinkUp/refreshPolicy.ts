export const DIRECT_LIBRE_NORMAL_REFRESH_MS = 60_000;
export const DIRECT_LIBRE_CATCH_UP_REFRESH_MS = 15_000;
export const DIRECT_LIBRE_EXPECTED_READING_MS = 5 * 60_000;
export const DIRECT_LIBRE_CATCH_UP_LEAD_MS = 30_000;
export const DIRECT_LIBRE_STALE_BACKOFF_MS = 12 * 60_000;
export const DIRECT_LIBRE_STALE_REFRESH_MS = 60_000;
export const DIRECT_LIBRE_NETWORK_BACKOFF_MS = 30_000;
export const DIRECT_LIBRE_INVALID_RESPONSE_BACKOFF_MS = 60_000;
export const DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
export const DIRECT_LIBRE_ACTION_REQUIRED_BACKOFF_MS = 30 * 60_000;
export const DIRECT_LIBRE_ATTEMPT_LEASE_MS = 30_000;

export const DIRECT_LIBRE_VALIDATED_NETWORK_REASON = 'validated-network';

export type DirectLibreRefreshReason =
  typeof DIRECT_LIBRE_VALIDATED_NETWORK_REASON;

function canValidatedNetworkBypass(lastErrorCode?: string) {
  return lastErrorCode === 'network' || lastErrorCode === 'invalid-response';
}

function errorBackoff(lastErrorCode?: string) {
  switch (lastErrorCode) {
    case 'rate-limited':
      return DIRECT_LIBRE_RATE_LIMIT_BACKOFF_MS;
    case 'invalid-response':
      return DIRECT_LIBRE_INVALID_RESPONSE_BACKOFF_MS;
    case 'invalid-credentials':
    case 'action-required':
    case 'patient-selection-required':
    case 'unsupported-api':
      return DIRECT_LIBRE_ACTION_REQUIRED_BACKOFF_MS;
    case 'network':
      return DIRECT_LIBRE_NETWORK_BACKOFF_MS;
    default:
      return undefined;
  }
}

export function directLibreRefreshInterval(
  latestReadingAt?: number,
  lastErrorCode?: string,
  now = Date.now(),
  reason?: DirectLibreRefreshReason,
) {
  // A native validated-network callback may bring a handover retry forward,
  // but the attempt lease remains authoritative and durable account/rate-limit
  // failures must retain their normal backoff.
  if (
    reason === DIRECT_LIBRE_VALIDATED_NETWORK_REASON &&
    canValidatedNetworkBypass(lastErrorCode)
  ) {
    return DIRECT_LIBRE_ATTEMPT_LEASE_MS;
  }
  const persistedErrorBackoff = errorBackoff(lastErrorCode);
  if (persistedErrorBackoff !== undefined) return persistedErrorBackoff;
  if (latestReadingAt === undefined) {
    return DIRECT_LIBRE_NORMAL_REFRESH_MS;
  }
  const age = Math.max(0, now - latestReadingAt);
  const catchUpStartsAt =
    DIRECT_LIBRE_EXPECTED_READING_MS - DIRECT_LIBRE_CATCH_UP_LEAD_MS;
  if (age >= catchUpStartsAt && age < DIRECT_LIBRE_STALE_BACKOFF_MS) {
    return DIRECT_LIBRE_CATCH_UP_REFRESH_MS;
  }
  return age >= DIRECT_LIBRE_STALE_BACKOFF_MS
    ? DIRECT_LIBRE_STALE_REFRESH_MS
    : DIRECT_LIBRE_NORMAL_REFRESH_MS;
}
