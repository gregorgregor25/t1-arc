import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertTarvisProviderReady,
  clearTarvisProviderCooldownsForTests,
  fetchTarvisProviderResponse,
} from "@/data/tarvis/providerTransport";
import { TARVIS_PROVIDERS, type TarvisProvider } from "@/data/tarvis/providers";
import {
  CHATGPT_SWITCH_HINT,
  providerSwitchHint,
} from "@/data/tarvis/providerSwitchHint";

const url = "https://api.openai.com/v1/responses";
const key = "synthetic-key";
// A marker that must never appear in a message shown to the person.
const MARKER = "PRIVATE-BODY-MARKER";
const init = (provider: TarvisProvider = "openai") => ({
  method: "POST",
  body: JSON.stringify({
    model: TARVIS_PROVIDERS[provider].model,
    instructions: "synthetic",
    input: [{ role: "user", content: [{ text: "synthetic" }] }],
    max_output_tokens: 100,
    text: { format: { name: "answer", schema: { type: "object" } } },
  }),
});
const errorBody = (code?: string, type?: string) =>
  JSON.stringify({ error: { message: `${MARKER} echo of the prompt`, code, type } });
const respond = (status: number, text: string) =>
  vi.mocked(fetch).mockResolvedValue(new Response(text, { status }));

async function failure(provider: TarvisProvider = "openai") {
  try {
    await fetchTarvisProviderResponse(provider, key, url, init(provider));
  } catch (error) {
    return error as Error & { settingsRequired: boolean; retryAt?: number };
  }
  throw new Error("Expected the request to fail");
}

describe("OpenAI key errors name one cause", () => {
  beforeEach(() => {
    clearTarvisProviderCooldownsForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("401: rejected key", async () => {
    respond(401, errorBody("invalid_api_key", "invalid_request_error"));
    const error = await failure();
    expect(error.message).toMatch(/^OpenAI rejected this API key/);
    expect(error.settingsRequired).toBe(true);
    expect(error.message).not.toContain(MARKER);
  });

  it.each([
    [404, errorBody("model_not_found")],
    [404, ""],
    [403, errorBody("model_not_found", "invalid_request_error")],
  ])("%i: model access names the model", async (status, text) => {
    respond(status, text);
    const error = await failure();
    expect(error.message).toContain(
      `can't use the model ${TARVIS_PROVIDERS.openai.model}`,
    );
    expect(error.settingsRequired).toBe(true);
    expect(error.message).not.toContain(MARKER);
  });

  it("403 otherwise: refused request", async () => {
    respond(403, errorBody("unsupported_country_region_territory"));
    const error = await failure();
    expect(error.message).toMatch(/^OpenAI accepted the key but refused the request/);
    expect(error.settingsRequired).toBe(true);
  });

  it.each([
    errorBody("insufficient_quota", "insufficient_quota"),
    errorBody(undefined, "insufficient_quota"),
  ])("429 insufficient_quota: no credit and no cooldown", async (text) => {
    respond(429, text);
    const error = await failure();
    expect(error.message).toMatch(/no API credit left, or billing is not set up/);
    expect(error.settingsRequired).toBe(true);
    expect(error.retryAt).toBeUndefined();
    expect(() => assertTarvisProviderReady("openai")).not.toThrow();
    expect(error.message).not.toContain(MARKER);
  });

  it("429 otherwise keeps the rate-limit cooldown", async () => {
    respond(429, errorBody("rate_limit_exceeded"));
    const error = await failure();
    expect(error.message).toMatch(/limit exceeded/);
    expect(error.retryAt).toBeGreaterThan(Date.now());
    expect(() => assertTarvisProviderReady("openai")).toThrow(/limit exceeded/);
  });

  it("ignores codes that are not short identifiers and maps by status", async () => {
    respond(429, JSON.stringify({ error: { code: `insufficient_quota ${MARKER}` } }));
    const error = await failure();
    expect(error.message).toMatch(/limit exceeded/);
    expect(error.message).not.toContain(MARKER);
  });

  it("maps a non-JSON body by status only", async () => {
    respond(401, `<html>${MARKER}</html>`);
    const error = await failure();
    expect(error.message).toMatch(/^OpenAI rejected this API key/);
    expect(error.message).not.toContain(MARKER);
  });
});

describe("Gemini and Claude split 401 from 403", () => {
  beforeEach(() => {
    clearTarvisProviderCooldownsForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["gemini", "claude"] as const)("%s", async (provider) => {
    const label = TARVIS_PROVIDERS[provider].label;
    respond(401, errorBody());
    const rejected = await failure(provider);
    expect(rejected.message).toBe(`${label} rejected this API key. Replace it in Tarv1s settings.`);
    expect(rejected.settingsRequired).toBe(true);
    respond(403, errorBody());
    const refused = await failure(provider);
    expect(refused.message).toMatch(new RegExp(`^${label} accepted the key but refused the request`));
    expect(refused.settingsRequired).toBe(true);
  });
});

describe("ChatGPT switch hint", () => {
  it("appears only for an API-key provider error that needs settings while ChatGPT is connected", () => {
    expect(providerSwitchHint("openai", true, true)).toBe(CHATGPT_SWITCH_HINT);
    expect(providerSwitchHint("gemini", true, true)).toBe(CHATGPT_SWITCH_HINT);
    expect(providerSwitchHint("openai", false, true)).toBeUndefined();
    expect(providerSwitchHint("openai", true, false)).toBeUndefined();
    expect(providerSwitchHint("chatgpt", true, true)).toBeUndefined();
  });
});
