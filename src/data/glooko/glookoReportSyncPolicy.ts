import { GlookoSyncState } from './glookoSyncPolicy';

export interface GlookoReportSyncState {
  lastAttemptAt?: number;
  /** The direct endpoint and/or fallback inbox was checked for a new PDF. */
  lastCheckedAt?: number;
  lastSuccessAt?: number;
  nextEligibleAt?: number;
  consecutiveFailures: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastReportStart?: number;
  lastReportEnd?: number;
  lastDailyModeCount?: number;
  lastActivityCount?: number;
  lastPauseCount?: number;
  lastSourceDataThrough?: number;
  lastInserted?: boolean;
  lastDiagnostic?: string;
  inboxConfigured?: boolean;
  /** SHA-256 of the selected folder's file metadata, never the folder URI. */
  lastInboxSnapshot?: string;
  lastReportSource?: 'direct' | 'folder' | 'shared' | 'manual';
}
export const DEFAULT_GLOOKO_REPORT_SYNC_STATE: GlookoReportSyncState = {
  consecutiveFailures: 0,
};

export const GLOOKO_REPORT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export type GlookoReportAutomaticPlan =
  | {
      due: true;
      days: 7;
      reason: 'initial' | 'source-advanced' | 'periodic';
    }
  | {
      due: false;
      reason:
        | 'not-configured'
        | 'fresh'
        | 'backoff';
      nextEligibleAt?: number;
    };

export function planAutomaticGlookoReportSync(
  reportState: GlookoReportSyncState,
  glookoState: GlookoSyncState,
  now = Date.now(),
): GlookoReportAutomaticPlan {
  const directAvailable =
    glookoState.automaticEnabled &&
    glookoState.sessionStatus === 'ready' &&
    typeof glookoState.verifiedAccountFingerprint === 'string' &&
    /^af1_[0-9a-f]{64}$/.test(glookoState.verifiedAccountFingerprint);
  if (!directAvailable && !reportState.inboxConfigured) {
    return { due: false, reason: 'not-configured' };
  }
  if (
    reportState.lastErrorCode !== undefined &&
    reportState.nextEligibleAt !== undefined &&
    reportState.nextEligibleAt > now
  ) {
    return {
      due: false,
      reason: 'backoff',
      nextEligibleAt: reportState.nextEligibleAt,
    };
  }
  const lastCheckedAt = reportState.lastCheckedAt ?? reportState.lastSuccessAt;
  if (lastCheckedAt === undefined) {
    return { due: true, days: 7, reason: 'initial' };
  }

  const earliestChangedRefresh =
    lastCheckedAt + GLOOKO_REPORT_MIN_INTERVAL_MS;
  const sourceAdvanced =
    glookoState.automaticEnabled &&
    glookoState.dataThrough !== undefined &&
    (reportState.lastSourceDataThrough === undefined ||
      glookoState.dataThrough > reportState.lastSourceDataThrough);
  if (sourceAdvanced && now >= earliestChangedRefresh) {
    return { due: true, days: 7, reason: 'source-advanced' };
  }
  if (now >= earliestChangedRefresh) {
    return { due: true, days: 7, reason: 'periodic' };
  }
  return {
    due: false,
    reason: 'fresh',
    nextEligibleAt: earliestChangedRefresh,
  };
}

/** Whether Android should keep a worker available for report-only checks. */
export function glookoReportBackgroundSchedulingEnabled(
  reportState: GlookoReportSyncState,
  glookoState: GlookoSyncState,
  now = Date.now(),
) {
  const plan = planAutomaticGlookoReportSync(
    reportState,
    glookoState,
    now,
  );
  return (
    plan.due ||
    plan.reason === 'fresh' ||
    plan.reason === 'backoff'
  );
}
