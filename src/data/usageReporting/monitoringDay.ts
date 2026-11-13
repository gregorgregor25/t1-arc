import { localDayKey } from '@/domain/usageReporting';

/**
 * Cheap, synchronous hook for the glucose collector's success path.
 *
 * The collector can tick every minute, so the day already recorded is cached
 * in memory and secure storage is touched at most once per local day per
 * process. The reporter is loaded lazily so the sync path never depends on
 * secure storage being available, and nothing here can throw into it.
 */
let lastRecordedDay: string | undefined;
let pending = false;
let cacheGeneration = 0;

export function noteMonitoringDay(now = Date.now()): void {
  try {
    const day = localDayKey(now);
    if (day === lastRecordedDay || pending) return;
    pending = true;
    const startGeneration = cacheGeneration;
    void import('./usageReporter')
      .then((reporter) => reporter.noteMonitoringDayAsync(now))
      .then((recorded) => {
        if (recorded && startGeneration === cacheGeneration) lastRecordedDay = day;
      })
      .catch(() => undefined)
      .finally(() => {
        pending = false;
      });
  } catch {
    pending = false;
  }
}

/** The switch or erasure changed what is stored; record today again if allowed. */
export function resetMonitoringDayCache(): void {
  cacheGeneration += 1;
  lastRecordedDay = undefined;
}
