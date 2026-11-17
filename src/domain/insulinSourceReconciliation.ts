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
 * Matching is one-to-one and keeps as many matches as possible, preferring
 * the closest records when there is a choice. Apart from the returned order, which
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
    const compare = (
      left: { copy: RankedRecord<T>; group: CopyGroup<T>; distance: number },
      right: { copy: RankedRecord<T>; group: CopyGroup<T>; distance: number },
    ) =>
      left.distance - right.distance ||
      timeOf(left.group.canonical.record) - timeOf(right.group.canonical.record) ||
      left.group.canonical.record.id.localeCompare(right.group.canonical.record.id) ||
      left.copy.record.id.localeCompare(right.copy.record.id);
    pairs.sort(compare);
    const options = new Map<RankedRecord<T>, CopyGroup<T>[]>();
    for (const { copy, group } of pairs) {
      const list = options.get(copy) ?? [];
      list.push(group);
      options.set(copy, list);
    }
    // One-to-one matching: closest pairs first, then augmenting paths so a
    // copy is never stranded when moving another copy to its second-nearest
    // record would let both be matched. This keeps the largest possible
    // number of matches, so totals never rise because of match order.
    const groupHolder = new Map<CopyGroup<T>, RankedRecord<T>>();
    const copyGroup = new Map<RankedRecord<T>, CopyGroup<T>>();
    const assign = (copy: RankedRecord<T>, group: CopyGroup<T>) => {
      groupHolder.set(group, copy);
      copyGroup.set(copy, group);
    };
    for (const { copy, group } of pairs) {
      if (copyGroup.has(copy) || groupHolder.has(group)) continue;
      assign(copy, group);
    }
    // Breadth-first search with an explicit queue, so a long chain of
    // reassignments (months of SMBs a few minutes apart) cannot overflow the
    // call stack. Groups a failed search visited cannot lead to a free group
    // while the matching is unchanged, so they stay marked until the next
    // successful reassignment. That avoids repeating failed searches; dense
    // clusters of near-identical records can still take longer.
    let visited = new Set<CopyGroup<T>>();
    const augment = (start: RankedRecord<T>) => {
      const reachedFrom = new Map<CopyGroup<T>, RankedRecord<T>>();
      const queue = [start];
      let free: CopyGroup<T> | undefined;
      for (let head = 0; head < queue.length && free === undefined; head += 1) {
        const current = queue[head];
        if (current === undefined) break;
        for (const group of options.get(current) ?? []) {
          if (visited.has(group)) continue;
          visited.add(group);
          reachedFrom.set(group, current);
          const holder = groupHolder.get(group);
          if (holder === undefined) {
            free = group;
            break;
          }
          queue.push(holder);
        }
      }
      if (free === undefined) return;
      // Walk back along the path, moving each copy to the group it reached.
      let group: CopyGroup<T> | undefined = free;
      while (group !== undefined) {
        const copy: RankedRecord<T> = reachedFrom.get(group)!;
        const previous = copyGroup.get(copy);
        assign(copy, group);
        group = copy === start ? undefined : previous;
      }
      visited = new Set();
    };
    const unmatched = copies
      .filter((copy) => !copyGroup.has(copy) && options.has(copy))
      .sort(
        (left, right) =>
          timeOf(left.record) - timeOf(right.record) ||
          left.record.id.localeCompare(right.record.id),
      );
    for (const copy of unmatched) augment(copy);
    const absorbed = new Set<RankedRecord<T>>();
    for (const [copy, group] of copyGroup) {
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

/** Glooko exports do not say whether a bolus was an automatic SMB; AAPS and Nightscout do. */
export function bolusSourceRecordsSmbMarking(sourceId: string) {
  return !/glooko/i.test(sourceId);
}

function isSmbDeliveryType(deliveryType: string | undefined) {
  return deliveryType?.trim().toUpperCase() === 'SMB';
}

/** Units stored by two systems for one delivery; within this they are the same amount. */
const EXACT_UNITS_EPSILON = 1e-9;
/** Exports round times to the minute, so a copy of the same delivery is at most this far apart. */
const SMB_MARKING_WINDOW_MS = 60_000;

/** Index of the first record at or after `time`, in records sorted by timestamp. */
function firstAtOrAfter(records: readonly BolusDelivery[], time: number) {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (records[middle]!.timestamp < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A kept Glooko copy loses AAPS's SMB marking. The kept record carries the
 * marking of a hidden copy (read-time only) only when that is certain:
 * exactly one record from a source that marks SMBs could be this delivery,
 * it was matched to this record, its units are exactly the same, it is less
 * than a minute away, and it states a delivery type. Otherwise the record stays unmarked and is counted
 * in the visible "doesn't mark automatic boluses" note. Units, timestamps and
 * totals are unchanged.
 */
function carrySmbMarking(
  all: readonly BolusDelivery[],
  kept: BolusDelivery[],
  hidden: readonly { record: BolusDelivery; keptId: string }[],
): BolusDelivery[] {
  const copiesByKept = new Map<string, BolusDelivery[]>();
  for (const { record, keptId } of hidden) {
    if (!bolusSourceRecordsSmbMarking(record.sourceId)) continue;
    const list = copiesByKept.get(keptId) ?? [];
    list.push(record);
    copiesByKept.set(keptId, list);
  }
  if (!copiesByKept.size) return kept;
  const marking = all
    .filter((record) => bolusSourceRecordsSmbMarking(record.sourceId))
    .sort((left, right) => left.timestamp - right.timestamp);
  return kept.map((record) => {
    if (bolusSourceRecordsSmbMarking(record.sourceId)) return record;
    const copies = copiesByKept.get(record.id);
    if (!copies?.length) return record;
    // Every record that could be this delivery, by source.
    const candidatesBySource = new Map<string, number>();
    let candidates = 0;
    for (
      let index = firstAtOrAfter(marking, record.timestamp - DUPLICATE_BOLUS_WINDOW_MS);
      index < marking.length && marking[index]!.timestamp <= record.timestamp + DUPLICATE_BOLUS_WINDOW_MS;
      index += 1
    ) {
      const candidate = marking[index]!;
      if (!sameBolus(record, candidate)) continue;
      candidates += 1;
      candidatesBySource.set(candidate.sourceId, (candidatesBySource.get(candidate.sourceId) ?? 0) + 1);
    }
    // One candidate per source (AAPS and Nightscout may both hold the delivery),
    // all of them matched to this record, exact units, a stated delivery type,
    // and the same SMB marking.
    const certain =
      candidates === copies.length &&
      [...candidatesBySource.values()].every((count) => count === 1) &&
      copies.every(
        (copy) =>
          Math.abs(copy.units - record.units) <= EXACT_UNITS_EPSILON &&
          Math.abs(copy.timestamp - record.timestamp) < SMB_MARKING_WINDOW_MS &&
          Boolean(copy.deliveryType?.trim()),
      ) &&
      new Set(copies.map((copy) => isSmbDeliveryType(copy.deliveryType))).size === 1;
    if (!certain) return record;
    const copy = copies[0]!;
    return {
      ...record,
      smbMarking: { sourceId: copy.sourceId, smb: isSmbDeliveryType(copy.deliveryType) },
    };
  });
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
  return { boluses: carrySmbMarking(boluses, kept, hidden), hidden };
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
