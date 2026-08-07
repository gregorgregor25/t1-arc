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

  it('lets stale source data override an otherwise healthy empty-range check', () => {
    const result = presentGlookoSyncState(
      state({
        lastCheckedAt: now - HOUR,
        lastCheckOutcome: 'empty-range',
        lastRequestedStartDate: '2026-08-07',
        lastRequestedEndDate: '2026-08-07',
        dataThrough: now - 12 * HOUR,
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('empty check was recorded');
    expect(result.message).toContain("latest record is still");
  });

  it('lets stale source data override an otherwise healthy new-data check', () => {
    const result = presentGlookoSyncState(
      state({
        lastCheckedAt: now - HOUR,
        lastCheckOutcome: 'new-data',
        lastInsertedRecords: 4,
        dataThrough: now - 12 * HOUR,
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Imported 4 new records');
    expect(result.message).toContain("latest record is still");
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

  it('distinguishes a failed attempt from the last successful check', () => {
    const result = presentGlookoSyncState(
      state({
        lastAttemptAt: now - 5 * 60 * 1000,
        lastCheckedAt: now - 3 * HOUR,
        lastErrorCode: 'timeout',
        lastErrorMessage:
          'Glooko accepted the export request, but the generated download did not arrive within two minutes.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Latest attempt failed 5 min ago');
    expect(result.message).toContain('Last successful check 3 hr ago');
    expect(result.message).toContain('generated download did not arrive');
  });

  it('says when a failed attempt has no earlier successful check', () => {
    const result = presentGlookoSyncState(
      state({
        lastAttemptAt: now - 5 * 60 * 1000,
        lastErrorMessage: 'The generated download timed out.',
      }),
      now,
    );

    expect(result.message).toContain(
      'No successful automatic check has completed yet',
    );
  });
});
