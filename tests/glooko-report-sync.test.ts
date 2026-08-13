import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
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
  it('keeps legacy regional WebView report automation disabled', () => {
    expect(
      planAutomaticGlookoReportSync(
        DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        enabledState(),
        1_000_000,
      ),
    ).toEqual({ due: false, reason: 'unsupported' });
  });
});
