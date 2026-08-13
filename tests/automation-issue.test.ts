import { describe, expect, it } from 'vitest';

import {
  automationIssueMeta,
  automationIssueForOutcome,
  automationOutcomeWithIssue,
  buildGlookoAutomationIssue,
} from '@/data/background/automationIssue';
import { DEFAULT_GLOOKO_REPORT_SYNC_STATE } from '@/data/glooko/glookoReportSyncPolicy';
import { DEFAULT_GLOOKO_SYNC_STATE } from '@/data/glooko/glookoSyncPolicy';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 7, 16);

describe('automation issues', () => {
  it('keeps a Glooko failure visible over a later skipped audit run', () => {
    const issue = buildGlookoAutomationIssue(
      {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        automaticEnabled: true,
        sessionStatus: 'ready',
        lastAttemptAt: NOW - 5 * 60 * 1000,
        lastCheckedAt: NOW - 3 * HOUR,
        lastErrorCode: 'timeout',
        lastErrorMessage: 'The generated download did not arrive.',
      },
      DEFAULT_GLOOKO_REPORT_SYNC_STATE,
    );

    expect(issue).toMatchObject({
      kind: 'failed',
      scope: 'Glooko update',
      attemptedAt: NOW - 5 * 60 * 1000,
      lastSuccessfulAt: NOW - 3 * HOUR,
    });
    expect(automationOutcomeWithIssue('skipped', issue)).toBe('failed');
    expect(
      automationIssueMeta(
        issue!,
        { dataThrough: NOW - HOUR, recordCount: 123 },
        NOW,
      ),
    ).toContain('Latest attempt failed 5 min ago');
    expect(
      automationIssueMeta(
        issue!,
        { dataThrough: NOW - HOUR, recordCount: 123 },
        NOW,
      ),
    ).toContain('Glooko update last succeeded 3 hr ago');
  });

  it('ignores retired PDF automation failures', () => {
    const issue = buildGlookoAutomationIssue(
      {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        lastAttemptAt: NOW - HOUR,
        lastErrorCode: 'timeout',
      },
      {
        ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
        lastAttemptAt: NOW - 5 * 60 * 1000,
        lastSuccessAt: NOW - 2 * HOUR,
        lastErrorCode: 'network',
        lastErrorMessage: 'The PDF transfer failed.',
      },
    );

    expect(issue).toMatchObject({
      kind: 'failed',
      scope: 'Glooko update',
      attemptedAt: NOW - HOUR,
    });
  });

  it('allows an active run to show as updating while retrying', () => {
    const issue = buildGlookoAutomationIssue(
      {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        lastErrorCode: 'timeout',
      },
      DEFAULT_GLOOKO_REPORT_SYNC_STATE,
    );

    expect(automationOutcomeWithIssue('running', issue)).toBe('running');
    expect(automationIssueForOutcome('running', issue)).toBeUndefined();
  });

  it('marks a paused direct connector failure as needing attention', () => {
    const issue = buildGlookoAutomationIssue(
      {
        ...DEFAULT_GLOOKO_SYNC_STATE,
        automaticEnabled: false,
        sessionStatus: 'ready',
        lastErrorCode: 'export-not-authorized',
        lastErrorMessage: 'CSV export was not authorized.',
      },
      DEFAULT_GLOOKO_REPORT_SYNC_STATE,
    );

    expect(issue).toMatchObject({
      kind: 'needs-attention',
      scope: 'Glooko update',
    });
  });
});
