import {
  GlucoseStats,
  InsulinStats,
  MealEvent,
  TimelineData,
} from './models';
import { calculateGlucoseStats } from './stats';
import { summarizeInsulinRange } from './timelineInsulinSummary';
import {
  addDays,
  DateKey,
  dayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from './time';

export interface DailyTimelineSummary {
  date: DateKey;
  glucose: GlucoseStats;
  insulin: InsulinStats;
  sourceReportedInsulinUnits?: number;
  insulinSourceAsOf?: number;
  insulinPartial: boolean;
  insulinSourceConflictCount: number;
  glucoseReadings: number;
  mealCount: number;
  carbohydrateGrams: number;
}

export function buildDailyTimelineSummaries(
  data: TimelineData,
): DailyTimelineSummary[] {
  if (data.range.end <= data.range.start) return [];
  const summaries: DailyTimelineSummary[] = [];
  let date = toDateKey(data.range.start);

  while (zonedDateTimeToTimestamp(date) < data.range.end) {
    const natural = dayRange(date, data.range.end);
    const range = {
      start: Math.max(data.range.start, natural.start),
      end: Math.min(data.range.end, natural.end),
    };
    if (range.end > range.start) {
      const insulin = summarizeInsulinRange(
        data.basal,
        data.boluses,
        range,
        data.dailyInsulinTotals,
      );
      const glucose = data.glucose.filter(
        (record) =>
          record.timestamp >= range.start && record.timestamp < range.end,
      );
      const meals = data.context.filter(
        (event): event is MealEvent =>
          event.kind === 'meal' &&
          event.start >= range.start &&
          event.start < range.end,
      );
      summaries.push({
        date,
        glucose: calculateGlucoseStats(glucose, range),
        insulin: insulin.stats,
        sourceReportedInsulinUnits: insulin.sourceTotals.length
          ? insulin.stats.totalUnits
          : undefined,
        insulinSourceAsOf: insulin.sourceAsOf,
        insulinPartial: insulin.partial,
        insulinSourceConflictCount: insulin.sourceConflictCount,
        glucoseReadings: glucose.length,
        mealCount: meals.length,
        carbohydrateGrams:
          Math.round(
            meals.reduce((total, meal) => total + meal.carbsGrams, 0) * 10,
          ) / 10,
      });
    }
    date = addDays(date, 1);
  }

  return summaries.sort((a, b) => b.date.localeCompare(a.date));
}
