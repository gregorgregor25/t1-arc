import { describe, expect, it } from 'vitest';

import {
  glookoStepCountsAsFailure,
  glookoStepCountsAsSkipped,
  isBusyGlookoExportResult,
  stateAfterBusyGlookoAttempt,
} from '@/data/glooko/glookoSyncOutcome';

describe('Glooko sync outcome classification', () => {
  it('treats a native busy cancellation as skipped and non-failing', () => {
    expect(
      isBusyGlookoExportResult({
        status: 'cancelled',
        reason: 'busy',
      }),
    ).toBe(true);
    expect(
      glookoStepCountsAsSkipped({ status: 'skipped', reason: 'busy' }),
    ).toBe(true);
    expect(
      glookoStepCountsAsFailure({ status: 'skipped', reason: 'busy' }),
    ).toBe(false);
  });

  it('keeps genuine cancellation and timeout outcomes failing', () => {
    expect(
      glookoStepCountsAsFailure({
        status: 'cancelled',
        reason: 'cancelled',
      }),
    ).toBe(true);
    expect(
      glookoStepCountsAsFailure({
        status: 'cancelled',
        reason: 'timeout',
      }),
    ).toBe(true);
  });

  it('removes only this attempt marker after a busy result', () => {
    const previous = {
      lastAttemptAt: 100,
      consecutiveFailures: 2,
      nextEligibleAt: 500,
    };
    const attempted = { ...previous, lastAttemptAt: 200 };
    expect(stateAfterBusyGlookoAttempt(previous, attempted, 200)).toBe(
      previous,
    );

    const concurrentSuccess = {
      lastAttemptAt: 250,
      consecutiveFailures: 0,
    };
    expect(
      stateAfterBusyGlookoAttempt(previous, concurrentSuccess, 200),
    ).toBe(concurrentSuccess);
  });
});
