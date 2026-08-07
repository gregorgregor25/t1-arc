import { GlookoSyncState } from './glookoSyncPolicy';
import { formatDate, formatTime, relativeAge, toDateKey } from '@/domain/time';

const UPSTREAM_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export type GlookoSyncPresentationTone = 'neutral' | 'healthy' | 'attention';

export interface GlookoSyncPresentation {
  tone: GlookoSyncPresentationTone;
  message: string;
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

export function presentGlookoSyncState(
  state: GlookoSyncState,
  now = Date.now(),
): GlookoSyncPresentation {
  if (!state.automaticEnabled) {
    return {
      tone: 'neutral',
      message: 'Automatic updates are off.',
    };
  }
  if (state.sessionStatus === 'needs-sign-in') {
    return {
      tone: 'attention',
      message: 'Glooko sign-in needs updating before automatic checks can continue.',
    };
  }
  if (state.lastErrorMessage) {
    return {
      tone: 'attention',
      message: `The last Glooko check failed. T1 Arc will retry automatically. ${state.lastErrorMessage}`,
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
  if (state.lastCheckOutcome === 'empty-range') {
    return {
      tone: 'healthy',
      message: `${checkedCopy}. Glooko returned no supported records for ${requestedRangeCopy(state)}; the empty check was recorded.`,
    };
  }
  const sourceIsStale =
    state.dataThrough !== undefined &&
    now - state.dataThrough > UPSTREAM_STALE_AFTER_MS;
  if (state.lastCheckOutcome === 'no-new-data' && sourceIsStale) {
    return {
      tone: 'attention',
      message: `${checkedCopy}, but Glooko's latest record is still ${dataThroughCopy(state.dataThrough!)}. Check that the current pump or replacement controller is linked to this Glooko account.`,
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
      message: `${checkedCopy}; imported ${inserted.toLocaleString('en-GB')} new record${inserted === 1 ? '' : 's'}.`,
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
