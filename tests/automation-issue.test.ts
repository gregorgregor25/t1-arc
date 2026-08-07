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
      scope: 'CSV export',
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
    ).toContain('CSV export last succeeded 3 hr ago');
  });

  it('uses the newest failing Glooko track', () => {
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
      scope: 'PDF report',
      lastSuccessfulAt: NOW - 2 * HOUR,
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
});
