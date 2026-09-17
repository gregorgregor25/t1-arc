import { GlucoseSource } from '@/data/contracts';
import { DexcomShareGlucoseSource } from '@/data/dexcomShare/DexcomShareGlucoseSource';
import { loadOwnedDexcomShareConnection } from '@/data/dexcomShare/secureStore';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import type { DirectLibreRefreshReason } from '@/data/libreLinkUp/refreshPolicy';
import { loadOwnedLibreLinkUpConnection } from '@/data/libreLinkUp/secureStore';
import { NotificationGlucoseSource } from '@/data/notification/NotificationGlucoseSource';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import { loadOwnedNightscoutConnection } from '@/data/nightscout/secureStore';
import { syncNightscoutHistoryIfDue } from '@/data/nightscout/historySync';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { loadOwnedXdripConnection } from '@/data/xdrip/secureStore';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import { MedtrumGlucoseSource } from '@/data/medtrum/MedtrumGlucoseSource';
import { loadOwnedMedtrumConnection } from '@/data/medtrum/secureStore';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import {
  GlucoseSourceRefreshResult,
  omitSupersededSourceRefreshes,
  refreshGlucoseSources,
} from './glucoseSourceRefresh';

export interface ConfiguredGlucoseRefreshOptions {
  reason?: DirectLibreRefreshReason;
  signal?: AbortSignal;
  /** Captured by a task owner before credentials or external work. */
  writeLease?: LocalDataWriteLease;
}

export async function configuredGlucoseSources(
  history: SqliteGlucoseHistoryStore | undefined = undefined,
  options: ConfiguredGlucoseRefreshOptions = {},
): Promise<GlucoseSource[]> {
  const writeLease =
    options.writeLease ?? (await acquireLocalDataWriteLease());
  const scopedHistory =
    history?.withWriteLease(writeLease) ??
    new SqliteGlucoseHistoryStore(writeLease);
  const [libre, nightscout, xdrip, dexcomShare, medtrum] =
    await Promise.all([
      loadOwnedLibreLinkUpConnection(writeLease),
      loadOwnedNightscoutConnection(writeLease),
      loadOwnedXdripConnection(writeLease),
      loadOwnedDexcomShareConnection(writeLease),
      loadOwnedMedtrumConnection(writeLease),
    ]);
  const notification = new NotificationGlucoseSource(scopedHistory);
  const notificationConfigured = await notification
    .isConfigured()
    .catch(() => false);
  const sources: GlucoseSource[] = notificationConfigured
    ? [notification]
    : [];
  const credentials = libre.values.credentials;
  if (credentials && libre.sourceWriteLease) {
    const sourceHistory = scopedHistory.withSourceWriteLease(
      libre.sourceWriteLease,
    );
    sources.push(
      new DirectLibreLinkUpSource(credentials, sourceHistory, {
        refreshReason: options.reason,
        signal: options.signal,
        writeLease,
        sourceWriteLease: libre.sourceWriteLease,
      }),
    );
  }
  const nightscoutConnection = nightscout.values.connection;
  if (nightscoutConnection && nightscout.sourceWriteLease) {
    const sourceHistory = scopedHistory.withSourceWriteLease(
      nightscout.sourceWriteLease,
    );
    // This path is deliberately limited to current glucose. Treatment/profile
    // history has its own foreground-only due scheduler below.
    sources.push(
      new NightscoutGlucoseSource(
        nightscoutConnection,
        sourceHistory,
        fetch,
        Date.now,
        undefined,
        undefined,
        undefined,
        writeLease,
        nightscout.sourceWriteLease,
      ),
    );
  }
  const xdripConnection = xdrip.values.connection;
  if (xdripConnection && xdrip.sourceWriteLease) {
    sources.push(
      new XdripGlucoseSource(
        xdripConnection,
        scopedHistory.withSourceWriteLease(xdrip.sourceWriteLease),
      ),
    );
  }
  const dexcomConnection = dexcomShare.values.connection;
  if (dexcomConnection && dexcomShare.sourceWriteLease) {
    sources.push(
      new DexcomShareGlucoseSource(
        dexcomConnection,
        scopedHistory.withSourceWriteLease(dexcomShare.sourceWriteLease),
      ),
    );
  }
  const medtrumConnection = medtrum.values.connection;
  if (
    medtrumConnection?.patientId &&
    medtrum.sourceWriteLease
  ) {
    sources.push(
      new MedtrumGlucoseSource(
        medtrumConnection,
        scopedHistory.withSourceWriteLease(medtrum.sourceWriteLease),
      ),
    );
  }
  return sources;
}

export async function refreshConfiguredGlucoseSources(
  history: SqliteGlucoseHistoryStore | undefined = undefined,
  options: ConfiguredGlucoseRefreshOptions = {},
) {
  const sources = await configuredGlucoseSources(history, options);
  const settled = await refreshGlucoseSources(sources);
  // A source reconfigured or disconnected while this owner was on the
  // network is no longer part of this refresh. Its typed lease rejection is a
  // benign cancellation, not a source outage to show or audit as a failure.
  const results = omitSupersededSourceRefreshes(settled);
  const successful = results.some((result) => result.status === 'fulfilled');
  if (results.length > 0 && !successful) {
    const failure = results.find(
      (result) => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }
  return results as GlucoseSourceRefreshResult[];
}

export async function syncConfiguredNightscoutHistoryIfDue(
  history: SqliteGlucoseHistoryStore | undefined = undefined,
) {
  const writeLease = await acquireLocalDataWriteLease();
  const scopedHistory =
    history?.withWriteLease(writeLease) ??
    new SqliteGlucoseHistoryStore(writeLease);
  const owned = await loadOwnedNightscoutConnection(writeLease);
  const connection = owned.values.connection;
  if (!connection || !owned.sourceWriteLease) return undefined;
  const sourceHistory = scopedHistory.withSourceWriteLease(
    owned.sourceWriteLease,
  );
  return syncNightscoutHistoryIfDue(
    new NightscoutGlucoseSource(
      connection,
      sourceHistory,
      fetch,
      Date.now,
      new NightscoutTreatmentImporter(
        connection,
        new SqliteHealthRecordStore(writeLease).withSourceWriteLease(
          owned.sourceWriteLease,
        ),
      ),
      undefined,
      undefined,
      writeLease,
      owned.sourceWriteLease,
    ),
    Date.now(),
    owned.sourceWriteLease,
  );
}
