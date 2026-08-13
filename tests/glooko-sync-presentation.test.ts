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
  it('does not call saved credentials ready before a verified download', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
      }),
      now,
    );

    expect(result.tone).toBe('neutral');
    expect(result.message).toContain('Verify the connection once');
  });

  it('keeps a pending verification failure visible while automatic updates are off', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
        lastAttemptAt: now - 5 * 60 * 1000,
        lastErrorCode: 'invalid-zip',
        lastErrorMessage: 'Glooko did not return a complete ZIP export.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('could not confirm the saved Glooko connection');
    expect(result.message).toContain('Verify saved connection');
    expect(result.message).not.toContain('Automatic updates are off');
  });

  it('keeps a sign-in failure visible while automatic updates are off', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        sessionStatus: 'needs-sign-in',
        lastAttemptAt: now - 5 * 60 * 1000,
        lastErrorCode: 'credentials-rejected',
        lastErrorMessage: 'Glooko did not accept the saved sign-in.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('needs your sign-in');
    expect(result.message).toContain('Update the saved sign-in');
    expect(result.message).not.toContain('Automatic updates are off');
  });

  it('explains that multi-patient accounts are paused instead of promising a retry', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        lastAttemptAt: now - 5 * 60 * 1000,
        lastCheckedAt: now - 3 * HOUR,
        lastErrorCode: 'account-selection-required',
        lastErrorMessage:
          'This Glooko sign-in can access more than one patient.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Automatic updates are paused');
    expect(result.message).toContain('Download your data from Glooko');
    expect(result.message).not.toContain('retry automatically');
  });

  it('does not claim manual import makes an unsupported locale safe', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        lastErrorCode: 'unsupported-region',
        lastErrorMessage:
          'Automatic Glooko sync supports UK accounts only.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Only UK accounts');
    expect(result.message).toContain('Nothing was imported');
    expect(result.message).not.toContain('Use Glooko\'s manual');
  });

  it('explains that a mixed timestamp locale blocks the whole archive', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        lastErrorCode: 'unsafe-timestamp-locale',
        lastErrorMessage:
          'At least one Glooko CSV uses month/day/year timestamps.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Nothing was imported');
    expect(result.message).toContain('UK day/month/year dates only');
  });

  it('explains that a different account was stopped before writes', () => {
    const result = presentGlookoSyncState(
      state({
        automaticEnabled: false,
        lastErrorCode: 'account-identity-mismatch',
        lastErrorMessage:
          'This is a different Glooko account from the one that owns the imported data.',
      }),
      now,
    );

    expect(result.tone).toBe('attention');
    expect(result.message).toContain('Reconnect the same Glooko account');
    expect(result.message).toContain('before any records were written');
    expect(result.message).not.toContain('Remove imported Glooko data');
  });

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
    expect(result.message).toContain('No new Glooko data was available');
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
    expect(result.message).toContain('Glooko had no new data');
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
    expect(result.message).toContain('added 12 new items');
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
    expect(result.message).toContain('did not finish updating');
    expect(result.message).toContain('try again automatically');
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
