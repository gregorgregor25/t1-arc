import { GLOOKO_CGM_SOURCE_ID } from './glookoCsv';
import { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { GlucoseReading } from '@/domain/models';

export async function writeGlookoGlucoseHistory(
  store: GlucoseHistoryStore,
  readings: GlucoseReading[],
) {
  if (!readings.length) return 0;
  const before = await store.getBounds(GLOOKO_CGM_SOURCE_ID);
  await store.upsertReadings(readings);
  const after = await store.getBounds(GLOOKO_CGM_SOURCE_ID);
  return Math.max(0, after.count - before.count);
}

export async function clearGlookoGlucoseHistory(
  store: GlucoseHistoryStore,
) {
  const before = await store.getBounds(GLOOKO_CGM_SOURCE_ID);
  await store.clearSource(GLOOKO_CGM_SOURCE_ID);
  return before.count;
}
