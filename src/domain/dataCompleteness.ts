import {
  BasalDelivery,
  GlucoseReading,
  PumpStateInterval,
  TimeRange,
  TimelineData,
} from "./models";
import { calculateInsulinStats } from "./stats";
import { addDays, DateKey, zonedDateTimeToTimestamp } from "./time";
import { selectLatestInsulinDailyTotals } from "./timelineInsulinSummary";

const GLUCOSE_OBSERVED_WINDOW_MS = 12 * 60 * 1000;

export interface CoverageGap {
  start: number;
  end: number;
  minutes: number;
}

export interface CoverageSummary {
  recordCount: number;
  coveredMinutes: number;
  missingMinutes: number;
  coveragePercent: number;
  gaps: CoverageGap[];
  longestGapMinutes: number;
}

export interface DataCompletenessReport {
  glucose: CoverageSummary & {
    sourceCounts: { sourceId: string; count: number }[];
  };
  basal: CoverageSummary;
  bolusCount: number;
  contextCount: number;
  insulinReconciliation?: InsulinReconciliation;
}

export interface InsulinReconciliation {
  reportedDays: number;
  dateKeys: string[];
  reportedRecordIds: string[];
  organisedRecordIds: string[];
  reportedBasalUnits?: number;
  reportedBolusUnits?: number;
  reportedTotalUnits: number;
  organisedBasalUnits: number;
  organisedBolusUnits: number;
  organisedTotalUnits: number;
  differenceUnits: number;
}

interface Interval {
  start: number;
  end: number;
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clippedInterval(
  start: number,
  end: number,
  range: TimeRange,
): Interval | undefined {
  const clipped = {
    start: Math.max(start, range.start),
    end: Math.min(end, range.end),
  };
  return clipped.end > clipped.start ? clipped : undefined;
}

function coverageFromIntervals(
  recordCount: number,
  intervals: Interval[],
  range: TimeRange,
): CoverageSummary {
  const totalMs = Math.max(0, range.end - range.start);
  const merged: Interval[] = [];
  intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start)
    .forEach((interval) => {
      const previous = merged[merged.length - 1];
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    });

  const gaps: CoverageGap[] = [];
  let cursor = range.start;
  for (const interval of merged) {
    if (interval.start > cursor) {
      gaps.push({
        start: cursor,
        end: interval.start,
        minutes: round((interval.start - cursor) / 60_000),
      });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < range.end) {
    gaps.push({
      start: cursor,
      end: range.end,
      minutes: round((range.end - cursor) / 60_000),
    });
  }

  const coveredMs = merged.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const coveredMinutes = round(coveredMs / 60_000);
  const missingMinutes = round(Math.max(0, totalMs - coveredMs) / 60_000);
  return {
    recordCount,
    coveredMinutes,
    missingMinutes,
    coveragePercent:
      totalMs > 0 ? round(Math.min(100, (coveredMs / totalMs) * 100)) : 0,
    gaps,
    longestGapMinutes: gaps.length
      ? Math.max(...gaps.map((gap) => gap.minutes))
      : 0,
  };
}

function glucoseCoverage(readings: GlucoseReading[], range: TimeRange) {
  const inRange = readings
    .filter(
      (reading) =>
        reading.timestamp >= range.start && reading.timestamp < range.end,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const intervals = inRange
    .map((reading, index) =>
      clippedInterval(
        reading.timestamp,
        Math.min(
          reading.timestamp + GLUCOSE_OBSERVED_WINDOW_MS,
          inRange[index + 1]?.timestamp ?? range.end,
        ),
        range,
      ),
    )
    .filter((interval): interval is Interval => Boolean(interval));
  const counts = new Map<string, number>();
  inRange.forEach((reading) => {
    counts.set(reading.sourceId, (counts.get(reading.sourceId) ?? 0) + 1);
  });
  return {
    ...coverageFromIntervals(inRange.length, intervals, range),
    sourceCounts: [...counts.entries()]
      .map(([sourceId, count]) => ({ sourceId, count }))
      .sort(
        (a, b) => b.count - a.count || a.sourceId.localeCompare(b.sourceId),
      ),
  };
}

function basalCoverage(
  deliveries: BasalDelivery[],
  pumpStates: PumpStateInterval[],
  range: TimeRange,
) {
  const overlapping = deliveries.filter(
    (delivery) => delivery.start < range.end && delivery.end > range.start,
  );
  const knownPauses = pumpStates.filter(
    (state) =>
      state.kind === "automated-pause" &&
      state.start < range.end &&
      state.end > range.start,
  );
  const intervals = [...overlapping, ...knownPauses]
    .map((delivery) => clippedInterval(delivery.start, delivery.end, range))
    .filter((interval): interval is Interval => Boolean(interval));
  return coverageFromIntervals(overlapping.length, intervals, range);
}

export function buildInsulinReconciliation(
  data: TimelineData,
): InsulinReconciliation | undefined {
  const reportedTotals = selectLatestInsulinDailyTotals(
    data.dailyInsulinTotals ?? [],
  )
    .filter((total) => {
      const dateKey = total.dateKey as DateKey;
      const start = zonedDateTimeToTimestamp(dateKey);
      const end = zonedDateTimeToTimestamp(addDays(dateKey, 1));
      // A source daily total represents the whole analysis-zone calendar day. Do
      // not compare it with a partial slice of detailed rows.
      return start >= data.range.start && end <= data.range.end;
    })
    .sort(
      (left, right) =>
        left.dateKey.localeCompare(right.dateKey) ||
        left.timestamp - right.timestamp,
    );
  if (!reportedTotals.length) return undefined;

  const reportedDays = reportedTotals.map((total) => {
    const dateKey = total.dateKey as DateKey;
    return {
      total,
      start: zonedDateTimeToTimestamp(dateKey),
      end: zonedDateTimeToTimestamp(addDays(dateKey, 1)),
    };
  });
  const selectedBasal = data.basal.filter((delivery) =>
    reportedDays.some(
      (day) =>
        delivery.sourceId === day.total.sourceId &&
        (day.total.sourceDeviceId === undefined ||
          delivery.sourceDeviceId === day.total.sourceDeviceId) &&
        delivery.start < day.end &&
        delivery.end > day.start,
    ),
  );
  const selectedBoluses = data.boluses.filter((delivery) =>
    reportedDays.some(
      (day) =>
        delivery.sourceId === day.total.sourceId &&
        (day.total.sourceDeviceId === undefined ||
          delivery.sourceDeviceId === day.total.sourceDeviceId) &&
        delivery.timestamp >= day.start &&
        delivery.timestamp < day.end,
    ),
  );
  const detailedBreakdownIsComparable = reportedDays.every((day) => {
    const dayBasal = selectedBasal.filter(
      (delivery) =>
        delivery.sourceId === day.total.sourceId &&
        (day.total.sourceDeviceId === undefined ||
          delivery.sourceDeviceId === day.total.sourceDeviceId) &&
        delivery.start < day.end &&
        delivery.end > day.start,
    );
    const dayBoluses = selectedBoluses.filter(
      (delivery) =>
        delivery.sourceId === day.total.sourceId &&
        (day.total.sourceDeviceId === undefined ||
          delivery.sourceDeviceId === day.total.sourceDeviceId) &&
        delivery.timestamp >= day.start &&
        delivery.timestamp < day.end,
    );
    const expectedBasal =
      day.total.basalUnits ??
      (day.total.bolusUnits === undefined
        ? undefined
        : Math.max(0, day.total.totalUnits - day.total.bolusUnits));
    const expectedBolus =
      day.total.bolusUnits ??
      (day.total.basalUnits === undefined
        ? undefined
        : Math.max(0, day.total.totalUnits - day.total.basalUnits));

    // Some Glooko exports provide authoritative cumulative daily totals and
    // individual boluses, but no timed basal-delivery stream. That is a
    // different source fidelity, not a mismatch. Only reconcile a component
    // when the export actually supplied the detailed rows needed to check it.
    if (expectedBasal === undefined && expectedBolus === undefined) {
      return dayBasal.length > 0 && dayBoluses.length > 0;
    }
    return (
      ((expectedBasal ?? 0) <= 0.005 || dayBasal.length > 0) &&
      ((expectedBolus ?? 0) <= 0.005 || dayBoluses.length > 0)
    );
  });
  if (!detailedBreakdownIsComparable) return undefined;
  const organised = reportedDays.reduce(
    (sum, reportedDay) => {
      const calculated = calculateInsulinStats(
        selectedBasal.filter(
          (delivery) =>
            delivery.sourceId === reportedDay.total.sourceId &&
            (reportedDay.total.sourceDeviceId === undefined ||
              delivery.sourceDeviceId === reportedDay.total.sourceDeviceId),
        ),
        selectedBoluses.filter(
          (delivery) =>
            delivery.sourceId === reportedDay.total.sourceId &&
            (reportedDay.total.sourceDeviceId === undefined ||
              delivery.sourceDeviceId === reportedDay.total.sourceDeviceId),
        ),
        { start: reportedDay.start, end: reportedDay.end },
      );
      return {
        basalUnits: sum.basalUnits + calculated.basalUnits,
        bolusUnits: sum.bolusUnits + calculated.bolusUnits,
        totalUnits: sum.totalUnits + calculated.totalUnits,
      };
    },
    { basalUnits: 0, bolusUnits: 0, totalUnits: 0 },
  );
  const reportedTotalUnits = round(
    reportedTotals.reduce((sum, total) => sum + total.totalUnits, 0),
    2,
  );
  const reportedBasal = reportedTotals.every(
    (total) => total.basalUnits !== undefined,
  )
    ? round(
        reportedTotals.reduce((sum, total) => sum + (total.basalUnits ?? 0), 0),
        2,
      )
    : undefined;
  const reportedBolus = reportedTotals.every(
    (total) => total.bolusUnits !== undefined,
  )
    ? round(
        reportedTotals.reduce((sum, total) => sum + (total.bolusUnits ?? 0), 0),
        2,
      )
    : undefined;
  return {
    reportedDays: reportedTotals.length,
    dateKeys: reportedTotals.map((total) => total.dateKey),
    reportedRecordIds: reportedTotals.map((total) => total.id),
    organisedRecordIds: [
      ...selectedBasal.map((delivery) => delivery.id),
      ...selectedBoluses.map((delivery) => delivery.id),
    ],
    reportedBasalUnits: reportedBasal,
    reportedBolusUnits: reportedBolus,
    reportedTotalUnits,
    organisedBasalUnits: round(organised.basalUnits, 2),
    organisedBolusUnits: round(organised.bolusUnits, 2),
    organisedTotalUnits: round(organised.totalUnits, 2),
    differenceUnits: round(reportedTotalUnits - organised.totalUnits, 2),
  };
}

export function buildDataCompletenessReport(
  data: TimelineData,
): DataCompletenessReport {
  return {
    glucose: glucoseCoverage(data.glucose, data.range),
    basal: basalCoverage(data.basal, data.pumpStates ?? [], data.range),
    bolusCount: data.boluses.filter(
      (delivery) =>
        delivery.timestamp >= data.range.start &&
        delivery.timestamp < data.range.end,
    ).length,
    contextCount: data.context.filter(
      (event) =>
        event.start < data.range.end &&
        (event.end ?? event.start) >= data.range.start,
    ).length,
    insulinReconciliation: buildInsulinReconciliation(data),
  };
}
