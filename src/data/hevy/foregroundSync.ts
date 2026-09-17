export interface HevyForegroundSyncLaneOptions<Result> {
  syncIfDue(): Promise<Result | undefined>;
  onImported(
    result: Result,
    lifecycle: HevyForegroundSyncLifecycle,
  ): Promise<void> | void;
  onError?(
    error: unknown,
    lifecycle: HevyForegroundSyncLifecycle,
  ): Promise<void> | void;
}

export interface HevyForegroundSyncLifecycle {
  isActive(): boolean;
}

export interface HevyForegroundSyncLane {
  trigger(): void;
  beginExclusiveChange(): HevyForegroundSyncBarrier;
  dispose(): void;
  isRunning(): boolean;
}

export interface HevyForegroundSyncBarrier {
  ready: Promise<void>;
  release(): void;
}

export function triggerHevyForegroundSyncIfActive(
  lane: Pick<HevyForegroundSyncLane, "trigger">,
  appState: string | null | undefined,
) {
  if (appState !== "active") return false;
  lane.trigger();
  return true;
}

/**
 * Runs the comparatively long Hevy crawl on an independent, fire-and-forget
 * lane. In particular, callers cannot accidentally await it as part of the
 * latency-sensitive glucose refresh path.
 */
export function createHevyForegroundSyncLane<Result>(
  options: HevyForegroundSyncLaneOptions<Result>,
): HevyForegroundSyncLane {
  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let lifecycleGeneration = 0;
  let suspensionCount = 0;

  return {
    trigger() {
      if (disposed || suspensionCount > 0 || inFlight) return;

      const runGeneration = lifecycleGeneration;
      const lifecycle: HevyForegroundSyncLifecycle = {
        isActive: () =>
          !disposed &&
          suspensionCount === 0 &&
          lifecycleGeneration === runGeneration,
      };

      const run = (async () => {
        try {
          const result = await options.syncIfDue();
          if (result !== undefined && lifecycle.isActive()) {
            await options.onImported(result, lifecycle);
          }
        } catch (error) {
          if (lifecycle.isActive()) {
            try {
              await options.onError?.(error, lifecycle);
            } catch {
              // This lane is deliberately fire-and-forget. A diagnostic UI
              // callback must never create an unhandled promise rejection.
            }
          }
        }
      })();
      const tracked = run.catch(() => undefined).finally(() => {
        if (inFlight === tracked) inFlight = undefined;
      });
      inFlight = tracked;
    },
    beginExclusiveChange() {
      suspensionCount += 1;
      lifecycleGeneration += 1;
      const ready = (inFlight ?? Promise.resolve()).then(
        () => undefined,
        () => undefined,
      );
      let released = false;
      return {
        ready,
        release() {
          if (released) return;
          released = true;
          suspensionCount = Math.max(0, suspensionCount - 1);
        },
      };
    },
    dispose() {
      disposed = true;
      lifecycleGeneration += 1;
    },
    isRunning() {
      return inFlight !== undefined;
    },
  };
}
