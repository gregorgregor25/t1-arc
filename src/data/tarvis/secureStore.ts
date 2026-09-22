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
import { isTarvisProvider, validateTarvisApiKey, type TarvisProvider } from "./providers";

const API_KEY_KEY = "t1arc.tarvis.openai-key.v1";
const PROVIDER_KEY = "t1arc.tarvis.provider.v1";
const API_KEY_KEYS = { openai: API_KEY_KEY, gemini: "t1arc.tarvis.gemini-key.v1", claude: "t1arc.tarvis.claude-key.v1" };
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
  return (
    (
      await loadEpochBoundSecureStoreString(
        API_KEY_KEYS[selected],
        writeLease,
      )
    )?.trim() || undefined
  );
}

export async function saveTarvisApiKey(
  value: string,
  lease: LocalDataWriteLease,
  provider: TarvisProvider = "openai",
) {
  const key = validateTarvisApiKey(value, provider);
  await runTarvisConnectionMutation(async () => {
    await saveEpochBoundSecureStoreValue(API_KEY_KEYS[provider], key, lease);
    await saveEpochBoundSecureStoreValue(PROVIDER_KEY, provider, lease);
  });
}

export async function selectTarvisProvider(provider: TarvisProvider, lease: LocalDataWriteLease) {
  await runTarvisConnectionMutation(async () => {
    if (!await loadTarvisApiKey(lease, provider)) throw new Error("Save a key for this provider first.");
    await saveEpochBoundSecureStoreValue(PROVIDER_KEY, provider, lease);
  });
}

export async function clearTarvisApiKey(lease?: LocalDataWriteLease, provider?: TarvisProvider) {
  await runTarvisConnectionMutation(async () => {
    const writeLease = lease ?? (await acquireLocalDataWriteLease());
    const selected = provider ?? await loadTarvisProvider(writeLease);
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
  const [apiKey, usage, safetyIdentifier] = await Promise.all([
    Promise.all(Object.values(API_KEY_KEYS).map(key => loadEpochBoundSecureStoreString(key, lease))),
    loadTarvisUsageValue(lease),
    loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease),
  ]);
  return {
    hasApiKey: apiKey.some(Boolean),
    hasUsage: usage !== undefined,
    hasSafetyIdentifier: safetyIdentifier !== undefined,
  };
}

export async function clearTarvisStoredData() {
  await runTarvisConnectionMutation(async () => {
    const results = await Promise.allSettled([
      ...Object.values(API_KEY_KEYS).map(key => forceClearEpochBoundSecureStoreValue(key)),
      forceClearEpochBoundSecureStoreValue(PROVIDER_KEY),
      forceClearEpochBoundSecureStoreValue(USAGE_KEY),
      forceClearEpochBoundSecureStoreValue(SAFETY_ID_KEY),
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
  const [keys, usage] = await Promise.all([
    Promise.all((Object.keys(API_KEY_KEYS) as TarvisProvider[]).map(async id => [id, Boolean(await loadTarvisApiKey(writeLease, id))] as const)),
    loadTarvisUsage(writeLease),
  ]);
  const configuredProviders = Object.fromEntries(keys) as Record<TarvisProvider, boolean>;
  return { hasApiKey: configuredProviders[provider], provider, configuredProviders, usage };
}

export async function getTarvisSafetyIdentifier(lease: LocalDataWriteLease) {
  const existing = await loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease);
  if (existing) return existing;
  const created = `${SAFETY_IDENTIFIER_PREFIX}${Crypto.randomUUID()}`;
  await saveEpochBoundSecureStoreValue(SAFETY_ID_KEY, created, lease);
  return created;
}
