import * as Crypto from "expo-crypto";

import { TarvisStoredSettings, TarvisUsage } from "./types";
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import {
  clearEpochBoundSecureStoreValue,
  forceClearEpochBoundSecureStoreValue,
  loadEpochBoundSecureStoreString,
  loadEpochBoundSecureStoreValue,
  saveEpochBoundSecureStoreValue,
} from "@/data/privacy/localDataEpochSecureStore";
import { runTarvisConnectionMutation } from "./connectionCoordinator";
import { assertTarvisModel, isTarvisProvider, TARVIS_PROVIDERS, TarvisModelUnavailableError, validateTarvisApiKey, type TarvisApiKeyProvider, type TarvisProvider } from "./providers";

const API_KEY_KEY = "t1arc.tarvis.openai-key.v1";
const PROVIDER_KEY = "t1arc.tarvis.provider.v1";
const API_KEY_KEYS = { openai: API_KEY_KEY, gemini: "t1arc.tarvis.gemini-key.v1", claude: "t1arc.tarvis.claude-key.v1" };
const MODEL_KEYS = { openai: "t1arc.tarvis.openai-model.v1", gemini: "t1arc.tarvis.gemini-model.v1", claude: "t1arc.tarvis.claude-model.v1" };
const USAGE_KEY = "t1arc.tarvis.usage.v1";
const SAFETY_ID_KEY = "t1arc.tarvis.safety-id.v1";
const SAFETY_IDENTIFIER_PREFIX = "t1arc-";

export const EMPTY_TARVIS_USAGE: TarvisUsage = {
  requestTimestamps: [],
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export async function loadTarvisProvider(lease?: LocalDataWriteLease): Promise<TarvisProvider> {
  const value = await loadEpochBoundSecureStoreString(PROVIDER_KEY, lease ?? (await acquireLocalDataWriteLease()));
  if (value === undefined || value === null) return "openai";
  if (!isTarvisProvider(value)) throw new Error("The saved AI provider could not be read. Reconnect in Tarv1s settings.");
  return value;
}

export async function loadTarvisApiKey(lease?: LocalDataWriteLease, provider?: TarvisProvider) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const selected = provider ?? await loadTarvisProvider(writeLease);
  // A ChatGPT session is never an API key and must use its own transport.
  if (selected === "chatgpt") return undefined;
  return (
    (
      await loadEpochBoundSecureStoreString(
        API_KEY_KEYS[selected],
        writeLease,
      )
    )?.trim() || undefined
  );
}

async function loadSavedTarvisModel(provider: TarvisProvider, lease: LocalDataWriteLease) {
  if (provider === "chatgpt") {
    const { getChatGptState } = await import("./chatGptConnection");
    return (await getChatGptState(lease)).selectedModel ?? "";
  }
  return await loadEpochBoundSecureStoreString(MODEL_KEYS[provider], lease) ?? TARVIS_PROVIDERS[provider].model;
}

export async function loadTarvisModel(lease?: LocalDataWriteLease, provider?: TarvisProvider): Promise<string> {
  const writeLease = lease ?? await acquireLocalDataWriteLease();
  const selected = provider ?? await loadTarvisProvider(writeLease);
  if (selected === "chatgpt") {
    const { getChatGptState } = await import("./chatGptConnection");
    const state = await getChatGptState(writeLease);
    if (!state.connected || !state.models.some(item => item.slug === state.selectedModel)) throw new TarvisModelUnavailableError(selected);
    return assertTarvisModel(selected, state.selectedModel);
  }
  return assertTarvisModel(selected, await loadSavedTarvisModel(selected, writeLease));
}

export async function selectTarvisModel(provider: TarvisProvider, model: string, lease: LocalDataWriteLease) {
  if (provider === "chatgpt") {
    const { selectChatGptModel } = await import("./chatGptConnection");
    await selectChatGptModel(model, lease);
    return;
  }
  const selected = assertTarvisModel(provider, model);
  await runTarvisConnectionMutation(async () => {
    await saveEpochBoundSecureStoreValue(MODEL_KEYS[provider], selected, lease);
  });
}

export async function saveTarvisApiKey(
  value: string,
  lease: LocalDataWriteLease,
  provider: TarvisProvider = "openai",
  model?: string,
) {
  if (provider === "chatgpt") throw new Error("Use Continue with ChatGPT to connect your ChatGPT plan.");
  const key = validateTarvisApiKey(value, provider);
  await runTarvisConnectionMutation(async () => {
    const selectedModel = assertTarvisModel(provider, model ?? await loadSavedTarvisModel(provider, lease));
    await saveEpochBoundSecureStoreValue(API_KEY_KEYS[provider], key, lease);
    await saveEpochBoundSecureStoreValue(MODEL_KEYS[provider], selectedModel, lease);
    await saveEpochBoundSecureStoreValue(PROVIDER_KEY, provider, lease);
  });
}

export async function selectTarvisProvider(provider: TarvisProvider, lease: LocalDataWriteLease, model?: string) {
  await runTarvisConnectionMutation(async () => {
    if (provider === "chatgpt") {
      const { getChatGptState } = await import("./chatGptConnection");
      const state = await getChatGptState(lease);
      if (!state.available || !state.connected) throw new Error("Continue with ChatGPT before choosing this connection.");
      if (!state.selectedModel || (model !== undefined && model !== state.selectedModel) || !state.models.some(item => item.slug === state.selectedModel)) throw new TarvisModelUnavailableError(provider);
      await saveEpochBoundSecureStoreValue(PROVIDER_KEY, provider, lease);
      return;
    }
    if (!await loadTarvisApiKey(lease, provider)) throw new Error("Save a key for this provider first.");
    const selectedModel = assertTarvisModel(provider, model ?? await loadSavedTarvisModel(provider, lease));
    await saveEpochBoundSecureStoreValue(MODEL_KEYS[provider], selectedModel, lease);
    await saveEpochBoundSecureStoreValue(PROVIDER_KEY, provider, lease);
  });
}

export async function clearTarvisApiKey(lease?: LocalDataWriteLease, provider?: TarvisProvider) {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const selected = provider ?? await loadTarvisProvider(writeLease);
  if (selected === "chatgpt") {
    const { signOutChatGpt } = await import("./chatGptConnection");
    await signOutChatGpt(writeLease);
    return;
  }
  await runTarvisConnectionMutation(async () => {
    await clearEpochBoundSecureStoreValue(API_KEY_KEYS[selected], writeLease);
  });
}

export interface TarvisStoredDataStatus {
  hasApiKey: boolean;
  hasUsage: boolean;
  hasSafetyIdentifier: boolean;
}

export async function getTarvisStoredDataStatus(): Promise<TarvisStoredDataStatus> {
  const lease = await acquireLocalDataWriteLease();
  const { hasChatGptStoredData } = await import("./chatGptConnection");
  const [apiKey, usage, safetyIdentifier, chatGpt] = await Promise.all([
    Promise.all(Object.values(API_KEY_KEYS).map(key => loadEpochBoundSecureStoreString(key, lease))),
    loadTarvisUsageValue(lease),
    loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease),
    hasChatGptStoredData(lease),
  ]);
  return {
    hasApiKey: apiKey.some(Boolean) || chatGpt,
    hasUsage: usage !== undefined,
    hasSafetyIdentifier: safetyIdentifier !== undefined,
  };
}

export async function clearTarvisStoredData() {
  await runTarvisConnectionMutation(async () => {
    const { clearChatGptStoredData } = await import("./chatGptConnection");
    const results = await Promise.allSettled([
      clearChatGptStoredData(),
      ...Object.values(API_KEY_KEYS).map(key => forceClearEpochBoundSecureStoreValue(key)),
      ...Object.values(MODEL_KEYS).map(key => forceClearEpochBoundSecureStoreValue(key)),
      forceClearEpochBoundSecureStoreValue(PROVIDER_KEY),
      forceClearEpochBoundSecureStoreValue(USAGE_KEY),
      forceClearEpochBoundSecureStoreValue(SAFETY_ID_KEY),
      forceClearEpochBoundSecureStoreValue("t1arc.tarvis.chatgpt-plan-info-seen.v1"),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  });
}

async function loadTarvisUsageValue(lease: LocalDataWriteLease) {
  return loadEpochBoundSecureStoreValue(USAGE_KEY, lease, (value) =>
    value && typeof value === "object"
      ? (value as Partial<TarvisUsage>)
      : undefined,
  );
}

export async function loadTarvisUsage(
  lease?: LocalDataWriteLease,
): Promise<TarvisUsage> {
  const parsed = await loadTarvisUsageValue(
    lease ?? (await acquireLocalDataWriteLease()),
  );
  if (!parsed) return { ...EMPTY_TARVIS_USAGE };
  return {
    requestTimestamps: Array.isArray(parsed.requestTimestamps)
      ? parsed.requestTimestamps.filter(Number.isFinite)
      : [],
    inputTokens: Number(parsed.inputTokens) || 0,
    outputTokens: Number(parsed.outputTokens) || 0,
    totalTokens: Number(parsed.totalTokens) || 0,
    lastRequestAt: Number(parsed.lastRequestAt) || undefined,
  };
}

export async function saveTarvisUsage(
  usage: TarvisUsage,
  lease: LocalDataWriteLease,
) {
  await saveEpochBoundSecureStoreValue(USAGE_KEY, usage, lease);
}

export async function loadTarvisSettings(
  lease?: LocalDataWriteLease,
): Promise<TarvisStoredSettings> {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const provider = await loadTarvisProvider(writeLease);
  const { getChatGptState } = await import("./chatGptConnection");
  const [keys, models, usage, chatGpt] = await Promise.all([
    Promise.all((Object.keys(API_KEY_KEYS) as TarvisApiKeyProvider[]).map(async id => [id, Boolean(await loadTarvisApiKey(writeLease, id))] as const)),
    Promise.all((Object.keys(MODEL_KEYS) as TarvisApiKeyProvider[]).map(async id => [id, await loadSavedTarvisModel(id, writeLease)] as const)),
    loadTarvisUsage(writeLease),
    getChatGptState(writeLease),
  ]);
  const configuredProviders = { ...Object.fromEntries(keys), chatgpt: chatGpt.available && chatGpt.connected } as Record<TarvisProvider, boolean>;
  const selectedModels = { ...Object.fromEntries(models), chatgpt: chatGpt.selectedModel ?? "" } as Record<TarvisProvider, string>;
  const hasApiKey = provider === "chatgpt"
    ? configuredProviders.chatgpt && chatGpt.models.some(item => item.slug === chatGpt.selectedModel)
    : configuredProviders[provider];
  return { hasApiKey, provider, configuredProviders, selectedModels, chatGpt, usage };
}

export async function getTarvisSafetyIdentifier(lease: LocalDataWriteLease) {
  const existing = await loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease);
  if (existing) return existing;
  const created = `${SAFETY_IDENTIFIER_PREFIX}${Crypto.randomUUID()}`;
  await saveEpochBoundSecureStoreValue(SAFETY_ID_KEY, created, lease);
  return created;
}
