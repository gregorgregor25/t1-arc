import { describe, expect, it } from 'vitest';

import {
  LocalDataSummary,
  localDataRecordCount,
  localDataStoredItemCount,
} from '@/domain/localDataSummary';

describe('local data vault summary', () => {
  it('counts health rows without treating raw export containers as records', () => {
    const summary: LocalDataSummary = {
      glucoseReadings: 288,
      insulinRecords: 97,
      contextRecords: 12,
      foodLogs: 4,
      foodRecipes: 2,
      healthConnectRecords: 31,
      retainedSourceExports: 3,
      notificationSourceEvents: 8,
      savedInsightReports: 2,
    };

    expect(localDataRecordCount(summary)).toBe(444);
    expect(localDataStoredItemCount(summary)).toBe(447);
    expect(summary.retainedSourceExports).toBe(3);
  });
});
