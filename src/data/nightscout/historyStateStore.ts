import * as SecureStore from 'expo-secure-store';

import { isDateKey } from '@/domain/time';

import {
  DEFAULT_NIGHTSCOUT_HISTORY_STATE,
  NightscoutHistoryState,
} from './historyBackfill';

const NIGHTSCOUT_HISTORY_STATE_KEY =
  'daymark.nightscout.history-state.v1';

export async function loadNightscoutHistoryState(): Promise<NightscoutHistoryState> {
  const value = await SecureStore.getItemAsync(
    NIGHTSCOUT_HISTORY_STATE_KEY,
  );
  if (!value) return { ...DEFAULT_NIGHTSCOUT_HISTORY_STATE };
  try {
    const parsed = JSON.parse(value) as NightscoutHistoryState;
    return {
      targetDate:
        parsed.targetDate && isDateKey(parsed.targetDate)
          ? parsed.targetDate
          : undefined,
      cursorBeforeMs:
        typeof parsed.cursorBeforeMs === 'number' &&
        Number.isFinite(parsed.cursorBeforeMs)
          ? parsed.cursorBeforeMs
          : undefined,
      lastAttemptAt:
        typeof parsed.lastAttemptAt === 'number'
          ? parsed.lastAttemptAt
          : undefined,
      lastSuccessAt:
        typeof parsed.lastSuccessAt === 'number'
          ? parsed.lastSuccessAt
          : undefined,
      completedAt:
        typeof parsed.completedAt === 'number'
          ? parsed.completedAt
          : undefined,
      lastError:
        typeof parsed.lastError === 'string'
          ? parsed.lastError
          : undefined,
    };
  } catch {
    return { ...DEFAULT_NIGHTSCOUT_HISTORY_STATE };
  }
}

export async function saveNightscoutHistoryState(
  state: NightscoutHistoryState,
) {
  await SecureStore.setItemAsync(
    NIGHTSCOUT_HISTORY_STATE_KEY,
    JSON.stringify(state),
  );
  return state;
}

export async function clearNightscoutHistoryState() {
  await SecureStore.deleteItemAsync(NIGHTSCOUT_HISTORY_STATE_KEY);
}
