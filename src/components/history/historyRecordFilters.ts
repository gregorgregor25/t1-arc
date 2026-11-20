export type HistoryRecordFilter = 'all' | 'context' | 'insulin' | 'summary';

export interface HistoryRecordFilterOption {
  value: HistoryRecordFilter;
  label: string;
}

/**
 * "All" is the default, so everything that used to be visible as separate
 * cards (including duplicate-dose warnings and the glucose and insulin
 * reconciliation notes) is shown until someone chooses a narrower view.
 */
export const DEFAULT_HISTORY_RECORD_FILTER: HistoryRecordFilter = 'all';

/**
 * Filter chips for the History "Records" list. Each chip after "All" shows
 * one of the lists that used to be separate cards. "Insulin doses" is left
 * out when no insulin source is connected, exactly as the separate card was
 * hidden before; the "Glucose + insulin" summary still explains the missing
 * insulin history.
 */
export function historyRecordFilterOptions(insulinMissing: boolean): HistoryRecordFilterOption[] {
  return [
    { value: 'all', label: 'All' },
    { value: 'context', label: 'Around the timeline' },
    ...(insulinMissing ? [] : [{ value: 'insulin' as const, label: 'Insulin doses' }]),
    { value: 'summary', label: 'Glucose + insulin' },
  ];
}

/**
 * Keeps the chosen chip when it is offered. When it is not offered for this
 * period (for example "Insulin doses" without an insulin source) the list
 * falls back to "All" for display only; the caller keeps the original choice,
 * so it comes back when that chip is offered again.
 */
export function resolveHistoryRecordFilter(
  chosen: HistoryRecordFilter,
  options: readonly HistoryRecordFilterOption[],
): HistoryRecordFilter {
  return options.some((option) => option.value === chosen) ? chosen : DEFAULT_HISTORY_RECORD_FILTER;
}

/** Which lists a filter shows. */
export function historyRecordListsFor(filter: HistoryRecordFilter, insulinMissing: boolean) {
  return {
    context: filter === 'all' || filter === 'context',
    insulin: !insulinMissing && (filter === 'all' || filter === 'insulin'),
    summary: filter === 'all' || filter === 'summary',
  };
}
