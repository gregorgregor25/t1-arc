import { useCallback, useEffect, useRef, useState } from 'react';

import {
  listSavedInsightReports,
  markInsightReportViewed,
} from '@/data/insights/insightReportRepository';
import { useDataContext } from '@/providers/DataProvider';

import {
  failedSavedInsightReports,
  loadedSavedInsightReports,
  loadingSavedInsightReports,
  type SavedInsightReportsState,
} from './savedInsightReportsState';

export function useSavedInsightReports(enabled = true) {
  const { dataMode, revision } = useDataContext();
  const [state, setState] = useState<SavedInsightReportsState>({
    reports: [],
    loading: dataMode === 'live',
    unavailable: dataMode !== 'live',
  });
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!enabled || dataMode !== 'live') {
      setState({ reports: [], loading: false, unavailable: true });
      return;
    }
    setState((current) => loadingSavedInsightReports(current));
    try {
      const saved = await listSavedInsightReports();
      if (requestId.current === currentRequest) {
        setState(loadedSavedInsightReports(saved));
      }
    } catch (error) {
      if (requestId.current === currentRequest) {
        setState((current) => failedSavedInsightReports(current));
      }
      throw error;
    }
  }, [dataMode, enabled]);

  useEffect(() => {
    let active = true;
    // Start the external repository request after the effect has committed so
    // its loading transition cannot cascade inside the committing render.
    void Promise.resolve()
      .then(() => (active ? reload() : undefined))
      .catch(() => undefined);
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, [reload, revision]);

  const markViewed = useCallback(async (id: string) => {
    const viewedAt = Date.now();
    await markInsightReportViewed(id, viewedAt);
    setState((current) => ({
      ...current,
      reports: current.reports.map((report) =>
        report.id === id && !report.viewedAt ? { ...report, viewedAt } : report,
      ),
    }));
  }, []);

  return { ...state, reload, markViewed };
}
