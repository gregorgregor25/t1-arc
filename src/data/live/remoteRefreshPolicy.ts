import { CADENCE_PROBE_REFRESH_REASON, type GlucoseRefreshOptions } from '@/data/contracts';
import { DIRECT_LIBRE_VALIDATED_NETWORK_REASON } from '@/data/libreLinkUp/refreshPolicy';
import type { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

/**
 * Due checks for Nightscout, Dexcom Share, Medtrum and xDrip.
 *
 * The native collector, its network callback, the WorkManager fallback and
 * the visible app can each ask a source to refresh. These checks stop those
 * triggers from repeating a request when no new reading can exist yet. They
 * never delay a reading that is due:
 *
 * - Five-minute sources become due 30 s before the next reading. The native
 *   collector's first five-minute tick lands 20 s after it, and its overdue
 *   polls are 20 s apart, so neither is skipped.
 * - Sources whose own two newest readings are at most 2.5 minutes apart keep
 *   the native one-minute schedule.
 */
export const REMOTE_EXPECTED_READING_MS = 5 * 60_000;
export const REMOTE_DUE_LEAD_MS = 30_000;
export const REMOTE_MIN_ATTEMPT_SPACING_MS = 15_000;
/** Two minutes plus tolerance for upload jitter, e.g. two-minute Medtrum sensors. */
export const REMOTE_MINUTE_CADENCE_MAX_INTERVAL_MS = 150_000;
/** Below the native one-minute tick so jitter never skips a tick. */
export const REMOTE_MINUTE_CADENCE_ATTEMPT_SPACING_MS = 45_000;
const OBSERVED_INTERVAL_LOOKBACK_MS = 2 * REMOTE_EXPECTED_READING_MS;

const DEXCOM_MAX_MINUTES = 1440;
const DEXCOM_OVERLAP_MINUTES = 10;
const DEXCOM_READING_MINUTES = 5;
/** A full-day read refills any reading Share received after a later one. */
export const DEXCOM_FULL_WINDOW_INTERVAL_MS = 60 * 60_000;

export type RemoteRefreshInput = {
  now: number;
  latestReadingAt?: number;
  /** Spacing between this source's two newest stored readings. */
  observedIntervalMs?: number;
  lastAttemptAt?: number;
  /** Explicit user refresh, first connection or a validated-network recovery. */
  force?: boolean;
};

export function observedReadingIntervalMs(
  latestReadingAt: number | undefined,
  previousReadingAt: number | undefined,
): number | undefined {
  if (latestReadingAt === undefined || previousReadingAt === undefined) return undefined;
  const interval = latestReadingAt - previousReadingAt;
  return interval > 0 ? interval : undefined;
}

export function remoteRefreshDue({
  now,
  latestReadingAt,
  observedIntervalMs,
  lastAttemptAt,
  force,
}: RemoteRefreshInput): boolean {
  if (force || latestReadingAt === undefined) return true;
  const sinceAttempt = lastAttemptAt === undefined ? undefined : now - lastAttemptAt;
  if (sinceAttempt !== undefined && sinceAttempt >= 0 && sinceAttempt < REMOTE_MIN_ATTEMPT_SPACING_MS) {
    return false;
  }
  const age = now - latestReadingAt;
  // A reading ahead of the phone clock cannot be aged reliably.
  if (age < 0) return true;
  const minuteCadence =
    observedIntervalMs !== undefined && observedIntervalMs <= REMOTE_MINUTE_CADENCE_MAX_INTERVAL_MS;
  const expectedMs = minuteCadence
    ? Math.max(60_000, observedIntervalMs)
    : REMOTE_EXPECTED_READING_MS;
  if (age >= expectedMs - REMOTE_DUE_LEAD_MS) return true;
  return (
    minuteCadence &&
    (sinceAttempt === undefined || sinceAttempt < 0 || sinceAttempt >= REMOTE_MINUTE_CADENCE_ATTEMPT_SPACING_MS)
  );
}

/** True when a refresh option or a validated-network recovery after a network error bypasses the due check. */
export function remoteRefreshForced(
  options: GlucoseRefreshOptions | undefined,
  lastErrorCode: string | undefined,
): boolean {
  return (
    options?.force === true ||
    (options?.reason === DIRECT_LIBRE_VALIDATED_NETWORK_REASON && lastErrorCode === 'network')
  );
}

/** Reads this source's persisted attempt and newest readings, then applies {@link remoteRefreshDue}. */
export async function remoteSourceRefreshDue(
  store: GlucoseHistoryStore,
  sourceId: string,
  now: number,
  options?: GlucoseRefreshOptions,
): Promise<boolean> {
  if (options?.force) return true;
  await store.initialize();
  const [state, latest] = await Promise.all([
    store.getSyncState(sourceId),
    store.getLatestReading(sourceId),
  ]);
  if (latest === undefined) return true;
  if (remoteRefreshForced(options, state?.lastErrorCode)) return true;
  if (options?.reason === CADENCE_PROBE_REFRESH_REASON) {
    // The native probe looks for a source that now reads every minute, which
    // the stored five-minute spacing cannot reveal. Keep only the spacing.
    const sinceAttempt = state?.lastAttemptAt === undefined ? undefined : now - state.lastAttemptAt;
    return sinceAttempt === undefined || sinceAttempt < 0 || sinceAttempt >= REMOTE_MIN_ATTEMPT_SPACING_MS;
  }
  const earlier = await store.getReadings(
    { start: latest.timestamp - OBSERVED_INTERVAL_LOOKBACK_MS, end: latest.timestamp },
    sourceId,
  );
  return remoteRefreshDue({
    now,
    latestReadingAt: latest.timestamp,
    observedIntervalMs: observedReadingIntervalMs(latest.timestamp, earlier.at(-1)?.timestamp),
    lastAttemptAt: state?.lastAttemptAt,
  });
}

export function dexcomMinutesToRequest(latestReadingAt: number | undefined, now: number): number {
  if (latestReadingAt === undefined) return DEXCOM_MAX_MINUTES;
  const missing = Math.ceil(Math.max(0, now - latestReadingAt) / 60_000) + DEXCOM_OVERLAP_MINUTES;
  return Math.min(DEXCOM_MAX_MINUTES, missing);
}

export type DexcomShareReadWindowInput = {
  now: number;
  latestReadingAt?: number;
  lastFullWindowAt?: number;
  force?: boolean;
};

export type DexcomShareReadWindow = { minutes: number; maxCount: number; full: boolean };

/**
 * Routine checks ask only for the minutes since the newest stored reading,
 * plus a ten-minute overlap. A full day is read on first connection, explicit
 * or recovery refreshes, and at least hourly so late Share uploads that land
 * before the newest reading are still filled in.
 */
export function dexcomShareReadWindow({
  now,
  latestReadingAt,
  lastFullWindowAt,
  force,
}: DexcomShareReadWindowInput): DexcomShareReadWindow {
  const full =
    force === true ||
    latestReadingAt === undefined ||
    lastFullWindowAt === undefined ||
    now - lastFullWindowAt < 0 ||
    now - lastFullWindowAt >= DEXCOM_FULL_WINDOW_INTERVAL_MS;
  const minutes = full ? DEXCOM_MAX_MINUTES : dexcomMinutesToRequest(latestReadingAt, now);
  return { minutes, maxCount: Math.ceil(minutes / DEXCOM_READING_MINUTES), full };
}
