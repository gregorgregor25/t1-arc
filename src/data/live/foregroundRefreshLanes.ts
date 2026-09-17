type RefreshLane = 'glucose' | 'full';

/** Coalesce each workload without making glucose wait for a bulk health import. */
export function createForegroundRefreshLanes() {
  const pending = new Map<RefreshLane, Promise<void>>();
  return {
    get busy() { return pending.size > 0; },
    run(lane: RefreshLane, work: () => Promise<void>): Promise<void> {
      const existing = pending.get(lane);
      if (existing) return existing;
      // Install ownership before work runs, including synchronous re-entry.
      const task = Promise.resolve().then(work);
      const tracked = task.finally(() => {
        if (pending.get(lane) === tracked) pending.delete(lane);
      });
      pending.set(lane, tracked);
      return tracked;
    },
    async waitForIdle() {
      // Caller first holds the account-change barrier so no new work starts.
      // Failure does not prevent draining the other lane before switching owner.
      await Promise.allSettled([...pending.values()]);
    },
  };
}
