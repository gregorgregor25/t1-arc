export type TarvisProvider = "openai" | "gemini" | "claude";

// Only identifiers verified for this release belong in this list. Never
// substitute a different model when a saved identifier is no longer offered.
export const TARVIS_MODELS: Record<TarvisProvider, readonly string[]> = {
  openai: ["gpt-5.6-luna", "gpt-5.6-terra"],
  gemini: ["gemini-3.8-flash", "gemini-3.7-flash"],
  claude: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5-5"],
};

export const TARVIS_PROVIDERS = {
  openai: { label: "OpenAI", model: "gpt-5.6-luna", pricingUrl: "https://developers.openai.com/api/docs/pricing", placeholder: "sk-proj-…", keyUrl: "https://platform.openai.com/api-keys", privacyUrl: "https://platform.openai.com/docs/guides/your-data", privacy: "T1 Arc requests no response storage. OpenAI's API retention and safety-monitoring terms still apply." },
  gemini: { label: "Google Gemini", model: "gemini-3.8-flash", pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing", placeholder: "AQ.…", keyUrl: "https://aistudio.google.com/apikey", privacyUrl: "https://ai.google.dev/gemini-api/terms", privacy: "Use a Gemini API project with active billing for health information. Google's unpaid-service terms prohibit submitting sensitive or personal information and may allow human review and product improvement. Paid-service requirements also apply to apps in the UK, EEA and Switzerland. Gemini requires users aged 18 or older and prohibits clinical practice or medical advice. Check Google's terms for your account and region." },
  claude: { label: "Anthropic Claude", model: "claude-sonnet-5", pricingUrl: "https://platform.claude.com/docs/en/about-claude/pricing", placeholder: "sk-ant-…", keyUrl: "https://platform.claude.com/settings/keys", privacyUrl: "https://privacy.claude.com/en/articles/7996868-how-long-do-you-store-my-data", privacy: "Anthropic's API retention and safety-monitoring terms apply. T1 Arc cannot enable zero data retention for your account." },
} as const;

export function isTarvisProvider(value: unknown): value is TarvisProvider {
  return value === "openai" || value === "gemini" || value === "claude";
}

export class TarvisModelUnavailableError extends Error {
  constructor(provider: TarvisProvider) {
    super(`The selected ${TARVIS_PROVIDERS[provider].label} model is unavailable. Choose a model in Tarv1s settings.`);
    this.name = "TarvisModelUnavailableError";
  }
}

export function assertTarvisModel(provider: TarvisProvider, value: unknown): string {
  if (typeof value !== "string" || !TARVIS_MODELS[provider].includes(value)) {
    throw new TarvisModelUnavailableError(provider);
  }
  return value;
}

export function validateTarvisApiKey(value: string, provider: TarvisProvider) {
  const key = value.trim();
  const prefix = provider === "gemini" ? "AQ. or AIza" : provider === "claude" ? "sk-ant-" : "sk-";
  const validPrefix = provider === "gemini" ? key.startsWith("AQ.") || key.startsWith("AIza") : provider === "claude" ? key.startsWith("sk-ant-") : key.startsWith("sk-") && !key.startsWith("sk-ant-");
  if (!validPrefix || key.length < 32 || /\s/.test(key)) {
    throw new Error(`Paste a complete ${TARVIS_PROVIDERS[provider].label} API key beginning with ${prefix}.`);
  }
  return key;
}
