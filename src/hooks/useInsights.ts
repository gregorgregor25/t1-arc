import { useEffect, useMemo, useState } from 'react';

import { InsightReport } from '@/domain/insights';
import { loadInsightReport } from '@/data/insights/loadInsightReport';
import {
  buildInsightComparisonRanges,
  InsightPeriodDays,
} from '@/domain/insightRanges';
import { DateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';

interface InsightState {
  report?: InsightReport;
  loading: boolean;
  error?: string;
  requestKey?: string;
}

export function useInsights(
  periodDays: InsightPeriodDays,
  comparisonEndDate: DateKey,
) {
  const { dataMode, now, repository, revision } = useDataContext();
  const ranges = useMemo(
    () =>
      buildInsightComparisonRanges(comparisonEndDate, periodDays, now),
    [comparisonEndDate, now, periodDays],
  );
  const [state, setState] = useState<InsightState>({ loading: true });
  const requestKey = `${ranges.current.start}:${ranges.current.end}:${dataMode}`;

  useEffect(() => {
    let active = true;
    if (!repository) {
      setState({ loading: true });
      return () => {
        active = false;
      };
    }

    setState((previous) => ({
      report:
        previous.requestKey === requestKey
          ? previous.report
          : undefined,
      loading: true,
      error: undefined,
      requestKey,
    }));
    loadInsightReport({
      repository,
      dataMode,
      periodDays,
      comparisonEndDate,
      now,
    })
      .then((report) => {
        if (!active) return;
        setState({
          loading: false,
          requestKey,
          report,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          loading: false,
          requestKey,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to build the comparison.',
        });
      });

    return () => {
      active = false;
    };
  }, [
    ranges.current.end,
    ranges.current.start,
    ranges.previous.end,
    ranges.previous.start,
    comparisonEndDate,
    dataMode,
    now,
    periodDays,
    repository,
    revision,
    requestKey,
  ]);

  return state;
}
