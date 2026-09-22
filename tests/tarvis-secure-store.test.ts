import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTarvisStoredData,
  getTarvisStoredDataStatus,
  loadTarvisSettings,
  loadTarvisApiKey,
  saveTarvisApiKey,
  selectTarvisProvider,
  clearTarvisApiKey,
} from "@/data/tarvis/secureStore";
import { beginTarvisConnectionRequest, resetTarvisConnectionCoordinatorForTests } from "@/data/tarvis/connectionCoordinator";

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
vi.mock("@/data/persistence/t1arcDatabase", () => ({ withT1ArcTransaction: async (task: (tx: unknown) => Promise<unknown>) => task({}) }));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 0 }),
  assertLocalDataWriteLeaseCurrent: async () => undefined,
  assertLocalDataWriteLeaseInTransaction: async () => undefined,
}));

describe("Tarv1s secure storage lifecycle", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.clearAllMocks();
    resetTarvisConnectionCoordinatorForTests();
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

  it("preserves legacy OpenAI setup and switches separate keys without exposing them in settings", async () => {
    const openai = `sk-proj-${"a".repeat(40)}`;
    const gemini = `AIza${"b".repeat(40)}`;
    const claude = `sk-ant-${"c".repeat(40)}`;
    secureStore.values.set("t1arc.tarvis.openai-key.v1", openai);
    await expect(loadTarvisSettings()).resolves.toMatchObject({ provider: "openai", hasApiKey: true });
    await saveTarvisApiKey(gemini, { epoch: 0 }, "gemini");
    await expect(loadTarvisApiKey()).resolves.toBe(gemini);
    await saveTarvisApiKey(claude, { epoch: 0 }, "claude");
    await selectTarvisProvider("openai", { epoch: 0 });
    await expect(loadTarvisApiKey()).resolves.toBe(openai);
    const settings = await loadTarvisSettings();
    expect(settings.configuredProviders).toEqual({ openai: true, gemini: true, claude: true });
    expect(JSON.stringify(settings)).not.toContain(openai);
    expect(JSON.stringify(settings)).not.toContain(gemini);
    expect(JSON.stringify(settings)).not.toContain(claude);
    await clearTarvisApiKey(undefined, "gemini");
    await expect(loadTarvisApiKey()).resolves.toBe(openai);
    await clearTarvisStoredData();
    expect(secureStore.values.size).toBe(0);
  });

  it("aborts an in-flight request when the provider changes", async () => {
    await saveTarvisApiKey(`sk-ant-${"c".repeat(40)}`, { epoch: 0 }, "claude");
    const request = await beginTarvisConnectionRequest();
    await saveTarvisApiKey(`AIza${"b".repeat(40)}`, { epoch: 0 }, "gemini");
    expect(request.signal.aborted).toBe(true);
    expect(() => request.assertCurrent()).toThrow("superseded");
    request.release();
  });

  it("leaves the active provider unchanged if a new key cannot be saved", async () => {
    await saveTarvisApiKey(`sk-proj-${"a".repeat(40)}`, { epoch: 0 });
    secureStore.setItemAsync.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(saveTarvisApiKey(`AIza${"b".repeat(40)}`, { epoch: 0 }, "gemini")).rejects.toThrow("storage unavailable");
    await expect(loadTarvisSettings()).resolves.toMatchObject({ provider: "openai", hasApiKey: true });
  });

  it("does not fall back to another provider when the chosen key is absent", async () => {
    secureStore.values.set("t1arc.tarvis.openai-key.v1", `sk-proj-${"a".repeat(40)}`);
    secureStore.values.set("t1arc.tarvis.provider.v1", "gemini");
    await expect(loadTarvisApiKey()).resolves.toBeUndefined();
    await expect(loadTarvisSettings()).resolves.toMatchObject({ provider: "gemini", hasApiKey: false });
    await expect(selectTarvisProvider("claude", { epoch: 0 })).rejects.toThrow("Save a key");
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
