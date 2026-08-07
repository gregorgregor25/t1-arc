import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { EvidenceReference } from '@/domain/insights';

import { TarvisAnswer, TarvisRequestMetrics } from './types';

const STORAGE_KEY = 'tarvis-conversation-v1';
const MAX_STORED_EXCHANGES = 30;

export interface StoredTarvisExchange {
  id: string;
  question: string;
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
  requestMetrics?: TarvisRequestMetrics;
}

interface StoredTarvisConversation {
  schemaVersion: 1;
  updatedAt: number;
  exchanges: StoredTarvisExchange[];
}

function validExchange(value: unknown): value is StoredTarvisExchange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const exchange = value as Partial<StoredTarvisExchange>;
  return (
    typeof exchange.id === 'string' &&
    typeof exchange.question === 'string' &&
    Boolean(exchange.answer) &&
    Array.isArray(exchange.evidence)
  );
}

export async function loadTarvisConversation() {
  const database = await openDaymarkDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    STORAGE_KEY,
  );
  if (!row?.value) return [];
  try {
    const stored = JSON.parse(row.value) as Partial<StoredTarvisConversation>;
    if (stored.schemaVersion !== 1 || !Array.isArray(stored.exchanges)) {
      return [];
    }
    return stored.exchanges.filter(validExchange).slice(-MAX_STORED_EXCHANGES);
  } catch {
    return [];
  }
}

export async function saveTarvisConversation(
  exchanges: StoredTarvisExchange[],
) {
  const document: StoredTarvisConversation = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    exchanges: exchanges.slice(-MAX_STORED_EXCHANGES),
  };
  await openDaymarkDatabase();
  await withDaymarkTransaction(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      STORAGE_KEY,
      JSON.stringify(document),
    );
  });
}

export async function clearTarvisConversation() {
  await openDaymarkDatabase();
  await withDaymarkTransaction(async (transaction) => {
    await transaction.runAsync(
      'DELETE FROM app_metadata WHERE key = ?',
      STORAGE_KEY,
    );
  });
}
