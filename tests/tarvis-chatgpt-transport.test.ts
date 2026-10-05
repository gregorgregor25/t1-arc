import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildChatGptRequestBody, fetchChatGptResponse } from "@/data/tarvis/chatGptTransport";
import { clearTarvisProviderCooldownsForTests, fetchTarvisProviderResponse } from "@/data/tarvis/providerTransport";

const native = vi.hoisted(() => ({ request: vi.fn(), cancelRequest: vi.fn(), isAvailable: vi.fn() }));
vi.mock("../modules/t1arc-chatgpt", () => ({ default: native, isAvailable: native.isAvailable }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "request-fixture" }));

const original = {
  model: "account-model", instructions: "Existing guarded instructions",
  input: [{ role: "user", content: [{ type: "input_text", text: "private context" }] }],
  reasoning: { effort: "low" }, text: { format: { type: "json_schema", name: "answer", schema: { type: "object" } } },
  store: true, stream: false, max_output_tokens: 800, safety_identifier: "api-only-id",
  temperature: 0, metadata: { private: "api-only" }, previous_response_id: "old", background: true,
};
const complete = { status: "completed", output: [{ content: [{ type: "output_text", text: "{}" }] }], usage: { total_tokens: 20 } };

describe("ChatGPT plan transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTarvisProviderCooldownsForTests();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No API fallback permitted")));
    native.isAvailable.mockReturnValue(true);
    native.cancelRequest.mockResolvedValue(undefined);
    native.request.mockResolvedValue(JSON.stringify(complete));
  });

  it("keeps guarded input/schema but strips API-only options and forces streaming/no storage", () => {
    const body = JSON.parse(buildChatGptRequestBody(original));
    expect(body).toEqual({
      model: original.model, instructions: original.instructions, input: original.input,
      reasoning: original.reasoning, text: original.text, store: false, stream: true,
    });
  });

  it("sends through the native public-endpoint transport and accepts completed output only", async () => {
    const response = await fetchTarvisProviderResponse("chatgpt", "synthetic-oauth-token", "https://unused.invalid", { body: JSON.stringify(original) });
    expect(await response.json()).toEqual(complete);
    expect(native.request).toHaveBeenCalledWith({ requestId: "request-fixture", accessToken: "synthetic-oauth-token", body: buildChatGptRequestBody(original) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "incomplete", "failed"])("rejects %s output even if answer JSON is valid", async status => {
    native.request.mockResolvedValueOnce(JSON.stringify({ ...complete, status }));
    await expect(fetchChatGptResponse("token", original)).rejects.toThrow("did not finish");
  });

  it("does not expose a malformed provider response", async () => {
    native.request.mockResolvedValueOnce("private health content");
    await expect(fetchChatGptResponse("token", original)).rejects.toThrow("unreadable response");
  });

  it.each([
    ["ERR_CHATGPT_REQUEST_FORMAT", "answer format (HTTP 400)"],
    ["ERR_CHATGPT_REQUEST_MODEL", "selected model (HTTP 400)"],
    ["ERR_CHATGPT_REQUEST_INPUT", "question format (HTTP 400)"],
    ["ERR_CHATGPT_REQUEST_REASONING", "model setting (HTTP 400)"],
    ["ERR_CHATGPT_REQUEST_OTHER", "request (HTTP 400)"],
    ["ERR_CHATGPT_REQUEST_HTTP_OTHER", "before answering"],
    ["ERR_CHATGPT_STREAM_FORMAT", "response stream"],
    ["ERR_CHATGPT_STREAM_MIME", "did not return an event stream"],
    ["ERR_CHATGPT_STREAM_FRAMING", "expected event framing"],
    ["ERR_CHATGPT_STREAM_EMPTY", "empty event stream"],
    ["ERR_CHATGPT_STREAM_EVENT_JSON", "unreadable stream event"],
    ["ERR_CHATGPT_STREAM_COMPLETION_SHAPE", "incomplete completion event"],
    ["ERR_CHATGPT_STREAM_REJECTED", "stopped the answer"],
    ["ERR_CHATGPT_NATIVE_PROTOCOL", "could not read ChatGPT's response"],
  ])("classifies %s without exposing provider text", async (code, message) => {
    native.request.mockRejectedValueOnce({ code, message: "private health content" });
    const failure = await fetchChatGptResponse("token", original).then(() => null, error => error as Error);
    expect(failure?.message).toContain(message);
    expect(failure?.message).not.toContain("private health");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces ChatGPT usage recovery without retrying or using a saved API key", async () => {
    native.request.mockRejectedValueOnce({ code: "ERR_CHATGPT_QUOTA", message: "private health content" });
    await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ manageUsage: true, settingsRequired: false });
    await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ manageUsage: true });
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires reconnect after an auth error and discards raw provider text", async () => {
    native.request.mockRejectedValueOnce({ code: "ERR_CHATGPT_AUTH", message: "private health content" });
    await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ settingsRequired: true, message: expect.not.stringContaining("private health") });
  });

  it("distinguishes account restrictions from an expired session", async () => {
    native.request.mockRejectedValueOnce({ code: "ERR_CHATGPT_RESTRICTED" });
    await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ settingsRequired: false, manageUsage: true, retryAt: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps temporary outages distinct from allowance exhaustion during cooldown", async () => {
    native.request.mockRejectedValueOnce({ code: "ERR_CHATGPT_RETRY" });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ settingsRequired: false, manageUsage: false, message: expect.stringContaining("temporarily unavailable") });
    }
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["ERR_CHATGPT_UNSUPPORTED", "ERR_CHATGPT_ROUTE"])("offers a settings change for %s without retrying the unsupported request", async code => {
    native.request.mockRejectedValueOnce({ code, message: "private request body" });
    await expect(fetchTarvisProviderResponse("chatgpt", "token", "https://unused.invalid", { body: JSON.stringify(original) })).rejects.toMatchObject({ settingsRequired: true, message: expect.not.stringContaining("private request") });
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes no native request when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchChatGptResponse("token", original, controller.signal)).rejects.toThrow("cancelled");
    expect(native.request).not.toHaveBeenCalled();
  });

  it("cancels the native stream and discards a late completed response", async () => {
    let finish!: (value: string) => void;
    let started!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    native.request.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; started(); }));
    const controller = new AbortController();
    const pending = fetchChatGptResponse("token", original, controller.signal);
    await dispatched;
    controller.abort();
    finish(JSON.stringify(complete));
    await expect(pending).rejects.toThrow("cancelled");
    expect(native.cancelRequest).toHaveBeenCalledWith("request-fixture");
  });

  it("keeps unsupported builds disconnected", async () => {
    native.isAvailable.mockReturnValueOnce(false);
    await expect(fetchChatGptResponse("token", original)).rejects.toMatchObject({ settingsRequired: true });
    expect(native.request).not.toHaveBeenCalled();
  });
});
