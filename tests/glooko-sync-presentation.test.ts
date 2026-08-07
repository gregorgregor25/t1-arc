import { describe, expect, it } from 'vitest';

import { presentGlookoSyncState } from '@/data/glooko/glookoSyncPresentation';
import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GlookoSyncState,
} from '@/data/glooko/glookoSyncPolicy';

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 7, 12);

function state(update: Partial<GlookoSyncState>): GlookoSyncState {
  return {
    ...DEFAULT_GLOOKO_SYNC_STATE,
    automaticEnabled: true,
    sessionStatus: 'ready',
    ...update,
  };
}

describe('Glooko sync presentation', () => {
  it('does not describe a valid empty range as a failure', () => {
    const result = presentGlookoSyncState(
      state({
        lastCheckedAt: now - HOUR,
        lastCheckOutcome: 'empty-range',
        lastRequestedStartDate: '2026-08-01',
        lastRequestedEndDate: '2026-08-07',
      }),
      now,
    );

    expect(result.tone).toBe('healthy');
    expect(result.message).toContain('returned no supported records');
    expect(result.message).toContain('empty check was recorded');
  });

  it('warns when a successful check finds an upstream source that is still stale', () => {
    const result = presentGlookoSyncState(
      state({
        lastCheckedAt: now - HOUR,
        lastCheckOutcome: 'no-new-data',
        dataThrough: now - 12 * HOUR,
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain("latest record is still");
    expect(result.message).toContain('replacement controller');
  });

  it('reports check time and inserted records separately', () => {
    const result = presentGlookoSyncState(
      state({
        lastCheckedAt: now - HOUR,
        lastCheckOutcome: 'new-data',
        lastInsertedRecords: 12,
      }),
      now,
    );

    expect(result.tone).toBe('healthy');
    expect(result.message).toContain('Checked 1 hr ago');
    expect(result.message).toContain('imported 12 new records');
  });
});
