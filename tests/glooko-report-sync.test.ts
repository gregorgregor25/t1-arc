import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GLOOKO_REPORT_MIN_INTERVAL_MS,
  glookoReportBackgroundSchedulingEnabled,
  planAutomaticGlookoReportSync,
} from '@/data/glooko/glookoReportSyncPolicy';
import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GlookoSyncState,
} from '@/data/glooko/glookoSyncPolicy';

function enabledState(
  update: Partial<GlookoSyncState> = {},
): GlookoSyncState {
  return {
    ...DEFAULT_GLOOKO_SYNC_STATE,
    automaticEnabled: true,
    sessionStatus: 'ready',
    ...update,
  };
}

describe('automatic Glooko PDF report policy', () => {
  it('starts from a verified saved Glooko connection without a report folder', () => {
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState({
          verifiedAccountFingerprint: `af1_${'a'.repeat(64)}`,
        }),
        1_000_000,
      ),
    ).toEqual({ due: true, days: 7, reason: 'initial' });
  });

  it('starts after the user approves an Android report folder', () => {
    expect(
      planAutomaticGlookoReportSync(
        {
          ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
          inboxConfigured: true,
        },
        enabledState({ automaticEnabled: false }),
        1_000_000,
      ),
    ).toEqual({ due: true, days: 7, reason: 'initial' });
  });

  it('reports that the inbox is not configured before a folder is approved', () => {
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState({ automaticEnabled: false }),
      ),
    ).toEqual({ due: false, reason: 'not-configured' });
  });

  it('refreshes after six hours when the primary Glooko data has advanced', () => {
    const lastSuccessAt = 1_000_000;
    expect(
      planAutomaticGlookoReportSync(
        {
          ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
          inboxConfigured: true,
          lastSuccessAt,
          lastSourceDataThrough: 900,
        },
        enabledState({
          verifiedAccountFingerprint: `af1_${'b'.repeat(64)}`,
          dataThrough: 1_000,
        }),
        lastSuccessAt + GLOOKO_REPORT_MIN_INTERVAL_MS,
      ),
    ).toEqual({ due: true, days: 7, reason: 'source-advanced' });
  });

  it('checks an unchanged folder periodically without running early', () => {
    const lastSuccessAt = 1_000_000;
    const state = {
      ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
      inboxConfigured: true,
      lastSuccessAt,
      lastSourceDataThrough: 1_000,
    };
    const connection = enabledState({
      verifiedAccountFingerprint: `af1_${'c'.repeat(64)}`,
      dataThrough: 1_000,
    });
    expect(
      planAutomaticGlookoReportSync(
        state,
        connection,
        lastSuccessAt + GLOOKO_REPORT_MIN_INTERVAL_MS - 1,
      ),
    ).toEqual({
      due: false,
      reason: 'fresh',
      nextEligibleAt: lastSuccessAt + GLOOKO_REPORT_MIN_INTERVAL_MS,
    });
    expect(
      planAutomaticGlookoReportSync(
        state,
        connection,
        lastSuccessAt + GLOOKO_REPORT_MIN_INTERVAL_MS,
      ),
    ).toEqual({ due: true, days: 7, reason: 'periodic' });
  });

  it('honours failure backoff before another report request', () => {
    expect(
      planAutomaticGlookoReportSync(
        {
          ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
          inboxConfigured: true,
          lastErrorCode: 'network',
          nextEligibleAt: 2_000_000,
        },
        enabledState({
          verifiedAccountFingerprint: `af1_${'d'.repeat(64)}`,
        }),
        1_000_000,
      ),
    ).toEqual({
      due: false,
      reason: 'backoff',
      nextEligibleAt: 2_000_000,
    });
  });

  it('keeps report scheduling active when CSV needs action but direct report credentials remain valid', () => {
    expect(
      glookoReportBackgroundSchedulingEnabled(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState({
          verifiedAccountFingerprint: `af1_${'e'.repeat(64)}`,
          lastErrorCode: 'insulin-table-unreadable',
        }),
        1_000_000,
      ),
    ).toBe(true);
  });

  it('does not keep report scheduling active without a direct connection or fallback folder', () => {
    expect(
      glookoReportBackgroundSchedulingEnabled(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState({
          automaticEnabled: false,
          lastErrorCode: 'insulin-table-unreadable',
        }),
        1_000_000,
      ),
    ).toBe(false);
  });
});
