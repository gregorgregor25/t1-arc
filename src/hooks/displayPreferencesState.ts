import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences,
  parseDisplayPreferences,
} from '@/domain/displayPreferences';

export type DisplayPreferencePatch = Partial<Pick<DisplayPreferences, 'glanceOrder' | 'hiddenHealthMetrics'>>;
export interface DisplayPreferenceSnapshot {
  preferences: DisplayPreferences;
  loading: boolean;
  saving: boolean;
  error?: string;
}

interface Persistence {
  read(): Promise<string | undefined>;
  update(update: (stored: string | undefined) => DisplayPreferences): Promise<DisplayPreferences>;
}

/** Shared snapshots avoid mismatched preferences in mounted Today/Health tabs. */
export function createDisplayPreferencesState(persistence: Persistence) {
  let snapshot: DisplayPreferenceSnapshot = {
    preferences: parseDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES), loading: true, saving: false,
  };
  let generation = 0;
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: DisplayPreferenceSnapshot) => {
    snapshot = next;
    for (const listener of listeners) {
      try { listener(); } catch { /* A view cannot make a completed save fail. */ }
    }
  };
  const parse = (stored: string | undefined) => stored === undefined
    ? parseDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES)
    : parseDisplayPreferences(JSON.parse(stored));
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh() {
      if (snapshot.saving) return Promise.resolve();
      if (loading) return loading;
      const requestedGeneration = ++generation;
      loading = persistence.read().then(stored => {
        if (requestedGeneration !== generation) return;
        publish({ ...snapshot, preferences: parse(stored), loading: false, error: undefined });
      }).catch(() => {
        if (requestedGeneration !== generation) return;
        publish({ ...snapshot, loading: false, error: 'Your display choices couldn’t be loaded. Try again.' });
      }).finally(() => { loading = undefined; });
      return loading;
    },
    async save(patch: DisplayPreferencePatch) {
      if (snapshot.loading || snapshot.saving) return false;
      ++generation;
      publish({ ...snapshot, saving: true, error: undefined });
      try {
        const preferences = await persistence.update(stored => parseDisplayPreferences({ ...parse(stored), ...patch }));
        publish({ preferences, loading: false, saving: false });
        return true;
      } catch {
        publish({ ...snapshot, saving: false, error: 'Your display choices weren’t saved. Try again.' });
        return false;
      }
    },
  };
}
