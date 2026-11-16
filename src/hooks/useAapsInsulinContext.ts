import { useEffect, useState } from 'react';

import {
  DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL,
  loadAapsNightscoutTreatmentFill,
} from '@/data/aaps/aapsTreatmentFill';
import { getSelectedGlucoseSourceId } from '@/data/aaps/localAapsSource';
import { AAPS_LOCAL_SOURCE_ID } from '@/data/aaps/types';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import type { AapsNightscoutFillState } from '@/domain/aapsInsulinProvenance';

export interface AapsInsulinContext {
  selectedSourceId?: string;
  nightscoutFill: AapsNightscoutFillState;
}

const DISABLED: AapsInsulinContext = { nightscoutFill: 'not-connected' };

/** Which glucose source is chosen and whether Nightscout fills AAPS dose history. */
export function useAapsInsulinContext(enabled: boolean, revision: number) {
  const [context, setContext] = useState<AapsInsulinContext>(DISABLED);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const selectedSourceId = await getSelectedGlucoseSourceId();
      if (selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
        if (active) setContext({ selectedSourceId, nightscoutFill: 'not-connected' });
        return;
      }
      const [connection, preference] = await Promise.all([
        loadNightscoutConnection().catch(() => undefined),
        loadAapsNightscoutTreatmentFill().catch(() => undefined),
      ]);
      const fill = preference?.enabled ?? DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL;
      if (active) {
        setContext({
          selectedSourceId,
          nightscoutFill: !connection ? 'not-connected' : fill ? 'on' : 'off',
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, revision]);
  return enabled ? context : DISABLED;
}
