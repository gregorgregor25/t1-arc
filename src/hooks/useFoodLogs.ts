import { useEffect, useState } from 'react';

import { getFoodLogs } from '@/data/food/foodLogRepository';
import { FoodLog } from '@/data/food/types';
import { TimeRange } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

export function useFoodLogs(range: TimeRange) {
  const { dataMode, revision } = useDataContext();
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [loading, setLoading] = useState(dataMode === 'live');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (dataMode !== 'live') {
      setLogs([]);
      setLoading(false);
      setError(undefined);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    getFoodLogs(range)
      .then((next) => {
        if (!active) return;
        setLogs(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLogs([]);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Food history could not be loaded.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataMode, range.end, range.start, revision]);

  return { logs, loading, error };
}
