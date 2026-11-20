import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import { forceClearEpochBoundSecureStoreValue } from '@/data/privacy/localDataEpochSecureStore';
import {
  SourceConnectionSupersededError,
  type SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';
import {
  loadOwnedNightscoutConnection,
  updateOwnedNightscoutHistoryState,
} from './secureStore';

import {
  DEFAULT_NIGHTSCOUT_HISTORY_STATE,
  NightscoutHistoryState,
  seedInitialNightscoutHistory,
  type NightscoutHistorySeedReason,
} from './historyBackfill';

const NIGHTSCOUT_HISTORY_STATE_KEY =
  't1arc.nightscout.history-state.v1';

export async function loadNightscoutHistoryState(
  lease?: LocalDataWriteLease | SourceConnectionWriteLease,
): Promise<NightscoutHistoryState> {
  const owned = await loadOwnedNightscoutConnection(
    lease && 'sourceId' in lease ? lease.localDataWriteLease : lease,
  );
  if (
    lease &&
    'sourceId' in lease &&
    (owned.sourceWriteLease?.ownerGeneration !== lease.ownerGeneration ||
      owned.sourceWriteLease.identityDigest !== lease.identityDigest)
  ) {
    throw new SourceConnectionSupersededError('nightscout');
  }
  const parsed = owned.values.historyState;
  if (!parsed) return { ...DEFAULT_NIGHTSCOUT_HISTORY_STATE };
  return parsed;
}

export async function saveNightscoutHistoryState(
  state: NightscoutHistoryState,
  lease: SourceConnectionWriteLease,
) {
  await updateOwnedNightscoutHistoryState(state, lease);
  return state;
}

export async function clearNightscoutHistoryState() {
  await forceClearEpochBoundSecureStoreValue(NIGHTSCOUT_HISTORY_STATE_KEY);
}

/**
 * Seeds the 14-day history target for one Nightscout connection, under that
 * connection's own write lease, so a replaced connection cannot be written.
 */
export async function seedNightscoutHistoryWithSourceLease(
  sourceWriteLease: SourceConnectionWriteLease,
  reason: NightscoutHistorySeedReason,
  now = Date.now(),
) {
  const state = await loadNightscoutHistoryState(sourceWriteLease);
  const seeded = seedInitialNightscoutHistory(state, now, reason);
  if (seeded === state) return state;
  return saveNightscoutHistoryState(seeded, sourceWriteLease);
}

/**
 * Seeds the 14-day history target for the connected Nightscout site. Does
 * nothing without a connection (for example in demo mode).
 */
export async function seedNightscoutHistoryAfterSourceChange(
  reason: NightscoutHistorySeedReason,
  now = Date.now(),
) {
  const writeLease = await acquireLocalDataWriteLease();
  const owned = await loadOwnedNightscoutConnection(writeLease);
  if (!owned.values.connection || !owned.sourceWriteLease) return undefined;
  return seedNightscoutHistoryWithSourceLease(
    owned.sourceWriteLease,
    reason,
    now,
  );
}
