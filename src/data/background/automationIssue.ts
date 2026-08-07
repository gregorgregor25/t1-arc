import type { AutomationDataEvidence } from './automationEvidence';
import type { AutomationOutcome } from './automationRunLog';
import type { GlookoReportSyncState } from '@/data/glooko/glookoReportSyncPolicy';
import type { GlookoSyncState } from '@/data/glooko/glookoSyncPolicy';
import { relativeAge } from '@/domain/time';

export interface AutomationConnectorIssue {
  kind: 'failed' | 'needs-attention';
  scope: string;
  attemptedAt?: number;
  lastSuccessfulAt?: number;
  message: string;
}

export function buildGlookoAutomationIssue(
  csv: GlookoSyncState,
  report: GlookoReportSyncState,
): AutomationConnectorIssue | undefined {
  const candidates: AutomationConnectorIssue[] = [];
  if (csv.lastErrorCode) {
    candidates.push({
      kind:
        csv.sessionStatus === 'needs-sign-in' ||
        csv.lastErrorCode === 'session-required'
          ? 'needs-attention'
          : 'failed',
      scope: 'CSV export',
      attemptedAt: csv.lastAttemptAt,
      lastSuccessfulAt: csv.lastCheckedAt ?? csv.lastSuccessAt,
      message:
        csv.lastErrorMessage ?? 'The latest Glooko CSV export did not finish.',
    });
  }
  if (report.lastErrorCode) {
    candidates.push({
      kind:
        report.lastErrorCode === 'session-required'
          ? 'needs-attention'
          : 'failed',
      scope: 'PDF report',
      attemptedAt: report.lastAttemptAt,
      lastSuccessfulAt: report.lastSuccessAt,
      message:
        report.lastErrorMessage ?? 'The latest Glooko PDF report did not finish.',
    });
  }
  const latest = candidates.sort(
    (left, right) =>
      (right.attemptedAt ?? Number.NEGATIVE_INFINITY) -
      (left.attemptedAt ?? Number.NEGATIVE_INFINITY),
  )[0];
  return latest;
}

export function automationOutcomeWithIssue(
  outcome: AutomationOutcome | undefined,
  issue: AutomationConnectorIssue | undefined,
) {
  return automationIssueForOutcome(outcome, issue)?.kind ?? outcome;
}

export function automationIssueForOutcome(
  outcome: AutomationOutcome | undefined,
  issue: AutomationConnectorIssue | undefined,
) {
  return outcome === 'running' ? undefined : issue;
}

export function automationIssueDetail(issue: AutomationConnectorIssue) {
  const prefix =
    issue.kind === 'needs-attention'
      ? `${issue.scope} latest attempt needs attention.`
      : `${issue.scope} latest attempt failed.`;
  const safeMessage =
    !/Call to function|java\.|SQLite|Exception|stack|rejected/i.test(
      issue.message,
    )
      ? issue.message
      : 'T1 Arc will try again automatically.';
  return `${prefix} ${safeMessage}`;
}

export function automationIssueMeta(
  issue: AutomationConnectorIssue,
  evidence: AutomationDataEvidence,
  now: number,
) {
  const attempt =
    issue.attemptedAt === undefined
      ? issue.kind === 'needs-attention'
        ? 'Latest attempt needs attention'
        : 'Latest attempt failed'
      : `${
          issue.kind === 'needs-attention'
            ? 'Latest attempt needs attention'
            : 'Latest attempt failed'
        } ${relativeAge(issue.attemptedAt, now).toLowerCase()}`;
  const success =
    issue.lastSuccessfulAt === undefined
      ? `${issue.scope} has not succeeded yet`
      : `${issue.scope} last succeeded ${relativeAge(
          issue.lastSuccessfulAt,
          now,
        ).toLowerCase()}`;
  const parts = [attempt, success];
  if (evidence.dataThrough !== undefined) {
    parts.push(
      `Data through ${relativeAge(evidence.dataThrough, now).toLowerCase()}`,
    );
  }
  if (evidence.lastStoredAt !== undefined) {
    parts.push(
      `Stored ${relativeAge(evidence.lastStoredAt, now).toLowerCase()}`,
    );
  }
  parts.push(
    evidence.recordCount
      ? `${evidence.recordCount.toLocaleString('en-GB')} stored`
      : 'No records stored',
  );
  return parts.join(' · ');
}
