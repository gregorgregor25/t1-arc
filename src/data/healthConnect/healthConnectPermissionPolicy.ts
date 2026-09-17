const DAY_MS = 24 * 60 * 60 * 1000;

export const STANDARD_HEALTH_CONNECT_LOOKBACK_MS = 30 * DAY_MS;
export const EARLIEST_HEALTH_CONNECT_IMPORT_MS = Date.parse(
  '2000-01-01T00:00:00Z',
);

/**
 * Health Connect's ordinary read permission covers recent data. Reading
 * further back is a separate, optional permission, so non-history imports
 * must never query the app's year-2000 lower bound.
 *
 * `firstAttemptAt` anchors the ordinary window for retries. Health Connect's
 * 30-day allowance is based on when permission was granted, not the date of a
 * later retry; the first import attempt is the closest durable timestamp T1
 * Arc owns for that grant.
 */
export function earliestHealthConnectReadableTime(input: {
  historyGranted: boolean;
  attemptedAt: number;
  firstAttemptAt?: number;
}) {
  if (input.historyGranted) return EARLIEST_HEALTH_CONNECT_IMPORT_MS;
  return (
    Math.min(input.firstAttemptAt ?? input.attemptedAt, input.attemptedAt) -
    STANDARD_HEALTH_CONNECT_LOOKBACK_MS
  );
}
