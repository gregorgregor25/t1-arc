import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createHevyForegroundSyncLane,
  triggerHevyForegroundSyncIfActive,
} from "@/data/hevy/foregroundSync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("Hevy foreground sync isolation", () => {
  it("keeps Hevy outside the latency-sensitive DataProvider refresh lane", () => {
    const source = readFileSync(
      new URL("../src/providers/DataProvider.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("const performRefresh");
    const end = source.indexOf("const refreshData", start);
    const primaryRefresh = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(primaryRefresh).not.toContain("syncHevyIfDue");
    expect(primaryRefresh).toContain("updateGlucoseDisplayFromHistory");
    expect(primaryRefresh).toContain("repository.refreshGlucose?.()");
    expect(primaryRefresh).toMatch(
      /repositoryState\.mode === "live" && includeHealthConnect\s*\? generateInsightReviewIfDue/,
    );
    expect(primaryRefresh).toMatch(
      /repositoryState\.mode === "live" && includeHealthConnect\s*\? syncConfiguredNightscoutHistoryIfDue/,
    );
    const cadenceStart = source.indexOf("const refreshInterval = setInterval");
    const cadenceEnd = source.indexOf("const subscription", cadenceStart);
    const frequentCadence = source.slice(cadenceStart, cadenceEnd);
    expect(frequentCadence).toContain("refreshGlucoseSilently()");
    expect(frequentCadence).not.toContain("refreshSilently()");
    expect(frequentCadence).toContain(
      'AppState.currentState === "active"',
    );
    expect(frequentCadence).toContain("60_000");
    const localClockStart = source.indexOf("const reconcileClock");
    const localClockEnd = source.indexOf("return () => clearInterval", localClockStart);
    const localClock = source.slice(localClockStart, localClockEnd);
    expect(localClock).toContain("publishLatestStoredGlucose()");
    expect(localClock).toContain("15_000");
    expect(localClock).not.toContain("refreshGlucoseSilently()");
    expect(localClock).not.toContain("refreshSilently()");
    expect(source).toContain(
      "await refreshEarliestLiveDate(lifecycle.isActive)",
    );
    const eraseStart = source.indexOf("const eraseAllLocalHealthData");
    const eraseEnd = source.indexOf("const deleteManualContext", eraseStart);
    const eraseFlow = source.slice(eraseStart, eraseEnd);
    expect(eraseFlow).toContain("beginHevyDataChange()");
    expect(eraseFlow).toContain("beginExclusiveChange()");
    expect(eraseFlow).toContain("localDataChangeGeneration.current += 1");
    expect(eraseFlow.indexOf("invalidateHevyConnectionOwnership()")).toBeLessThan(
      eraseFlow.indexOf("eraseLocalHealthData()"),
    );
    expect(eraseFlow.lastIndexOf("updateHevyBackgroundSyncRegistration()")).toBeGreaterThan(
      eraseFlow.indexOf('changeDataMode("demo")'),
    );

    const reloadStart = source.indexOf("const reloadSources");
    const reloadEnd = source.indexOf("const changeDataMode", reloadStart);
    expect(source.slice(reloadStart, reloadEnd)).toContain(
      "generation !== localDataChangeGeneration.current",
    );
  });

  it("guards manual card callbacks and routes destructive actions through the shared barrier", () => {
    const source = readFileSync(
      new URL("../src/components/HevySourceCard.tsx", import.meta.url),
      "utf8",
    );
    const connectStart = source.indexOf("async function connect()");
    const connectEnd = source.indexOf("async function sync()", connectStart);
    const connectFlow = source.slice(connectStart, connectEnd);

    expect(connectFlow).toContain("if (!mounted.current) return");
    expect(connectFlow).not.toContain(
      "updateHevyBackgroundSyncRegistration()",
    );
    expect(source).toContain("await disconnectHevy();");
    expect(source).toContain(
      "await disconnectHevy({ removeImportedWorkouts: true });",
    );
  });

  it("only schedules foreground work while the app is active", () => {
    const lane = { trigger: vi.fn() };

    expect(triggerHevyForegroundSyncIfActive(lane, null)).toBe(false);
    expect(triggerHevyForegroundSyncIfActive(lane, "inactive")).toBe(false);
    expect(triggerHevyForegroundSyncIfActive(lane, "background")).toBe(false);
    expect(lane.trigger).not.toHaveBeenCalled();

    expect(triggerHevyForegroundSyncIfActive(lane, "active")).toBe(true);
    expect(lane.trigger).toHaveBeenCalledOnce();
  });

  it("does not hold glucose refresh or invalidation while Hevy is slow", async () => {
    const hevy = deferred<{ imported: number } | undefined>();
    const onHevyImported = vi.fn();
    const lane = createHevyForegroundSyncLane({
      syncIfDue: () => hevy.promise,
      onImported: onHevyImported,
    });
    const invalidateGlucose = vi.fn();

    lane.trigger();
    await Promise.resolve().then(invalidateGlucose);

    expect(lane.isRunning()).toBe(true);
    expect(invalidateGlucose).toHaveBeenCalledOnce();
    expect(onHevyImported).not.toHaveBeenCalled();

    hevy.resolve({ imported: 1 });
    await vi.waitFor(() => expect(onHevyImported).toHaveBeenCalledOnce());
    expect(lane.isRunning()).toBe(false);
  });

  it("coalesces repeated cadence and resume triggers", async () => {
    const hevy = deferred<undefined>();
    const syncIfDue = vi.fn(() => hevy.promise);
    const lane = createHevyForegroundSyncLane({
      syncIfDue,
      onImported: vi.fn(),
    });

    lane.trigger();
    lane.trigger();

    expect(syncIfDue).toHaveBeenCalledOnce();
    hevy.resolve(undefined);
    await vi.waitFor(() => expect(lane.isRunning()).toBe(false));
  });

  it("settles safely when sync and the diagnostic callback both reject", async () => {
    const syncError = new Error("Hevy unavailable");
    const diagnosticError = new Error("diagnostic UI unavailable");
    const syncIfDue = vi.fn(async () => {
      throw syncError;
    });
    const onError = vi.fn(async () => {
      throw diagnosticError;
    });
    const lane = createHevyForegroundSyncLane({
      syncIfDue,
      onImported: vi.fn(),
      onError,
    });

    lane.trigger();

    await vi.waitFor(() => expect(lane.isRunning()).toBe(false));
    expect(onError).toHaveBeenCalledWith(syncError, expect.any(Object));

    lane.trigger();
    await vi.waitFor(() => expect(syncIfDue).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lane.isRunning()).toBe(false));
  });

  it("suppresses callbacks when disposed before a sync settles", async () => {
    const hevy = deferred<{ imported: number } | undefined>();
    const onImported = vi.fn();
    const onError = vi.fn();
    const lane = createHevyForegroundSyncLane({
      syncIfDue: () => hevy.promise,
      onImported,
      onError,
    });

    lane.trigger();
    lane.dispose();
    hevy.resolve({ imported: 1 });

    await vi.waitFor(() => expect(lane.isRunning()).toBe(false));
    expect(onImported).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("lets an async callback suppress post-await work after disposal", async () => {
    const hevy = deferred<{ imported: number } | undefined>();
    const callbackStarted = deferred<void>();
    const releaseCallback = deferred<void>();
    const postAwaitUpdate = vi.fn();
    const lane = createHevyForegroundSyncLane({
      syncIfDue: () => hevy.promise,
      onImported: async (_result, lifecycle) => {
        callbackStarted.resolve();
        await releaseCallback.promise;
        if (lifecycle.isActive()) postAwaitUpdate();
      },
    });

    lane.trigger();
    hevy.resolve({ imported: 1 });
    await callbackStarted.promise;
    lane.dispose();
    releaseCallback.resolve();

    await vi.waitFor(() => expect(lane.isRunning()).toBe(false));
    expect(postAwaitUpdate).not.toHaveBeenCalled();
  });

  it("suspends triggers, invalidates callbacks, and drains real in-flight work", async () => {
    const hevy = deferred<{ imported: number } | undefined>();
    const syncIfDue = vi
      .fn<() => Promise<{ imported: number } | undefined>>()
      .mockReturnValueOnce(hevy.promise)
      .mockResolvedValue(undefined);
    const onImported = vi.fn();
    const lane = createHevyForegroundSyncLane({ syncIfDue, onImported });

    lane.trigger();
    const barrier = lane.beginExclusiveChange();
    lane.trigger();
    expect(syncIfDue).toHaveBeenCalledOnce();

    hevy.resolve({ imported: 1 });
    await expect(barrier.ready).resolves.toBeUndefined();
    expect(onImported).not.toHaveBeenCalled();

    barrier.release();
    lane.trigger();
    await vi.waitFor(() => expect(syncIfDue).toHaveBeenCalledTimes(2));
  });
});
