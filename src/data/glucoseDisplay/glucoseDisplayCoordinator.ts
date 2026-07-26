import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';

import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from '@/data/libreLinkUp/constants';
import { loadLibreLinkUpCredentials } from '@/data/libreLinkUp/secureStore';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';

export const GLUCOSE_DISPLAY_HEADLESS_TASK =
  'DaymarkLibreForegroundSync';

let foregroundSync: Promise<void> | undefined;

export async function updateGlucoseDisplayFromHistory() {
  const display = await DaymarkGlucoseDisplay.getStatusAsync();
  if (!display.supported || !display.enabled) return;

  const store = new SqliteGlucoseHistoryStore();
  await store.initialize();
  const [reading, syncState] = await Promise.all([
    store.getLatestReading(DIRECT_LIBRE_LINKUP_SOURCE_ID),
    store.getSyncState(DIRECT_LIBRE_LINKUP_SOURCE_ID),
  ]);
  if (!reading) {
    await DaymarkGlucoseDisplay.updateMissingAsync(
      'Daymark direct LibreLinkUp',
    );
    return;
  }
  await DaymarkGlucoseDisplay.updateReadingAsync(
    reading.mmolL,
    reading.trend,
    reading.timestamp,
    'Daymark direct LibreLinkUp',
    Boolean(syncState?.lastErrorCode),
  );
}

export async function runGlucoseDisplayForegroundSync() {
  if (foregroundSync) return foregroundSync;
  foregroundSync = (async () => {
    const credentials = await loadLibreLinkUpCredentials();
    if (!credentials) {
      await DaymarkGlucoseDisplay.updateMissingAsync(
        'LibreLinkUp connection removed',
      );
      return;
    }

    const source = new DirectLibreLinkUpSource(
      credentials,
      new SqliteGlucoseHistoryStore(),
    );
    try {
      await source.refresh();
    } finally {
      // Cached history is still useful when LibreLinkUp is temporarily
      // unavailable; the native display marks it delayed or stale.
      await updateGlucoseDisplayFromHistory();
    }
  })().finally(() => {
    foregroundSync = undefined;
  });
  return foregroundSync;
}

export async function disableGlucoseDisplay() {
  await DaymarkGlucoseDisplay.disableAsync();
}
