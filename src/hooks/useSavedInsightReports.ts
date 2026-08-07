import { useCallback, useEffect, useState } from 'react';

import {
  listSavedInsightReports,
  markInsightReportViewed,
  SavedInsightReport,
} from '@/data/insights/insightReportRepository';
import { useDataContext } from '@/providers/DataProvider';

export function useSavedInsightReports() {
  const { dataMode, revision } = useDataContext();
  const [reports, setReports] = useState<SavedInsightReport[]>([]);

  const reload = useCallback(async () => {
    if (dataMode !== 'live') {
      setReports([]);
      return;
    }
    const saved = await listSavedInsightReports();
    setReports(saved);
  }, [dataMode]);

  useEffect(() => {
    void reload().catch(() => setReports([]));
  }, [reload, revision]);

  const markViewed = useCallback(async (id: string) => {
    const viewedAt = Date.now();
    await markInsightReportViewed(id, viewedAt);
    setReports((current) =>
      current.map((report) =>
        report.id === id && !report.viewedAt
          ? { ...report, viewedAt }
          : report,
      ),
    );
  }, []);

  return { reports, reload, markViewed };
}
