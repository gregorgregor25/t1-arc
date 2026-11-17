import { addDays, DateKey, dayRange, toDateKey } from '@/domain/time';

export const NIGHTSCOUT_HISTORY_BLOCK_MS = 14 * 86_400_000;
export const NIGHTSCOUT_HISTORY_INTERVAL_MS = 15 * 60_000;

export interface NightscoutHistoryState {
  targetDate?: DateKey;
  cursorBeforeMs?: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  completedAt?: number;
  lastError?: string;
}

export interface NightscoutHistoryPlan {
  startMs: number;
  endMs: number;
  targetMs: number;
  finalBlock: boolean;
}

export const DEFAULT_NIGHTSCOUT_HISTORY_STATE: NightscoutHistoryState = {};

export function planNightscoutHistoryBackfill(
  state: NightscoutHistoryState,
  now: number,
): NightscoutHistoryPlan | undefined {
  if (!state.targetDate || state.completedAt) return undefined;
  if (
    state.lastAttemptAt &&
    now - state.lastAttemptAt < NIGHTSCOUT_HISTORY_INTERVAL_MS
  ) {
    return undefined;
  }
  const targetMs = dayRange(state.targetDate).start;
  const endMs = Math.min(state.cursorBeforeMs ?? now, now);
  if (endMs <= targetMs) return undefined;
  const startMs = Math.max(targetMs, endMs - NIGHTSCOUT_HISTORY_BLOCK_MS);
  return {
    startMs,
    endMs,
    targetMs,
    finalBlock: startMs === targetMs,
  };
}

/** How much Nightscout history a new connection or fill switch reads. */
export const NIGHTSCOUT_INITIAL_HISTORY_DAYS = 14;

export type NightscoutHistorySeedReason = 'connected' | 'fill-enabled';

/**
 * Gives a new Nightscout connection (or a newly enabled AAPS fill switch) a
 * 14-day history target, so treatments for the last two weeks are stored
 * without the person starting a backfill. The target is a local date key, so
 * a clock change inside the window does not shift it. A target the person
 * chose is never moved later. Turning the fill switch on re-reads a completed
 * range once, because treatments were skipped while it was off; the import is
 * idempotent.
 */
export function seedInitialNightscoutHistory(
  state: NightscoutHistoryState,
  now: number,
  reason: NightscoutHistorySeedReason,
  timeZone?: string,
): NightscoutHistoryState {
  const initialTarget = addDays(
    toDateKey(now, timeZone),
    -NIGHTSCOUT_INITIAL_HISTORY_DAYS,
  );
  if (!state.targetDate) {
    return {
      ...state,
      targetDate: initialTarget,
      cursorBeforeMs: undefined,
      completedAt: undefined,
      lastAttemptAt: undefined,
    };
  }
  if (reason === 'fill-enabled' && state.completedAt !== undefined) {
    return {
      ...state,
      cursorBeforeMs: undefined,
      completedAt: undefined,
      lastAttemptAt: undefined,
    };
  }
  return state;
}
