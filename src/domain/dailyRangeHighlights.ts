import {
  calculateGlucoseRangeSummary,
  glucoseTargetRangeLabel,
  REPRESENTATIVE_COVERAGE_PERCENT,
  STANDARD_GLUCOSE_RANGE,
  type GlucoseRangeSummary,
} from './glucoseRanges';
import type { T1ArcRegionalDefaults } from './regionalProfile';
import type { GlucoseReading, TimeRange } from './models';
import { formatRegionalNumber } from './regionalFormat';
import { addDays, type DateKey, getZonedDateTimeParts, toDateKey, zonedDateTimeToTimestamp } from './time';

export interface DailyRangeSummary {
  dateKey: DateKey;
  range: TimeRange;
  summary: GlucoseRangeSummary;
}

function readingsWithin(readings: readonly GlucoseReading[], range: TimeRange) {
  return readings.filter((reading) => reading.timestamp >= range.start && reading.timestamp < range.end);
}

function localMidnight(dateKey: DateKey, timeZone: string) {
  return zonedDateTimeToTimestamp(dateKey, 0, 0, 0, timeZone);
}

/**
 * Standard-range statistics for each local calendar day that starts inside
 * the range. Day boundaries come from the time zone, so clock-change days
 * keep their real 23- or 25-hour length.
 */
export function dailyRangeSummaries(
  readings: readonly GlucoseReading[],
  range: TimeRange,
  timeZone: string,
): DailyRangeSummary[] {
  const days: DailyRangeSummary[] = [];
  const sorted = [...readings].sort((left, right) => left.timestamp - right.timestamp);
  for (
    let dateKey = toDateKey(range.start, timeZone), start = localMidnight(dateKey, timeZone);
    start < range.end;
    dateKey = addDays(dateKey, 1), start = localMidnight(dateKey, timeZone)
  ) {
    const dayRange = { start: Math.max(start, range.start), end: Math.min(localMidnight(addDays(dateKey, 1), timeZone), range.end) };
    if (dayRange.end <= dayRange.start) continue;
    days.push({
      dateKey,
      range: dayRange,
      summary: calculateGlucoseRangeSummary({ readings: readingsWithin(sorted, dayRange), range: dayRange }),
    });
  }
  return days;
}

export type SteadiestDayResult =
  | {
      status: 'shown';
      dateKey: DateKey;
      range: TimeRange;
      /** Standard-range time in range, as displayed (1 decimal place). */
      timeInRangePercent: number;
      coveragePercent: number;
      /** Other eligible days with the same displayed percentage. */
      tiedDateKeys: DateKey[];
      eligibleDays: number;
      totalDays: number;
    }
  | { status: 'withheld'; eligibleDays: 0; totalDays: number };

/**
 * The complete day with the highest standard-range (3.9–10.0 mmol/L) time in
 * range among days with at least 70% sensor coverage. Equal displayed values
 * are a tie: the most recent tied day is named and the others are listed.
 */
export function steadiestDay(days: readonly DailyRangeSummary[]): SteadiestDayResult {
  const eligible = days.filter(({ summary }) =>
    summary.representative &&
    summary.coveragePercent >= REPRESENTATIVE_COVERAGE_PERCENT &&
    summary.standard.inRange.percent !== null,
  );
  if (!eligible.length) return { status: 'withheld', eligibleDays: 0, totalDays: days.length };
  const best = Math.max(...eligible.map(({ summary }) => summary.standard.inRange.percent!));
  const tied = eligible
    .filter(({ summary }) => summary.standard.inRange.percent === best)
    .sort((left, right) => right.range.start - left.range.start);
  const chosen = tied[0]!;
  return {
    status: 'shown',
    dateKey: chosen.dateKey,
    range: chosen.range,
    timeInRangePercent: best,
    coveragePercent: chosen.summary.coveragePercent,
    tiedDateKeys: tied.slice(1).map(({ dateKey }) => dateKey),
    eligibleDays: eligible.length,
    totalDays: days.length,
  };
}

export interface DayComparisonWindow {
  label: string;
  range: TimeRange;
  summary: GlucoseRangeSummary;
}

export interface YesterdayTodayComparison {
  today: DayComparisonWindow;
  yesterday: DayComparisonWindow;
  /** False when either window has under 70% sensor coverage. */
  comparable: boolean;
}

/**
 * Today from local midnight to now, compared with yesterday over the same
 * clock hours so both windows cover the same part of the day.
 */
export function yesterdayVsTodaySoFar(
  readings: readonly GlucoseReading[],
  now: number,
  timeZone: string,
): YesterdayTodayComparison | null {
  const today = toDateKey(now, timeZone);
  const todayStart = localMidnight(today, timeZone);
  if (now <= todayStart) return null;
  const parts = getZonedDateTimeParts(now, timeZone);
  const yesterday = addDays(today, -1);
  const yesterdayStart = localMidnight(yesterday, timeZone);
  const yesterdayEnd = Math.min(
    zonedDateTimeToTimestamp(yesterday, parts.hour, parts.minute, parts.second, timeZone),
    todayStart,
  );
  if (yesterdayEnd <= yesterdayStart) return null;
  const todayRange = { start: todayStart, end: now };
  const yesterdayRange = { start: yesterdayStart, end: yesterdayEnd };
  const todaySummary = calculateGlucoseRangeSummary({ readings: readingsWithin(readings, todayRange), range: todayRange });
  const yesterdaySummary = calculateGlucoseRangeSummary({ readings: readingsWithin(readings, yesterdayRange), range: yesterdayRange });
  return {
    today: { label: 'Today so far', range: todayRange, summary: todaySummary },
    yesterday: { label: 'Yesterday, same hours', range: yesterdayRange, summary: yesterdaySummary },
    comparable: todaySummary.representative && yesterdaySummary.representative,
  };
}

type HighlightSettings = Pick<T1ArcRegionalDefaults, 'locale' | 'timeZone' | 'glucoseUnit'>;

export function formatHighlightDate(dateKey: DateKey, settings: Pick<HighlightSettings, 'locale' | 'timeZone'>) {
  // Noon avoids any clock-change edge when naming the calendar day.
  return new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(zonedDateTimeToTimestamp(dateKey, 12, 0, 0, settings.timeZone));
}

function percent(value: number, locale: string) {
  return `${formatRegionalNumber(value, locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

/** "Highest time in range: Tue 12 Nov, 86%". */
export function steadiestDayText(result: SteadiestDayResult, settings: HighlightSettings) {
  if (result.status === 'withheld') {
    return {
      headline: 'No day highlighted',
      detail: `No day in this period had at least ${REPRESENTATIVE_COVERAGE_PERCENT}% sensor coverage, so no day is named.`,
    };
  }
  const tied = result.tiedDateKeys.length
    ? ` The same figure was recorded on ${result.tiedDateKeys.map((key) => formatHighlightDate(key, settings)).join(', ')}.`
    : '';
  return {
    headline: `Highest time in range: ${formatHighlightDate(result.dateKey, settings)}, ${percent(result.timeInRangePercent, settings.locale)}`,
    detail: `${glucoseTargetRangeLabel(STANDARD_GLUCOSE_RANGE, settings)}. Sensor coverage that day: ${percent(result.coveragePercent, settings.locale)}. Chosen from ${formatRegionalNumber(result.eligibleDays, settings.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(result.totalDays, settings.locale, { maximumFractionDigits: 0 })} days with at least ${REPRESENTATIVE_COVERAGE_PERCENT}% coverage.${tied}`,
  };
}
