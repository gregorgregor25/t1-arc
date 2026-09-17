import type { LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
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
