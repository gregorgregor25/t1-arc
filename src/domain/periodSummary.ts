import { gmiSummary } from './gmiSummary';
import { calculateGlucoseStatistics, type GlucoseStatistics } from './glucoseStatistics';
import {
  calculateGlucoseRangeSummary,
  type GlucoseRangeSummary,
  type GlucoseTargetRange,
  REPRESENTATIVE_COVERAGE_PERCENT,
} from './glucoseRanges';
import type { MealEvent, TimelineData, TimeRange } from './models';
import { recordSourceLabels } from './recordSourceLabels';
import {
  hasInsulinDeliveryEvidence,
  summarizeInsulinRange,
  type InsulinRangeSummary,
} from './timelineInsulinSummary';

/** GMI needs this much time; matches the GMI card and gmiSummary. */
export const GMI_MINIMUM_DAYS = 14;

export type PeriodSummaryTimeline = Pick<
  TimelineData,
  'range' | 'glucose' | 'basal' | 'boluses' | 'dailyInsulinTotals' | 'context'
>;

export type GmiResult =
  | { status: 'shown'; percent: number; mmolMol: number }
  | { status: 'withheld'; reason: string };

export interface InsulinPeriodSummary {
  summary: InsulinRangeSummary;
  /** Newest insulin record time in the period. */
  through?: number;
  sourceIds: string[];
  sourceLabels: string[];
}

export interface CarbPeriodSummary {
  grams: number;
  mealCount: number;
  through: number;
  sourceIds: string[];
  sourceLabels: string[];
}

export interface PeriodSummary {
  range: TimeRange;
  /** Period length in days, one decimal place. */
  lengthDays: number;
  ranges: GlucoseRangeSummary;
  statistics: GlucoseStatistics;
  gmi: GmiResult;
  glucoseSourceIds: string[];
  glucoseSourceLabels: string[];
  glucoseThrough?: number;
  insulin?: InsulinPeriodSummary;
  carbs?: CarbPeriodSummary;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function distinct(values: Iterable<string>) {
  return [...new Set(values)];
}

function inRange(timestamp: number, range: TimeRange) {
  return timestamp >= range.start && timestamp < range.end;
}

/**
 * GMI is shown only under the same rule as the GMI card: at least 14 days and
 * at least 70% sensor coverage. Otherwise the reason is stated.
 */
export function periodGmi(timeline: Pick<TimelineData, 'glucose' | 'range'>): GmiResult {
  const gmi = gmiSummary(timeline.glucose, timeline.range);
  if (gmi.percent === null || gmi.mmolMol === null) {
    return { status: 'withheld', reason: 'No sensor readings were recorded in this period.' };
  }
  if (gmi.representative) {
    return { status: 'shown', percent: roundOne(gmi.percent), mmolMol: gmi.mmolMol };
  }
  const days = roundOne((timeline.range.end - timeline.range.start) / 86_400_000);
  const coverage = Math.round(gmi.coveragePercent);
  return {
    status: 'withheld',
    reason: `GMI is shown for at least ${GMI_MINIMUM_DAYS} days with at least ${REPRESENTATIVE_COVERAGE_PERCENT}% sensor coverage. This period is ${days} ${days === 1 ? 'day' : 'days'} with ${coverage}% coverage.`,
  };
}

export function summarizePeriod(
  timeline: PeriodSummaryTimeline,
  personalRange: GlucoseTargetRange | null,
): PeriodSummary {
  const { range } = timeline;
  const glucose = timeline.glucose.filter((reading) => inRange(reading.timestamp, range));
  const ranges = calculateGlucoseRangeSummary({ readings: glucose, range, personalRange });
  const statistics = calculateGlucoseStatistics({ readings: glucose, range });
  const glucoseSourceIds = distinct(glucose.map((reading) => reading.sourceId));
  const glucoseThrough = glucose.length
    ? Math.max(...glucose.map((reading) => reading.timestamp))
    : undefined;

  let insulin: InsulinPeriodSummary | undefined;
  if (hasInsulinDeliveryEvidence({ ...timeline, dailyInsulinTotals: timeline.dailyInsulinTotals ?? [] })) {
    const summary = summarizeInsulinRange(
      timeline.basal,
      timeline.boluses,
      range,
      timeline.dailyInsulinTotals ?? [],
    );
    const boluses = timeline.boluses.filter((record) => inRange(record.timestamp, range));
    const basal = timeline.basal.filter((record) => record.start < range.end && record.end > range.start);
    const totals = summary.sourceTotals;
    const times = [
      ...boluses.map((record) => record.timestamp),
      ...basal.map((record) => Math.min(record.end, range.end)),
    ];
    const sourceIds = distinct([
      ...basal.map((record) => record.sourceId),
      ...boluses.map((record) => record.sourceId),
      ...totals.map((record) => record.sourceId),
    ]);
    insulin = {
      summary,
      ...(times.length ? { through: Math.max(...times) } : {}),
      sourceIds,
      sourceLabels: recordSourceLabels(sourceIds),
    };
  }

  const meals = timeline.context.filter(
    (event): event is MealEvent =>
      event.kind === 'meal' &&
      !event.excludedFoodSource &&
      inRange(event.start, range) &&
      typeof event.carbsGrams === 'number' &&
      Number.isFinite(event.carbsGrams),
  );
  const carbs = meals.length
    ? (() => {
        const sourceIds = distinct(meals.map((meal) => meal.sourceId));
        return {
          grams: Math.round(meals.reduce((total, meal) => total + (meal.carbsGrams ?? 0), 0)),
          mealCount: meals.length,
          through: Math.max(...meals.map((meal) => meal.start)),
          sourceIds,
          sourceLabels: recordSourceLabels(sourceIds),
        };
      })()
    : undefined;

  return {
    range,
    lengthDays: roundOne((range.end - range.start) / 86_400_000),
    ranges,
    statistics,
    gmi: periodGmi({ glucose, range }),
    glucoseSourceIds,
    glucoseSourceLabels: recordSourceLabels(glucoseSourceIds),
    ...(glucoseThrough === undefined ? {} : { glucoseThrough }),
    ...(insulin ? { insulin } : {}),
    ...(carbs ? { carbs } : {}),
  };
}
