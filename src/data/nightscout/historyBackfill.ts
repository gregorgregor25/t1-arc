import { DateKey, dayRange } from '@/domain/time';

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
