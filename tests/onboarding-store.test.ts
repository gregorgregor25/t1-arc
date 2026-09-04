import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearOnboardingState,
  createOnboardingWriteCoordinator,
  loadOnboardingComplete,
  loadOnboardingState,
  parseOnboardingState,
  saveOnboardingComplete,
  saveOnboardingProgress,
} from "@/data/onboarding/onboardingStore";

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

vi.mock("expo-secure-store", () => secureStore);

describe("onboarding state", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it("treats a new install as not completed", async () => {
    await expect(loadOnboardingState()).resolves.toBeUndefined();
    await expect(loadOnboardingComplete()).resolves.toBe(false);
  });

  it("persists resumable progress without completing onboarding", async () => {
    await saveOnboardingProgress(2);
    await expect(loadOnboardingState()).resolves.toMatchObject({
      status: "in_progress",
      lastStep: 2,
      walkthroughVersion: 1,
    });
    await expect(loadOnboardingComplete()).resolves.toBe(false);
  });

  it("persists completion at the final step", async () => {
    await saveOnboardingComplete();
    await expect(loadOnboardingState()).resolves.toMatchObject({
      status: "completed",
      lastStep: 4,
    });
    await expect(loadOnboardingComplete()).resolves.toBe(true);
  });

  it("fails closed on corrupt or unknown state", () => {
    expect(() => parseOnboardingState("{bad json")).toThrow(
      /could not be read/i,
    );
    expect(() =>
      parseOnboardingState(
        JSON.stringify({
          schemaVersion: 99,
          walkthroughVersion: 1,
          status: "completed",
          lastStep: 4,
          updatedAt: 1,
        }),
      ),
    ).toThrow(/could not be read/i);
  });

  it("serializes completion after any in-flight progress write", async () => {
    const events: string[] = [];
    let resolveProgress: (() => void) | undefined;
    const persistProgress = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveProgress = () => {
            events.push("progress");
            resolve();
          };
        }),
    );
    const persistComplete = vi.fn(async () => {
      events.push("complete");
    });
    const writes = createOnboardingWriteCoordinator(
      persistProgress,
      persistComplete,
    );

    const progress = writes.progress(2);
    const completion = writes.complete();
    await vi.waitFor(() => expect(persistProgress).toHaveBeenCalledOnce());
    expect(persistComplete).not.toHaveBeenCalled();
    resolveProgress?.();
    await Promise.all([progress, completion]);

    expect(events).toEqual(["progress", "complete"]);
  });

  it("does not persist final-step progress before completion", async () => {
    const persistProgress = vi.fn(async () => undefined);
    const writes = createOnboardingWriteCoordinator(
      persistProgress,
      vi.fn(async () => undefined),
    );

    await writes.progress(4);

    expect(persistProgress).not.toHaveBeenCalled();
  });

  it("can reset only onboarding metadata", async () => {
    secureStore.values.set("t1arc.onboarding.walkthrough.v1", "bad");
    secureStore.values.set("unrelated.health.setting", "preserved");

    await clearOnboardingState();

    expect(secureStore.values.get("t1arc.onboarding.walkthrough.v1")).toBe(
      undefined,
    );
    expect(secureStore.values.get("unrelated.health.setting")).toBe(
      "preserved",
    );
  });
});
