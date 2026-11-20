/**
 * Compare periods shows the three most useful findings first and folds the
 * rest under "More findings". Changes in glucose and insulin come before
 * possible influences, each already ordered by likely usefulness, so the
 * first three are taken in that order. Data-confidence notes are not
 * findings here; they keep their own section below.
 */
export const COMPARE_TOP_FINDING_COUNT = 3;

export interface CompareFindingGroups<T> {
  changes: readonly T[];
  context: readonly T[];
}

export interface CompareFindingSplit<T> {
  top: CompareFindingGroups<T>;
  more: CompareFindingGroups<T>;
  /** How many findings are folded under "More findings". */
  moreCount: number;
}

export function splitCompareFindings<T>(
  groups: CompareFindingGroups<T>,
  limit = COMPARE_TOP_FINDING_COUNT,
): CompareFindingSplit<T> {
  const topChanges = groups.changes.slice(0, limit);
  const topContext = groups.context.slice(0, Math.max(0, limit - topChanges.length));
  const moreChanges = groups.changes.slice(topChanges.length);
  const moreContext = groups.context.slice(topContext.length);
  return {
    top: { changes: topChanges, context: topContext },
    more: { changes: moreChanges, context: moreContext },
    moreCount: moreChanges.length + moreContext.length,
  };
}

/** "More findings, 4 more" style label parts for the fold button. */
export function moreFindingsLabel(count: number, expanded: boolean, formatCount: (value: number) => string) {
  if (expanded) return 'Fewer findings';
  return `More findings (${formatCount(count)})`;
}
