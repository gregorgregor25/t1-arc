import { useEffect, useState } from 'react';

import {
  getDailyHealthMetricSnapshot,
} from '@/data/healthConnect/dailyHealthMetrics';
import {
  DailyHealthMetrics,
  DailyMetricRecord,
} from '@/domain/dailyHealthMetrics';
import type { HealthConnectContextCategory } from '@/data/healthConnect/healthConnectContextSelection';
import { TimeRange } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

export function useDailyHealthMetrics(range: TimeRange) {
  const { dataMode, revision } = useDataContext();
  const [snapshot, setSnapshot] = useState<{
    metrics: DailyHealthMetrics;
    records: DailyMetricRecord[];
    contextNeedsSource: HealthConnectContextCategory[];
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (dataMode !== 'live') {
      setSnapshot(undefined);
      setError(undefined);
      return () => {
        active = false;
      };
    }
    getDailyHealthMetricSnapshot(range)
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot(undefined);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Health metrics could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, [dataMode, range.end, range.start, revision]);

  return {
    metrics: snapshot?.metrics,
    records: snapshot?.records ?? [],
    contextNeedsSource: snapshot?.contextNeedsSource ?? [],
    error,
  };
}
