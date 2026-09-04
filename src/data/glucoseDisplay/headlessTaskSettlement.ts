// A cold LibreLinkUp handover can legitimately need four sequential requests
// (401, login, connections and graph). Each request has its own 20-second
// deadline, so the Headless JS owner must not cancel the whole chain at the old
// 40/48-second boundary. Android keeps the native task alive for 120 seconds,
// leaving 25 seconds after this deadline for abort cleanup and SQLite state.
export const GLUCOSE_DISPLAY_HEADLESS_DEADLINE_MS = 95_000;

/**
 * React Native only notifies Android that a Headless JS task finished when its
 * promise resolves. Convert both rejection and an overlong task into a bounded
 * resolved result so the native foreground service can release its task gate.
 */
export async function settleHeadlessPromise(
  promise: Promise<unknown>,
  deadlineMs = GLUCOSE_DISPLAY_HEADLESS_DEADLINE_MS,
  onDeadline?: () => void,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        onDeadline?.();
        resolve(false);
      }, deadlineMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  return completed;
}
