import type { BasalDelivery, BolusDelivery, HealthContextEvent } from './models';

/**
 * Several connected sources can describe the same pump delivery: an old Glooko
 * export, the Nightscout site AAPS uploads to and AAPS's broadcast on this
 * phone. Totals must count each delivery once. Higher-precedence copies are
 * kept; lower ones are hidden at read time only, so every stored source
 * record stays inspectable with its own provenance.
 *
 * Precedence: pump export (Glooko) > Nightscout > AAPS on this phone.
 * Nightscout is read with the user's own token. Android usually cannot
 * confirm who sent an on-phone AAPS broadcast, so those records only fill
 * gaps Nightscout has not covered yet, such as the minutes before its next
 * fetch. Manual entries and unknown sources are never hidden here.
 */
export const INSULIN_SOURCE_PRECEDENCE: readonly string[] = [
  'glooko-export',
  'nightscout',
  'aaps-local',
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
  rank: number;
}

interface CopyGroup<T> {
  canonical: RankedRecord<T>;
  /** The canonical record and every copy it absorbed, one per source. */
  members: T[];
  absorbedRanks: Set<number>;
}

interface CopyRules<T> {
  timeOf: (record: T) => number;
  /** Largest time difference at which two records can be copies. */
  windowMs: number;
  /** Records that may be matched at all; others are always kept as they are. */
  eligible: (record: T) => boolean;
  matches: (kept: T, copy: T) => boolean;
}

/**
 * Shared matching for records that several sources can each hold one copy of.
 *
 * Sources are processed in precedence order. A record from the highest
 * source present stays as the canonical record. A record from a lower source
 * is hidden only when it matches a canonical record (or a copy that record
 * already absorbed) and that record has not yet absorbed a copy from the same
 * source. So one canonical record absorbs at most one copy from each lower
 * source, and two genuine records close together in one source both stay.
 * Matching is greedy by time difference, closest first, so each copy goes to
 * the nearest record it can belong to. Apart from the returned order, which
 * follows the input, the result does not depend on input order.
 */
function reconcileCopies<T extends { id: string; sourceId: string }>(
  records: readonly T[],
  rules: CopyRules<T>,
): { kept: T[]; hidden: { record: T; keptId: string }[] } {
  const { timeOf, windowMs, matches } = rules;
  const passThrough: { record: T; order: number }[] = [];
  const ranked: RankedRecord<T>[] = [];
  records.forEach((record, order) => {
    const rank = precedence(record.sourceId);
    if (rank === undefined || !rules.eligible(record)) passThrough.push({ record, order });
    else ranked.push({ record, order, rank });
  });
  const ranks = [...new Set(ranked.map((item) => item.rank))].sort((left, right) => left - right);
  const groups: CopyGroup<T>[] = [];
  // Groups indexed by the time buckets of their members, so each copy is
  // compared only with nearby records rather than with every record.
  const buckets = new Map<number, Set<CopyGroup<T>>>();
  const bucketOf = (time: number) => Math.floor(time / windowMs);
  const index = (group: CopyGroup<T>, member: T) => {
    const bucket = bucketOf(timeOf(member));
    const list = buckets.get(bucket) ?? new Set<CopyGroup<T>>();
    list.add(group);
    buckets.set(bucket, list);
  };
  const hidden: { record: T; keptId: string }[] = [];
  for (const rank of ranks) {
    const copies = ranked.filter((item) => item.rank === rank);
    const pairs: { copy: RankedRecord<T>; group: CopyGroup<T>; distance: number }[] = [];
    for (const copy of copies) {
      const time = timeOf(copy.record);
      const nearby = new Set<CopyGroup<T>>();
      for (let bucket = bucketOf(time) - 1; bucket <= bucketOf(time) + 1; bucket += 1) {
        buckets.get(bucket)?.forEach((group) => nearby.add(group));
      }
      for (const group of nearby) {
        if (group.absorbedRanks.has(rank)) continue;
        const distances = group.members
          .filter((member) => matches(member, copy.record))
          .map((member) => Math.abs(timeOf(member) - time));
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
      index(group, copy.record);
      hidden.push({ record: copy.record, keptId: group.canonical.record.id });
    }
    for (const copy of copies) {
      if (absorbed.has(copy)) continue;
      const group: CopyGroup<T> = {
        canonical: copy,
        members: [copy.record],
        absorbedRanks: new Set(),
      };
      groups.push(group);
      index(group, copy.record);
    }
  }
  const kept = [...passThrough, ...groups.map((group) => group.canonical)]
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
  const { kept, hidden } = reconcileCopies(boluses, {
    timeOf: (record) => record.timestamp,
    windowMs: DUPLICATE_BOLUS_WINDOW_MS,
    eligible: () => true,
    matches: sameBolus,
  });
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

/** The same meal can be imported from Glooko, AAPS on this phone and Nightscout. */
export const DUPLICATE_CONTEXT_WINDOW_MS = 2 * 60_000;
export const DUPLICATE_CARBS_TOLERANCE_GRAMS = 0.5;

/** AAPS notes (targets, profile switches, site changes) reach T1 Arc through both AAPS routes. */
const AAPS_NOTE_SOURCES = new Set(['aaps-local', 'nightscout']);

/**
 * Only imported carbohydrate records and AAPS notes take part. Manual
 * entries, meals without carbohydrate and every other kind are never hidden.
 */
function reconcilableContext(event: HealthContextEvent) {
  if (event.origin !== 'imported') return false;
  if (event.kind === 'meal') {
    return event.carbsGrams !== undefined && Number.isFinite(event.carbsGrams);
  }
  return event.kind === 'note' && AAPS_NOTE_SOURCES.has(event.sourceId);
}

function sameContextRecord(kept: HealthContextEvent, copy: HealthContextEvent) {
  if (kept.sourceId === copy.sourceId || kept.kind !== copy.kind) return false;
  if (Math.abs(kept.start - copy.start) > DUPLICATE_CONTEXT_WINDOW_MS) return false;
  if (kept.kind === 'meal' && copy.kind === 'meal') {
    return (
      kept.carbsGrams !== undefined &&
      copy.carbsGrams !== undefined &&
      Math.abs(kept.carbsGrams - copy.carbsGrams) < DUPLICATE_CARBS_TOLERANCE_GRAMS
    );
  }
  if (kept.kind === 'note' && copy.kind === 'note') {
    return kept.title === copy.title;
  }
  return false;
}

/**
 * Counts each imported meal once, with the same source precedence and
 * per-source matching as boluses. Hidden copies stay stored with their own
 * provenance; only read-time totals and lists use the kept record.
 */
export function reconcileContextSources(
  events: readonly HealthContextEvent[],
): HealthContextEvent[] {
  return reconcileCopies(events, {
    timeOf: (event) => event.start,
    windowMs: DUPLICATE_CONTEXT_WINDOW_MS,
    eligible: reconcilableContext,
    matches: sameContextRecord,
  }).kept;
}
