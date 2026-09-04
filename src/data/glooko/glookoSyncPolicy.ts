import { DateKey } from '@/domain/time';
import {
  GlookoBackfillRange,
  planNextGlookoBackfill,
} from './glookoBackfill';

export const GLOOKO_INCREMENTAL_INTERVAL_MS = 60 * 60 * 1000;
export const GLOOKO_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS =
  7 * 24 * 60 * 60 * 1000;
export const GLOOKO_HISTORY_BACKFILL_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const GLOOKO_FOREGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const GLOOKO_RECENT_DATA_PRIORITY_MS = 4 * 60 * 60 * 1000;

export type GlookoSessionStatus =
  | 'unknown'
  | 'pending-verification'
  | 'ready'
  | 'needs-sign-in';
export type GlookoBackgroundOutcome =
  | 'success'
  | 'skipped'
  | 'session-required'
  | 'cancelled'
  | 'failed';
export type GlookoCheckOutcome =
  | 'new-data'
  | 'no-new-data'
  | 'empty-range';

export type GlookoFailureDisposition = 'retryable' | 'action-required';

const GLOOKO_ACTION_REQUIRED_FAILURES = new Set([
  'session-required',
  'credentials-rejected',
  'authentication-challenge',
  'authentication-protocol-changed',
  'region-mismatch',
  'session-rejected',
  'account-code-not-found',
  'account-selection-required',
  'export-not-authorized',
  'unsupported-region',
  'export-too-large',
  'device-storage',
  'unsupported-archive',
  'rejected-archive-rows',
  'unsafe-timestamp-locale',
  'credential-generation-mismatch',
  'account-identity-mismatch',
  'missing-account-identity',
  'insulin-table-missing',
  'insulin-table-unreadable',
  'insulin-table-rows-rejected',
  'unbound-existing-data',
  'unverified-credentials',
]);

/**
 * Separates failures that can reasonably heal on a later scheduled attempt
 * from failures that require the user or the connector to change first.
 */
export function glookoFailureDisposition(
  reason: string | undefined,
): GlookoFailureDisposition {
  return reason !== undefined && GLOOKO_ACTION_REQUIRED_FAILURES.has(reason)
    ? 'action-required'
    : 'retryable';
}

export interface GlookoSyncState {
  automaticEnabled: boolean;
  sessionStatus: GlookoSessionStatus;
  /** Installation-keyed HMAC of the dynamically discovered Glooko account. */
  verifiedAccountFingerprint?: string;
  /** Durable one-time approval while an existing-data binding retry is pending. */
  pendingExistingDataBinding?: boolean;
  lastAttemptAt?: number;
  /** A recent-range export was downloaded, parsed and stored successfully. */
  lastCheckedAt?: number;
  /** Any Glooko archive reached the device, even if parsing later failed. */
  lastDownloadedAt?: number;
  /** New or newly supported records were added to the local record store. */
  lastDataChangedAt?: number;
  lastSuccessAt?: number;
  lastAutomaticAt?: number;
  lastFullSuccessAt?: number;
  lastExtendedSuccessAt?: number;
  dataThrough?: number;
  nextEligibleAt?: number;
  consecutiveFailures: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastRangeDays?: number;
  lastInsertedRecords?: number;
  lastParsedRecords?: number;
  lastCheckOutcome?: GlookoCheckOutcome;
  lastRequestedStartDate?: DateKey;
  lastRequestedEndDate?: DateKey;
  lastBackgroundRunAt?: number;
  lastBackgroundOutcome?: GlookoBackgroundOutcome;
  lastBackgroundDetail?: string;
  historyBackfillBeforeDate?: DateKey;
  historyBackfillTargetDate?: DateKey;
  lastHistoryBackfillAt?: number;
}

export function isGlookoAccountFingerprint(
  value: unknown,
): value is string {
  return typeof value === 'string' && /^af1_[0-9a-f]{64}$/.test(value);
}

export type GlookoAutomaticPlan =
  | {
      due: true;
      days: 14 | 30 | 90;
      reason:
        | 'incremental'
        | 'reconciliation'
        | 'extended-reconciliation'
        | 'initial';
    }
  | {
      due: true;
      days: number;
      reason: 'history-backfill';
      historicalRange: GlookoBackfillRange;
    }
  | {
      due: false;
      reason:
        | 'disabled'
        | 'fresh'
        | 'backoff'
        | 'verification-pending'
        | 'sign-in-required'
        | 'action-required';
      nextEligibleAt?: number;
    };

export const DEFAULT_GLOOKO_SYNC_STATE: GlookoSyncState = {
  automaticEnabled: false,
  sessionStatus: 'unknown',
  consecutiveFailures: 0,
};

export function planAutomaticGlookoSync(
  state: GlookoSyncState,
  now = Date.now(),
): GlookoAutomaticPlan {
  if (state.sessionStatus === 'pending-verification') {
    if (glookoFailureDisposition(state.lastErrorCode) !== 'action-required') {
      return { due: false, reason: 'verification-pending' };
    }
  }
  if (state.sessionStatus === 'needs-sign-in') {
    return { due: false, reason: 'sign-in-required' };
  }
  if (glookoFailureDisposition(state.lastErrorCode) === 'action-required') {
    return { due: false, reason: 'action-required' };
  }
  if (!state.automaticEnabled) return { due: false, reason: 'disabled' };
  if (state.nextEligibleAt !== undefined && state.nextEligibleAt > now) {
    return {
      due: false,
      reason:
        state.lastErrorCode === undefined ? 'fresh' : 'backoff',
      nextEligibleAt: state.nextEligibleAt,
    };
  }
  const lastCheckedAt = state.lastCheckedAt ?? state.lastSuccessAt;
  if (lastCheckedAt === undefined) {
    return { due: true, days: 90, reason: 'initial' };
  }
  if (
    state.lastExtendedSuccessAt === undefined ||
    now - state.lastExtendedSuccessAt >=
      GLOOKO_EXTENDED_RECONCILIATION_INTERVAL_MS
  ) {
    return {
      due: true,
      days: 90,
      reason: 'extended-reconciliation',
    };
  }
  if (
    state.lastFullSuccessAt === undefined ||
    now - state.lastFullSuccessAt >= GLOOKO_RECONCILIATION_INTERVAL_MS
  ) {
    return { due: true, days: 30, reason: 'reconciliation' };
  }
  const recentCheckAge = now - lastCheckedAt;
  if (recentCheckAge >= GLOOKO_RECENT_DATA_PRIORITY_MS) {
    return { due: true, days: 14, reason: 'incremental' };
  }
  const historicalRange =
    state.historyBackfillTargetDate !== undefined
      ? planNextGlookoBackfill({
          backfilledBeforeDate: state.historyBackfillBeforeDate,
          targetDate: state.historyBackfillTargetDate,
        })
      : undefined;
  if (
    historicalRange !== undefined &&
    (state.lastHistoryBackfillAt === undefined ||
      now - state.lastHistoryBackfillAt >=
        GLOOKO_HISTORY_BACKFILL_INTERVAL_MS)
  ) {
    return {
      due: true,
      days: historicalRange.days,
      reason: 'history-backfill',
      historicalRange,
    };
  }
  if (recentCheckAge >= GLOOKO_INCREMENTAL_INTERVAL_MS) {
    return { due: true, days: 14, reason: 'incremental' };
  }
  return {
    due: false,
    reason: 'fresh',
    nextEligibleAt: lastCheckedAt + GLOOKO_INCREMENTAL_INTERVAL_MS,
  };
}

/** Whether Android should keep the Glooko worker registered for this state. */
export function glookoBackgroundSchedulingEnabled(
  state: GlookoSyncState,
  now = Date.now(),
) {
  const plan = planAutomaticGlookoSync(state, now);
  return (
    plan.due ||
    plan.reason === 'fresh' ||
    plan.reason === 'backoff'
  );
}

export function glookoFailureBackoffMs(consecutiveFailures: number) {
  const schedule = [
    30 * 60 * 1000,
    2 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  ];
  const index = Math.min(
    Math.max(0, Math.floor(consecutiveFailures) - 1),
    schedule.length - 1,
  );
  return schedule[index] ?? schedule[schedule.length - 1]!;
}
