import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginTarvisConnectionRequest,
  resetTarvisConnectionCoordinatorForTests,
} from "@/data/tarvis/connectionCoordinator";
import {
  clearTarvisApiKey,
  clearTarvisStoredData,
  saveTarvisApiKey,
} from "@/data/tarvis/secureStore";

const epochStore = vi.hoisted(() => ({
  clear: vi.fn(),
  forceClear: vi.fn(),
  loadString: vi.fn(),
  loadValue: vi.fn(),
  save: vi.fn(),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "test-uuid" }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 7 }),
}));
vi.mock("@/data/privacy/localDataEpochSecureStore", () => ({
  clearEpochBoundSecureStoreValue: epochStore.clear,
  forceClearEpochBoundSecureStoreValue: epochStore.forceClear,
  loadEpochBoundSecureStoreString: epochStore.loadString,
  loadEpochBoundSecureStoreValue: epochStore.loadValue,
  saveEpochBoundSecureStoreValue: epochStore.save,
}));

describe("Tarv1s key connection races", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTarvisConnectionCoordinatorForTests();
    epochStore.clear.mockResolvedValue(undefined);
    epochStore.forceClear.mockResolvedValue(undefined);
    epochStore.save.mockResolvedValue(undefined);
  });

  it("cancels an active hosted request before deleting the saved key", async () => {
    const request = await beginTarvisConnectionRequest();

    await clearTarvisApiKey({ epoch: 7 });

    expect(request.signal.aborted).toBe(true);
    expect(() => request.assertCurrent()).toThrowError(
      expect.objectContaining({ name: "TarvisConnectionSupersededError" }),
    );
    expect(epochStore.clear).toHaveBeenCalledWith(
      "t1arc.tarvis.openai-key.v1",
      { epoch: 7 },
    );
  });

  it("cancels an active hosted request before replacing the saved key", async () => {
    const request = await beginTarvisConnectionRequest();
    const lease = { epoch: 7 };

    await saveTarvisApiKey(`sk-${"a".repeat(40)}`, lease);

    expect(request.signal.aborted).toBe(true);
    expect(epochStore.save).toHaveBeenCalledWith(
      "t1arc.tarvis.openai-key.v1",
      `sk-${"a".repeat(40)}`,
      lease,
    );
  });

  it("keeps later key saves behind every cleanup delete even when one delete fails", async () => {
    let finishApiDelete!: () => void;
    const apiDelete = new Promise<void>((resolve) => {
      finishApiDelete = resolve;
    });
    const events: string[] = [];
    epochStore.forceClear.mockImplementation(async (key: string) => {
      if (key === "t1arc.tarvis.openai-key.v1") {
        events.push("api-delete-start");
        await apiDelete;
        events.push("api-delete-end");
        return;
      }
      if (key === "t1arc.tarvis.usage.v1") {
        events.push("usage-delete-failed");
        throw new Error("usage delete failed");
      }
      events.push("safety-delete");
    });
    epochStore.save.mockImplementation(async () => {
      events.push("new-key-save");
    });

    const clearing = clearTarvisStoredData();
    let clearFailure: unknown;
    const clearingObserved = clearing.catch((error: unknown) => {
      clearFailure = error;
    });
    const saving = saveTarvisApiKey(`sk-${"b".repeat(40)}`, { epoch: 7 });
    await vi.waitFor(() =>
      expect(epochStore.forceClear).toHaveBeenCalledTimes(3),
    );
    await Promise.resolve();

    expect(epochStore.save).not.toHaveBeenCalled();
    finishApiDelete();
    await clearingObserved;
    await saving;

    expect(clearFailure).toMatchObject({ message: "usage delete failed" });
    expect(events).toEqual([
      "api-delete-start",
      "usage-delete-failed",
      "safety-delete",
      "api-delete-end",
      "new-key-save",
    ]);
  });
});
