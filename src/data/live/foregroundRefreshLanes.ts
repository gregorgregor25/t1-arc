type RefreshLane = 'glucose' | 'full';

export interface ForegroundRefreshRunOptions {
  /**
   * An explicit user refresh. It never joins a silent pass in flight, whose
   * sources may have skipped a check that was not yet due; it runs its own
   * pass once that one settles.
   */
  explicit?: boolean;
}

interface PendingRefresh {
  promise: Promise<void>;
  explicit: boolean;
}

/** Coalesce each workload without making glucose wait for a bulk health import. */
export function createForegroundRefreshLanes() {
  const pending = new Map<RefreshLane, PendingRefresh>();
  const track = (lane: RefreshLane, task: Promise<void>, explicit: boolean) => {
    const tracked = task.finally(() => {
      if (pending.get(lane)?.promise === tracked) pending.delete(lane);
    });
    pending.set(lane, { promise: tracked, explicit });
    return tracked;
  };
  return {
    get busy() { return pending.size > 0; },
    run(
      lane: RefreshLane,
      work: () => Promise<void>,
      options: ForegroundRefreshRunOptions = {},
    ): Promise<void> {
      const explicit = options.explicit === true;
      const existing = pending.get(lane);
      if (existing && (!explicit || existing.explicit)) return existing.promise;
      // Install ownership before work runs, including synchronous re-entry.
      // A queued explicit pass owns the lane at once, so later callers join it
      // and account barriers wait for it.
      const task = existing
        ? existing.promise.catch(() => undefined).then(work)
        : Promise.resolve().then(work);
      return track(lane, task, explicit);
    },
    async waitForIdle() {
      // Caller first holds the account-change barrier so no new work starts.
      // Failure does not prevent draining the other lane before switching owner.
      await Promise.allSettled([...pending.values()].map((entry) => entry.promise));
    },
  };
}
