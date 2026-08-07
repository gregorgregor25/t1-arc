import { GlucoseSource } from '@/data/contracts';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { loadLibreLinkUpCredentials } from '@/data/libreLinkUp/secureStore';
import { NotificationGlucoseSource } from '@/data/notification/NotificationGlucoseSource';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import { syncNightscoutHistoryIfDue } from '@/data/nightscout/historySync';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { loadXdripConnection } from '@/data/xdrip/secureStore';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';

import {
  GlucoseSourceRefreshResult,
  refreshGlucoseSources,
} from './glucoseSourceRefresh';

export async function configuredGlucoseSources(
  history = new SqliteGlucoseHistoryStore(),
): Promise<GlucoseSource[]> {
  const [credentials, nightscout, xdrip] = await Promise.all([
    loadLibreLinkUpCredentials(),
    loadNightscoutConnection(),
    loadXdripConnection(),
  ]);
  const notification = new NotificationGlucoseSource(history);
  const notificationConfigured = await notification
    .isConfigured()
    .catch(() => false);
  const sources: GlucoseSource[] = notificationConfigured
    ? [notification]
    : [];
  if (credentials) {
    sources.push(new DirectLibreLinkUpSource(credentials, history));
  }
  if (nightscout) {
    sources.push(
      new NightscoutGlucoseSource(
        nightscout,
        history,
        fetch,
        Date.now,
        new NightscoutTreatmentImporter(
          nightscout,
          new SqliteHealthRecordStore(),
        ),
      ),
    );
  }
  if (xdrip) {
    sources.push(new XdripGlucoseSource(xdrip, history));
  }
  return sources;
}

export async function refreshConfiguredGlucoseSources(
  history = new SqliteGlucoseHistoryStore(),
) {
  const sources = await configuredGlucoseSources(history);
  const results = await refreshGlucoseSources(sources);
  const successful = results.some((result) => result.status === 'fulfilled');
  if (results.length > 0 && !successful) {
    const failure = results.find(
      (result) => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }
  const nightscout = sources.find(
    (source): source is NightscoutGlucoseSource =>
      source instanceof NightscoutGlucoseSource,
  );
  if (nightscout) {
    const nightscoutResult = results.find(
      (result) => result.sourceId === nightscout.sourceId,
    );
    await syncNightscoutHistoryIfDue(nightscout).then(
      () => {
        if (nightscoutResult) nightscoutResult.historyStatus = 'fulfilled';
      },
      () => {
        if (nightscoutResult) nightscoutResult.historyStatus = 'rejected';
      },
    );
  }
  return results as GlucoseSourceRefreshResult[];
}

export async function syncConfiguredNightscoutHistoryIfDue(
  history = new SqliteGlucoseHistoryStore(),
) {
  const connection = await loadNightscoutConnection();
  if (!connection) return undefined;
  return syncNightscoutHistoryIfDue(
    new NightscoutGlucoseSource(
      connection,
      history,
      fetch,
      Date.now,
      new NightscoutTreatmentImporter(
        connection,
        new SqliteHealthRecordStore(),
      ),
    ),
  );
}
