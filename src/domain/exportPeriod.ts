import type { TimeRange } from './models';
import { toDateKey } from './time';

export type ExportPeriodChoice = 14 | 30 | 90 | 'all';

export const EXPORT_PERIOD_CHOICES: readonly ExportPeriodChoice[] = [14, 30, 90, 'all'];

const DAY_MS = 86_400_000;

/**
 * A rolling period ending now (the same convention as the GMI card), or
 * everything from the earliest stored record.
 */
export function exportPeriodRange(
  choice: ExportPeriodChoice,
  now: number,
  earliestRecordAt: number | undefined,
): TimeRange {
  if (choice === 'all') {
    const start = earliestRecordAt !== undefined && earliestRecordAt < now ? earliestRecordAt : now - DAY_MS;
    return { start, end: now };
  }
  return { start: now - choice * DAY_MS, end: now };
}

export function exportPeriodLabel(choice: ExportPeriodChoice) {
  return choice === 'all' ? 'All' : `${choice} days`;
}

/** For example "T1-Arc-glucose-2026-11-02-to-2026-11-16". */
export function exportFileStem(kind: string, range: TimeRange, timeZone: string) {
  const start = toDateKey(range.start, timeZone);
  const end = toDateKey(Math.max(range.start, range.end - 1), timeZone);
  return `T1-Arc-${kind}-${start}-to-${end}`;
}
