import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTarvisStoredData,
  getTarvisStoredDataStatus,
} from "@/data/tarvis/secureStore";

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
vi.mock("expo-crypto", () => ({ randomUUID: () => "test-uuid" }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 0 }),
  assertLocalDataWriteLeaseCurrent: async () => undefined,
  assertLocalDataWriteLeaseInTransaction: async () => undefined,
}));

describe("Tarv1s secure storage lifecycle", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it("reports existing private values without creating a safety identifier", async () => {
    secureStore.values.set("t1arc.tarvis.openai-key.v1", "sk-private");
    secureStore.values.set("t1arc.tarvis.usage.v1", "{}");

    await expect(getTarvisStoredDataStatus()).resolves.toEqual({
      hasApiKey: true,
      hasUsage: true,
      hasSafetyIdentifier: false,
    });
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("deletes the API key, usage history and safety identifier together", async () => {
    secureStore.values.set("t1arc.tarvis.openai-key.v1", "sk-private");
    secureStore.values.set("t1arc.tarvis.usage.v1", "{}");
    secureStore.values.set("t1arc.tarvis.safety-id.v1", "private-id");

    await clearTarvisStoredData();

    expect(secureStore.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        "t1arc.tarvis.openai-key.v1",
        "t1arc.tarvis.usage.v1",
        "t1arc.tarvis.safety-id.v1",
      ]),
    );
    await expect(getTarvisStoredDataStatus()).resolves.toEqual({
      hasApiKey: false,
      hasUsage: false,
      hasSafetyIdentifier: false,
    });
  });
});
