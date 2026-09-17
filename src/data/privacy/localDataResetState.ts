import T1ArcGlucoseDisplay from '../../../modules/t1arc-glucose-display';
import T1ArcGlookoExport from '../../../modules/t1arc-glooko-export';
import T1ArcNotificationSource from '../../../modules/t1arc-notification-source';
import { loadDexcomShareConnection } from '@/data/dexcomShare/secureStore';
import { getGlookoReportInboxStatus } from '@/data/glooko/glookoReportInbox';
import { loadGlookoSyncState } from '@/data/glooko/glookoSyncState';
import { loadGlucoseAlertPreferences } from '@/data/glucoseAlerts/glucoseAlertPreferences';
import { loadHevyConnection } from '@/data/hevy/secureStore';
import { loadInsightReviewPreferences } from '@/data/insights/insightReviewPreferences';
import { loadLibreLinkUpCredentials } from '@/data/libreLinkUp/secureStore';
import { loadMedtrumConnection } from '@/data/medtrum/secureStore';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import { openT1ArcDatabase } from '@/data/persistence/t1arcDatabase';
import { getLocalDataSummary } from '@/data/privacy/localDataVault';
import { getTarvisStoredDataStatus } from '@/data/tarvis/secureStore';
import { loadXdripConnection } from '@/data/xdrip/secureStore';
import { LocalDataSummary } from '@/domain/localDataSummary';

export interface LocalDataResetState {
  summary: LocalDataSummary;
  hasResettableConfiguration: boolean;
}

async function hasSavedHealthConnectPreferences() {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<{ configured: number }>(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM health_connect_preferences
     ) THEN 1 ELSE 0 END AS configured`,
  );
  return row?.configured === 1;
}

/**
 * Loads the complete state used to decide whether the local erase action has
 * anything to remove. Errors deliberately propagate: an unavailable store is
 * an unknown state, not evidence that the device is empty.
 */
export async function getLocalDataResetState(): Promise<LocalDataResetState> {
  const [
    summary,
    libreLinkUp,
    nightscout,
    dexcomShare,
    medtrum,
    xdrip,
    hevy,
    glookoCredentials,
    glookoInbox,
    glookoSync,
    notificationSource,
    glucoseDisplay,
    glucoseAlerts,
    insightReview,
    healthConnectPreferences,
    tarvis,
  ] = await Promise.all([
    getLocalDataSummary(),
    loadLibreLinkUpCredentials(),
    loadNightscoutConnection(),
    loadDexcomShareConnection(),
    loadMedtrumConnection(),
    loadXdripConnection(),
    loadHevyConnection(),
    T1ArcGlookoExport.getCredentialStatusAsync(),
    getGlookoReportInboxStatus(),
    loadGlookoSyncState(),
    T1ArcNotificationSource.getStatusAsync(),
    T1ArcGlucoseDisplay.getStatusAsync(),
    loadGlucoseAlertPreferences(),
    loadInsightReviewPreferences(),
    hasSavedHealthConnectPreferences(),
    getTarvisStoredDataStatus(),
  ]);

  const hasGlookoConfiguration =
    glookoCredentials.configured ||
    glookoInbox.configured ||
    glookoSync.sessionStatus !== 'unknown' ||
    glookoSync.automaticEnabled ||
    Boolean(glookoSync.verifiedAccountFingerprint) ||
    Boolean(glookoSync.pendingExistingDataBinding) ||
    Boolean(glookoSync.historyBackfillBeforeDate) ||
    Boolean(glookoSync.historyBackfillTargetDate);
  const hasTarvisData =
    tarvis.hasApiKey || tarvis.hasUsage || tarvis.hasSafetyIdentifier;

  return {
    summary,
    hasResettableConfiguration: Boolean(
      libreLinkUp ||
      nightscout ||
      dexcomShare ||
      medtrum ||
      xdrip ||
      hevy ||
      hasGlookoConfiguration ||
      notificationSource.enabled ||
      notificationSource.rules.length > 0 ||
      notificationSource.pendingCount > 0 ||
      glucoseDisplay.enabled ||
      glucoseAlerts.enabled ||
      insightReview.weeklyNotificationEnabled ||
      healthConnectPreferences ||
      hasTarvisData,
    ),
  };
}
