import { DEXCOM_CGM_SOURCE_ID } from './dexcomClarityCsv';
import { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { GlucoseReading } from '@/domain/models';

export async function writeDexcomGlucoseHistory(
  store: GlucoseHistoryStore,
  readings: GlucoseReading[],
) {
  if (!readings.length) return 0;
  const before = await store.getBounds(DEXCOM_CGM_SOURCE_ID);
  await store.upsertReadings(readings);
  const after = await store.getBounds(DEXCOM_CGM_SOURCE_ID);
  return Math.max(0, after.count - before.count);
}

export async function clearDexcomGlucoseHistory(
  store: GlucoseHistoryStore,
) {
  const before = await store.getBounds(DEXCOM_CGM_SOURCE_ID);
  await store.clearSource(DEXCOM_CGM_SOURCE_ID);
  return before.count;
}
