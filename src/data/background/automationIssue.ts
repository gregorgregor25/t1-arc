import type { AutomationDataEvidence } from './automationEvidence';
import type { AutomationOutcome } from './automationRunLog';
import type { GlookoReportSyncState } from '@/data/glooko/glookoReportSyncPolicy';
import {
  type GlookoSyncState,
  glookoFailureDisposition,
} from '@/data/glooko/glookoSyncPolicy';
import type { HevySourceStatus } from '@/data/hevy/types';
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
        glookoFailureDisposition(csv.lastErrorCode) === 'action-required'
          ? 'needs-attention'
          : 'failed',
      scope: 'Glooko update',
      attemptedAt: csv.lastAttemptAt,
      lastSuccessfulAt: csv.lastCheckedAt ?? csv.lastSuccessAt,
      message:
        glookoFailureDisposition(csv.lastErrorCode) === 'action-required'
          ? 'Open Glooko from the menu to fix the connection.'
          : 'T1 Arc will try again automatically.',
    });
  }
  if (report.inboxConfigured && report.lastErrorCode) {
    const needsAttention = [
      'folder-unavailable',
      'unexpected-report-range',
      'report-content-missing',
    ].includes(report.lastErrorCode);
    candidates.push({
      kind: needsAttention ? 'needs-attention' : 'failed',
      scope: 'Glooko report inbox',
      attemptedAt: report.lastAttemptAt,
      lastSuccessfulAt: report.lastSuccessAt,
      message:
        report.lastErrorCode === 'folder-unavailable'
          ? 'Open Glooko from Settings and choose the report folder again.'
          : needsAttention
            ? 'Open Glooko from Settings and check the selected Daily Overview.'
            : 'T1 Arc kept the previous report and will try the folder again automatically.',
    });
  }
  const latest = candidates.sort(
    (left, right) =>
      (right.attemptedAt ?? Number.NEGATIVE_INFINITY) -
      (left.attemptedAt ?? Number.NEGATIVE_INFINITY),
  )[0];
  return latest;
}

export function buildHevyAutomationIssue(
  status: HevySourceStatus,
): AutomationConnectorIssue | undefined {
  if (!status.connected || !status.lastError) return undefined;
  return {
    kind: 'failed',
    scope: 'Hevy update',
    attemptedAt: status.lastAttemptAt,
    lastSuccessfulAt: status.lastSuccessAt,
    message:
      'T1 Arc will try again automatically. Open Hevy in Settings to check now.',
  };
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
      ? `${issue.scope} needs attention.`
      : `${issue.scope} did not finish.`;
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
  return parts.join(' · ');
}
