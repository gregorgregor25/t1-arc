import { NightscoutGlucoseSource } from './NightscoutGlucoseSource';
import { dayRange } from '@/domain/time';
import {
  NightscoutHistoryState,
  planNightscoutHistoryBackfill,
} from './historyBackfill';
import {
  loadNightscoutHistoryState,
  saveNightscoutHistoryState,
} from './historyStateStore';
import {
  isLocalDataWriteSupersededError,
} from '@/data/privacy/localDataWriteEpoch';
import {
  isSourceConnectionSupersededError,
  type SourceConnectionWriteLease,
} from '@/data/live/sourceConnectionOwnership';

let syncInFlight:
  | { key: string; promise: Promise<NightscoutHistoryState> }
  | undefined;

export async function syncNightscoutHistoryIfDue(
  source: NightscoutGlucoseSource,
  now = Date.now(),
  sourceWriteLease: SourceConnectionWriteLease,
) {
  const key = `${sourceWriteLease.localDataWriteLease.epoch}:${sourceWriteLease.ownerGeneration}`;
  if (syncInFlight?.key === key) return syncInFlight.promise;
  const promise = runNightscoutHistorySync(
    source,
    now,
    sourceWriteLease,
  ).finally(() => {
    if (syncInFlight?.promise === promise) syncInFlight = undefined;
  });
  syncInFlight = { key, promise };
  return promise;
}

async function runNightscoutHistorySync(
  source: NightscoutGlucoseSource,
  now: number,
  writeLease: SourceConnectionWriteLease,
) {
  const state = await loadNightscoutHistoryState(writeLease);
  const plan = planNightscoutHistoryBackfill(state, now);
  if (!plan) {
    if (
      state.targetDate &&
      !state.completedAt &&
      state.cursorBeforeMs !== undefined &&
      state.cursorBeforeMs <= dayRange(state.targetDate).start
    ) {
      return saveNightscoutHistoryState({
        ...state,
        completedAt: now,
      }, writeLease);
    }
    return state;
  }
  const attempting: NightscoutHistoryState = {
    ...state,
    lastAttemptAt: now,
    lastError: undefined,
  };
  await saveNightscoutHistoryState(attempting, writeLease);
  try {
    await source.importHistoryRange(plan.startMs, plan.endMs);
    return saveNightscoutHistoryState({
      ...attempting,
      cursorBeforeMs: plan.startMs,
      lastSuccessAt: Date.now(),
      completedAt: plan.finalBlock ? Date.now() : undefined,
    }, writeLease);
  } catch (error) {
    if (
      isLocalDataWriteSupersededError(error) ||
      isSourceConnectionSupersededError(error)
    ) {
      throw error;
    }
    await saveNightscoutHistoryState({
      ...attempting,
      lastError:
        error instanceof Error
          ? error.message
          : 'Older Nightscout history could not be read.',
    }, writeLease);
    throw error;
  }
}
