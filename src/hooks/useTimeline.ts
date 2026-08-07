import { useEffect, useState } from 'react';

import {
  DataSourceStatus,
  GlucoseReading,
  TimeRange,
  TimelineData,
} from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';

interface TimelineState {
  data?: TimelineData;
  loading: boolean;
  error?: string;
}

export function useTimeline(range: TimeRange) {
  const { repository, revision } = useDataContext();
  const [state, setState] = useState<TimelineState>({ loading: true });

  useEffect(() => {
    let active = true;
    if (!repository) {
      setState({ loading: true });
      return () => {
        active = false;
      };
    }
    // Keep the current page visible while fresh data is revalidated. Replacing
    // it with a loading card made every silent glucose poll look like a full
    // screen refresh.
    setState((previous) => ({
      ...previous,
      loading: previous.data === undefined,
      error: undefined,
    }));
    repository
      .getTimeline(range)
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load timeline.',
        });
      });
    return () => {
      active = false;
    };
  }, [range.end, range.start, repository, revision]);

  return state;
}

interface LatestState {
  reading?: GlucoseReading;
  sources: DataSourceStatus[];
  loading: boolean;
  error?: string;
}

export function useLatestData() {
  const { repository, now, revision } = useDataContext();
  const [state, setState] = useState<LatestState>({
    sources: [],
    loading: true,
  });

  useEffect(() => {
    let active = true;
    if (!repository) {
      setState({ sources: [], loading: true });
      return () => {
        active = false;
      };
    }
    Promise.allSettled([
      repository.getLatestGlucose(),
      repository.getSourceStatuses(now),
    ]).then(([readingResult, sourcesResult]) => {
      if (!active) return;
      const error =
        readingResult.status === 'rejected'
          ? readingResult.reason
          : sourcesResult.status === 'rejected'
            ? sourcesResult.reason
            : undefined;
      setState({
        reading:
          readingResult.status === 'fulfilled' ? readingResult.value : undefined,
        sources:
          sourcesResult.status === 'fulfilled' ? sourcesResult.value : [],
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : error
              ? 'Unable to refresh current data.'
              : undefined,
      });
    });
    return () => {
      active = false;
    };
  }, [now, repository, revision]);

  return state;
}
