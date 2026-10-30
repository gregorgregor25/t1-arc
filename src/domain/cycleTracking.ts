/** Calendar dates are local days, never UTC timestamps or elapsed 24-hour windows. */
export type CycleDate = string;
export type CycleFlow = 'spotting' | 'light' | 'medium' | 'heavy';

export interface CyclePeriod {
  id: string;
  startDate: CycleDate;
  endDate?: CycleDate;
  source: 'manual' | 'health-connect';
  readOnly: boolean;
  sourceLabel?: string;
}

export interface CycleDay {
  date: CycleDate;
  flow?: CycleFlow;
  flowSource?: 'manual' | 'health-connect';
  symptoms: string[];
  notes?: string;
  source: 'manual' | 'health-connect';
  readOnly: boolean;
}

export interface NextPeriodEstimate {
  startDate: CycleDate;
  basedOnCycles: number;
  typicalLengthDays: number;
}

export interface CycleSnapshot {
  periods: CyclePeriod[];
  days: CycleDay[];
  nextPeriodEstimate?: NextPeriodEstimate;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCycleDate(value: string): number {
  const parts = DATE_RE.exec(value);
  if (!parts) throw new Error('Enter a valid calendar date in YYYY-MM-DD format.');
  const year = Number(parts[1]);
  if (year < 1900 || year > 2200) throw new Error('The calendar date is out of range.');
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error('Enter a valid calendar date in YYYY-MM-DD format.');
  }
  return timestamp;
}

export function localCycleDate(timestamp: number): CycleDate {
  if (!Number.isFinite(timestamp)) throw new Error('The timestamp is invalid.');
  const date = new Date(timestamp);
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function cycleDayDifference(startDate: CycleDate, endDate: CycleDate): number {
  return Math.round((parseCycleDate(endDate) - parseCycleDate(startDate)) / DAY_MS);
}

export function addCycleDays(date: CycleDate, days: number): CycleDate {
  if (!Number.isSafeInteger(days)) throw new Error('The day offset is invalid.');
  return new Date(parseCycleDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function validatePeriodDates(startDate: CycleDate, endDate?: CycleDate): void {
  parseCycleDate(startDate);
  if (endDate !== undefined) {
    const length = cycleDayDifference(startDate, endDate);
    if (length < 0) throw new Error('The period end cannot be before its start.');
    if (length > 365) throw new Error('The period date range is too long.');
  }
}

export function periodsOverlap(a: Pick<CyclePeriod, 'startDate' | 'endDate'>, b: Pick<CyclePeriod, 'startDate' | 'endDate'>): boolean {
  const aEnd = a.endDate ?? '9999-12-31';
  const bEnd = b.endDate ?? '9999-12-31';
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

export function mergeCyclePeriods(manual: CyclePeriod[], imported: CyclePeriod[]): CyclePeriod[] {
  const sortedManual = [...manual].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const seen = new Set<string>();
  const visibleImported = imported
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .filter((period) => {
      if (sortedManual.some((own) => periodsOverlap(own, period))) return false;
      const key = `${period.startDate}|${period.endDate ?? period.startDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [...sortedManual, ...visibleImported].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** Only offer a single date when at least three recent intervals are fairly stable. */
export function estimateNextPeriod(periods: CyclePeriod[], today: CycleDate): NextPeriodEstimate | undefined {
  parseCycleDate(today);
  const starts = [...new Set(periods.map((period) => period.startDate).filter((date) => date <= today))].sort();
  const intervals: number[] = [];
  for (let index = starts.length - 1; index > 0 && intervals.length < 6; index--) {
    const days = cycleDayDifference(starts[index - 1]!, starts[index]!);
    if (days < 15 || days > 90) return undefined;
    intervals.push(days);
  }
  if (intervals.length < 3 || Math.max(...intervals) - Math.min(...intervals) > 7) return undefined;
  const ordered = intervals.sort((a, b) => a - b);
  const typicalLengthDays = ordered[Math.floor(ordered.length / 2)]!;
  const startDate = addCycleDays(starts.at(-1)!, typicalLengthDays);
  if (startDate < today) return undefined;
  return { startDate, basedOnCycles: intervals.length, typicalLengthDays };
}
