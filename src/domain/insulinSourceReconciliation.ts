import type { BasalDelivery, BolusDelivery } from './models';

/**
 * Several connected sources can describe the same pump delivery: an old Glooko
 * export, AAPS on this phone and the Nightscout site AAPS uploads to. Totals
 * must count each delivery once. Higher-precedence copies are kept; lower ones
 * are hidden at read time only, so every stored source record stays
 * inspectable with its own provenance.
 *
 * Precedence: pump export (Glooko) > AAPS on this phone > Nightscout.
 * Manual entries and unknown sources are never hidden here.
 */
export const INSULIN_SOURCE_PRECEDENCE: readonly string[] = [
  'glooko-export',
  'aaps-local',
  'nightscout',
];

/** Same delivery recorded by two systems: AAPS copies share a timestamp; exports may round to the minute. */
export const DUPLICATE_BOLUS_WINDOW_MS = 2 * 60_000;
export const DUPLICATE_BOLUS_UNITS_TOLERANCE = 0.05;

function precedence(sourceId: string) {
  const index = INSULIN_SOURCE_PRECEDENCE.indexOf(sourceId);
  return index === -1 ? undefined : index;
}

export interface BolusReconciliation {
  boluses: BolusDelivery[];
  /** Lower-precedence copies hidden from totals, with the record kept instead. */
  hidden: { record: BolusDelivery; keptId: string }[];
}

export function reconcileBolusSources(
  boluses: readonly BolusDelivery[],
): BolusReconciliation {
  const ranked = boluses
    .map((record, order) => ({ record, order, rank: precedence(record.sourceId) }))
    .sort(
      (left, right) =>
        (left.rank ?? -1) - (right.rank ?? -1) ||
        left.record.timestamp - right.record.timestamp ||
        left.record.id.localeCompare(right.record.id),
    );
  const kept: typeof ranked = [];
  const matched = new Set<string>();
  const hidden: BolusReconciliation['hidden'] = [];
  for (const candidate of ranked) {
    if (candidate.rank === undefined || candidate.rank === 0) {
      kept.push(candidate);
      continue;
    }
    const match = kept
      .filter(
        (other) =>
          other.rank !== undefined &&
          other.rank < candidate.rank! &&
          other.record.sourceId !== candidate.record.sourceId &&
          !matched.has(other.record.id) &&
          Math.abs(other.record.timestamp - candidate.record.timestamp) <=
            DUPLICATE_BOLUS_WINDOW_MS &&
          Math.abs(other.record.units - candidate.record.units) <
            DUPLICATE_BOLUS_UNITS_TOLERANCE,
      )
      .sort(
        (left, right) =>
          Math.abs(left.record.timestamp - candidate.record.timestamp) -
            Math.abs(right.record.timestamp - candidate.record.timestamp) ||
          left.record.id.localeCompare(right.record.id),
      )[0];
    if (match) {
      matched.add(match.record.id);
      hidden.push({ record: candidate.record, keptId: match.record.id });
    } else {
      kept.push(candidate);
    }
  }
  return {
    boluses: kept
      .sort((left, right) => left.order - right.order)
      .map((item) => item.record),
    hidden,
  };
}

function scaled(record: BasalDelivery, start: number, end: number, part?: number): BasalDelivery {
  if (start === record.start && end === record.end) return record;
  const fraction = (end - start) / (record.end - record.start);
  return {
    ...record,
    id: part === undefined || part === 0 ? record.id : `${record.id}:part:${part}`,
    start,
    end,
    units: record.units * fraction,
    unitsEstimated: true,
  };
}

/**
 * Nightscout semantics: a temporary basal ends when the next one starts.
 * Records stored before AAPS shortened them must not overlap later ones.
 */
function truncateSequentialNightscout(records: BasalDelivery[]) {
  const byStart = new Map<number, BasalDelivery>();
  for (const record of records) {
    const previous = byStart.get(record.start);
    // Two copies with one start: prefer the newest import, then a stable ID.
    if (
      !previous ||
      (record.importedAt ?? 0) > (previous.importedAt ?? 0) ||
      ((record.importedAt ?? 0) === (previous.importedAt ?? 0) &&
        record.id.localeCompare(previous.id) > 0)
    ) {
      byStart.set(record.start, record);
    }
  }
  const sorted = [...byStart.values()].sort((left, right) => left.start - right.start);
  return sorted.flatMap((record, index) => {
    const next = sorted[index + 1];
    const end = next ? Math.min(record.end, next.start) : record.end;
    return end > record.start ? [scaled(record, record.start, end)] : [];
  });
}

function subtractCoverage(record: BasalDelivery, coverage: { start: number; end: number }[]) {
  let pieces = [{ start: record.start, end: record.end }];
  for (const cover of coverage) {
    pieces = pieces.flatMap((piece) => {
      if (cover.end <= piece.start || cover.start >= piece.end) return [piece];
      return [
        { start: piece.start, end: Math.min(piece.end, cover.start) },
        { start: Math.max(piece.start, cover.end), end: piece.end },
      ].filter((part) => part.end > part.start);
    });
  }
  return pieces.map((piece, index) => scaled(record, piece.start, piece.end, index));
}

/**
 * Only one basal rate runs at a time. Where a higher-precedence source already
 * covers a period, a lower-precedence interval is clipped to the uncovered
 * time so the same basal period is never counted twice.
 */
export function reconcileBasalSources(basal: readonly BasalDelivery[]): BasalDelivery[] {
  const nightscout = basal.filter((record) => record.sourceId === 'nightscout');
  const normalized = [
    ...basal.filter((record) => record.sourceId !== 'nightscout'),
    ...truncateSequentialNightscout(nightscout),
  ];
  const result: BasalDelivery[] = [];
  const coverageByRank = new Map<number, { start: number; end: number }[]>();
  normalized.forEach((record) => {
    const rank = precedence(record.sourceId);
    if (rank === undefined) return;
    const list = coverageByRank.get(rank) ?? [];
    list.push({ start: record.start, end: record.end });
    coverageByRank.set(rank, list);
  });
  for (const record of normalized) {
    const rank = precedence(record.sourceId);
    if (rank === undefined || rank === 0) {
      result.push(record);
      continue;
    }
    const higher = [...coverageByRank.entries()]
      .filter(([otherRank]) => otherRank < rank)
      .flatMap(([, list]) => list);
    result.push(...subtractCoverage(record, higher));
  }
  return result.sort(
    (left, right) => left.start - right.start || left.id.localeCompare(right.id),
  );
}
