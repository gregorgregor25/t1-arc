import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GLOOKO_FOREGROUND_CHECK_INTERVAL_MS,
  GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS,
  GLOOKO_INCREMENTAL_INTERVAL_MS,
  GLOOKO_HISTORY_BACKFILL_INTERVAL_MS,
  GLOOKO_RECONCILIATION_INTERVAL_MS,
  glookoFailureBackoffMs,
  planAutomaticGlookoSync,
} from '@/data/glooko/glookoSyncPolicy';

const NOW = Date.UTC(2026, 6, 26, 12);

describe('Glooko automatic sync policy', () => {
  it('checks often enough in the foreground to notice a due export promptly', () => {
    expect(GLOOKO_FOREGROUND_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(GLOOKO_FOREGROUND_CHECK_INTERVAL_MS).toBeLessThan(
      GLOOKO_INCREMENTAL_INTERVAL_MS,
    );
  });

  it('does nothing until automatic refresh is enabled', () => {
    expect(planAutomaticGlookoSync(DEFAULT_GLOOKO_SYNC_STATE, NOW)).toEqual({
      due: false,
      reason: 'disabled',
    });
  });

  it('requests an initial 90-day evidence window', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 90,
      reason: 'initial',
    });
  });

  it('requests the shortest supported Glooko refresh after one hour', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - GLOOKO_INCREMENTAL_INTERVAL_MS,
          lastFullSuccessAt: NOW - GLOOKO_RECONCILIATION_INTERVAL_MS / 2,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 14,
      reason: 'incremental',
    });
  });

  it('schedules from the last completed check even when source data did not advance', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - 8 * GLOOKO_INCREMENTAL_INTERVAL_MS,
          lastCheckedAt: NOW - GLOOKO_INCREMENTAL_INTERVAL_MS / 2,
          lastCheckOutcome: 'no-new-data',
          lastFullSuccessAt: NOW - GLOOKO_RECONCILIATION_INTERVAL_MS / 2,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
        },
        NOW,
      ),
    ).toEqual({
      due: false,
      reason: 'fresh',
      nextEligibleAt:
        NOW - GLOOKO_INCREMENTAL_INTERVAL_MS / 2 +
        GLOOKO_INCREMENTAL_INTERVAL_MS,
    });
  });

  it('prefers the nightly 30-day reconciliation when both are due', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - GLOOKO_INCREMENTAL_INTERVAL_MS,
          lastFullSuccessAt: NOW - GLOOKO_RECONCILIATION_INTERVAL_MS,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 30,
      reason: 'reconciliation',
    });
  });

  it('uses a fresh recent window to retrieve one due historical block', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - GLOOKO_INCREMENTAL_INTERVAL_MS,
          lastFullSuccessAt:
            NOW - GLOOKO_RECONCILIATION_INTERVAL_MS / 2,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
          historyBackfillBeforeDate: '2026-07-01',
          historyBackfillTargetDate: '2026-01-15',
          lastHistoryBackfillAt:
            NOW - GLOOKO_HISTORY_BACKFILL_INTERVAL_MS,
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 90,
      reason: 'history-backfill',
      historicalRange: {
        startDate: '2026-04-02',
        endDate: '2026-06-30',
        days: 90,
      },
    });
  });

  it('keeps recent data ahead of backfill when it is more than four hours old', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - 4 * 60 * 60 * 1000,
          lastFullSuccessAt:
            NOW - GLOOKO_RECONCILIATION_INTERVAL_MS / 2,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
          historyBackfillBeforeDate: '2026-07-01',
          historyBackfillTargetDate: '2026-01-15',
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 14,
      reason: 'incremental',
    });
  });

  it('does not retry silently when Glooko needs sign-in', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'needs-sign-in',
        },
        NOW,
      ),
    ).toEqual({
      due: false,
      reason: 'sign-in-required',
    });
  });

  it('honours a failure backoff before freshness calculations', () => {
    const nextEligibleAt = NOW + 30 * 60 * 1000;
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          nextEligibleAt,
          lastErrorCode: 'network',
        },
        NOW,
      ),
    ).toEqual({
      due: false,
      reason: 'backoff',
      nextEligibleAt,
    });
  });

  it('labels the successful one-hour eligibility window as fresh', () => {
    const nextEligibleAt = NOW + 30 * 60 * 1000;
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - 90 * 60 * 1000,
          lastFullSuccessAt: NOW - 12 * 60 * 60 * 1000,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS / 2,
          nextEligibleAt,
        },
        NOW,
      ),
    ).toEqual({
      due: false,
      reason: 'fresh',
      nextEligibleAt,
    });
  });

  it('refreshes the 90-day evidence window weekly', () => {
    expect(
      planAutomaticGlookoSync(
        {
          ...DEFAULT_GLOOKO_SYNC_STATE,
          automaticEnabled: true,
          sessionStatus: 'ready',
          lastSuccessAt: NOW - 60 * 60 * 1000,
          lastFullSuccessAt: NOW - 12 * 60 * 60 * 1000,
          lastExtendedSuccessAt:
            NOW - GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS,
        },
        NOW,
      ),
    ).toEqual({
      due: true,
      days: 90,
      reason: 'extended-reconciliation',
    });
  });

  it('backs off progressively and caps at one day', () => {
    expect(glookoFailureBackoffMs(1)).toBe(30 * 60 * 1000);
    expect(glookoFailureBackoffMs(2)).toBe(2 * 60 * 60 * 1000);
    expect(glookoFailureBackoffMs(3)).toBe(6 * 60 * 60 * 1000);
    expect(glookoFailureBackoffMs(99)).toBe(24 * 60 * 60 * 1000);
  });
});
