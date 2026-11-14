/**
 * Anonymous usage counts: pure day/week bookkeeping and payload building.
 *
 * A payload never carries an identifier, device detail, locale, time zone,
 * health record or account detail. The day counts are integers from 0 to 7.
 */
export const USAGE_SCHEMA = 1 as const;
const HISTORY_DAYS = 14;
const WEEK_MS = 7 * 86_400_000;

export interface UsageState {
  /** Local calendar days (YYYY-MM-DD) on which the app was opened. */
  openedDays: string[];
  /** Local calendar days on which the native collector completed a sync. */
  monitoringDays: string[];
  lastDaySent?: string;
  /** Last weekly send, or the start of the first weekly window. */
  lastWeekSentAt?: number;
}

export interface DayPing {
  schema: typeof USAGE_SCHEMA;
  kind: 'day';
  appVersion: string;
}

export interface WeekPing {
  schema: typeof USAGE_SCHEMA;
  kind: 'week';
  appVersion: string;
  daysOpened: number;
  daysMonitoring: number;
}

export type UsagePing = DayPing | WeekPing;

export interface DuePingOptions {
  /** False only when the person has switched usage counts off. */
  consent: boolean;
  appVersion: string;
  now: number;
}

export function emptyUsageState(): UsageState {
  return { openedDays: [], monitoringDays: [] };
}

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDay(days: string[], key: string): string[] {
  if (days.includes(key)) return days;
  return [...days, key].sort().slice(-HISTORY_DAYS);
}

/**
 * The first open (after install or erasure) starts the weekly window rather
 * than sending a week with no history, so the first weekly count covers a
 * full seven days.
 */
export function recordOpen(state: UsageState, now: number): UsageState {
  const openedDays = addDay(state.openedDays, localDayKey(now));
  const seedWeek = state.lastWeekSentAt === undefined;
  if (openedDays === state.openedDays && !seedWeek) return state;
  return { ...state, openedDays, ...(seedWeek ? { lastWeekSentAt: now } : {}) };
}

export function recordMonitoringDay(state: UsageState, now: number): UsageState {
  const monitoringDays = addDay(state.monitoringDays, localDayKey(now));
  return monitoringDays === state.monitoringDays ? state : { ...state, monitoringDays };
}

/** The seven local calendar days before today; noon avoids clock-change edges. */
function previousSevenDayKeys(now: number): Set<string> {
  const keys = new Set<string>();
  const today = new Date(now);
  for (let i = 1; i <= 7; i += 1) {
    keys.add(
      localDayKey(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12).getTime(),
      ),
    );
  }
  return keys;
}

export function duePings(
  state: UsageState,
  { consent, appVersion, now }: DuePingOptions,
): UsagePing[] {
  if (!consent) return [];
  const pings: UsagePing[] = [];
  if (state.lastDaySent !== localDayKey(now)) {
    pings.push({ schema: USAGE_SCHEMA, kind: 'day', appVersion });
  }
  // A send time in the future means the clock moved back; do not wait for it.
  const sinceWeek = state.lastWeekSentAt === undefined ? undefined : now - state.lastWeekSentAt;
  if (sinceWeek !== undefined && (sinceWeek >= WEEK_MS || sinceWeek < 0)) {
    const window = previousSevenDayKeys(now);
    const count = (days: string[]) => days.filter((d) => window.has(d)).length;
    pings.push({
      schema: USAGE_SCHEMA,
      kind: 'week',
      appVersion,
      daysOpened: count(state.openedDays),
      daysMonitoring: count(state.monitoringDays),
    });
  }
  return pings;
}

export function markSent(state: UsageState, kind: UsagePing['kind'], now: number): UsageState {
  return kind === 'day'
    ? { ...state, lastDaySent: localDayKey(now) }
    : { ...state, lastWeekSentAt: now };
}
