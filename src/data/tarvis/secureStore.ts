import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { TarvisStoredSettings, TarvisUsage } from './types';

const API_KEY_KEY = 't1arc.tarvis.openai-key.v1';
const USAGE_KEY = 't1arc.tarvis.usage.v1';
const SAFETY_ID_KEY = 't1arc.tarvis.safety-id.v1';

export const EMPTY_TARVIS_USAGE: TarvisUsage = {
  requestTimestamps: [],
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export async function loadTarvisApiKey() {
  return (await SecureStore.getItemAsync(API_KEY_KEY))?.trim() || undefined;
}

export async function saveTarvisApiKey(value: string) {
  const key = value.trim();
  if (!key.startsWith('sk-') || key.length < 32) {
    throw new Error('Paste a complete OpenAI secret key beginning with sk-.');
  }
  await SecureStore.setItemAsync(API_KEY_KEY, key);
}

export async function clearTarvisApiKey() {
  await SecureStore.deleteItemAsync(API_KEY_KEY);
}

export async function loadTarvisUsage(): Promise<TarvisUsage> {
  const stored = await SecureStore.getItemAsync(USAGE_KEY);
  if (!stored) return { ...EMPTY_TARVIS_USAGE };
  try {
    const parsed = JSON.parse(stored) as Partial<TarvisUsage>;
    return {
      requestTimestamps: Array.isArray(parsed.requestTimestamps)
        ? parsed.requestTimestamps.filter(Number.isFinite)
        : [],
      inputTokens: Number(parsed.inputTokens) || 0,
      outputTokens: Number(parsed.outputTokens) || 0,
      totalTokens: Number(parsed.totalTokens) || 0,
      lastRequestAt: Number(parsed.lastRequestAt) || undefined,
    };
  } catch {
    return { ...EMPTY_TARVIS_USAGE };
  }
}

export async function saveTarvisUsage(usage: TarvisUsage) {
  await SecureStore.setItemAsync(USAGE_KEY, JSON.stringify(usage));
}

export async function loadTarvisSettings(): Promise<TarvisStoredSettings> {
  const [key, usage] = await Promise.all([
    loadTarvisApiKey(),
    loadTarvisUsage(),
  ]);
  return { hasApiKey: Boolean(key), usage };
}

export async function getTarvisSafetyIdentifier() {
  const existing = await SecureStore.getItemAsync(SAFETY_ID_KEY);
  if (existing) return existing;
  const created = `t1arc-${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(SAFETY_ID_KEY, created);
  return created;
}
