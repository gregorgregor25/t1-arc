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

let syncInFlight: Promise<NightscoutHistoryState> | undefined;

export async function syncNightscoutHistoryIfDue(
  source: NightscoutGlucoseSource,
  now = Date.now(),
) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runNightscoutHistorySync(source, now).finally(() => {
    syncInFlight = undefined;
  });
  return syncInFlight;
}

async function runNightscoutHistorySync(
  source: NightscoutGlucoseSource,
  now: number,
) {
  const state = await loadNightscoutHistoryState();
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
      });
    }
    return state;
  }
  const attempting: NightscoutHistoryState = {
    ...state,
    lastAttemptAt: now,
    lastError: undefined,
  };
  await saveNightscoutHistoryState(attempting);
  try {
    await source.importHistoryRange(plan.startMs, plan.endMs);
    return saveNightscoutHistoryState({
      ...attempting,
      cursorBeforeMs: plan.startMs,
      lastSuccessAt: Date.now(),
      completedAt: plan.finalBlock ? Date.now() : undefined,
    });
  } catch (error) {
    await saveNightscoutHistoryState({
      ...attempting,
      lastError:
        error instanceof Error
          ? error.message
          : 'Older Nightscout history could not be read.',
    });
    throw error;
  }
}
