import type { BasalDelivery, BolusDelivery, HealthContextEvent } from './models';

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

interface RankedRecord<T> {
  record: T;
  order: number;
  rank: number | undefined;
}

interface CopyGroup<T> {
  canonical: RankedRecord<T>;
  /** The canonical record and every copy it absorbed, one per source. */
  members: T[];
  absorbedRanks: Set<number>;
}

/**
 * Shared matching for records that several sources can each hold one copy of.
 *
 * Sources are processed in precedence order. A record from the highest
 * source present stays as the canonical delivery. A record from a lower
 * source is hidden only when it matches a canonical delivery (or a copy that
 * delivery already absorbed) and that delivery has not yet absorbed a copy
 * from the same source. So one delivery absorbs at most one copy from each
 * lower source, and two genuine deliveries recorded close together in one
 * source both stay. Matching is greedy by time difference, closest first, so
 * each copy goes to the nearest delivery it can belong to.
 */
function reconcileCopies<T extends { id: string; sourceId: string }>(
  records: readonly T[],
  timeOf: (record: T) => number,
  matches: (kept: T, copy: T) => boolean,
): { kept: T[]; hidden: { record: T; keptId: string }[] } {
  const ranked: RankedRecord<T>[] = records.map((record, order) => ({
    record,
    order,
    rank: precedence(record.sourceId),
  }));
  const unranked = ranked.filter((item) => item.rank === undefined);
  const ranks = [...new Set(ranked.flatMap((item) => (item.rank === undefined ? [] : [item.rank])))]
    .sort((left, right) => left - right);
  const groups: CopyGroup<T>[] = [];
  const hidden: { record: T; keptId: string }[] = [];
  for (const rank of ranks) {
    const copies = ranked.filter((item) => item.rank === rank);
    const pairs: { copy: RankedRecord<T>; group: CopyGroup<T>; distance: number }[] = [];
    for (const copy of copies) {
      for (const group of groups) {
        if (group.absorbedRanks.has(rank)) continue;
        const distances = group.members
          .filter((member) => matches(member, copy.record))
          .map((member) => Math.abs(timeOf(member) - timeOf(copy.record)));
        if (distances.length === 0) continue;
        pairs.push({ copy, group, distance: Math.min(...distances) });
      }
    }
    pairs.sort(
      (left, right) =>
        left.distance - right.distance ||
        timeOf(left.group.canonical.record) - timeOf(right.group.canonical.record) ||
        left.group.canonical.record.id.localeCompare(right.group.canonical.record.id) ||
        left.copy.record.id.localeCompare(right.copy.record.id),
    );
    const absorbed = new Set<RankedRecord<T>>();
    for (const { copy, group } of pairs) {
      if (absorbed.has(copy) || group.absorbedRanks.has(rank)) continue;
      absorbed.add(copy);
      group.absorbedRanks.add(rank);
      group.members.push(copy.record);
      hidden.push({ record: copy.record, keptId: group.canonical.record.id });
    }
    for (const copy of copies) {
      if (absorbed.has(copy)) continue;
      groups.push({ canonical: copy, members: [copy.record], absorbedRanks: new Set() });
    }
  }
  const kept = [...unranked, ...groups.map((group) => group.canonical)]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.record);
  hidden.sort(
    (left, right) =>
      timeOf(left.record) - timeOf(right.record) || left.record.id.localeCompare(right.record.id),
  );
  return { kept, hidden };
}

function sameBolus(kept: BolusDelivery, copy: BolusDelivery) {
  return (
    kept.sourceId !== copy.sourceId &&
    Math.abs(kept.timestamp - copy.timestamp) <= DUPLICATE_BOLUS_WINDOW_MS &&
    Math.abs(kept.units - copy.units) < DUPLICATE_BOLUS_UNITS_TOLERANCE
  );
}

export function reconcileBolusSources(
  boluses: readonly BolusDelivery[],
): BolusReconciliation {
  const { kept, hidden } = reconcileCopies(boluses, (record) => record.timestamp, sameBolus);
  return { boluses: kept, hidden };
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

/** AAPS sends the same carbs and notes locally and to Nightscout. */
export const DUPLICATE_CONTEXT_WINDOW_MS = 2 * 60_000;
export const DUPLICATE_CARBS_TOLERANCE_GRAMS = 0.5;

function sameAapsRecord(local: HealthContextEvent, remote: HealthContextEvent) {
  if (local.kind !== remote.kind) return false;
  if (Math.abs(local.start - remote.start) > DUPLICATE_CONTEXT_WINDOW_MS) return false;
  if (local.kind === 'meal' && remote.kind === 'meal') {
    return (
      local.carbsGrams !== undefined &&
      remote.carbsGrams !== undefined &&
      Math.abs(local.carbsGrams - remote.carbsGrams) < DUPLICATE_CARBS_TOLERANCE_GRAMS
    );
  }
  if (local.kind === 'note' && remote.kind === 'note') {
    return local.title === remote.title;
  }
  return false;
}

/**
 * Hides a Nightscout carb or note record when AAPS on this phone sent the
 * same record, so meals are not counted twice. Other sources are untouched.
 */
export function reconcileContextSources(
  events: readonly HealthContextEvent[],
): HealthContextEvent[] {
  const local = events.filter((event) => event.sourceId === 'aaps-local');
  if (local.length === 0) return [...events];
  const matched = new Set<string>();
  return events.filter((event) => {
    if (event.sourceId !== 'nightscout') return true;
    const match = local
      .filter((candidate) => !matched.has(candidate.id) && sameAapsRecord(candidate, event))
      .sort(
        (left, right) =>
          Math.abs(left.start - event.start) - Math.abs(right.start - event.start) ||
          left.id.localeCompare(right.id),
      )[0];
    if (!match) return true;
    matched.add(match.id);
    return false;
  });
}
