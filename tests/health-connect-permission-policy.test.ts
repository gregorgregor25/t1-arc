import { describe, expect, it } from 'vitest';

import {
  EARLIEST_HEALTH_CONNECT_IMPORT_MS,
  earliestHealthConnectReadableTime,
  STANDARD_HEALTH_CONNECT_LOOKBACK_MS,
} from '@/data/healthConnect/healthConnectPermissionPolicy';

describe('Health Connect readable history policy', () => {
  const attemptedAt = Date.parse('2026-08-19T09:00:00Z');

  it('uses only the ordinary 30-day window without older-history access', () => {
    expect(
      earliestHealthConnectReadableTime({
        historyGranted: false,
        attemptedAt,
      }),
    ).toBe(attemptedAt - STANDARD_HEALTH_CONNECT_LOOKBACK_MS);
  });

  it('anchors retries to the first attempt instead of shrinking the window', () => {
    const firstAttemptAt = attemptedAt - 7 * 24 * 60 * 60 * 1000;

    expect(
      earliestHealthConnectReadableTime({
        historyGranted: false,
        attemptedAt,
        firstAttemptAt,
      }),
    ).toBe(firstAttemptAt - STANDARD_HEALTH_CONNECT_LOOKBACK_MS);
  });

  it('uses the complete import boundary only after optional history access', () => {
    expect(
      earliestHealthConnectReadableTime({
        historyGranted: true,
        attemptedAt,
      }),
    ).toBe(EARLIEST_HEALTH_CONNECT_IMPORT_MS);
  });
});
