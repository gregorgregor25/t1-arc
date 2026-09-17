import { useEffect, useSyncExternalStore } from 'react';
import { DISPLAY_PREFERENCES_STORAGE_KEY } from '@/domain/displayPreferences';
import { readPersonalAppState, updatePersonalAppState } from '@/data/persistence/personalAppState';
import { useDataContext } from '@/providers/DataProvider';
import { createDisplayPreferencesState } from './displayPreferencesState';

const liveState = createDisplayPreferencesState({
  read: () => readPersonalAppState(DISPLAY_PREFERENCES_STORAGE_KEY),
  update: update => updatePersonalAppState(DISPLAY_PREFERENCES_STORAGE_KEY, stored => {
    const result = update(stored);
    return { value: JSON.stringify(result), result };
  }),
});
let demoValue: string | undefined;
const demoState = createDisplayPreferencesState({
  read: async () => demoValue,
  update: async update => {
    const result = update(demoValue);
    demoValue = JSON.stringify(result);
    return result;
  },
});

export function useDisplayPreferences() {
  const { dataMode, revision } = useDataContext();
  const state = dataMode === 'live' ? liveState : demoState;
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  useEffect(() => { void state.refresh(); }, [state, revision]);
  return { ...snapshot, save: state.save, retry: state.refresh };
}
