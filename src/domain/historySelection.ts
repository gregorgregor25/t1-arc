import type { TimeRange } from './models';
import { getCachedDateTimeFormat } from './intlFormatterCache';

export interface HistoryRangeSelection extends TimeRange {
  ownerIdentity: string;
}

export function isHistoryRangeSelection(value: unknown, now: number, ownerIdentity: string): value is HistoryRangeSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as HistoryRangeSelection;
  return typeof selection.ownerIdentity === 'string' && Boolean(selection.ownerIdentity) &&
    selection.ownerIdentity.length <= 4096 && selection.ownerIdentity === ownerIdentity &&
    Number.isSafeInteger(selection.start) && Number.isSafeInteger(selection.end) &&
    Number.isSafeInteger(now) && now < 8_640_000_000_000_000 &&
    selection.start > 0 && selection.end > selection.start && selection.end <= now &&
    selection.end - selection.start <= 31 * 86_400_000;
}

export function createHistoryRangeSelection(range: TimeRange, ownerIdentity: string): HistoryRangeSelection {
  const selection = { start: range.start, end: range.end, ownerIdentity };
  if (!isHistoryRangeSelection(selection, range.end, ownerIdentity)) throw new Error('This history period is not available.');
  return selection;
}

export function historySelectionForRequest(focus: unknown, selection: unknown, now: number, ownerIdentity: string) {
  return focus === 'glucose' && isHistoryRangeSelection(selection, now, ownerIdentity) ? selection : undefined;
}

/** Include timezone at each endpoint so repeated DST clock hours remain distinguishable. */
export function historySelectionLabel(selection: HistoryRangeSelection, locale: string, timeZone: string) {
  const formatter = getCachedDateTimeFormat(locale, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return `${formatter.format(selection.start)} to ${formatter.format(selection.end)}`;
}
