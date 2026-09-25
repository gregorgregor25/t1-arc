import { assertTarvisModel, TARVIS_PROVIDERS, type TarvisProvider } from "./providers";

// Keep the existing, guarded Responses-shaped request contract inside Tarv1s.
// Only this boundary translates it to the selected provider's native API.
interface ModelRequest {
  model: string;
  instructions: string;
  input: { role: string; content: { text: string }[] }[];
  max_output_tokens: number;
  reasoning?: { effort: string };
  text: { format: { name?: string; schema: Record<string, unknown> } };
}

// Sources: https://www.niddk.nih.gov/health-information/diagnostic-tests/a1c-test
// https://diabetes.org/living-with-diabetes/treatment-care/food-monitoring
// ADA 2026 hypoglycaemia levels: https://pmc.ncbi.nlm.nih.gov/articles/PMC12690178/
const GEMINI_MEASURE_CALIBRATION = `When the question concerns HbA1c or CGM time in range, keep these measures distinct. HbA1c reflects average glucose over roughly three months, with greater weight on recent weeks. Large sustained changes in recent weeks can change HbA1c; do not say it cannot reflect recent changes in glucose management. High and low readings contribute to that average, but the HbA1c result cannot identify individual episodes; do not imply that lows have no effect on HbA1c or are always masked by other readings. Red-cell lifespan or haemoglobin variants can affect the result. Time in range is the fraction of observed sensor time within a defined glucose range. A time-in-range percentage alone does not reveal the number, timing, depth or duration of high or low events, glucose variability, or how out-of-range time divides between below and above range. Those details need the CGM trace or separate statistics. Do not describe the TIR percentage itself as showing day-to-day patterns or stability, even in a summary or comparison with HbA1c; attribute those insights explicitly to the full CGM trace and separate metrics. Do not add numerical glucose bands or clinical classifications unless the question asks for them. If discussing hypoglycaemia levels, distinguish glucose depth from clinical severity: level 1 is at least 3.0 and below 3.9 mmol/L (at least 54 and below 70 mg/dL); level 2 is below 3.0 mmol/L (54 mg/dL), whereas severe (level 3) hypoglycaemia involves impaired mental or physical functioning requiring another person's assistance, irrespective of the glucose value. A sensor threshold or trace alone cannot establish a severe event. Use only the points relevant to the question. Do not infer personal results or turn either measure into a dose or an exact conversion. Keep all existing JSON and safety instructions.`;

function geminiInstructions(original: ModelRequest) {
  if (original.text.format.name !== "tarvis_general_education_v1") return original.instructions;
  return `${original.instructions}\n\n${GEMINI_MEASURE_CALIBRATION}`;
}

export interface ProviderResponseBody {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: { content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export class TarvisProviderError extends Error {
  constructor(message: string, readonly settingsRequired = false, readonly retryAt?: number) {
    super(message);
    this.name = "TarvisProviderError";
  }
}

const cooldowns = new Map<TarvisProvider, number>();
export function assertTarvisProviderReady(provider: TarvisProvider, now = Date.now()) {
  const until = cooldowns.get(provider) ?? 0;
  if (until > now) throw new TarvisProviderError(`${TARVIS_PROVIDERS[provider].label} API limit exceeded. Please wait before trying again.`, false, until);
}

export function clearTarvisProviderCooldownsForTests() { cooldowns.clear(); }

// Claude's native JSON schema support omits these validation keywords. The
// original strict local answer/plan parsers continue enforcing the contract.
export function claudeOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(claudeOutputSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"].includes(key),
  ).map(([key, item]) => [key, claudeOutputSchema(item)]));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function count(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }

export function normalizeProviderResponse(provider: TarvisProvider, value: unknown): ProviderResponseBody {
  const raw = record(value);
  if (provider === "openai") return raw as ProviderResponseBody;
  let text: string;
  let reason: unknown;
  let input: number;
  let output: number;
  if (provider === "gemini") {
    const candidate = record(list(raw.candidates)[0]);
    reason = candidate.finishReason;
    if (record(raw.promptFeedback).blockReason || (reason && reason !== "STOP" && reason !== "MAX_TOKENS")) {
      throw new TarvisProviderError("Gemini blocked this response. Please rephrase your question.");
    }
    text = list(record(candidate.content).parts).map(record).filter(part => part.thought !== true).map(part => typeof part.text === "string" ? part.text : "").join("");
    const usage = record(raw.usageMetadata);
    input = count(usage.promptTokenCount);
    output = count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount);
  } else {
    reason = raw.stop_reason;
    if (reason === "refusal") throw new TarvisProviderError("Claude declined this response. Please rephrase your question.");
    if (reason && reason !== "end_turn" && reason !== "max_tokens") throw new TarvisProviderError("Claude did not complete the answer. Please try again.");
    text = list(raw.content).map(record).filter(part => part.type === "text").map(part => typeof part.text === "string" ? part.text : "").join("");
    const usage = record(raw.usage);
    input = count(usage.input_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
    output = count(usage.output_tokens);
  }
  if (reason === "MAX_TOKENS" || reason === "max_tokens") {
    return { status: "incomplete", incomplete_details: { reason: "output limit" }, usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } };
  }
  if (!text.trim()) throw new TarvisProviderError(`${TARVIS_PROVIDERS[provider].label} returned no answer. Please try again.`);
  return { status: "completed", output: [{ content: [{ type: "output_text", text }] }], usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } };
}

export async function fetchTarvisProviderResponse(provider: TarvisProvider, key: string, openAiUrl: string, init: RequestInit) {
  assertTarvisProviderReady(provider);
  const config = TARVIS_PROVIDERS[provider];
  let original: ModelRequest;
  let model: string;
  try {
    original = JSON.parse(String(init.body)) as ModelRequest;
    model = assertTarvisModel(provider, original.model);
  } catch {
    throw new TarvisProviderError(`The selected ${config.label} model is unavailable. Choose a model in Tarv1s settings.`, true);
  }
  let url = openAiUrl;
  let request = init;
  if (provider !== "openai") {
    const content = original.input.flatMap(item => item.content.map(part => part.text)).join("\n");
    if (provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      request = { ...init, headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({
        systemInstruction: { parts: [{ text: geminiInstructions(original) }] },
        contents: [{ role: "user", parts: [{ text: content }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: original.text.format.schema, maxOutputTokens: Math.max(original.max_output_tokens, 4096), thinkingConfig: { thinkingLevel: "LOW" } },
      }) };
    } else {
      url = "https://api.anthropic.com/v1/messages";
      request = { ...init, headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({
        model, system: original.instructions, messages: [{ role: "user", content }],
        max_tokens: Math.max(original.max_output_tokens, 2048),
        output_config: { format: { type: "json_schema", schema: claudeOutputSchema(original.text.format.schema) } },
      }) };
    }
  }
  let response: Response;
  try { response = await fetch(url, request); }
  catch (error) {
    if (init.signal?.aborted) throw error;
    throw new TarvisProviderError(`${config.label} could not be reached. Check your connection and try again.`);
  }
  // Do not surface provider error bodies: they may echo private inputs.
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new TarvisProviderError(`${config.label} API key is invalid or lacks permission. Open Tarv1s settings to check it.`, true);
    if (response.status === 429) {
      const retry = response.headers?.get("retry-after");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
      const requestedDelay = seconds ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      const until = Date.now() + Math.min(24 * 60 * 60 * 1000, Math.max(30_000, Number.isFinite(requestedDelay) ? requestedDelay : 0));
      cooldowns.set(provider, until);
      throw new TarvisProviderError(`${config.label} API limit exceeded. Please wait before trying again.`, false, until);
    }
    if (response.status >= 500) throw new TarvisProviderError(`${config.label} is currently unavailable. Please try again later.`);
    throw new TarvisProviderError(`${config.label} could not complete this request (HTTP ${response.status}). Check your API access and try again.`);
  }
  return { ok: true, status: response.status, async json() {
    let body: unknown;
    try { body = await response.json(); } catch { throw new TarvisProviderError(`${config.label} returned an unreadable response. Please try again.`); }
    return normalizeProviderResponse(provider, body);
  } };
}
