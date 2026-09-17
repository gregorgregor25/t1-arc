import { useEffect, useState } from 'react';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import type { ContextNoteEvent } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

export function usePersonalObservations(kind?: 'lab-result' | 'site-change'): { events: ContextNoteEvent[]; error?: string } {
  const { ownerIdentity, demoMode, revision } = useDataContext();
  const [state, setState] = useState<{ owner: string; events: ContextNoteEvent[]; error?: string }>();
  useEffect(() => {
    let active = true;
    if (demoMode) return;
    void new SqliteHealthRecordStore().getPersonalObservations(kind).then(events => {
      if (active) setState({ owner: ownerIdentity, events });
    }).catch(() => { if (active) setState({ owner: ownerIdentity, events: [], error: 'Saved observations could not be loaded. Pull down to retry.' }); });
    return () => { active = false; };
  }, [ownerIdentity, demoMode, revision, kind]);
  return !demoMode && state?.owner === ownerIdentity ? state : { events: [] };
}
