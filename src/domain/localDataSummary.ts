export interface LocalDataSummary {
  glucoseReadings: number;
  insulinRecords: number;
  contextRecords: number;
  foodLogs: number;
  foodRecipes: number;
  healthConnectRecords: number;
  retainedSourceExports: number;
  notificationSourceEvents: number;
  savedInsightReports: number;
}

export function localDataRecordCount(summary: LocalDataSummary) {
  return (
    summary.glucoseReadings +
    summary.insulinRecords +
    summary.contextRecords +
    summary.foodLogs +
    summary.foodRecipes +
    summary.healthConnectRecords +
    summary.notificationSourceEvents +
    summary.savedInsightReports
  );
}

export function localDataStoredItemCount(summary: LocalDataSummary) {
  return localDataRecordCount(summary) + summary.retainedSourceExports;
}
