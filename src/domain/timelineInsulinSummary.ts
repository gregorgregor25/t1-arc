import {
  BasalDelivery,
  BolusDelivery,
  InsulinDailyTotal,
  TimelineData,
  TimeRange,
} from './models';
import {
  addDays,
  DateKey,
  toDateKey,
  zonedDateTimeToTimestamp,
} from './time';

export interface DailyInsulinSummary {
  dateKey: DateKey;
  start: number;
  end: number;
  basalUnits: number;
  bolusUnits: number;
  totalUnits: number;
}

export type InsulinTimelineFidelity =
  | 'detailed-events'
  | 'daily-totals-and-report-events'
  | 'daily-totals-only'
  | 'report-events-only'
  | 'no-records'
  | 'not-connected';

export interface InsulinTimelineFidelityPresentation {
  kind: InsulinTimelineFidelity;
  label: string;
  detail: string;
}

/** Describes only the insulin detail actually present in this timeline range. */
export function describeInsulinTimelineFidelity(
  data: Pick<
    TimelineData,
    'basal' | 'boluses' | 'dailyInsulinTotals' | 'pumpStates' | 'sources'
  >,
): InsulinTimelineFidelityPresentation {
  const hasDetailedEvents = data.basal.length > 0 || data.boluses.length > 0;
  const hasDailyTotals = (data.dailyInsulinTotals?.length ?? 0) > 0;
  const hasReportEvents = (data.pumpStates?.length ?? 0) > 0;
  const insulinSource = data.sources.find((source) => source.label === 'Insulin');

  if (hasDetailedEvents) {
    return {
      kind: 'detailed-events',
      label: 'Detailed delivery events',
      detail:
        'Basal intervals and boluses are plotted from individual source records.',
    };
  }
  if (hasDailyTotals && hasReportEvents) {
    return {
      kind: 'daily-totals-and-report-events',
      label: 'Daily totals + report events',
      detail:
        'Insulin amounts are daily summaries; Activity Mode and pause bands are report-derived.',
    };
  }
  if (hasDailyTotals) {
    return {
      kind: 'daily-totals-only',
      label: 'Daily totals only',
      detail: 'This range has summary amounts, not timed delivery events.',
    };
  }
  if (hasReportEvents) {
    return {
      kind: 'report-events-only',
      label: 'Report-derived pump states',
      detail:
        'Activity Mode and pause bands are available, but timed insulin amounts are not.',
    };
  }
  if (insulinSource && insulinSource.freshness !== 'missing') {
    return {
      kind: 'no-records',
      label: 'No insulin records in this range',
      detail: 'An insulin source is connected, but it supplied no records for these dates.',
    };
  }
  return {
    kind: 'not-connected',
    label: 'Insulin not connected',
    detail: 'Connect or import a supported insulin source to add delivery data.',
  };
}

/**
 * Produces Europe/London calendar-day totals for long-range charts. Basal
 * intervals are clipped at both the requested range and DST-aware day edges.
 */
export function summarizeInsulinByDay(
  basal: BasalDelivery[],
  boluses: BolusDelivery[],
  range: TimeRange,
  reportedTotals: InsulinDailyTotal[] = [],
): DailyInsulinSummary[] {
  if (range.end <= range.start) return [];

  const summaries: DailyInsulinSummary[] = [];
  let dateKey = toDateKey(range.start);

  for (let index = 0; index < 370; index += 1) {
    const naturalStart = zonedDateTimeToTimestamp(dateKey);
    const nextDateKey = addDays(dateKey, 1);
    const naturalEnd = zonedDateTimeToTimestamp(nextDateKey);
    const start = Math.max(range.start, naturalStart);
    const end = Math.min(range.end, naturalEnd);

    if (end > start) {
      const calculatedBasalUnits = basal.reduce((total, delivery) => {
        const overlapStart = Math.max(start, delivery.start);
        const overlapEnd = Math.min(end, delivery.end);
        if (overlapEnd <= overlapStart) return total;
        return (
          total +
          delivery.rateUnitsPerHour *
            ((overlapEnd - overlapStart) / 3_600_000)
        );
      }, 0);
      const calculatedBolusUnits = boluses.reduce(
        (total, delivery) =>
          delivery.timestamp >= start && delivery.timestamp < end
            ? total + delivery.units
            : total,
        0,
      );
      const reported = reportedTotals.find(
        (total) => total.dateKey === dateKey,
      );
      const basalUnits =
        reported?.basalUnits ?? calculatedBasalUnits;
      const bolusUnits =
        reported?.bolusUnits ?? calculatedBolusUnits;
      summaries.push({
        dateKey,
        start,
        end,
        basalUnits,
        bolusUnits,
        totalUnits: reported?.totalUnits ?? basalUnits + bolusUnits,
      });
    }

    if (naturalEnd >= range.end) break;
    dateKey = nextDateKey;
  }

  return summaries;
}
