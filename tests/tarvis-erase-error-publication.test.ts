import { beforeEach, describe, expect, it, vi } from "vitest";

import { askTarvis } from "@/data/tarvis/openAiClient";
import {
  resetTarvisConnectionCoordinatorForTests,
  runTarvisConnectionMutation,
} from "@/data/tarvis/connectionCoordinator";

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  assertLeaseCurrent: vi.fn(),
  loadApiKey: vi.fn(),
  loadUsage: vi.fn(),
  saveUsage: vi.fn(),
  getSafetyIdentifier: vi.fn(),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  assertLocalDataWriteLeaseCurrent: mocks.assertLeaseCurrent,
}));

vi.mock("@/data/tarvis/secureStore", () => ({
  getTarvisSafetyIdentifier: mocks.getSafetyIdentifier,
  loadTarvisApiKey: mocks.loadApiKey,
  loadTarvisUsage: mocks.loadUsage,
  saveTarvisUsage: mocks.saveUsage,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function supersededError() {
  const error = new Error(
    "This local-data operation was superseded by a privacy erase.",
  );
  error.name = "LocalDataWriteSupersededError";
  return error;
}

describe("Tarv1s erase-safe error publication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetTarvisConnectionCoordinatorForTests();
    mocks.acquireLease.mockResolvedValue({ epoch: 3 });
    mocks.assertLeaseCurrent.mockResolvedValue(undefined);
    mocks.loadApiKey.mockResolvedValue("test-key");
    mocks.loadUsage.mockResolvedValue({
      requestTimestamps: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    mocks.saveUsage.mockResolvedValue(undefined);
    mocks.getSafetyIdentifier.mockResolvedValue("safety-id");
  });

  it("replaces a failed request with benign supersession when erase wins during the network call", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network failed"),
    );
    mocks.assertLeaseCurrent.mockRejectedValueOnce(supersededError());

    await expect(
      askTarvis("What are the NICE sick-day rules?", undefined, [], {
        epoch: 3,
      }),
    ).rejects.toMatchObject({ name: "LocalDataWriteSupersededError" });

    expect(mocks.assertLeaseCurrent).toHaveBeenCalledWith({ epoch: 3 });
  });

  it("suppresses a hosted answer when the saved key is disconnected during the network call", async () => {
    const network = deferred<Response>();
    const started = deferred();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      started.resolve();
      return network.promise;
    });

    const answer = askTarvis(
      "What are the NICE sick-day rules?",
      undefined,
      [],
      { epoch: 3 },
    );
    await started.promise;
    await runTarvisConnectionMutation(async () => undefined);
    network.reject(new Error("network stopped"));

    await expect(answer).rejects.toMatchObject({
      name: "TarvisConnectionSupersededError",
    });
  });

  it("does not send a key loaded after a concurrent disconnect has begun", async () => {
    const keyLoad = deferred<string>();
    mocks.loadApiKey.mockReturnValueOnce(keyLoad.promise);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const answer = askTarvis(
      "What are the NICE sick-day rules?",
      undefined,
      [],
      { epoch: 3 },
    );
    await vi.waitFor(() => expect(mocks.loadApiKey).toHaveBeenCalledOnce());
    await runTarvisConnectionMutation(async () => undefined);
    keyLoad.resolve("test-key");

    await expect(answer).rejects.toMatchObject({
      name: "TarvisConnectionSupersededError",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reserves the single-flight slot before asynchronous credential loading", async () => {
    const keyLoad = deferred<string>();
    mocks.loadApiKey.mockReturnValueOnce(keyLoad.promise);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network failed"),
    );

    const first = askTarvis(
      "What are the NICE sick-day rules?",
      undefined,
      [],
      { epoch: 3 },
    );
    await vi.waitFor(() => expect(mocks.loadApiKey).toHaveBeenCalledOnce());

    await expect(
      askTarvis("Explain NICE activity guidance.", undefined, [], { epoch: 3 }),
    ).rejects.toThrow("already answering");

    keyLoad.resolve("test-key");
    await expect(first).rejects.toThrow("network failed");
  });

  it("rejects a response that resolves after the hard request deadline without publishing final usage", async () => {
    vi.useFakeTimers();
    try {
      const network = deferred<Response>();
      vi.spyOn(globalThis, "fetch").mockReturnValue(network.promise);
      const answer = askTarvis(
        "What are the NICE sick-day rules?",
        undefined,
        [],
        { epoch: 3 },
      );
      await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());

      await vi.advanceTimersByTimeAsync(45_000);
      network.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    headline: "Late answer",
                    answer: "This must never be accepted.",
                    confidence: "high",
                    evidenceIds: [],
                    limitations: [],
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
        }),
      } as Response);

      await expect(answer).rejects.toThrow("stopped after 45 seconds");
      expect(mocks.saveUsage).toHaveBeenCalledTimes(1);
      expect(mocks.saveUsage.mock.calls[0]?.[0]).toMatchObject({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
