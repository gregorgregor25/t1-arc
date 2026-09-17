import { readPersonalAppState } from './persistence/personalAppState';
import { savePreferredHealthConnectSource } from './healthConnect/healthConnectRepository';
import { acquireLocalDataWriteLease, withLocalDataWriteLeaseTransaction } from './privacy/localDataWriteEpoch';
import { advanceInsightInputGenerationInTransaction, clearSavedInsightReportsInTransaction } from './insights/insightReportRepository';
import { NATIVE_NUTRITION_SOURCE, NUTRITION_SOURCE_KEY, validateNutritionSource } from '@/domain/nutritionSource';

export async function readNutritionSource() {
  const value = await readPersonalAppState(NUTRITION_SOURCE_KEY);
  return value ? validateNutritionSource(value) : NATIVE_NUTRITION_SOURCE;
}
export async function saveNutritionSource(selected: string) {
  const value = validateNutritionSource(selected);
  const lease = await acquireLocalDataWriteLease();
  if (value.startsWith('health-connect:')) await savePreferredHealthConnectSource('nutrition', value.slice('health-connect:'.length), 'manual', lease);
  await withLocalDataWriteLeaseTransaction(lease, async database => {
    await database.runAsync('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', NUTRITION_SOURCE_KEY, value);
    await advanceInsightInputGenerationInTransaction(database);
    await clearSavedInsightReportsInTransaction(database);
  });
}
