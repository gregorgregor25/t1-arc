import { useEffect, useState } from 'react';

import { getMedicationHistory } from '@/data/medications/medicationRepository';
import { MedicationEvent, TimeRange } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

export function useMedicationHistory(range: TimeRange) {
  const { dataMode, revision } = useDataContext();
  const [events, setEvents] = useState<MedicationEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (dataMode !== 'live') {
      setEvents([]);
      setError(undefined);
      return () => {
        active = false;
      };
    }
    getMedicationHistory(range)
      .then((next) => {
        if (!active) return;
        setEvents(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setEvents([]);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Medication history could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, [dataMode, range.end, range.start, revision]);

  return { error, events };
}
