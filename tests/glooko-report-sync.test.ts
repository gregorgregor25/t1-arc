import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GLOOKO_REPORT_INTERVAL_MS,
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
  it('requests the initial rolling seven-day report', () => {
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState(),
        1_000_000,
      ),
    ).toEqual({ due: true, days: 7, reason: 'initial' });
  });

  it('runs daily rather than on every hourly CSV refresh', () => {
    const lastSuccessAt = 1_000_000;
    expect(
      planAutomaticGlookoReportSync(
        {
          ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
          lastSuccessAt,
        },
        enabledState(),
        lastSuccessAt + GLOOKO_REPORT_INTERVAL_MS - 1,
      ),
    ).toMatchObject({ due: false, reason: 'fresh' });
    expect(
      planAutomaticGlookoReportSync(
        {
          ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
          lastSuccessAt,
        },
        enabledState(),
        lastSuccessAt + GLOOKO_REPORT_INTERVAL_MS,
      ),
    ).toEqual({ due: true, days: 7, reason: 'daily' });
  });

  it('pauses report generation when automatic sync is off or sign-in expired', () => {
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        DEFAULT_GLOOKO_SYNC_STATE,
      ),
    ).toMatchObject({ due: false, reason: 'disabled' });
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState({ sessionStatus: 'needs-sign-in' }),
      ),
    ).toMatchObject({ due: false, reason: 'sign-in-required' });
  });
});
