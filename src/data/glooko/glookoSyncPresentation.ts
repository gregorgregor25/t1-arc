import {
  GlookoSyncState,
  glookoFailureDisposition,
} from './glookoSyncPolicy';
import { formatDate, formatTime, relativeAge, toDateKey } from '@/domain/time';

const UPSTREAM_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export type GlookoSyncPresentationTone = 'neutral' | 'healthy' | 'attention';

export interface GlookoSyncPresentation {
  tone: GlookoSyncPresentationTone;
  message: string;
}

/** Safe copy for the normal UI. Raw upstream messages remain in diagnostics. */
export function presentGlookoFailure(reason?: string) {
  switch (reason) {
    case 'credentials-rejected':
      return 'Glooko did not accept the saved email or password. Update the saved sign-in and try again.';
    case 'authentication-challenge':
      return 'Open Glooko and complete any sign-in checks, then try again. If it still fails, download your data from Glooko and choose the file here.';
    case 'region-mismatch':
    case 'unsupported-region':
      return 'Only UK accounts using UK dates and times are supported. Nothing was imported.';
    case 'session-rejected':
      return 'Glooko could not keep you signed in. Check the saved connection again. If it still fails, download your data from Glooko and choose the file here.';
    case 'account-selection-required':
      return 'Automatic updates support one patient per sign-in. Download your data from Glooko and choose the file here.';
    case 'export-not-authorized':
      return 'Glooko did not allow this account to update automatically. Update the saved sign-in, or download your data from Glooko and choose the file here.';
    case 'authentication-protocol-changed':
    case 'account-code-not-found':
      return 'Glooko changed how automatic updates work. Download your data from Glooko and choose the file here while T1 Arc is updated.';
    case 'export-too-large':
      return 'Glooko returned too much data at once. Choose a shorter date range and try again.';
    case 'device-storage':
      return 'Free some phone storage, then check the saved connection again.';
    case 'unsupported-archive':
    case 'rejected-archive-rows':
      return 'T1 Arc could not safely read this Glooko file, so nothing was imported. Try a fresh download from Glooko.';
    case 'insulin-table-missing':
    case 'insulin-table-unreadable':
    case 'insulin-table-rows-rejected':
      return 'T1 Arc could not confirm that the insulin data was complete, so nothing was imported. Try a fresh download from Glooko.';
    case 'unsafe-timestamp-locale':
      return 'This file uses month/day/year dates. Nothing was imported. T1 Arc currently supports UK day/month/year dates only.';
    case 'credential-generation-mismatch':
    case 'unbound-existing-data':
      return 'This sign-in does not match the saved Glooko history. Reconnect the original account, or remove imported Glooko data before using a different one.';
    case 'unverified-credentials':
      return 'Check the saved Glooko connection before adding data for this account.';
    default:
      return 'Glooko did not finish updating. T1 Arc will try again automatically.';
  }
}

function dataThroughCopy(timestamp: number) {
  return `${formatDate(toDateKey(timestamp), {
    day: 'numeric',
    month: 'short',
  })}, ${formatTime(timestamp)}`;
}

function requestedRangeCopy(state: GlookoSyncState) {
  if (!state.lastRequestedStartDate || !state.lastRequestedEndDate) {
    return 'the requested range';
  }
  const start = formatDate(state.lastRequestedStartDate, {
    day: 'numeric',
    month: 'short',
  });
  const end = formatDate(state.lastRequestedEndDate, {
    day: 'numeric',
    month: 'short',
  });
  return start === end ? start : `${start}–${end}`;
}

function latestAttemptCopy(
  state: GlookoSyncState,
  now: number,
  outcome: 'failed' | 'needs sign-in',
) {
  return state.lastAttemptAt === undefined
    ? `Latest attempt ${outcome}`
    : `Latest attempt ${outcome} ${relativeAge(
        state.lastAttemptAt,
        now,
      ).toLowerCase()}`;
}

function lastSuccessfulCheckCopy(state: GlookoSyncState, now: number) {
  const successfulAt = state.lastCheckedAt ?? state.lastSuccessAt;
  return successfulAt === undefined
    ? 'No successful automatic check has completed yet'
    : `Last successful check ${relativeAge(successfulAt, now).toLowerCase()}`;
}

function actionRequiredGuidance(reason: string | undefined) {
  switch (reason) {
    case 'account-selection-required':
      return 'Automatic updates support one patient per sign-in. Download your data from Glooko and choose the file in T1 Arc.';
    case 'export-not-authorized':
      return 'Update the saved sign-in. If this is the right account, download your data from Glooko and choose the file in T1 Arc.';
    case 'authentication-protocol-changed':
    case 'account-code-not-found':
    case 'missing-account-identity':
      return 'Glooko changed how sign-in works. Download your data from Glooko and choose the file in T1 Arc while automatic updates are fixed.';
    case 'account-identity-mismatch':
      return 'Reconnect the same Glooko account that owns the imported data. T1 Arc stopped this different account before any records were written.';
    case 'region-mismatch':
    case 'unsupported-region':
      return 'Only UK accounts using UK dates and times are supported. Nothing was imported.';
    case 'export-too-large':
      return 'Download a shorter date range from Glooko and choose that file in T1 Arc.';
    case 'device-storage':
      return 'Free some storage on this phone, then use Check saved connection.';
    case 'unsupported-archive':
    case 'rejected-archive-rows':
    case 'insulin-table-missing':
    case 'insulin-table-unreadable':
    case 'insulin-table-rows-rejected':
      return 'T1 Arc could not confirm that this Glooko download was complete, so nothing was imported. Try a fresh download from Glooko.';
    case 'unsafe-timestamp-locale':
      return 'This file uses month/day/year dates. Nothing was imported. T1 Arc currently supports UK day/month/year dates only.';
    case 'credential-generation-mismatch':
    case 'unbound-existing-data':
      return 'This sign-in does not match the saved Glooko history. Reconnect the original account, or remove imported Glooko data before using a different one.';
    case 'unverified-credentials':
      return 'Use Verify saved connection before importing data for this account.';
    default:
      return 'Update the saved sign-in, or download your data from Glooko and choose the file in T1 Arc.';
  }
}

export function presentGlookoSyncState(
  state: GlookoSyncState,
  now = Date.now(),
): GlookoSyncPresentation {
  if (state.sessionStatus === 'needs-sign-in') {
    return {
      tone: 'attention',
      message: `Glooko needs your sign-in. Update the saved sign-in to resume automatic updates. ${lastSuccessfulCheckCopy(state, now)}.`,
    };
  }
  if (glookoFailureDisposition(state.lastErrorCode) === 'action-required') {
    return {
      tone: 'attention',
      message: `Automatic updates are paused. ${actionRequiredGuidance(state.lastErrorCode)} ${lastSuccessfulCheckCopy(state, now)}.`,
    };
  }
  if (state.sessionStatus === 'pending-verification') {
    if (state.lastErrorMessage) {
      return {
        tone: 'attention',
        message: `T1 Arc could not confirm the saved Glooko connection. Use Verify saved connection to try again. ${lastSuccessfulCheckCopy(state, now)}.`,
      };
    }
    return {
      tone: 'neutral',
      message: 'Your Glooko sign-in is saved. Verify the connection once to turn on automatic updates.',
    };
  }
  if (!state.automaticEnabled) {
    return {
      tone: 'neutral',
      message: 'Automatic updates are off.',
    };
  }
  if (state.lastErrorMessage) {
    return {
      tone: 'attention',
      message: `${latestAttemptCopy(state, now, 'failed')}. Glooko did not finish updating. T1 Arc will try again automatically. ${lastSuccessfulCheckCopy(state, now)}.`,
    };
  }
  const checkedAt = state.lastCheckedAt ?? state.lastSuccessAt;
  if (checkedAt === undefined) {
    return {
      tone: 'neutral',
      message: 'Automatic updates are ready; the first Glooko check has not completed yet.',
    };
  }
  const checkedCopy = `Checked ${relativeAge(checkedAt, now).toLowerCase()}`;
  const sourceIsStale =
    state.dataThrough !== undefined &&
    now - state.dataThrough > UPSTREAM_STALE_AFTER_MS;
  if (sourceIsStale) {
    const staleContext =
      state.lastCheckOutcome === 'empty-range'
        ? `${checkedCopy}. Glooko had no new data for ${requestedRangeCopy(state)}, but`
        : state.lastCheckOutcome === 'new-data'
          ? `${checkedCopy}. Imported ${(state.lastInsertedRecords ?? 0).toLocaleString('en-GB')} new record${state.lastInsertedRecords === 1 ? '' : 's'}, but`
          : `${checkedCopy}, but`;
    return {
      tone: 'attention',
      message: `${staleContext} Glooko's latest record is still ${dataThroughCopy(state.dataThrough!)}. Check that the current pump or replacement controller is linked to this Glooko account.`,
    };
  }
  if (state.lastCheckOutcome === 'empty-range') {
    return {
      tone: 'healthy',
      message: `${checkedCopy}. No new Glooko data was available for ${requestedRangeCopy(state)}.`,
    };
  }
  if (state.lastCheckOutcome === 'no-new-data') {
    return {
      tone: 'healthy',
      message: `${checkedCopy}; no newer records were available. Data remains through ${
        state.dataThrough === undefined
          ? 'an unknown time'
          : dataThroughCopy(state.dataThrough)
      }.`,
    };
  }
  if (state.lastCheckOutcome === 'new-data') {
    const inserted = state.lastInsertedRecords ?? 0;
    return {
      tone: 'healthy',
      message: `${checkedCopy}; added ${inserted.toLocaleString('en-GB')} new item${inserted === 1 ? '' : 's'}.`,
    };
  }
  return {
    tone: 'healthy',
    message: `${checkedCopy}. Glooko data is available through ${
      state.dataThrough === undefined
        ? 'an unknown time'
        : dataThroughCopy(state.dataThrough)
    }.`,
  };
}
