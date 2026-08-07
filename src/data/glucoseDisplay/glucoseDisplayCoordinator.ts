import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';

import { GLOOKO_CGM_SOURCE_ID } from '@/data/import/glookoCsv';
import { reconcileGlucoseAlerts } from '@/data/glucoseAlerts/glucoseAlertPreferences';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from '@/data/libreLinkUp/constants';
import { refreshConfiguredGlucoseSources } from '@/data/live/configuredGlucoseSources';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';
import { NIGHTSCOUT_SOURCE_ID } from '@/data/nightscout/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { XDRIP_SOURCE_ID } from '@/data/xdrip/types';
import { assessGlucoseTrend } from '@/domain/trend';

export const GLUCOSE_DISPLAY_HEADLESS_TASK =
  'DaymarkLibreForegroundSync';

const WEAR_HISTORY_WINDOW_MS = 6 * 60 * 60_000;
const MAX_WEAR_HISTORY_POINTS = 144;

let foregroundSync: Promise<void> | undefined;

function displaySourceLabel(sourceId: string) {
  if (sourceId === DIRECT_LIBRE_LINKUP_SOURCE_ID) {
    return 'T1 Arc direct LibreLinkUp';
  }
  if (sourceId === NOTIFICATION_SOURCE_ID) {
    return 'Phone notification source';
  }
  if (sourceId === GLOOKO_CGM_SOURCE_ID) {
    return 'Glooko glucose history';
  }
  if (sourceId === NIGHTSCOUT_SOURCE_ID) {
    return 'Nightscout';
  }
  if (sourceId === XDRIP_SOURCE_ID) {
    return 'xDrip-compatible endpoint';
  }
  return 'Personal glucose source';
}

export async function updateGlucoseDisplayFromHistory() {
  const display = await DaymarkGlucoseDisplay.getStatusAsync();
  // The native snapshot also feeds Wear OS. Watch sync must not depend on
  // whether the phone notification or Pixel always-on overlay is enabled.
  if (!display.supported) return true;

  const store = new SqliteGlucoseHistoryStore();
  await store.initialize();
  const reading = await store.getLatestReading();
  if (!reading) {
    await DaymarkGlucoseDisplay.updateMissingAsync(
      'No personal glucose reading',
    );
    await reconcileGlucoseAlerts(undefined).catch(() => undefined);
    return true;
  }
  const syncState = await store.getSyncState(reading.sourceId);
  const historyReadings = await store.getReadings(
    {
      start: reading.timestamp - WEAR_HISTORY_WINDOW_MS,
      end: reading.timestamp + 1,
    },
    reading.sourceId,
  );
  const recentReadings =
    reading.trend === 'unknown'
      ? historyReadings.filter(
          (candidate) =>
            candidate.timestamp >= reading.timestamp - 20 * 60_000,
        )
      : [reading];
  const trend = assessGlucoseTrend(reading, recentReadings);
  const [, historyUpdated] = await Promise.all([
    DaymarkGlucoseDisplay.updateReadingAsync(
      reading.mmolL,
      trend.direction,
      reading.timestamp,
      displaySourceLabel(reading.sourceId),
      Boolean(syncState?.lastErrorCode),
      trend.origin,
    ),
    DaymarkGlucoseDisplay.updateHistoryAsync(
      historyReadings
        .sort((left, right) => left.timestamp - right.timestamp)
        .slice(-MAX_WEAR_HISTORY_POINTS)
        .map((candidate) => ({
          mmolL: candidate.mmolL,
          timestampMs: candidate.timestamp,
        })),
    ),
  ]);
  await reconcileGlucoseAlerts(reading, trend.direction).catch(
    () => undefined,
  );
  return historyUpdated;
}

export async function runGlucoseDisplayForegroundSync() {
  if (foregroundSync) return foregroundSync;
  foregroundSync = (async () => {
    try {
      await refreshConfiguredGlucoseSources();
    } finally {
      // Cached history is still useful when a configured source is temporarily
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
