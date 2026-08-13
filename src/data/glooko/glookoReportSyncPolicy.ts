import { GlookoSyncState } from './glookoSyncPolicy';

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
      reason:
        | 'disabled'
        | 'unsupported'
        | 'sign-in-required'
        | 'fresh'
        | 'backoff';
      nextEligibleAt?: number;
    };

export function planAutomaticGlookoReportSync(
  _reportState: GlookoReportSyncState,
  _glookoState: GlookoSyncState,
  _now = Date.now(),
): GlookoReportAutomaticPlan {
  // The legacy PDF path still depends on regional WebView automation. Keep it
  // manual until it has the same explicit account/region guarantees as CSV.
  return { due: false, reason: 'unsupported' };
}
