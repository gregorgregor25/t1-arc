import { DiabetesRepository } from '@/data/contracts';
import { getDailyHealthMetricSnapshot } from '@/data/healthConnect/dailyHealthMetrics';
import { DataMode } from '@/data/libreLinkUp/secureStore';
import { buildInsightReport, InsightReport } from '@/domain/insights';
import {
  buildInsightComparisonRanges,
  InsightPeriodDays,
} from '@/domain/insightRanges';
import { DateKey } from '@/domain/time';

interface LoadInsightReportOptions {
  repository: DiabetesRepository;
  dataMode: DataMode;
  periodDays: InsightPeriodDays;
  comparisonEndDate: DateKey;
  now: number;
}

export async function loadInsightReport({
  repository,
  dataMode,
  periodDays,
  comparisonEndDate,
  now,
}: LoadInsightReportOptions): Promise<InsightReport> {
  const ranges = buildInsightComparisonRanges(
    comparisonEndDate,
    periodDays,
    now,
  );
  const [current, previous, currentHealth, previousHealth] = await Promise.all([
    repository.getTimeline(ranges.current),
    repository.getTimeline(ranges.previous),
    dataMode === 'live'
      ? getDailyHealthMetricSnapshot(ranges.current)
      : Promise.resolve(undefined),
    dataMode === 'live'
      ? getDailyHealthMetricSnapshot(ranges.previous)
      : Promise.resolve(undefined),
  ]);

  return buildInsightReport(current, previous, Date.now(), {
    current: currentHealth,
    previous: previousHealth,
  });
}
