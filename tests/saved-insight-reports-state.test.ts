import { describe, expect, it } from 'vitest';

import type { SavedInsightReport } from '@/data/insights/insightReportRepository';
import {
  failedSavedInsightReports,
  loadedSavedInsightReports,
  loadingSavedInsightReports,
} from '@/hooks/savedInsightReportsState';

const report = { id: 'saved-review' } as SavedInsightReport;

describe('saved insight report load state', () => {
  it('retains the last known reports while refreshing', () => {
    expect(
      loadingSavedInsightReports(loadedSavedInsightReports([report])).reports,
    ).toEqual([report]);
  });

  it('retains reports and exposes an unavailable error after load failure', () => {
    const state = failedSavedInsightReports(
      loadingSavedInsightReports(loadedSavedInsightReports([report])),
    );
    expect(state.reports).toEqual([report]);
    expect(state.unavailable).toBe(true);
    expect(state.error).toMatch(/temporarily unavailable/i);
    expect(state.loading).toBe(false);
  });

  it('replaces retained reports after a successful load', () => {
    expect(loadedSavedInsightReports([])).toMatchObject({
      reports: [],
      unavailable: false,
      error: undefined,
    });
  });
});
