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

const API_KEY_KEY = "t1arc.tarvis.openai-key.v1";
const USAGE_KEY = "t1arc.tarvis.usage.v1";
const SAFETY_ID_KEY = "t1arc.tarvis.safety-id.v1";
const SAFETY_IDENTIFIER_PREFIX = "t1arc-";

export const EMPTY_TARVIS_USAGE: TarvisUsage = {
  requestTimestamps: [],
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export async function loadTarvisApiKey(lease?: LocalDataWriteLease) {
  return (
    (
      await loadEpochBoundSecureStoreString(
        API_KEY_KEY,
        lease ?? (await acquireLocalDataWriteLease()),
      )
    )?.trim() || undefined
  );
}

export async function saveTarvisApiKey(
  value: string,
  lease: LocalDataWriteLease,
) {
  const key = value.trim();
  if (!key.startsWith("sk-") || key.length < 32) {
    throw new Error("Paste a complete OpenAI secret key beginning with sk-.");
  }
  await runTarvisConnectionMutation(() =>
    saveEpochBoundSecureStoreValue(API_KEY_KEY, key, lease),
  );
}

export async function clearTarvisApiKey(lease?: LocalDataWriteLease) {
  await runTarvisConnectionMutation(async () => {
    const writeLease = lease ?? (await acquireLocalDataWriteLease());
    await clearEpochBoundSecureStoreValue(API_KEY_KEY, writeLease);
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
    loadTarvisApiKey(lease),
    loadTarvisUsageValue(lease),
    loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease),
  ]);
  return {
    hasApiKey: apiKey !== undefined,
    hasUsage: usage !== undefined,
    hasSafetyIdentifier: safetyIdentifier !== undefined,
  };
}

export async function clearTarvisStoredData() {
  await runTarvisConnectionMutation(async () => {
    const results = await Promise.allSettled([
      forceClearEpochBoundSecureStoreValue(API_KEY_KEY),
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
  const [key, usage] = await Promise.all([
    loadTarvisApiKey(writeLease),
    loadTarvisUsage(writeLease),
  ]);
  return { hasApiKey: Boolean(key), usage };
}

export async function getTarvisSafetyIdentifier(lease: LocalDataWriteLease) {
  const existing = await loadEpochBoundSecureStoreString(SAFETY_ID_KEY, lease);
  if (existing) return existing;
  const created = `${SAFETY_IDENTIFIER_PREFIX}${Crypto.randomUUID()}`;
  await saveEpochBoundSecureStoreValue(SAFETY_ID_KEY, created, lease);
  return created;
}
