/**
 * Cheap, synchronous hook for app opens and the glucose collector's success
 * path, so people who rarely open the app still hear about a new release.
 *
 * The collector can tick every minute, so the time of the next due check is
 * cached in memory and secure storage is read at most once until then. The
 * checker is loaded lazily so the sync path never depends on secure storage or
 * the network being available, and nothing here can throw into it.
 */
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

let nextCheckAt = 0;
let pending = false;
let hintGeneration = 0;

export function noteUpdateCheckOpportunity(now = Date.now()): void {
  try {
    if (pending || now < nextCheckAt) return;
    pending = true;
    const startGeneration = hintGeneration;
    void import('./updateAlerts')
      .then((alerts) => alerts.runAutomaticUpdateCheckForThisAppAsync(now))
      .then((next) => {
        if (startGeneration === hintGeneration) nextCheckAt = next;
      })
      .catch(() => {
        if (startGeneration === hintGeneration) nextCheckAt = now + RETRY_AFTER_FAILURE_MS;
      })
      .finally(() => {
        pending = false;
      });
  } catch {
    pending = false;
  }
}

/** The switch changed; let the next opportunity read it again. */
export function resetUpdateCheckHint(): void {
  hintGeneration += 1;
  nextCheckAt = 0;
}
