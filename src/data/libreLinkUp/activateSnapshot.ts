import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from './constants';
import { LibreLinkUpSnapshot } from './types';
import { GlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

export async function persistVerifiedLibreSnapshot(
  store: GlucoseHistoryStore,
  snapshot: LibreLinkUpSnapshot,
  activatedAt = Date.now(),
) {
  if (!snapshot.readings.length) {
    throw new Error('The verified LibreLinkUp snapshot contains no readings.');
  }
  await store.initialize();
  await store.upsertReadings(snapshot.readings);
  const bounds = await store.getBounds(DIRECT_LIBRE_LINKUP_SOURCE_ID);
  await store.saveSyncState({
    sourceId: DIRECT_LIBRE_LINKUP_SOURCE_ID,
    lastAttemptAt: activatedAt,
    lastSuccessAt: activatedAt,
    recordCount: bounds.count,
  });
  return bounds;
}
