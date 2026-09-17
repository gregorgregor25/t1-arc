import { DiabetesRepository } from '@/data/contracts';
import { getDailyHealthMetricSnapshot } from '@/data/healthConnect/dailyHealthMetrics';
import { DataMode } from '@/data/libreLinkUp/secureStore';
import { buildInsightReport, InsightReport } from '@/domain/insights';
import {
  buildInsightComparisonRanges,
  InsightPeriodDays,
} from '@/domain/insightRanges';
import { DateKey } from '@/domain/time';
import type { TimeRange } from '@/domain/models';
import {
  acquireInsightInputGeneration,
  assertInsightInputGenerationCurrent,
} from './insightReportRepository';

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
  return loadInsightReportForRanges({ repository, dataMode, currentRange: ranges.current, previousRange: ranges.previous, generatedAt: Date.now() });
}

/** Load the same source-selected evidence for an explicit app selection. */
export async function loadInsightReportForRanges({ repository, dataMode, currentRange, previousRange, generatedAt }: {
  repository: DiabetesRepository;
  dataMode: DataMode;
  currentRange: TimeRange;
  previousRange: TimeRange;
  generatedAt: number;
}): Promise<InsightReport> {
  if (!Number.isSafeInteger(generatedAt) || generatedAt <= 0 || generatedAt >= 8_640_000_000_000_000) {
    throw new Error('This report needs a valid recorded period.');
  }
  for (const range of [currentRange, previousRange]) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start <= 0 || range.end <= range.start || range.end > generatedAt) {
      throw new Error('This report needs a valid recorded period.');
    }
  }
  const inputGeneration = await acquireInsightInputGeneration();
  const [current, previous, currentHealth, previousHealth] = await Promise.all([
    repository.getTimeline(currentRange),
    repository.getTimeline(previousRange),
    dataMode === 'live'
      ? getDailyHealthMetricSnapshot(currentRange)
      : Promise.resolve(undefined),
    dataMode === 'live'
      ? getDailyHealthMetricSnapshot(previousRange)
      : Promise.resolve(undefined),
  ]);

  await assertInsightInputGenerationCurrent(inputGeneration);

  return buildInsightReport(current, previous, generatedAt, {
    current: currentHealth,
    previous: previousHealth,
  }, inputGeneration);
}
