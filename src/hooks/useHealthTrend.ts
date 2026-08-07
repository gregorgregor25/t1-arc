import { useEffect, useState } from 'react';

import {
  getHealthTrendSnapshot,
  HealthTrendDay,
} from '@/data/healthConnect/dailyHealthMetrics';
import { DateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';

export type { HealthTrendDay };

export function useHealthTrend(endDate: DateKey, days = 7) {
  const { dataMode, revision } = useDataContext();
  const [data, setData] = useState<HealthTrendDay[]>([]);
  const [loading, setLoading] = useState(dataMode === 'live');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (dataMode !== 'live') {
      setData([]);
      setLoading(false);
      setError(undefined);
      return () => {
        active = false;
      };
    }

    setLoading(data.length === 0);
    const loadedAt = Date.now();
    getHealthTrendSnapshot(endDate, days, loadedAt)
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setData([]);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Health trends could not be loaded.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dataMode, days, endDate, revision]);

  return { data, error, loading };
}
