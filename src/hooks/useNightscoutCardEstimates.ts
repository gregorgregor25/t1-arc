import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { nightscoutCardEstimates } from '@/components/aapsEstimatePresentation';
import { loadDisplayableNightscoutIobCobSnapshot } from '@/data/nightscout/iobCobStore';
import type { NightscoutIobCobSnapshot } from '@/data/nightscout/types';
import { startForegroundInterval } from './foregroundInterval';

/** The saved Nightscout estimate, re-read while Today is visible. */
export function useNightscoutCardEstimates(enabled: boolean, revision: number) {
  const [snapshot, setSnapshot] = useState<NightscoutIobCobSnapshot>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      void loadDisplayableNightscoutIobCobSnapshot()
        .catch(() => undefined)
        .then((next) => {
          if (active) setSnapshot(next);
        });
    };
    load();
    const stop = startForegroundInterval(load, 30_000, AppState, { runOnResume: true });
    return () => {
      active = false;
      stop();
    };
  }, [enabled, revision]);
  return enabled ? nightscoutCardEstimates(snapshot) : undefined;
}
