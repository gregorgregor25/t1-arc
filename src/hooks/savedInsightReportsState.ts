import type { SavedInsightReport } from '@/data/insights/insightReportRepository';

export interface SavedInsightReportsState {
  reports: SavedInsightReport[];
  loading: boolean;
  unavailable: boolean;
  error?: string;
}

export const SAVED_INSIGHT_REPORTS_UNAVAILABLE =
  'Saved review history is temporarily unavailable. Existing saved reviews remain on this device.';

export function loadingSavedInsightReports(
  current: SavedInsightReportsState,
): SavedInsightReportsState {
  return { ...current, loading: true, unavailable: false, error: undefined };
}

export function loadedSavedInsightReports(
  reports: SavedInsightReport[],
): SavedInsightReportsState {
  return { reports, loading: false, unavailable: false, error: undefined };
}

export function failedSavedInsightReports(
  current: SavedInsightReportsState,
): SavedInsightReportsState {
  return {
    ...current,
    loading: false,
    unavailable: true,
    error: SAVED_INSIGHT_REPORTS_UNAVAILABLE,
  };
}
