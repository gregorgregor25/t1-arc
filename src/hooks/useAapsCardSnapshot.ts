import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadAapsCardSnapshot, type AapsCardSnapshot } from '@/data/aaps/aapsCardSnapshot';
import { getAapsLocalSourceStatus, getLatestAapsContext } from '@/data/aaps/localAapsSource';
import { AAPS_LOCAL_SOURCE_ID } from '@/data/aaps/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';

type SnapshotState = AapsCardSnapshot | { kind: 'loading' | 'unavailable' };

export function useAapsCardSnapshot(enabled: boolean, owner: object | undefined, revision: number) {
  const [state, setState] = useState<{ owner?: object; enabled: boolean; snapshot: SnapshotState }>({
    owner, enabled, snapshot: { kind: 'loading' },
  });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled) return;
    try {
      const store = new SqliteGlucoseHistoryStore();
      const snapshot = await loadAapsCardSnapshot({
        status: getAapsLocalSourceStatus,
        context: getLatestAapsContext,
        latest: () => store.getLatestReading(AAPS_LOCAL_SOURCE_ID),
        history: (range) => store.getReadings(range, AAPS_LOCAL_SOURCE_ID),
      });
      if (request === generation.current) setState({ owner, enabled, snapshot });
    } catch {
      if (request === generation.current) {
        setState({ owner, enabled, snapshot: { kind: 'unavailable' } });
      }
    }
  }, [enabled, owner]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    const interval = setInterval(() => void refresh(), 30_000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      active = false;
      generation.current += 1;
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, refresh, revision]);

  if (!enabled) return { kind: 'other' } as const;
  return state.owner === owner && state.enabled === enabled
    ? state.snapshot : { kind: 'loading' } as const;
}
