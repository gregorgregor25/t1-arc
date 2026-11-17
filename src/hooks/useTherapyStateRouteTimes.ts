import { useEffect, useState } from 'react';

import { loadAapsLocalTreatmentRoute } from '@/data/aaps/localAapsTreatments';
import { AAPS_LOCAL_SOURCE_ID } from '@/data/aaps/types';
import { NIGHTSCOUT_SOURCE_ID } from '@/data/nightscout/types';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

/**
 * When each therapy-state route last worked, as read from this phone's
 * records. Import batches are written only after a successful sync or
 * receive, so their `importedAt` is evidence that the route delivered data.
 */
export interface TherapyStateRouteTimes {
  /** Last successful Nightscout treatment sync that stored new content. */
  nightscoutTreatmentSyncAt?: number;
  /** Last batch of AAPS treatments received on this phone. */
  aapsLocalTreatmentsReceivedAt?: number;
  /** Whether the AAPS treatment route on this phone is switched on. */
  aapsLocalTreatmentRouteOn: boolean;
}

const NONE: TherapyStateRouteTimes = { aapsLocalTreatmentRouteOn: false };

export function useTherapyStateRouteTimes(
  enabled: boolean,
  ownerIdentity: string,
  revision: number,
): TherapyStateRouteTimes {
  const [state, setState] = useState<{ owner: string; times: TherapyStateRouteTimes }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const store = new SqliteHealthRecordStore();
    void Promise.all([
      store.getLatestImport(NIGHTSCOUT_SOURCE_ID).catch(() => undefined),
      store.getLatestImport(AAPS_LOCAL_SOURCE_ID).catch(() => undefined),
      loadAapsLocalTreatmentRoute().catch(() => false),
    ]).then(([nightscout, local, routeOn]) => {
      if (!active) return;
      setState({
        owner: ownerIdentity,
        times: {
          nightscoutTreatmentSyncAt: nightscout?.importedAt,
          aapsLocalTreatmentsReceivedAt: local?.importedAt,
          aapsLocalTreatmentRouteOn: routeOn,
        },
      });
    });
    return () => {
      active = false;
    };
  }, [enabled, ownerIdentity, revision]);
  // Unknown until read: states from a route with no known activity stay hidden.
  return enabled && state?.owner === ownerIdentity ? state.times : NONE;
}
