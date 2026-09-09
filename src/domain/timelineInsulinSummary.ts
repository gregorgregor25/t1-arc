import {
  BasalDelivery,
  BolusDelivery,
  InsulinDailyTotal,
  InsulinStats,
  TimelineData,
  TimeRange,
} from './models';
import { calculateInsulinStats } from './stats';
import { addDays, DateKey, toDateKey, zonedDateTimeToTimestamp } from './time';

export interface DailyInsulinSummary {
  dateKey: DateKey;
  start: number;
  end: number;
  basalUnits: number;
  bolusUnits: number;
  totalUnits: number;
  /** Source total minus basal and bolus; negative means they are not its split. */
  sourceMinusBreakdownUnits: number;
  sourceTotal?: InsulinDailyTotal;
  sourceAlternatives: InsulinDailyTotal[];
  sourceAsOf?: number;
  partial: boolean;
}

export interface InsulinRangeSummary {
  stats: InsulinStats;
  sourceTotals: InsulinDailyTotal[];
  sourceAsOf?: number;
  partial: boolean;
  sourceCoversEveryDay: boolean;
  sourceProvidesBasalEveryDay: boolean;
  sourceProvidesBolusEveryDay: boolean;
  sourceConflictCount: number;
}

export interface DailyInsulinTotalSelection {
  dateKey: string;
  total: InsulinDailyTotal;
  /** Latest totals from other source/device provenance groups for this day. */
  alternatives: InsulinDailyTotal[];
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

function dailyTotalCompleteness(total: InsulinDailyTotal) {
  return (
    Number(total.basalUnits !== undefined) +
    Number(total.bolusUnits !== undefined)
  );
}

function compareDailyTotalProvenance(
  left: InsulinDailyTotal,
  right: InsulinDailyTotal,
) {
  return (
    left.timestamp - right.timestamp ||
    dailyTotalCompleteness(left) - dailyTotalCompleteness(right) ||
    (left.importedAt ?? left.timestamp) -
      (right.importedAt ?? right.timestamp) ||
    (left.sourceRow ?? -1) - (right.sourceRow ?? -1) ||
    [left.sourceId, left.sourceFile ?? '', left.sourceDeviceId ?? '', left.id]
      .join('\u0000')
      .localeCompare(
        [
          right.sourceId,
          right.sourceFile ?? '',
          right.sourceDeviceId ?? '',
          right.id,
        ].join('\u0000'),
      )
  );
}

function dailyTotalProvenanceKey(total: InsulinDailyTotal) {
  return `${total.sourceId}\u0000${total.sourceDeviceId ?? 'device-unspecified'}`;
}

function matchesDailyTotalProvenance(
  record: BasalDelivery | BolusDelivery,
  total: InsulinDailyTotal,
) {
  return (
    record.sourceId === total.sourceId &&
    (total.sourceDeviceId === undefined ||
      record.sourceDeviceId === total.sourceDeviceId)
  );
}

/**
 * Keeps the newest snapshot inside each source/device provenance group, then
 * chooses one group per analysis-zone date. Other groups remain explicit alternatives
 * so callers never double-count them or silently conceal a source conflict.
 */
export function selectLatestInsulinDailyTotalSelections(
  totals: readonly InsulinDailyTotal[],
): DailyInsulinTotalSelection[] {
  const groupsByDate = new Map<string, Map<string, InsulinDailyTotal>>();
  totals.forEach((total) => {
    const groups = groupsByDate.get(total.dateKey) ?? new Map();
    const key = dailyTotalProvenanceKey(total);
    const previous = groups.get(key);
    if (!previous || compareDailyTotalProvenance(total, previous) > 0) {
      groups.set(key, total);
    }
    groupsByDate.set(total.dateKey, groups);
  });
  return [...groupsByDate.entries()]
    .map(([dateKey, groups]) => {
      const candidates = [...groups.values()].sort((left, right) =>
        compareDailyTotalProvenance(right, left),
      );
      return {
        dateKey,
        total: candidates[0]!,
        alternatives: candidates.slice(1),
      };
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

export function selectLatestInsulinDailyTotals(
  totals: readonly InsulinDailyTotal[],
) {
  return selectLatestInsulinDailyTotalSelections(totals).map(
    (selection) => selection.total,
  );
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
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
  const insulinSource = data.sources.find(
    (source) => source.label === 'Insulin',
  );

  if (hasDetailedEvents) {
    return {
      kind: 'detailed-events',
      label: 'Detailed delivery events',
      detail: data.basal.length > 0 && data.boluses.length > 0
        ? 'Basal intervals and boluses are plotted from individual source records.'
        : data.boluses.length > 0
          ? hasDailyTotals
            ? 'Boluses are timed delivery records. Basal amounts, where available, are daily totals, not timed basal intervals.'
            : 'Boluses are plotted from individual source records. No timed basal intervals are available in this range.'
          : 'Basal intervals are plotted from individual source records. No timed boluses are available in this range.',
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
      detail:
        'An insulin source is connected, but it supplied no records for these dates.',
    };
  }
  return {
    kind: 'not-connected',
    label: 'Insulin not connected',
    detail:
      'Connect or import a supported insulin source to add delivery data.',
  };
}

/**
 * Produces local calendar-day totals for long-range charts. Basal
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
  const reportedSelections =
    selectLatestInsulinDailyTotalSelections(reportedTotals);
  let dateKey = toDateKey(range.start);

  for (let index = 0; index < 370; index += 1) {
    const naturalStart = zonedDateTimeToTimestamp(dateKey);
    const nextDateKey = addDays(dateKey, 1);
    const naturalEnd = zonedDateTimeToTimestamp(nextDateKey);
    const start = Math.max(range.start, naturalStart);
    const end = Math.min(range.end, naturalEnd);

    if (end > start) {
      const requestedPartial = start > naturalStart || end < naturalEnd;
      const selection = reportedSelections.find(
        (item) => item.dateKey === dateKey,
      );
      const candidate = selection?.total;
      // A historical whole-day total must not replace a deliberately partial
      // slice. A same-day snapshot may represent today so far when it was
      // imported by the end of the requested range.
      const reported =
        candidate &&
        start === naturalStart &&
        (!requestedPartial ||
          (candidate.importedAt ?? candidate.timestamp) <= end + 5 * 60_000)
          ? candidate
          : undefined;
      const sourceSnapshotPartial = Boolean(
        reported?.importedAt !== undefined &&
          toDateKey(reported.importedAt) === dateKey &&
          reported.importedAt < naturalEnd,
      );
      const sourceAsOf =
        reported &&
        reported.timestamp >= naturalStart &&
        reported.timestamp <= end + 5 * 60_000
          ? Math.min(end, reported.timestamp)
          : undefined;
      const partial = requestedPartial || sourceSnapshotPartial;
      const detailedBasal = reported
        ? basal.filter((delivery) =>
            matchesDailyTotalProvenance(delivery, reported),
          )
        : basal;
      const detailedBoluses = reported
        ? boluses.filter((delivery) =>
            matchesDailyTotalProvenance(delivery, reported),
          )
        : boluses;
      const calculated = calculateInsulinStats(detailedBasal, detailedBoluses, {
        start,
        end,
      });
      const basalUnits = reported?.basalUnits ?? calculated.basalUnits;
      const bolusUnits = reported?.bolusUnits ?? calculated.bolusUnits;
      const totalUnits = reported?.totalUnits ?? basalUnits + bolusUnits;
      summaries.push({
        dateKey,
        start,
        end,
        basalUnits,
        bolusUnits,
        totalUnits,
        sourceMinusBreakdownUnits: rounded(
          totalUnits - basalUnits - bolusUnits,
        ),
        sourceTotal: reported,
        sourceAlternatives: reported ? (selection?.alternatives ?? []) : [],
        // This is the source record's own timestamp. Import time only says
        // when the snapshot reached T1 Arc and must never be presented as the
        // point through which the source data is complete.
        sourceAsOf,
        partial,
      });
    }

    if (naturalEnd >= range.end) break;
    dateKey = nextDateKey;
  }

  return summaries;
}

/** Builds one display total without losing authoritative daily source totals. */
export function summarizeInsulinRange(
  basal: BasalDelivery[],
  boluses: BolusDelivery[],
  range: TimeRange,
  reportedTotals: InsulinDailyTotal[] = [],
): InsulinRangeSummary {
  const days = summarizeInsulinByDay(basal, boluses, range, reportedTotals);
  const sourceTotals = days.flatMap((day) =>
    day.sourceTotal ? [day.sourceTotal] : [],
  );
  const sourceAsOf = days.reduce<number | undefined>(
    (latest, day) =>
      day.sourceAsOf === undefined
        ? latest
        : latest === undefined
          ? day.sourceAsOf
          : Math.max(latest, day.sourceAsOf),
    undefined,
  );
  return {
    stats: {
      basalUnits: rounded(
        days.reduce((total, day) => total + day.basalUnits, 0),
      ),
      bolusUnits: rounded(
        days.reduce((total, day) => total + day.bolusUnits, 0),
      ),
      totalUnits: rounded(
        days.reduce((total, day) => total + day.totalUnits, 0),
      ),
    },
    sourceTotals,
    sourceAsOf,
    partial: days.some((day) => day.partial),
    sourceCoversEveryDay:
      days.length > 0 && days.every((day) => day.sourceTotal !== undefined),
    sourceProvidesBasalEveryDay:
      days.length > 0 &&
      days.every((day) => day.sourceTotal?.basalUnits !== undefined),
    sourceProvidesBolusEveryDay:
      days.length > 0 &&
      days.every((day) => day.sourceTotal?.bolusUnits !== undefined),
    sourceConflictCount: days.reduce(
      (count, day) => count + day.sourceAlternatives.length,
      0,
    ),
  };
}
