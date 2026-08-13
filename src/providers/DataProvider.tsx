import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import DaymarkGlucoseDisplay from '../../modules/daymark-glucose-display';
import DaymarkGlookoExport from '../../modules/daymark-glooko-export';
import DaymarkNotificationSource from '../../modules/daymark-notification-source';
import { migrateBackgroundWorkerRegistration } from '@/data/background/backgroundTaskRegistration';
import {
  registerLibreBackgroundSync,
  unregisterLibreBackgroundSync,
} from '@/data/background/libreSyncTask';
import { updateGlookoBackgroundSyncRegistration } from '@/data/background/glookoSyncTask';
import { updateHealthConnectBackgroundSyncRegistration } from '@/data/background/healthConnectSyncTask';
import { updateInsightReviewBackgroundRegistration } from '@/data/background/insightReviewTask';
import {
  beginGlookoCredentialChange,
  beginGlookoDataChange,
  GlookoSyncOutcome,
  syncGlookoHistoryRange,
  syncGlookoIfDue,
  syncGlookoManually,
  syncGlookoSilentlyNow,
  verifyGlookoCredentials,
} from '@/data/glooko/glookoSync';
import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GLOOKO_FOREGROUND_CHECK_INTERVAL_MS,
  GlookoSyncState,
  glookoFailureDisposition,
  planAutomaticGlookoSync,
} from '@/data/glooko/glookoSyncPolicy';
import {
  assertManualGlookoImportIntegrity,
  GlookoManualImportAttestation,
} from '@/data/glooko/glookoImportIntegrity';
import {
  hasImportedGlookoData,
  loadGlookoSyncState,
  updateGlookoSyncState,
} from '@/data/glooko/glookoSyncState';
import {
  getLatestGlookoReport,
  saveGlookoReport,
  StoredGlookoReport,
} from '@/data/glooko/glookoReportRepository';
import { PumpTrackIntervalInput } from '@/data/glooko/glookoReport';
import {
  GlookoReportSyncOutcome,
  syncGlookoReportIfDue,
  syncGlookoReportNow,
} from '@/data/glooko/glookoReportSync';
import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GlookoReportSyncState,
  planAutomaticGlookoReportSync,
} from '@/data/glooko/glookoReportSyncPolicy';
import {
  loadGlookoReportSyncState,
  saveGlookoReportSyncState,
} from '@/data/glooko/glookoReportSyncState';
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  loadGlucoseAlertPreferences,
  resetGlucoseAlertState,
  saveGlucoseAlertPreferences,
} from '@/data/glucoseAlerts/glucoseAlertPreferences';
import {
  getHealthConnectDataBounds,
  syncHealthConnectIfDue,
} from '@/data/healthConnect/healthConnectRepository';
import { generateInsightReviewIfDue } from '@/data/insights/insightReviewGenerator';
import { clearSavedInsightReports } from '@/data/insights/insightReportRepository';
import { setWeeklyReviewNotificationEnabled } from '@/data/insights/insightReviewPreferences';
import { DiabetesRepository } from '@/data/contracts';
import { createDemoRepository } from '@/data/demoRepository';
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from '@/data/import/glookoImport';
import { DEXCOM_CLARITY_SOURCE_ID } from '@/data/import/dexcomClarityCsv';
import { PreparedDexcomClarityImport } from '@/data/import/dexcomClarityImport';
import {
  clearDexcomGlucoseHistory,
  writeDexcomGlucoseHistory,
} from '@/data/import/dexcomGlucoseImport';
import {
  clearGlookoGlucoseHistory,
  writeGlookoGlucoseHistory,
} from '@/data/import/glookoGlucoseImport';
import {
  saveFoodLog as persistFoodLog,
  updateFoodLog as persistFoodLogUpdate,
  updateFoodLogPortions as persistFoodLogPortions,
} from '@/data/food/foodLogRepository';
import { FoodLog, FoodLogDraft } from '@/data/food/types';
import {
  DataMode,
  clearLibreLinkUpCredentials,
  loadLibreLinkUpCredentials,
  saveDataMode,
} from '@/data/libreLinkUp/secureStore';
import {
  eraseLocalHealthData,
} from '@/data/privacy/localDataVault';
import { persistVerifiedLibreSnapshot } from '@/data/libreLinkUp/activateSnapshot';
import { LibreLinkUpSnapshot } from '@/data/libreLinkUp/types';
import { createLiveRepository } from '@/data/live/createLiveRepository';
import { glucoseReadingChanged } from '@/data/live/glucoseSourceRefresh';
import { syncConfiguredNightscoutHistoryIfDue } from '@/data/live/configuredGlucoseSources';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import {
  NIGHTSCOUT_HISTORY_BLOCK_MS,
  NightscoutHistoryState,
} from '@/data/nightscout/historyBackfill';
import {
  clearNightscoutHistoryState,
  loadNightscoutHistoryState,
  saveNightscoutHistoryState,
} from '@/data/nightscout/historyStateStore';
import { syncNightscoutHistoryIfDue } from '@/data/nightscout/historySync';
import {
  clearNightscoutConnection,
  loadNightscoutConnection,
  saveNightscoutConnection,
} from '@/data/nightscout/secureStore';
import {
  NIGHTSCOUT_SOURCE_ID,
  NightscoutConnection,
} from '@/data/nightscout/types';
import {
  createManualContextEvent,
  ManualContextDraft,
  reviseManualContextEvent,
} from '@/data/manualContext';
import {
  ImportedSourceDeleteResult,
  ImportWriteResult,
  StoredImportSourceSummary,
} from '@/data/persistence/HealthRecordStore';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import {
  clearXdripConnection,
  loadXdripConnection,
  saveXdripConnection,
} from '@/data/xdrip/secureStore';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import { XdripConnection } from '@/data/xdrip/types';
import { GlucoseReading, HealthContextEvent } from '@/domain/models';
import { LocalDataSummary } from '@/domain/localDataSummary';
import { DateKey, addDays, toDateKey } from '@/domain/time';

interface DataContextValue {
  repository?: DiabetesRepository;
  now: number;
  today: DateKey;
  earliestDate: DateKey;
  dataMode: DataMode;
  demoMode: boolean;
  ready: boolean;
  syncing: boolean;
  revision: number;
  sourceError?: string;
  backgroundSyncAvailable: boolean;
  glookoSyncState: GlookoSyncState;
  glookoSyncing: boolean;
  glookoReportSyncState: GlookoReportSyncState;
  glookoReportSyncing: boolean;
  glookoBackgroundSyncAvailable: boolean;
  refreshData(): Promise<void>;
  reloadSources(): Promise<void>;
  setDataMode(mode: DataMode): Promise<void>;
  activateLibreSnapshot(snapshot: LibreLinkUpSnapshot): Promise<void>;
  connectNightscout(
    connection: NightscoutConnection,
  ): Promise<GlucoseReading>;
  disconnectNightscout(): Promise<void>;
  connectXdrip(connection: XdripConnection): Promise<GlucoseReading>;
  disconnectXdrip(): Promise<void>;
  setNightscoutHistoryTarget(
    targetDate: DateKey | undefined,
  ): Promise<NightscoutHistoryState>;
  importGlookoData(
    prepared: PreparedGlookoImport,
    attestation?: GlookoManualImportAttestation,
  ): Promise<ImportWriteResult>;
  importGlookoReport(
    fileName: string,
    bytes: Uint8Array,
    extractedText: string,
    pumpTrackIntervals?: PumpTrackIntervalInput[],
  ): Promise<StoredGlookoReport>;
  getLatestGlookoReport(): Promise<StoredGlookoReport | undefined>;
  importDexcomData(
    prepared: PreparedDexcomClarityImport,
  ): Promise<ImportWriteResult>;
  getDexcomArchiveSummary(): Promise<StoredImportSourceSummary>;
  clearImportedDexcomData(): Promise<ImportedSourceDeleteResult>;
  syncGlooko(): Promise<GlookoSyncOutcome>;
  syncGlookoQuietly(): Promise<GlookoSyncOutcome>;
  syncGlookoReport(): Promise<GlookoReportSyncOutcome>;
  syncGlookoRange(
    startDate: DateKey,
    endDate: DateKey,
  ): Promise<GlookoSyncOutcome>;
  setGlookoAutomaticEnabled(enabled: boolean): Promise<GlookoSyncState>;
  setGlookoHistoryBackfillTarget(
    targetDate: DateKey | undefined,
    startBeforeDate?: DateKey,
  ): Promise<GlookoSyncState>;
  markGlookoCredentialsReady(
    credentialGeneration: number,
    legacyCredentialContinuity?: boolean,
  ): Promise<GlookoSyncOutcome>;
  beginGlookoCredentialSetup(): Promise<() => void>;
  markGlookoSessionForgotten(): Promise<GlookoSyncState>;
  hasSavedGlookoExport(): Promise<boolean>;
  getGlookoArchiveSummary(): Promise<StoredImportSourceSummary>;
  reprocessAllGlookoData(): Promise<GlookoReprocessAllResult>;
  clearImportedGlookoData(): Promise<ImportedSourceDeleteResult>;
  eraseAllLocalHealthData(): Promise<LocalDataSummary>;
  saveManualContext(
    draft: ManualContextDraft,
    existing?: HealthContextEvent,
  ): Promise<HealthContextEvent>;
  logFood(draft: FoodLogDraft): Promise<FoodLog>;
  updateFoodLog(log: FoodLog, draft: FoodLogDraft): Promise<FoodLog>;
  updateFoodPortions(
    log: FoodLog,
    amounts: Record<string, number>,
  ): Promise<FoodLog>;
  deleteManualContext(id: string): Promise<boolean>;
}

export interface GlookoReprocessAllResult {
  archivesProcessed: number;
  archivesFailed: number;
  insertedGlucose: number;
  insertedBasal: number;
  insertedBoluses: number;
  insertedContext: number;
  insertedDailyTotals: number;
  duplicateCount: number;
}

async function withGlookoDataCommit<T>(work: () => Promise<T>) {
  const barrier = beginGlookoDataChange();
  let commitToken: string | undefined;
  try {
    await barrier.ready;
    const commitLease = await DaymarkGlookoExport.beginDataCommitAsync();
    if (!commitLease.acquired) {
      throw new Error(
        'Glooko data is being removed. Wait a moment, then try the import again.',
      );
    }
    commitToken = commitLease.token;
    return await work();
  } finally {
    if (commitToken) {
      await DaymarkGlookoExport.endDataCommitAsync(commitToken).catch(
        () => false,
      );
    }
    barrier.release();
  }
}

interface RepositoryState {
  repository?: DiabetesRepository;
  mode: DataMode;
  ready: boolean;
  sourceError?: string;
  backgroundSyncAvailable: boolean;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: PropsWithChildren) {
  const [initialNow] = useState(() => Date.now());
  const [now, setNow] = useState(initialNow);
  const [earliestLiveDate, setEarliestLiveDate] = useState<DateKey>(() =>
    toDateKey(initialNow),
  );
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [glookoSyncing, setGlookoSyncing] = useState(false);
  const [glookoSyncState, setGlookoSyncState] = useState<GlookoSyncState>(
    DEFAULT_GLOOKO_SYNC_STATE,
  );
  const [glookoReportSyncState, setGlookoReportSyncState] =
    useState<GlookoReportSyncState>(DEFAULT_GLOOKO_REPORT_SYNC_STATE);
  const [glookoReportSyncing, setGlookoReportSyncing] = useState(false);
  const [glookoBackgroundSyncAvailable, setGlookoBackgroundSyncAvailable] =
    useState(false);
  const syncInFlight = useRef(false);
  const automaticGlookoInFlight = useRef(false);
  const healthRecordStore = useRef(new SqliteHealthRecordStore());
  const glucoseHistoryStore = useRef(new SqliteGlucoseHistoryStore());
  const [repositoryState, setRepositoryState] = useState<RepositoryState>({
    mode: 'live',
    ready: false,
    backgroundSyncAvailable: false,
  });
  const configurationId = useRef(0);

  const refreshEarliestLiveDate = useCallback(async () => {
    const [glucose, insulin, context, healthConnect] = await Promise.all([
      glucoseHistoryStore.current.getBounds(),
      healthRecordStore.current.getInsulinBounds(),
      healthRecordStore.current.getContextBounds(),
      getHealthConnectDataBounds(),
    ]);
    const candidates = [
      glucose.earliest,
      insulin.earliest,
      context.earliest,
      healthConnect.earliest,
    ].filter((value): value is number => value !== undefined);
    setEarliestLiveDate(
      candidates.length ? toDateKey(Math.min(...candidates)) : toDateKey(Date.now()),
    );
  }, []);

  const configure = useCallback(
    async (requestedMode?: DataMode) => {
      const id = ++configurationId.current;
      try {
        await openDaymarkDatabase();
        await migrateBackgroundWorkerRegistration().catch(
          () => false,
        );
        const [
          credentials,
          nightscout,
          xdrip,
          storedGlookoState,
          storedGlookoReportState,
        ] = await Promise.all([
          loadLibreLinkUpCredentials(),
          loadNightscoutConnection(),
          loadXdripConnection(),
          loadGlookoSyncState(),
          loadGlookoReportSyncState(),
        ]);
        setGlookoSyncState(storedGlookoState);
        setGlookoReportSyncState(storedGlookoReportState);
        // Demo data remains available to development/tests through an explicit
        // request, but production launches always open the private local store.
        const preferredMode = requestedMode ?? 'live';
        const mode: DataMode = preferredMode;
        const repository =
          mode === 'live'
            ? createLiveRepository(credentials, nightscout, xdrip)
            : createDemoRepository(initialNow);

        await saveDataMode(mode);
        let backgroundSyncAvailable = false;
        if (mode === 'live') {
          backgroundSyncAvailable = await registerLibreBackgroundSync();
        } else {
          await unregisterLibreBackgroundSync();
        }
        const glookoBackgroundAvailable =
          await updateGlookoBackgroundSyncRegistration().catch(() => false);
        if (mode === 'live') {
          await updateHealthConnectBackgroundSyncRegistration().catch(
            () => false,
          );
        }
        await updateInsightReviewBackgroundRegistration(
          mode === 'live',
        ).catch(() => false);

        if (id !== configurationId.current) return;
        if (mode === 'live') await refreshEarliestLiveDate();
        if (id !== configurationId.current) return;
        setRepositoryState({
          repository,
          mode,
          ready: true,
          backgroundSyncAvailable,
        });
        setGlookoBackgroundSyncAvailable(glookoBackgroundAvailable);
        setRevision((value) => value + 1);
      } catch (error) {
        if (id !== configurationId.current) return;
        setRepositoryState({
          repository: createLiveRepository(),
          mode: 'live',
          ready: true,
          sourceError:
            error instanceof Error
              ? error.message
              : 'Unable to initialise data sources.',
          backgroundSyncAvailable: false,
        });
      }
    },
    [initialNow, refreshEarliestLiveDate],
  );

  useEffect(() => {
    void configure();
  }, [configure]);

  const performRefresh = useCallback(async (
    visible: boolean,
    includeHealthConnect = true,
  ) => {
    const repository = repositoryState.repository;
    if (!repository || syncInFlight.current) return;
    syncInFlight.current = true;
    if (visible) setSyncing(true);
    let shouldInvalidate = visible;
    const beforeReading =
      repositoryState.mode === 'live'
        ? await glucoseHistoryStore.current
            .getLatestReading()
            .catch(() => undefined)
        : undefined;
    try {
      const [repositoryRefresh, healthConnectRefresh] =
        await Promise.allSettled([
        repository.refresh(),
        repositoryState.mode === 'live' && includeHealthConnect
          ? syncHealthConnectIfDue()
          : Promise.resolve(undefined),
        repositoryState.mode === 'live'
          ? generateInsightReviewIfDue()
          : Promise.resolve(undefined),
        repositoryState.mode === 'live'
          ? syncConfiguredNightscoutHistoryIfDue(
              glucoseHistoryStore.current,
            )
          : Promise.resolve(undefined),
      ]);
      if (repositoryRefresh.status === 'rejected') {
        throw repositoryRefresh.reason;
      }
      const afterReading =
        repositoryState.mode === 'live'
          ? await glucoseHistoryStore.current
              .getLatestReading()
              .catch(() => undefined)
          : undefined;
      const glucoseChanged = glucoseReadingChanged(
        beforeReading,
        afterReading,
      );
      const healthConnectRan =
        healthConnectRefresh.status === 'fulfilled' &&
        healthConnectRefresh.value !== undefined;
      shouldInvalidate =
        shouldInvalidate || glucoseChanged || healthConnectRan;
      setRepositoryState((state) => ({ ...state, sourceError: undefined }));
    } catch (error) {
      setRepositoryState((state) => ({
        ...state,
        sourceError:
          error instanceof Error ? error.message : 'Unable to refresh data.',
      }));
    } finally {
      if (repositoryState.mode === 'live' && shouldInvalidate) {
        await refreshEarliestLiveDate();
        await updateGlucoseDisplayFromHistory().catch(() => undefined);
      }
      if (shouldInvalidate) {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      syncInFlight.current = false;
      if (visible) setSyncing(false);
    }
  }, [
    refreshEarliestLiveDate,
    repositoryState.mode,
    repositoryState.repository,
  ]);

  const refreshData = useCallback(
    () => performRefresh(true, true),
    [performRefresh],
  );
  const refreshSilently = useCallback(
    () => performRefresh(false, true),
    [performRefresh],
  );
  const refreshGlucoseSilently = useCallback(
    () => performRefresh(false, false),
    [performRefresh],
  );

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const clockInterval = setInterval(updateClock, 30_000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    if (!repositoryState.ready || !repositoryState.repository) return;
    // Let initial SQLite reads paint the app before a potentially large
    // Health Connect import starts writing to the same on-device database.
    void refreshGlucoseSilently();
    const initialHealthRefresh = setTimeout(() => {
      void refreshSilently();
    }, 8_000);
    // The source itself applies its adaptive one-minute/15-second policy.
    // This tick lets it react promptly when a new Libre reading is expected.
    const refreshInterval = setInterval(() => {
      void refreshSilently();
    }, 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshSilently();
    });
    return () => {
      clearTimeout(initialHealthRefresh);
      clearInterval(refreshInterval);
      subscription.remove();
    };
  }, [
    refreshGlucoseSilently,
    refreshSilently,
    repositoryState.ready,
    repositoryState.repository,
  ]);

  const reloadSources = useCallback(
    async () => {
      if (repositoryState.mode === 'live') {
        await generateInsightReviewIfDue(Date.now(), 0).catch(
          () => undefined,
        );
      }
      await configure(repositoryState.mode);
    },
    [configure, repositoryState.mode],
  );

  const changeDataMode = useCallback(
    async (mode: DataMode) => {
      setRepositoryState((state) => ({ ...state, ready: false }));
      await saveDataMode(mode);
      await configure(mode);
    },
    [configure],
  );

  const activateLibreSnapshot = useCallback(
    async (snapshot: LibreLinkUpSnapshot) => {
      const store = glucoseHistoryStore.current;
      const activatedAt = Date.now();
      await persistVerifiedLibreSnapshot(store, snapshot, activatedAt);
      await updateGlucoseDisplayFromHistory().catch(() => undefined);
      await refreshEarliestLiveDate();
      await changeDataMode('live');
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const connectNightscout = useCallback(
    async (connection: NightscoutConnection) => {
      const [existing, existingHistory] = await Promise.all([
        loadNightscoutConnection(),
        loadNightscoutHistoryState(),
      ]);
      if (
        (!existing &&
          (existingHistory.cursorBeforeMs !== undefined ||
            existingHistory.targetDate !== undefined)) ||
        (existing &&
          (existing.baseUrl !== connection.baseUrl ||
            existing.accessToken !== connection.accessToken))
      ) {
        await clearNightscoutHistoryState();
      }
      const source = new NightscoutGlucoseSource(
        connection,
        glucoseHistoryStore.current,
        fetch,
        Date.now,
        new NightscoutTreatmentImporter(
          connection,
          healthRecordStore.current,
        ),
      );
      const latest = await source.importInitialHistory();
      if (!latest) {
        throw new Error(
          'Nightscout connected, but it did not return a glucose reading.',
        );
      }
      await saveNightscoutConnection(connection);
      await refreshEarliestLiveDate();
      await changeDataMode('live');
      await updateGlucoseDisplayFromHistory().catch(() => undefined);
      return latest;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectNightscout = useCallback(async () => {
    await Promise.all([
      clearNightscoutConnection(),
      clearNightscoutHistoryState(),
    ]);
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const connectXdrip = useCallback(
    async (connection: XdripConnection) => {
      const source = new XdripGlucoseSource(
        connection,
        glucoseHistoryStore.current,
      );
      await source.refresh();
      const latest = await source.getLatestReading();
      if (!latest) {
        throw new Error(
          'The xDrip endpoint connected, but it did not return a glucose reading.',
        );
      }
      await saveXdripConnection(connection);
      await refreshEarliestLiveDate();
      await changeDataMode('live');
      await updateGlucoseDisplayFromHistory().catch(() => undefined);
      return latest;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectXdrip = useCallback(async () => {
    await clearXdripConnection();
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const setNightscoutHistoryTarget = useCallback(
    async (targetDate: DateKey | undefined) => {
      const current = await loadNightscoutHistoryState();
      if (!targetDate) {
        const paused = {
          ...current,
          targetDate: undefined,
          completedAt: undefined,
          lastError: undefined,
        };
        await saveNightscoutHistoryState(paused);
        setRevision((value) => value + 1);
        return paused;
      }
      if (targetDate > toDateKey(Date.now()) || targetDate < '2000-01-01') {
        throw new Error('Choose a Nightscout history date between 2000 and today.');
      }
      const connection = await loadNightscoutConnection();
      if (!connection) {
        throw new Error('Connect Nightscout before building its history.');
      }
      const now = Date.now();
      const bounds = await glucoseHistoryStore.current.getBounds(
        NIGHTSCOUT_SOURCE_ID,
      );
      const initialBoundary = now - NIGHTSCOUT_HISTORY_BLOCK_MS;
      const continuousCursor = Math.min(
        current.cursorBeforeMs ?? initialBoundary,
        bounds.earliest ?? initialBoundary,
        initialBoundary,
      );
      const started: NightscoutHistoryState = {
        ...current,
        targetDate,
        cursorBeforeMs: continuousCursor,
        lastAttemptAt: undefined,
        completedAt: undefined,
        lastError: undefined,
      };
      await saveNightscoutHistoryState(started);
      const source = new NightscoutGlucoseSource(
        connection,
        glucoseHistoryStore.current,
        fetch,
        Date.now,
        new NightscoutTreatmentImporter(
          connection,
          healthRecordStore.current,
        ),
      );
      const result = await syncNightscoutHistoryIfDue(source, now);
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
      return result;
    },
    [refreshEarliestLiveDate],
  );

  const importGlookoData = useCallback(
    async (
      prepared: PreparedGlookoImport,
      attestation?: GlookoManualImportAttestation,
    ) => {
      assertManualGlookoImportIntegrity(prepared, attestation);

      return withGlookoDataCommit(async () => {
        const before = await loadGlookoSyncState();
        const healthResult = await healthRecordStore.current.writeImport(
          prepared.batch,
          prepared.preview.basal,
          prepared.preview.boluses,
          prepared.preview.context,
          prepared.sourcePayload,
          prepared.preview.dailyInsulinTotals,
          prepared.preview.rawRecords,
        );
        const insertedGlucose = await writeGlookoGlucoseHistory(
          glucoseHistoryStore.current,
          prepared.preview.glucose,
        );
        const result = {
          ...healthResult,
          insertedGlucose,
          duplicateCount:
            healthResult.duplicateCount +
            Math.max(0, prepared.preview.glucose.length - insertedGlucose),
        };
        if (
          before.verifiedAccountFingerprint === undefined &&
          (await hasImportedGlookoData())
        ) {
          const unbound = await updateGlookoSyncState((current) => ({
            ...current,
            automaticEnabled: false,
            nextEligibleAt: undefined,
            lastErrorCode: 'unbound-existing-data',
            lastErrorMessage:
              'Manual Glooko data is not bound to a verified automatic sign-in. Remove it before connecting another account.',
          }));
          setGlookoSyncState(unbound);
          const available =
            await updateGlookoBackgroundSyncRegistration().catch(
              () => false,
            );
          setGlookoBackgroundSyncAvailable(available);
        }
        await generateInsightReviewIfDue(Date.now(), 0).catch(
          () => undefined,
        );
        await refreshEarliestLiveDate();
        if (repositoryState.mode === 'demo') {
          await changeDataMode('live');
        } else {
          setNow(Date.now());
          setRevision((value) => value + 1);
        }
        return result;
      });
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const importGlookoReport = useCallback(
    async (
      fileName: string,
      bytes: Uint8Array,
      extractedText: string,
      pumpTrackIntervals: PumpTrackIntervalInput[] = [],
    ) => {
      const result = await saveGlookoReport(
        fileName,
        bytes,
        extractedText,
        pumpTrackIntervals,
      );
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      setNow(Date.now());
      setRevision((value) => value + 1);
      return result.report;
    },
    [],
  );

  const importDexcomData = useCallback(
    async (prepared: PreparedDexcomClarityImport) => {
      const healthResult = await healthRecordStore.current.writeImport(
        prepared.batch,
        [],
        [],
        [],
        prepared.sourcePayload,
      );
      const insertedGlucose = await writeDexcomGlucoseHistory(
        glucoseHistoryStore.current,
        prepared.preview.glucose,
      );
      const result = {
        ...healthResult,
        insertedGlucose,
        duplicateCount:
          healthResult.duplicateCount +
          Math.max(0, prepared.preview.glucose.length - insertedGlucose),
      };
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      if (repositoryState.mode === 'demo') {
        await changeDataMode('live');
      } else {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return result;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const getDexcomArchiveSummary = useCallback(
    () =>
      healthRecordStore.current.getImportSourceSummary(
        DEXCOM_CLARITY_SOURCE_ID,
      ),
    [],
  );

  const completeGlookoOutcome = useCallback(
    async (
      outcome: GlookoSyncOutcome,
      showPersonalData = false,
    ) => {
      setGlookoSyncState(outcome.syncState);
      if (outcome.status === 'success') {
        await generateInsightReviewIfDue(Date.now(), 0).catch(
          () => undefined,
        );
        await refreshEarliestLiveDate();
        if (showPersonalData && repositoryState.mode === 'demo') {
          await changeDataMode('live');
        } else {
          setNow(Date.now());
          setRevision((value) => value + 1);
        }
      }
      const available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);
      return outcome;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const syncGlooko = useCallback(async () => {
    setGlookoSyncing(true);
    try {
      return await completeGlookoOutcome(
        await syncGlookoManually(90),
        true,
      );
    } finally {
      setGlookoSyncing(false);
    }
  }, [completeGlookoOutcome]);

  const syncGlookoQuietly = useCallback(async () => {
    setGlookoSyncing(true);
    try {
      return await completeGlookoOutcome(
        await syncGlookoSilentlyNow(14),
        true,
      );
    } finally {
      setGlookoSyncing(false);
    }
  }, [completeGlookoOutcome]);

  const completeGlookoReportOutcome = useCallback(
    async (outcome: GlookoReportSyncOutcome) => {
      setGlookoReportSyncState(outcome.syncState);
      if (outcome.status === 'success') {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return outcome;
    },
    [],
  );

  const syncGlookoReport = useCallback(async () => {
    setGlookoReportSyncing(true);
    try {
      return await completeGlookoReportOutcome(
        await syncGlookoReportNow('manual'),
      );
    } finally {
      setGlookoReportSyncing(false);
    }
  }, [completeGlookoReportOutcome]);

  const syncGlookoRange = useCallback(
    async (startDate: DateKey, endDate: DateKey) => {
      setGlookoSyncing(true);
      try {
        return await completeGlookoOutcome(
          await syncGlookoHistoryRange(startDate, endDate),
          true,
        );
      } finally {
        setGlookoSyncing(false);
      }
    },
    [completeGlookoOutcome],
  );

  const runAutomaticGlookoSync = useCallback(async () => {
    if (automaticGlookoInFlight.current) return;
    automaticGlookoInFlight.current = true;
    try {
      const [current, currentReport] = await Promise.all([
        loadGlookoSyncState(),
        loadGlookoReportSyncState(),
      ]);
      const csvDue = planAutomaticGlookoSync(current).due;
      const reportDue = planAutomaticGlookoReportSync(
        currentReport,
        current,
      ).due;
      if (!csvDue && !reportDue) {
        // A background worker may have completed since React last rendered.
        // Refresh the audit state without flashing a loading indicator.
        setGlookoSyncState(current);
        setGlookoReportSyncState(currentReport);
        return;
      }
      if (csvDue) {
        setGlookoSyncing(true);
        await completeGlookoOutcome(await syncGlookoIfDue('app-open'));
      }
      if (reportDue) {
        setGlookoReportSyncing(true);
        await completeGlookoReportOutcome(
          await syncGlookoReportIfDue('app-open'),
        );
      }
    } finally {
      automaticGlookoInFlight.current = false;
      setGlookoSyncing(false);
      setGlookoReportSyncing(false);
    }
  }, [completeGlookoOutcome, completeGlookoReportOutcome]);

  useEffect(() => {
    if (!repositoryState.ready) return;
    void runAutomaticGlookoSync();
    const foregroundInterval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void runAutomaticGlookoSync();
      }
    }, GLOOKO_FOREGROUND_CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runAutomaticGlookoSync();
    });
    return () => {
      clearInterval(foregroundInterval);
      subscription.remove();
    };
  }, [repositoryState.ready, runAutomaticGlookoSync]);

  const setGlookoAutomaticEnabled = useCallback(async (enabled: boolean) => {
    const next = await updateGlookoSyncState((current) => {
      const canEnable =
        glookoFailureDisposition(current.lastErrorCode) !== 'action-required';
      const automaticEnabled = enabled && canEnable;
      return {
        ...current,
        automaticEnabled,
        nextEligibleAt: automaticEnabled ? undefined : current.nextEligibleAt,
      };
    });
    setGlookoSyncState(next);
    const available =
      await updateGlookoBackgroundSyncRegistration().catch(() => false);
    setGlookoBackgroundSyncAvailable(available);
    if (next.automaticEnabled) {
      void runAutomaticGlookoSync();
    } else {
      await DaymarkGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
        () => false,
      );
    }
    return next;
  }, [runAutomaticGlookoSync]);

  const setGlookoHistoryBackfillTarget = useCallback(
    async (
      targetDate: DateKey | undefined,
      startBeforeDate?: DateKey,
    ) => {
      const next = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled:
          targetDate === undefined
            ? current.automaticEnabled
            : glookoFailureDisposition(current.lastErrorCode) !==
              'action-required',
        historyBackfillTargetDate: targetDate,
        historyBackfillBeforeDate:
          current.historyBackfillBeforeDate ?? startBeforeDate,
        lastHistoryBackfillAt:
          targetDate === undefined
            ? current.lastHistoryBackfillAt
            : undefined,
        nextEligibleAt: targetDate === undefined
          ? current.nextEligibleAt
          : undefined,
      }));
      setGlookoSyncState(next);
      const available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);
      if (targetDate !== undefined && next.automaticEnabled) {
        void runAutomaticGlookoSync();
      }
      return next;
    },
    [runAutomaticGlookoSync],
  );

  const markGlookoSessionForgotten = useCallback(async () => {
    const next = await updateGlookoSyncState((current) => ({
      ...current,
      automaticEnabled: false,
      sessionStatus: 'needs-sign-in',
      pendingLegacyCredentialContinuity: undefined,
      nextEligibleAt: undefined,
      lastErrorCode: 'session-required',
      lastErrorMessage: 'Sign into Glooko again to resume automatic refresh.',
    }));
    await DaymarkGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
      () => false,
    );
    setGlookoSyncState(next);
    const available = await updateGlookoBackgroundSyncRegistration().catch(
      () => false,
    );
    setGlookoBackgroundSyncAvailable(available);
    return next;
  }, []);

  const beginGlookoCredentialSetup = useCallback(async () => {
    const barrier = beginGlookoCredentialChange();
    await barrier.ready;
    return barrier.release;
  }, []);

  const markGlookoCredentialsReady = useCallback(
    async (
      credentialGeneration: number,
      legacyCredentialContinuity = false,
    ) => {
      const verification = verifyGlookoCredentials(
        credentialGeneration,
        async () => {
          const pending = await updateGlookoSyncState((current) => ({
            ...current,
            automaticEnabled: false,
            sessionStatus: 'pending-verification',
            pendingLegacyCredentialContinuity:
              legacyCredentialContinuity,
            nextEligibleAt: undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
          }));
          setGlookoSyncState(pending);
        },
        14,
        legacyCredentialContinuity,
      );
      // The fresh reservation above happens synchronously. This optimistic
      // state is UI-only while the queued verifier persists the same state.
      setGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        sessionStatus: 'pending-verification',
        pendingLegacyCredentialContinuity: legacyCredentialContinuity,
        nextEligibleAt: undefined,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      }));

      setGlookoSyncing(true);
      let outcome: GlookoSyncOutcome;
      try {
        outcome = await completeGlookoOutcome(await verification, true);
      } finally {
        setGlookoSyncing(false);
      }
      if (outcome.status === 'success') {
        await DaymarkGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
          () => false,
        );
        const reportNext = await loadGlookoReportSyncState();
        const reportReady = {
          ...reportNext,
          nextEligibleAt: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
        };
        await saveGlookoReportSyncState(reportReady);
        setGlookoReportSyncState(reportReady);
      }
      return outcome;
    },
    [completeGlookoOutcome],
  );

  const hasSavedGlookoExport = useCallback(
    () =>
      healthRecordStore.current.hasImportSourcePayload('glooko-export'),
    [],
  );

  const getGlookoArchiveSummary = useCallback(
    () =>
      healthRecordStore.current.getImportSourceSummary('glooko-export'),
    [],
  );

  const reprocessAllGlookoData = useCallback(async () => {
    return withGlookoDataCommit(async () => {
      const references =
        await healthRecordStore.current.getImportSourcePayloadReferences(
          'glooko-export',
        );
      if (!references.length) {
        throw new Error('There is no saved Glooko export to reprocess yet.');
      }
      const result: GlookoReprocessAllResult = {
        archivesProcessed: 0,
        archivesFailed: 0,
        insertedGlucose: 0,
        insertedBasal: 0,
        insertedBoluses: 0,
        insertedContext: 0,
        insertedDailyTotals: 0,
        duplicateCount: 0,
      };
      for (const reference of references) {
        const retained =
          await healthRecordStore.current.getImportSourcePayload(
            reference.batchId,
          );
        if (!retained) {
          result.archivesFailed += 1;
          continue;
        }
        try {
          const next = await prepareGlookoImport(
            retained.batch.fileName,
            retained.payload.bytes,
            retained.batch.importedAt,
          );
          if (next.preview.unsafeTimestampLocale) {
            throw new Error('Unsafe Glooko timestamp locale.');
          }
          const healthResult = await healthRecordStore.current.writeImport(
            next.batch,
            next.preview.basal,
            next.preview.boluses,
            next.preview.context,
            undefined,
            next.preview.dailyInsulinTotals,
            next.preview.rawRecords,
          );
          const insertedGlucose = await writeGlookoGlucoseHistory(
            glucoseHistoryStore.current,
            next.preview.glucose,
          );
          result.archivesProcessed += 1;
          result.insertedGlucose += insertedGlucose;
          result.insertedBasal += healthResult.insertedBasal;
          result.insertedBoluses += healthResult.insertedBoluses;
          result.insertedContext += healthResult.insertedContext;
          result.insertedDailyTotals += healthResult.insertedDailyTotals;
          result.duplicateCount +=
            healthResult.duplicateCount +
            Math.max(0, next.preview.glucose.length - insertedGlucose);
        } catch {
          // One damaged or obsolete snapshot must not prevent later snapshots
          // from being re-read. The exact encrypted bytes remain untouched.
          result.archivesFailed += 1;
        } finally {
          retained.payload.bytes.fill(0);
        }
      }
      if (!result.archivesProcessed) {
        throw new Error(
          'Saved Glooko exports could not be reprocessed. Their encrypted source copies were kept unchanged.',
        );
      }
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      if (repositoryState.mode === 'demo') {
        await changeDataMode('live');
      } else {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return result;
    });
  }, [changeDataMode, refreshEarliestLiveDate, repositoryState.mode]);

  const saveManualContext = useCallback(
    async (draft: ManualContextDraft, existing?: HealthContextEvent) => {
      const event = existing
        ? reviseManualContextEvent(existing, draft)
        : createManualContextEvent(draft);
      await healthRecordStore.current.saveManualContext(event);
      if (existing) {
        await clearSavedInsightReports();
      }
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      if (repositoryState.mode === 'demo') {
        await changeDataMode('live');
      } else {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return event;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const logFood = useCallback(
    async (draft: FoodLogDraft) => {
      const result = await persistFoodLog(draft);
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      if (repositoryState.mode === 'demo') {
        await changeDataMode('live');
      } else {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return result.log;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const updateFoodPortions = useCallback(
    async (log: FoodLog, amounts: Record<string, number>) => {
      const adjusted = await persistFoodLogPortions(log, amounts);
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      setNow(Date.now());
      setRevision((value) => value + 1);
      return adjusted;
    },
    [],
  );

  const updateFoodLog = useCallback(
    async (log: FoodLog, draft: FoodLogDraft) => {
      const adjusted = await persistFoodLogUpdate(log, draft);
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      if (repositoryState.mode === 'demo') {
        await changeDataMode('live');
      } else {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      return adjusted;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const clearImportedGlookoData = useCallback(async () => {
    const barrier = beginGlookoDataChange();
    let resetToken: string | undefined;
    try {
      // Stop future worker launches before waiting for any current work.
      let disabled = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        nextEligibleAt: undefined,
      }));
      setGlookoSyncState(disabled);
      let available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);

      await barrier.ready;
      // An invalidated predecessor may have completed a state write while it
      // was draining, so assert the disabled state once more before deletion.
      disabled = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        nextEligibleAt: undefined,
      }));
      setGlookoSyncState(disabled);
      available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);

      const resetLease = await DaymarkGlookoExport.beginDataResetAsync();
      if (!resetLease.acquired) {
        throw new Error(
          'A Glooko import is still finishing. Wait a moment, then remove the imported data again.',
        );
      }
      resetToken = resetLease.token;

      const [healthResult, glucose] = await Promise.all([
        healthRecordStore.current.clearImportedSource('glooko-export'),
        clearGlookoGlucoseHistory(glucoseHistoryStore.current),
      ]);
      const result = { ...healthResult, glucose };
      const next = await updateGlookoSyncState((current) => ({
        ...DEFAULT_GLOOKO_SYNC_STATE,
        sessionStatus: current.sessionStatus,
      }));
      setGlookoSyncState(next);
      await saveGlookoReportSyncState({
        ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
      });
      setGlookoReportSyncState({
        ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
      });

      const resetEnded = await DaymarkGlookoExport.endDataResetAsync(
        resetToken,
      );
      if (!resetEnded) {
        throw new Error('The protected Glooko data reset did not finish.');
      }
      resetToken = undefined;
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
      return result;
    } finally {
      if (resetToken) {
        await DaymarkGlookoExport.endDataResetAsync(resetToken).catch(
          () => false,
        );
      }
      barrier.release();
    }
  }, [refreshEarliestLiveDate]);

  const clearImportedDexcomData = useCallback(async () => {
    const [healthResult, glucose] = await Promise.all([
      healthRecordStore.current.clearImportedSource(
        DEXCOM_CLARITY_SOURCE_ID,
      ),
      clearDexcomGlucoseHistory(glucoseHistoryStore.current),
    ]);
    await clearSavedInsightReports();
    await generateInsightReviewIfDue(Date.now(), 0).catch(
      () => undefined,
    );
    await refreshEarliestLiveDate();
    setNow(Date.now());
    setRevision((value) => value + 1);
    return { ...healthResult, glucose };
  }, [refreshEarliestLiveDate]);

  const eraseAllLocalHealthData = useCallback(async () => {
    if (
      syncInFlight.current ||
      automaticGlookoInFlight.current ||
      glookoSyncing ||
      glookoReportSyncing
    ) {
      throw new Error(
        'Wait for the current source refresh to finish before erasing this device.',
      );
    }
    const barrier = beginGlookoDataChange();
    let resetToken: string | undefined;
    setSyncing(true);
    try {
      let disabled = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        nextEligibleAt: undefined,
      }));
      setGlookoSyncState(disabled);
      let available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);
      await barrier.ready;
      disabled = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        nextEligibleAt: undefined,
      }));
      setGlookoSyncState(disabled);
      available =
        await updateGlookoBackgroundSyncRegistration().catch(() => false);
      setGlookoBackgroundSyncAvailable(available);

      const alerts = await loadGlucoseAlertPreferences();
      await Promise.all([
        clearLibreLinkUpCredentials(),
        clearNightscoutConnection(),
        clearNightscoutHistoryState(),
        clearXdripConnection(),
        DaymarkGlucoseDisplay.disableAsync(),
        DaymarkGlucoseDisplay.updateMissingAsync(
          'No health data on this device',
        ),
        DaymarkGlookoExport.clearSessionAsync(),
        DaymarkNotificationSource.setConfigurationAsync({
          enabled: false,
          rules: [],
        }),
        DaymarkNotificationSource.clearPendingAsync(),
        saveGlucoseAlertPreferences({ ...alerts, enabled: false }),
        resetGlucoseAlertState(),
        setWeeklyReviewNotificationEnabled(false),
      ]);

      const resetLease = await DaymarkGlookoExport.beginDataResetAsync();
      if (!resetLease.acquired) {
        throw new Error(
          'A Glooko import is still finishing. Wait a moment, then erase this device again.',
        );
      }
      resetToken = resetLease.token;
      const removed = await eraseLocalHealthData();
      const resetEnded = await DaymarkGlookoExport.endDataResetAsync(
        resetToken,
      );
      if (!resetEnded) {
        throw new Error('The protected local-data erase did not finish.');
      }
      resetToken = undefined;
      setGlookoSyncState({ ...DEFAULT_GLOOKO_SYNC_STATE });
      setGlookoReportSyncState({
        ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
      });
      setEarliestLiveDate(toDateKey(Date.now()));
      await updateHealthConnectBackgroundSyncRegistration().catch(
        () => false,
      );
      await changeDataMode('demo');
      return removed;
    } finally {
      if (resetToken) {
        await DaymarkGlookoExport.endDataResetAsync(resetToken).catch(
          () => false,
        );
      }
      barrier.release();
      setSyncing(false);
    }
  }, [changeDataMode, glookoReportSyncing, glookoSyncing]);

  const deleteManualContext = useCallback(async (id: string) => {
    const deleted = await healthRecordStore.current.deleteManualContext(id);
    if (deleted) {
      await clearSavedInsightReports();
      await generateInsightReviewIfDue(Date.now(), 0).catch(
        () => undefined,
      );
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
    }
    return deleted;
  }, [refreshEarliestLiveDate]);

  const value = useMemo<DataContextValue>(() => {
    const today = toDateKey(now);
    return {
      now,
      today,
      earliestDate:
        repositoryState.mode === 'demo'
          ? addDays(today, -20)
          : earliestLiveDate,
      repository: repositoryState.repository,
      dataMode: repositoryState.mode,
      demoMode: repositoryState.mode === 'demo',
      ready: repositoryState.ready,
      syncing,
      revision,
      sourceError: repositoryState.sourceError,
      backgroundSyncAvailable: repositoryState.backgroundSyncAvailable,
      glookoSyncState,
      glookoSyncing,
      glookoReportSyncState,
      glookoReportSyncing,
      glookoBackgroundSyncAvailable,
      refreshData,
      reloadSources,
      setDataMode: changeDataMode,
      activateLibreSnapshot,
      connectNightscout,
      disconnectNightscout,
      connectXdrip,
      disconnectXdrip,
      setNightscoutHistoryTarget,
      importGlookoData,
      importGlookoReport,
      getLatestGlookoReport,
      importDexcomData,
      getDexcomArchiveSummary,
      clearImportedDexcomData,
      syncGlooko,
      syncGlookoQuietly,
      syncGlookoReport,
      syncGlookoRange,
      setGlookoAutomaticEnabled,
      setGlookoHistoryBackfillTarget,
      beginGlookoCredentialSetup,
      markGlookoCredentialsReady,
      markGlookoSessionForgotten,
      hasSavedGlookoExport,
      getGlookoArchiveSummary,
      reprocessAllGlookoData,
      clearImportedGlookoData,
      eraseAllLocalHealthData,
      saveManualContext,
      logFood,
      updateFoodLog,
      updateFoodPortions,
      deleteManualContext,
    };
  }, [
    changeDataMode,
    activateLibreSnapshot,
    connectNightscout,
    disconnectNightscout,
    connectXdrip,
    disconnectXdrip,
    setNightscoutHistoryTarget,
    clearImportedGlookoData,
    eraseAllLocalHealthData,
    deleteManualContext,
    importGlookoData,
    importGlookoReport,
    importDexcomData,
    getDexcomArchiveSummary,
    clearImportedDexcomData,
    glookoBackgroundSyncAvailable,
    glookoSyncState,
    glookoSyncing,
    glookoReportSyncState,
    glookoReportSyncing,
    getGlookoArchiveSummary,
    hasSavedGlookoExport,
    reprocessAllGlookoData,
    earliestLiveDate,
    now,
    refreshData,
    reloadSources,
    repositoryState,
    revision,
    syncing,
    logFood,
    updateFoodLog,
    updateFoodPortions,
    saveManualContext,
    setGlookoAutomaticEnabled,
    setGlookoHistoryBackfillTarget,
    beginGlookoCredentialSetup,
    markGlookoCredentialsReady,
    markGlookoSessionForgotten,
    syncGlooko,
    syncGlookoQuietly,
    syncGlookoReport,
    syncGlookoRange,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDataContext() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useDataContext must be used inside DataProvider.');
  }
  return context;
}
