import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTarvisProviderReady, claudeOutputSchema, clearTarvisProviderCooldownsForTests, fetchTarvisProviderResponse, normalizeProviderResponse } from "@/data/tarvis/providerTransport";
import { TARVIS_PROVIDERS, validateTarvisApiKey, type TarvisProvider } from "@/data/tarvis/providers";

const openAiUrl = "https://api.openai.com/v1/responses";
const key = "test-key-never-put-in-a-url";
const body = { model: TARVIS_PROVIDERS.openai.model, store: false, safety_identifier: "opaque-openai-only", instructions: "Guarded instructions", input: [{ role: "user", content: [{ type: "input_text", text: "bounded health context" }] }], max_output_tokens: 800, text: { format: { type: "json_schema", name: "answer", strict: true, schema: { type: "object", additionalProperties: false, properties: { answer: { type: "string", maxLength: 50 } }, required: ["answer"] } } } };
const init = (provider: TarvisProvider = "openai") => ({ method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, model: TARVIS_PROVIDERS[provider].model }), signal: new AbortController().signal });
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe("Tarv1s native provider boundary", () => {
  beforeEach(() => { clearTarvisProviderCooldownsForTests(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("preserves the OpenAI request including storage opt-out", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ output: [], usage: {} }));
    const request = init();
    await fetchTarvisProviderResponse("openai", key, openAiUrl, request);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(openAiUrl, request);
  });

  it("uses the exact selected native model and rejects a cross-provider or unavailable model", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({}));
    for (const [provider, model] of [["gemini", "gemini-3.8-flash"], ["claude", "claude-opus-5-5"]] as const) {
      const request = { ...init(), body: JSON.stringify({ ...body, model }) };
      await fetchTarvisProviderResponse(provider, key, openAiUrl, request);
      const [url, sent] = vi.mocked(fetch).mock.lastCall!;
      if (provider === "gemini") expect(String(url)).toContain(`/models/${model}:generateContent`);
      else expect(JSON.parse(String(sent?.body)).model).toBe(model);
    }
    vi.mocked(fetch).mockClear();
    await expect(fetchTarvisProviderResponse("gemini", key, openAiUrl, init())).rejects.toMatchObject({ settingsRequired: true });
    await expect(fetchTarvisProviderResponse("openai", key, openAiUrl, { ...init(), body: JSON.stringify({ ...body, model: "unlisted" }) })).rejects.toMatchObject({ settingsRequired: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["gemini", "claude"] as const)("sends only the selected %s key and native schema", async provider => {
    vi.mocked(fetch).mockResolvedValue(ok({}));
    const request = { ...init(), body: JSON.stringify({ ...body, model: TARVIS_PROVIDERS[provider].model }) };
    await fetchTarvisProviderResponse(provider, key, openAiUrl, request);
    const [url, sent] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).not.toContain(key);
    expect(String(url)).toContain(provider === "gemini" ? "generativelanguage.googleapis.com" : "api.anthropic.com");
    expect(sent?.signal).toBe(request.signal);
    expect(sent?.headers).not.toHaveProperty("Authorization");
    expect(sent?.headers).toHaveProperty(provider === "gemini" ? "x-goog-api-key" : "x-api-key", key);
    expect(sent?.body).not.toContain("opaque-openai-only");
    expect(sent?.body).not.toContain("gpt-5.6-luna");
    const payload = JSON.parse(String(sent?.body));
    expect(JSON.stringify(payload)).toContain("bounded health context");
    expect(JSON.stringify(payload)).toContain("Guarded instructions");
    if (provider === "gemini") expect(payload.generationConfig.responseJsonSchema).toEqual(body.text.format.schema);
    else expect(payload.output_config.format.schema).toEqual(claudeOutputSchema(body.text.format.schema));
  });

  it("normalizes Gemini tokens including thinking, excluding thought text", () => {
    const result = normalizeProviderResponse("gemini", { candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "private reasoning" }, { text: '{"answer":"ok"}' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 10, totalTokenCount: 35 } });
    expect(result.output?.[0]?.content?.[0]?.text).toBe('{"answer":"ok"}');
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 15, total_tokens: 35 });
  });

  it("normalizes Claude tokens including cache use", () => {
    const result = normalizeProviderResponse("claude", { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "{}" }], usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 4 } });
    expect(result.usage).toEqual({ input_tokens: 35, output_tokens: 4, total_tokens: 39 });
    expect(result.output?.[0]?.content?.[0]?.text).toBe("{}");
  });

  it.each([
    ["gemini", { promptFeedback: { blockReason: "SAFETY" } }],
    ["gemini", { candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "unsafe" }] } }] }],
    ["claude", { stop_reason: "refusal", content: [{ type: "text", text: "unsafe" }] }],
    ["claude", { stop_reason: "tool_use", content: [] }],
    ["gemini", {}], ["claude", {}],
  ] as const)("rejects blocked or blank %s output", (provider, raw) => {
    expect(() => normalizeProviderResponse(provider, raw)).toThrow();
  });

  it.each(["gemini", "claude"] as const)("does not parse truncated %s output", provider => {
    const raw = provider === "gemini" ? { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"partial"' }] } }] } : { stop_reason: "max_tokens", content: [{ type: "text", text: '{"partial"' }] };
    expect(normalizeProviderResponse(provider, raw)).toMatchObject({ status: "incomplete" });
  });

  it.each([401, 403, 429, 500, 503, 504, 400])("handles HTTP %i even with HTML errors without leaking response content", async status => {
    vi.mocked(fetch).mockResolvedValue(new Response("<html>secret health data</html>", { status }));
    await expect(fetchTarvisProviderResponse("gemini", key, openAiUrl, init("gemini"))).rejects.not.toThrow("secret health data");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("exposes settings recovery for invalid keys", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 401 }));
    await expect(fetchTarvisProviderResponse("claude", key, openAiUrl, init("claude"))).rejects.toMatchObject({ settingsRequired: true });
  });

  it("honours Retry-After and isolates provider cooldowns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "90" } }));
    await expect(fetchTarvisProviderResponse("gemini", key, openAiUrl, init("gemini"))).rejects.toMatchObject({ retryAt: 1_090_000 });
    await expect(fetchTarvisProviderResponse("gemini", key, openAiUrl, init("gemini"))).rejects.toThrow("limit exceeded");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => assertTarvisProviderReady("claude")).not.toThrow();
    vi.advanceTimersByTime(90_000);
    expect(() => assertTarvisProviderReady("gemini")).not.toThrow();
  });

  it("reports malformed successful JSON and network failures safely", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json"));
    const response = await fetchTarvisProviderResponse("claude", key, openAiUrl, init("claude"));
    await expect(response.json()).rejects.toThrow("unreadable");
    vi.mocked(fetch).mockRejectedValue(new Error("private URL"));
    await expect(fetchTarvisProviderResponse("claude", key, openAiUrl, init("claude"))).rejects.toThrow("could not be reached");
  });

  it("does not rewrite explicit cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error("cancelled");
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(fetchTarvisProviderResponse("claude", key, openAiUrl, { ...init("claude"), signal: controller.signal })).rejects.toBe(error);
  });

  it("validates keys locally and rejects the wrong provider", () => {
    for (const [provider, prefix] of [["openai", "sk-proj-"], ["claude", "sk-ant-"], ["gemini", "AIza"]] as [TarvisProvider, string][]) {
      expect(validateTarvisApiKey(` ${prefix}${"x".repeat(40)} `, provider)).toBe(`${prefix}${"x".repeat(40)}`);
      expect(() => validateTarvisApiKey("wrong", provider)).toThrow();
    }
    expect(validateTarvisApiKey(`AQ.${"x".repeat(50)}`, "gemini")).toBe(`AQ.${"x".repeat(50)}`);
    expect(() => validateTarvisApiKey(`sk-ant-${"x".repeat(40)}`, "openai")).toThrow();
  });
});
