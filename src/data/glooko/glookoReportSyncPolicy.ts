import { GlookoSyncState } from './glookoSyncPolicy';

export const GLOOKO_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface GlookoReportSyncState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextEligibleAt?: number;
  consecutiveFailures: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastReportStart?: number;
  lastReportEnd?: number;
  lastDailyModeCount?: number;
  lastInserted?: boolean;
  lastDiagnostic?: string;
}
export const DEFAULT_GLOOKO_REPORT_SYNC_STATE: GlookoReportSyncState = {
  consecutiveFailures: 0,
};

export type GlookoReportAutomaticPlan =
  | { due: true; days: 7; reason: 'initial' | 'daily' }
  | {
      due: false;
      reason: 'disabled' | 'sign-in-required' | 'fresh' | 'backoff';
      nextEligibleAt?: number;
    };

export function planAutomaticGlookoReportSync(
  reportState: GlookoReportSyncState,
  glookoState: GlookoSyncState,
  now = Date.now(),
): GlookoReportAutomaticPlan {
  if (!glookoState.automaticEnabled) {
    return { due: false, reason: 'disabled' };
  }
  if (glookoState.sessionStatus === 'needs-sign-in') {
    return { due: false, reason: 'sign-in-required' };
  }
  if (
    reportState.nextEligibleAt !== undefined &&
    reportState.nextEligibleAt > now
  ) {
    return {
      due: false,
      reason:
        reportState.lastErrorCode === undefined ? 'fresh' : 'backoff',
      nextEligibleAt: reportState.nextEligibleAt,
    };
  }
  if (reportState.lastSuccessAt === undefined) {
    return { due: true, days: 7, reason: 'initial' };
  }
  if (now - reportState.lastSuccessAt >= GLOOKO_REPORT_INTERVAL_MS) {
    return { due: true, days: 7, reason: 'daily' };
  }
  return {
    due: false,
    reason: 'fresh',
    nextEligibleAt:
      reportState.lastSuccessAt + GLOOKO_REPORT_INTERVAL_MS,
  };
}
