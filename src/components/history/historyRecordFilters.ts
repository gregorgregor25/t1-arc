export type HistoryRecordFilter = 'context' | 'insulin' | 'summary';

export interface HistoryRecordFilterOption {
  value: HistoryRecordFilter;
  label: string;
}

/**
 * Filter chips for the History "Records" list. Each chip shows one of the
 * lists that used to be separate cards. "Insulin doses" is left out when no
 * insulin source is connected, exactly as the separate card was hidden before;
 * the "Glucose + insulin" summary still explains the missing insulin history.
 */
export function historyRecordFilterOptions(insulinMissing: boolean): HistoryRecordFilterOption[] {
  return [
    { value: 'context', label: 'Around the timeline' },
    ...(insulinMissing ? [] : [{ value: 'insulin' as const, label: 'Insulin doses' }]),
    { value: 'summary', label: 'Glucose + insulin' },
  ];
}

/** Keeps the chosen chip when it still exists, otherwise falls back to the first. */
export function resolveHistoryRecordFilter(
  chosen: HistoryRecordFilter,
  options: readonly HistoryRecordFilterOption[],
): HistoryRecordFilter {
  return options.some((option) => option.value === chosen) ? chosen : (options[0]?.value ?? 'context');
}
