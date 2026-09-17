export const PRESENTATION_CLOCK_BUCKET_MS = 60_000;

/**
 * Keep relative-age presentation current without republishing the entire data
 * context for every short stored-glucose observation. A different bucket also
 * accepts a backwards system-clock adjustment rather than pinning stale time.
 */
export function nextPresentationClock(previous: number, observed: number) {
  return Math.floor(previous / PRESENTATION_CLOCK_BUCKET_MS) ===
    Math.floor(observed / PRESENTATION_CLOCK_BUCKET_MS)
    ? previous
    : observed;
}
