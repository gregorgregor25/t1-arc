import { useEffect, useMemo, useState } from 'react';

import { buildInsightReport, InsightReport } from '@/domain/insights';
import { addDays, dayRange } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';

interface InsightState {
  report?: InsightReport;
  loading: boolean;
  error?: string;
}

export function useInsights() {
  const { now, repository, revision, today } = useDataContext();
  const ranges = useMemo(() => {
    const todayStart = dayRange(today, now).start;
    const currentStart = dayRange(addDays(today, -7), now).start;
    const previousStart = dayRange(addDays(today, -14), now).start;
    return {
      current: { start: currentStart, end: todayStart },
      previous: { start: previousStart, end: currentStart },
    };
  }, [now, today]);
  const [state, setState] = useState<InsightState>({ loading: true });

  useEffect(() => {
    let active = true;
    if (!repository) {
      setState({ loading: true });
      return () => {
        active = false;
      };
    }

    setState((previous) => ({
      ...previous,
      loading: true,
      error: undefined,
    }));
    Promise.all([
      repository.getTimeline(ranges.current),
      repository.getTimeline(ranges.previous),
    ])
      .then(([current, previous]) => {
        if (!active) return;
        setState({
          loading: false,
          report: buildInsightReport(current, previous, Date.now()),
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          loading: false,
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
    repository,
    revision,
  ]);

  return state;
}
