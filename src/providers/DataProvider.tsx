import {
  createContext,
  PropsWithChildren,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Linking } from "react-native";

import T1ArcGlucoseDisplay from "../../modules/t1arc-glucose-display";
import T1ArcGlookoExport from "../../modules/t1arc-glooko-export";
import T1ArcNotificationSource from "../../modules/t1arc-notification-source";
import {
  registerLibreBackgroundSync,
  unregisterLibreBackgroundSync,
} from "@/data/background/libreSyncTask";
import { updateGlookoBackgroundSyncRegistration } from "@/data/background/glookoSyncTask";
import { updateHealthConnectBackgroundSyncRegistration } from "@/data/background/healthConnectSyncTask";
import { updateHevyBackgroundSyncRegistration } from "@/data/background/hevySyncTask";
import { updateInsightReviewBackgroundRegistration } from "@/data/background/insightReviewTask";
import {
  beginGlookoCredentialChange,
  beginGlookoDataChange,
  GLOOKO_INITIAL_HISTORY_DAYS,
  GlookoSyncOutcome,
  syncGlookoHistoryRange,
  syncGlookoIfDue,
  syncGlookoManually,
  syncGlookoSilentlyNow,
  verifyGlookoCredentials,
} from "@/data/glooko/glookoSync";
import {
  DEFAULT_GLOOKO_SYNC_STATE,
  GLOOKO_FOREGROUND_CHECK_INTERVAL_MS,
  GlookoSyncState,
  glookoFailureDisposition,
  planAutomaticGlookoSync,
} from "@/data/glooko/glookoSyncPolicy";
import {
  assertManualGlookoImportIntegrity,
  GlookoManualImportAttestation,
} from "@/data/glooko/glookoImportIntegrity";
import {
  hasImportedGlookoData,
  loadGlookoSyncState,
  updateGlookoSyncState,
} from "@/data/glooko/glookoSyncState";
import {
  getLatestGlookoReport,
  saveGlookoReport,
  StoredGlookoReport,
} from "@/data/glooko/glookoReportRepository";
import { PumpTrackIntervalInput } from "@/data/glooko/glookoReport";
import {
  clearGlookoReportInbox,
  getGlookoReportInboxStatus,
} from "@/data/glooko/glookoReportInbox";
import {
  beginGlookoReportDataChange,
  GlookoReportSyncOutcome,
  syncGlookoReportIfDue,
  syncGlookoReportNow,
} from "@/data/glooko/glookoReportSync";
import { runInitialGlookoReportSync } from "@/data/glooko/glookoInitialReportSync";
import {
  DEFAULT_GLOOKO_REPORT_SYNC_STATE,
  GlookoReportSyncState,
  planAutomaticGlookoReportSync,
} from "@/data/glooko/glookoReportSyncPolicy";
import {
  loadGlookoReportSyncState,
  saveGlookoReportSyncState,
} from "@/data/glooko/glookoReportSyncState";
import {
  updateGlucoseDisplayFromHistory,
  updateGlucoseDisplayFromHistoryWithLease,
} from "@/data/glucoseDisplay/glucoseDisplayCoordinator";
import {
  loadGlucoseAlertPreferences,
  resetGlucoseAlertState,
  saveGlucoseAlertPreferences,
} from "@/data/glucoseAlerts/glucoseAlertPreferences";
import {
  getHealthConnectDataBounds,
  syncHealthConnectIfDue,
} from "@/data/healthConnect/healthConnectRepository";
import { generateInsightReviewIfDue } from "@/data/insights/insightReviewGenerator";
import {
  requestPostCommitInsightRefresh,
  resumePendingInsightRefresh,
} from "@/data/insights/postCommitInsightRefresh";
import { clearSavedInsightReports } from "@/data/insights/insightReportRepository";
import { createCoalescedPostCommitTask } from "@/data/postCommitTaskCoordinator";
import { createSavePipelineTrace } from "@/data/performance/savePipelineTrace";
import { clearHevyConnection } from "@/data/hevy/secureStore";
import {
  createHevyForegroundSyncLane,
  triggerHevyForegroundSyncIfActive,
} from "@/data/hevy/foregroundSync";
import type { HevyForegroundSyncLane } from "@/data/hevy/foregroundSync";
import { invalidateHevyConnectionOwnership } from "@/data/hevy/repository";
import {
  beginHevyDataChange,
  HEVY_SYNC_INTERVAL_MS,
  syncHevyIfDue,
} from "@/data/hevy/sync";
import { clearInsightReviewPreferences } from "@/data/insights/insightReviewPreferences";
import { DiabetesRepository } from "@/data/contracts";
import { DexcomShareGlucoseSource } from "@/data/dexcomShare/DexcomShareGlucoseSource";
import {
  activateDexcomShareConnection,
  beginDexcomShareConnectionChange,
  clearDexcomShareConnection,
  disconnectDexcomShareConnection,
  loadOwnedDexcomShareConnection,
} from "@/data/dexcomShare/secureStore";
import { DexcomShareConnection } from "@/data/dexcomShare/types";
import { createDemoRepository } from "@/data/demoRepository";
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from "@/data/import/glookoImport";
import { DEXCOM_CLARITY_SOURCE_ID } from "@/data/import/dexcomClarityCsv";
import { PreparedDexcomClarityImport } from "@/data/import/dexcomClarityImport";
import {
  clearDexcomGlucoseHistory,
  writeDexcomGlucoseHistory,
} from "@/data/import/dexcomGlucoseImport";
import {
  clearGlookoGlucoseHistory,
  writeGlookoGlucoseHistory,
} from "@/data/import/glookoGlucoseImport";
import {
  saveFoodLog as persistFoodLog,
  updateFoodLog as persistFoodLogUpdate,
  updateFoodLogPortions as persistFoodLogPortions,
} from "@/data/food/foodLogRepository";
import { FoodLog, FoodLogDraft } from "@/data/food/types";
import {
  DataMode,
  clearLibreLinkUpCredentials,
  loadOwnedLibreLinkUpConnection,
  saveDataMode,
} from "@/data/libreLinkUp/secureStore";
import {
  eraseLocalHealthData,
  invalidateLocalDataWritesForErase,
} from "@/data/privacy/localDataVault";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
  LocalDataWriteSupersededError,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";
import { runExclusiveLocalDataMutation } from "@/data/privacy/localDataMutationCoordinator";
import {
  LibreLinkUpCredentials,
  LibreLinkUpSnapshot,
} from "@/data/libreLinkUp/types";
import { createLiveRepository } from "@/data/live/createLiveRepository";
import { StartupLocalFirstRepository } from "@/data/live/StartupLocalFirstRepository";
import { verifiedSourceActivationOptions } from "@/data/live/verifiedSourceActivation";
import {
  assertSourceConnectionActivationCurrent,
  type SourceConnectionWriteLease,
} from "@/data/live/sourceConnectionOwnership";
import {
  GlucosePublicationWatermark,
  observeGlucoseReadingForPublication,
} from "@/data/live/glucoseSourceRefresh";
import { syncConfiguredNightscoutHistoryIfDue } from "@/data/live/configuredGlucoseSources";
import { NightscoutGlucoseSource } from "@/data/nightscout/NightscoutGlucoseSource";
import { NightscoutTreatmentImporter } from "@/data/nightscout/NightscoutTreatmentImporter";
import {
  NIGHTSCOUT_HISTORY_BLOCK_MS,
  NightscoutHistoryState,
} from "@/data/nightscout/historyBackfill";
import {
  clearNightscoutHistoryState,
  loadNightscoutHistoryState,
  saveNightscoutHistoryState,
} from "@/data/nightscout/historyStateStore";
import { syncNightscoutHistoryIfDue } from "@/data/nightscout/historySync";
import {
  activateNightscoutConnection,
  beginNightscoutConnectionChange,
  clearNightscoutConnection,
  disconnectNightscoutConnection,
  loadOwnedNightscoutConnection,
} from "@/data/nightscout/secureStore";
import {
  NIGHTSCOUT_SOURCE_ID,
  NightscoutConnection,
} from "@/data/nightscout/types";
import { MedtrumGlucoseSource } from "@/data/medtrum/MedtrumGlucoseSource";
import {
  activateMedtrumConnection,
  beginMedtrumConnectionChange,
  clearMedtrumConnection,
  disconnectMedtrumConnection,
  loadOwnedMedtrumConnection,
} from "@/data/medtrum/secureStore";
import { MedtrumConnectResult, MedtrumConnection } from "@/data/medtrum/types";
import {
  createManualContextEvent,
  ManualContextDraft,
  reviseManualContextEvent,
} from "@/data/manualContext";
import {
  createManualInsulinDelivery,
  type ManualInsulinDraft,
  reviseManualInsulinDelivery,
} from "@/data/manualInsulin";
import {
  ImportedSourceDeleteResult,
  ImportWriteResult,
  StoredImportSourceSummary,
} from "@/data/persistence/HealthRecordStore";
import { openT1ArcDatabase } from "@/data/persistence/t1arcDatabase";
import { SqliteHealthRecordStore } from "@/data/persistence/SqliteHealthRecordStore";
import { MemoryGlucoseHistoryStore } from "@/data/persistence/GlucoseHistoryStore";
import { SqliteGlucoseHistoryStore } from "@/data/persistence/SqliteGlucoseHistoryStore";
import { clearTarvisStoredData } from "@/data/tarvis/secureStore";
import { clearTarvisTreatmentProfile } from "@/data/tarvis/treatmentProfile";
import {
  resolveTarvisDatasetOwnerIdentity,
  type TarvisDatasetOwnerSource,
} from "@/data/tarvis/conversationScope";
import {
  activateXdripConnection,
  beginXdripConnectionChange,
  clearXdripConnection,
  disconnectXdripConnection,
  loadOwnedXdripConnection,
} from "@/data/xdrip/secureStore";
import { XdripGlucoseSource } from "@/data/xdrip/XdripGlucoseSource";
import { XdripConnection } from "@/data/xdrip/types";
import {
  type BolusDelivery,
  GlucoseReading,
  HealthContextEvent,
} from "@/domain/models";
import { LocalDataSummary } from "@/domain/localDataSummary";
import { DateKey, addDays, toDateKey } from "@/domain/time";
import { isGlookoSourceLink } from "@/navigation/appLinks";
import {
  installRepositoryForVerifiedLibreOwner,
  libreActivationNeedsRefreshBarrier,
  publishVerifiedLibreSnapshotImmediately,
} from "@/providers/libreRepositoryActivation";
import { nextPresentationClock } from "@/providers/presentationClock";

interface DataContextValue {
  repository?: DiabetesRepository;
  now: number;
  today: DateKey;
  earliestDate: DateKey;
  dataMode: DataMode;
  ownerIdentity: string;
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
  activateLibreSnapshot(
    snapshot: LibreLinkUpSnapshot,
    credentials: LibreLinkUpCredentials,
    writeLease: LocalDataWriteLease,
    sourceWriteLease: SourceConnectionWriteLease,
  ): Promise<void>;
  connectNightscout(connection: NightscoutConnection): Promise<GlucoseReading>;
  disconnectNightscout(): Promise<void>;
  connectDexcomShare(
    connection: DexcomShareConnection,
  ): Promise<GlucoseReading>;
  disconnectDexcomShare(): Promise<void>;
  connectMedtrum(connection: MedtrumConnection): Promise<MedtrumConnectResult>;
  disconnectMedtrum(): Promise<void>;
  connectXdrip(connection: XdripConnection): Promise<GlucoseReading>;
  disconnectXdrip(): Promise<void>;
  setNightscoutHistoryTarget(
    targetDate: DateKey | undefined,
  ): Promise<NightscoutHistoryState>;
  importGlookoData(
    prepared: PreparedGlookoImport,
    attestation?: GlookoManualImportAttestation,
    writeLease?: LocalDataWriteLease,
  ): Promise<ImportWriteResult>;
  importGlookoReport(
    fileName: string,
    bytes: Uint8Array,
    extractedText: string,
    pumpTrackIntervals?: PumpTrackIntervalInput[],
    subjectFingerprint?: string,
  ): Promise<StoredGlookoReport>;
  getLatestGlookoReport(): Promise<StoredGlookoReport | undefined>;
  importDexcomData(
    prepared: PreparedDexcomClarityImport,
    writeLease: LocalDataWriteLease,
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
    existingDataBindingApproved?: boolean,
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
  saveManualInsulin(
    draft: ManualInsulinDraft,
    existing?: BolusDelivery,
  ): Promise<BolusDelivery>;
  logFood(
    draft: FoodLogDraft,
    operationLease?: LocalDataWriteLease,
  ): Promise<FoodLog>;
  updateFoodLog(
    log: FoodLog,
    draft: FoodLogDraft,
    operationLease?: LocalDataWriteLease,
  ): Promise<FoodLog>;
  updateFoodPortions(
    log: FoodLog,
    amounts: Record<string, number>,
    operationLease?: LocalDataWriteLease,
  ): Promise<FoodLog>;
  deleteManualContext(id: string): Promise<boolean>;
  deleteManualInsulin(id: string): Promise<boolean>;
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
    const commitLease = await T1ArcGlookoExport.beginDataCommitAsync();
    if (!commitLease.acquired) {
      throw new Error(
        "Glooko data is being removed. Wait a moment, then try the import again.",
      );
    }
    commitToken = commitLease.token;
    return await work();
  } finally {
    if (commitToken) {
      await T1ArcGlookoExport.endDataCommitAsync(commitToken).catch(
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
  tarvisLocalDataEpoch?: number;
  tarvisOwnerSources: TarvisDatasetOwnerSource[];
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
  const syncInFlight = useRef<Promise<void> | undefined>(undefined);
  const glucosePublicationWatermark = useRef<GlucosePublicationWatermark>({});
  const libreActivationInFlight = useRef(false);
  const automaticGlookoInFlight = useRef(false);
  const hevyForegroundLane = useRef<HevyForegroundSyncLane | undefined>(
    undefined,
  );
  const healthRecordStore = useRef(new SqliteHealthRecordStore());
  const glucoseHistoryStore = useRef(new SqliteGlucoseHistoryStore());
  const [startupRepository] = useState(
    () => new StartupLocalFirstRepository(createLiveRepository()),
  );
  const startupRepositoryPending = useRef(true);
  const [repositoryState, setRepositoryState] = useState<RepositoryState>({
    // LocalDataEraseRecoveryGate has already opened and verified the private
    // vault before DataProvider mounts. Publish a cache-only repository now so
    // saved glucose, insulin, health and timeline cards do not wait for source
    // credentials, background-worker registration or network configuration.
    repository: startupRepository,
    mode: "live",
    ready: false,
    backgroundSyncAvailable: false,
    tarvisOwnerSources: [],
  });
  const configurationId = useRef(0);
  const configurationQueue = useRef<Promise<void>>(Promise.resolve());
  const configuredLibreCredentials = useRef<LibreLinkUpCredentials | undefined>(
    undefined,
  );
  const localDataChangeGeneration = useRef(0);

  const repositoryForPublication = useCallback(
    (repository: DiabetesRepository) => {
      if (!startupRepositoryPending.current) return repository;
      startupRepository.upgrade(repository);
      startupRepositoryPending.current = false;
      return startupRepository;
    },
    [startupRepository],
  );

  const refreshEarliestLiveDate = useCallback(
    async (
      shouldApply: () => boolean = () => true,
      writeLease?: LocalDataWriteLease,
    ) => {
      const trace = createSavePipelineTrace("bounds-refresh");
      return trace.run(async () => {
        const [glucose, insulin, context, healthConnect] = await Promise.all([
          trace.measure("glucose-bounds", () =>
            glucoseHistoryStore.current.getBounds(),
          ),
          trace.measure("insulin-bounds", () =>
            healthRecordStore.current.getInsulinBounds(),
          ),
          trace.measure("context-bounds", () =>
            healthRecordStore.current.getContextBounds(),
          ),
          trace.measure("health-connect-bounds", getHealthConnectDataBounds),
        ]);
        const candidates = [
          glucose.earliest,
          insulin.earliest,
          context.earliest,
          healthConnect.earliest,
        ].filter((value): value is number => value !== undefined);
        if (!shouldApply()) return;
        if (writeLease) {
          await trace.measure("lease-validation", () =>
            assertLocalDataWriteLeaseCurrent(writeLease),
          );
        }
        if (!shouldApply()) return;
        await trace.measure("ui-publication", async () => {
          setEarliestLiveDate(
            candidates.length
              ? toDateKey(Math.min(...candidates))
              : toDateKey(Date.now()),
          );
        });
      });
    },
    [],
  );

  const scheduleCommittedDataWritePublication = useCallback(
    async (
      writeLease: LocalDataWriteLease,
      operationGeneration: number,
      earliestTimestamp?: number,
    ) => {
      if (operationGeneration !== localDataChangeGeneration.current) {
        throw new LocalDataWriteSupersededError();
      }
      await assertLocalDataWriteLeaseCurrent(writeLease);
      if (operationGeneration !== localDataChangeGeneration.current) {
        throw new LocalDataWriteSupersededError();
      }
      // The durable write and privacy-epoch validation above are part of save
      // acknowledgement. Publish on the next frame so the caller can first
      // close its modal or clear its busy state; otherwise this provider-wide
      // refresh competes with the interaction that initiated the save.
      requestAnimationFrame(() => {
        void assertLocalDataWriteLeaseCurrent(writeLease)
          .then(() => {
            if (operationGeneration !== localDataChangeGeneration.current) {
              return;
            }
            startTransition(() => {
              if (earliestTimestamp !== undefined) {
                const committedDate = toDateKey(earliestTimestamp);
                setEarliestLiveDate((current) =>
                  committedDate < current ? committedDate : current,
                );
              }
              setNow(Date.now());
              setRevision((value) => value + 1);
            });
          })
          .catch(() => undefined);
      });
    },
    [],
  );

  const postCommitBoundsRefresh = useMemo(
    () =>
      createCoalescedPostCommitTask<{
        writeLease: LocalDataWriteLease;
        operationGeneration: number;
      }>({
        run: ({ writeLease, operationGeneration }, isActive) =>
          refreshEarliestLiveDate(
            () =>
              isActive() &&
              operationGeneration === localDataChangeGeneration.current,
            writeLease,
          ),
      }),
    [refreshEarliestLiveDate],
  );

  const schedulePostCommitBoundsRefresh = useCallback(
    (writeLease: LocalDataWriteLease, operationGeneration: number) => {
      postCommitBoundsRefresh.schedule({
        writeLease,
        operationGeneration,
      });
    },
    [postCommitBoundsRefresh],
  );

  useEffect(
    () => () => postCommitBoundsRefresh.cancelPending(),
    [postCommitBoundsRefresh],
  );

  const configure = useCallback(
    (requestedMode?: DataMode, operationLease?: LocalDataWriteLease) => {
      const id = ++configurationId.current;
      const run = configurationQueue.current.then(async () => {
        let writeLease = operationLease;
        try {
          await openT1ArcDatabase();
          // Capture before SecureStore credentials. Every source created below
          // carries this exact generation through its eventual DB commits.
          writeLease ??= await acquireLocalDataWriteLease();
          const [
            libreOwned,
            nightscoutOwned,
            xdripOwned,
            dexcomShareOwned,
            medtrumOwned,
            storedGlookoState,
            storedGlookoReportState,
            reportInboxStatus,
          ] = await Promise.all([
            loadOwnedLibreLinkUpConnection(writeLease),
            loadOwnedNightscoutConnection(writeLease),
            loadOwnedXdripConnection(writeLease),
            loadOwnedDexcomShareConnection(writeLease),
            loadOwnedMedtrumConnection(writeLease),
            loadGlookoSyncState(writeLease),
            loadGlookoReportSyncState(),
            getGlookoReportInboxStatus(),
          ]);
          const credentials = libreOwned.values.credentials;
          const nightscout = nightscoutOwned.values.connection;
          const xdrip = xdripOwned.values.connection;
          const dexcomShare = dexcomShareOwned.values.connection;
          const medtrum = medtrumOwned.values.connection;
          const reconciledGlookoReportState = {
            ...storedGlookoReportState,
            inboxConfigured: reportInboxStatus.configured,
          };
          if (
            storedGlookoReportState.inboxConfigured !==
            reportInboxStatus.configured
          ) {
            await saveGlookoReportSyncState(
              reconciledGlookoReportState,
              writeLease,
            );
          }
          setGlookoSyncState(storedGlookoState);
          setGlookoReportSyncState(reconciledGlookoReportState);
          // Demo data remains available to development/tests through an explicit
          // request, but production launches always open the private local store.
          const preferredMode = requestedMode ?? "live";
          const mode: DataMode = preferredMode;
          const repository =
            mode === "live"
              ? createLiveRepository(
                  credentials,
                  nightscout,
                  xdrip,
                  dexcomShare,
                  medtrum,
                  writeLease,
                  {
                    libre: libreOwned.sourceWriteLease,
                    nightscout: nightscoutOwned.sourceWriteLease,
                    xdrip: xdripOwned.sourceWriteLease,
                    dexcomShare: dexcomShareOwned.sourceWriteLease,
                    medtrum: medtrumOwned.sourceWriteLease,
                  },
                )
              : createDemoRepository(initialNow);
          const tarvisOwnerSources =
            mode === "live"
              ? [
                  libreOwned.sourceWriteLease,
                  nightscoutOwned.sourceWriteLease,
                  xdripOwned.sourceWriteLease,
                  dexcomShareOwned.sourceWriteLease,
                  medtrumOwned.sourceWriteLease,
                ].flatMap((sourceWriteLease) =>
                  sourceWriteLease
                    ? [
                        {
                          sourceId: sourceWriteLease.sourceId,
                          identityDigest: sourceWriteLease.identityDigest,
                        },
                      ]
                    : [],
                )
              : [];

          await withLocalDataWriteLeaseTransaction(writeLease, () =>
            saveDataMode(mode),
          );
          let backgroundSyncAvailable = false;
          if (mode === "live") {
            backgroundSyncAvailable = await registerLibreBackgroundSync();
          } else {
            await unregisterLibreBackgroundSync();
          }
          const glookoBackgroundAvailable =
            await updateGlookoBackgroundSyncRegistration(writeLease).catch(
              (error) => {
                if (isLocalDataWriteSupersededError(error)) throw error;
                return false;
              },
            );
          if (mode === "live") {
            await updateHealthConnectBackgroundSyncRegistration().catch(
              () => false,
            );
            await updateHevyBackgroundSyncRegistration().catch(() => false);
          }
          await updateInsightReviewBackgroundRegistration(
            mode === "live",
          ).catch(() => false);

          if (id !== configurationId.current) return;
          if (mode === "live") {
            await refreshEarliestLiveDate(() => true, writeLease);
          }
          if (id !== configurationId.current) return;
          await withLocalDataWriteLeaseTransaction(writeLease, async () => {
            if (id !== configurationId.current) return;
            configuredLibreCredentials.current =
              mode === "live" ? credentials : undefined;
            setRepositoryState({
              repository: repositoryForPublication(repository),
              mode,
              ready: true,
              backgroundSyncAvailable,
              tarvisLocalDataEpoch: writeLease!.epoch,
              tarvisOwnerSources,
            });
            setGlookoBackgroundSyncAvailable(glookoBackgroundAvailable);
            setRevision((value) => value + 1);
          });
        } catch (error) {
          if (id !== configurationId.current) return;
          if (isLocalDataWriteSupersededError(error)) return;
          const errorLease = writeLease;
          if (errorLease) {
            try {
              await withLocalDataWriteLeaseTransaction(errorLease, async () => {
                configuredLibreCredentials.current = undefined;
                const fallbackRepository = createLiveRepository();
                setRepositoryState({
                  repository: repositoryForPublication(fallbackRepository),
                  mode: "live",
                  ready: true,
                  sourceError:
                    error instanceof Error
                      ? error.message
                      : "Unable to initialise data sources.",
                  backgroundSyncAvailable: false,
                  tarvisLocalDataEpoch: errorLease.epoch,
                  tarvisOwnerSources: [],
                });
              });
            } catch (publishError) {
              if (!isLocalDataWriteSupersededError(publishError)) {
                // A database fault already explains why configuration failed;
                // avoid publishing potentially stale source state here.
              }
            }
            return;
          }
          configuredLibreCredentials.current = undefined;
          const fallbackRepository = createLiveRepository();
          setRepositoryState({
            repository: repositoryForPublication(fallbackRepository),
            mode: "live",
            ready: true,
            sourceError:
              error instanceof Error
                ? error.message
                : "Unable to initialise data sources.",
            backgroundSyncAvailable: false,
            tarvisOwnerSources: [],
          });
        }
      });
      configurationQueue.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [initialNow, refreshEarliestLiveDate, repositoryForPublication],
  );

  useEffect(() => {
    void configure();
  }, [configure]);

  useEffect(() => {
    if (!repositoryState.ready || repositoryState.mode !== "live") return;
    // A source mutation may have committed just before process termination.
    // The durable input generation makes this cheap when no work is pending.
    resumePendingInsightRefresh();
  }, [repositoryState.mode, repositoryState.ready]);

  const observeLatestStoredGlucose = useCallback(async () => {
    if (repositoryState.mode !== "live") return false;
    try {
      const reading = await glucoseHistoryStore.current.getLatestReading();
      return observeGlucoseReadingForPublication(
        glucosePublicationWatermark.current,
        reading,
      );
    } catch {
      // A transient keyed-database read failure must not be interpreted as the
      // user's glucose history having been removed.
      return false;
    }
  }, [repositoryState.mode]);

  const publishLatestStoredGlucose = useCallback(async () => {
    if (!(await observeLatestStoredGlucose())) return false;
    setNow(Date.now());
    setRevision((value) => value + 1);
    return true;
  }, [observeLatestStoredGlucose]);

  const performRefresh = useCallback(
    (visible: boolean, includeHealthConnect = true): Promise<void> => {
      const repository = repositoryState.repository;
      if (!repository) return Promise.resolve();

      // Publish a row committed by the native/headless owner before waiting on
      // any network refresh. This also runs when another foreground refresh is
      // already in flight, which is the critical app-resume case.
      const publishBeforeRefresh = publishLatestStoredGlucose();
      if (libreActivationInFlight.current) {
        return publishBeforeRefresh.then(() => undefined);
      }
      if (syncInFlight.current) {
        const activeRefresh = syncInFlight.current;
        return Promise.allSettled([publishBeforeRefresh, activeRefresh]).then(
          () => undefined,
        );
      }

      const refresh = (async () => {
        const publishedBefore = await publishBeforeRefresh;
        if (visible) setSyncing(true);
        let shouldInvalidate = visible || publishedBefore;
        let shouldPublishAtEnd = visible;
        try {
          const [repositoryRefresh, healthConnectRefresh] =
            await Promise.allSettled([
              includeHealthConnect
                ? repository.refresh()
                : (repository.refreshGlucose?.() ?? repository.refresh()),
              repositoryState.mode === "live" && includeHealthConnect
                ? syncHealthConnectIfDue()
                : Promise.resolve(undefined),
              repositoryState.mode === "live" && includeHealthConnect
                ? generateInsightReviewIfDue()
                : Promise.resolve(undefined),
              repositoryState.mode === "live" && includeHealthConnect
                ? syncConfiguredNightscoutHistoryIfDue(
                    glucoseHistoryStore.current,
                  )
                : Promise.resolve(undefined),
            ]);
          if (repositoryRefresh.status === "rejected") {
            throw repositoryRefresh.reason;
          }
          const glucoseChanged = await observeLatestStoredGlucose();
          const healthConnectRan =
            healthConnectRefresh.status === "fulfilled" &&
            healthConnectRefresh.value !== undefined;
          shouldInvalidate =
            shouldInvalidate || glucoseChanged || healthConnectRan;
          shouldPublishAtEnd =
            shouldPublishAtEnd || glucoseChanged || healthConnectRan;
          setRepositoryState((state) =>
            state.sourceError === undefined
              ? state
              : { ...state, sourceError: undefined },
          );
        } catch (error) {
          const sourceError =
            error instanceof Error ? error.message : "Unable to refresh data.";
          setRepositoryState((state) =>
            state.sourceError === sourceError
              ? state
              : { ...state, sourceError },
          );
        } finally {
          try {
            if (repositoryState.mode === "live" && shouldInvalidate) {
              await refreshEarliestLiveDate();
              await updateGlucoseDisplayFromHistory().catch(() => undefined);
            }
          } finally {
            if (shouldPublishAtEnd) {
              setNow(Date.now());
              setRevision((value) => value + 1);
            }
            if (visible) setSyncing(false);
          }
        }
      })();
      let tracked!: Promise<void>;
      tracked = refresh.finally(() => {
        if (syncInFlight.current === tracked) syncInFlight.current = undefined;
      });
      syncInFlight.current = tracked;
      return tracked;
    },
    [
      observeLatestStoredGlucose,
      publishLatestStoredGlucose,
      refreshEarliestLiveDate,
      repositoryState.mode,
      repositoryState.repository,
    ],
  );

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
    const reconcileClock = () => {
      const observedAt = Date.now();
      setNow((previous) => nextPresentationClock(previous, observedAt));
      if (AppState.currentState === "active") {
        // Native/headless sync can commit a newer row while React remains
        // mounted. Observe SQLite locally so the foreground card follows the
        // persistent notification without opening another network request.
        void publishLatestStoredGlucose();
      }
    };
    const clockInterval = setInterval(reconcileClock, 15_000);
    return () => clearInterval(clockInterval);
  }, [publishLatestStoredGlucose]);

  useEffect(() => {
    if (!repositoryState.ready || !repositoryState.repository) return;
    // Let initial SQLite reads paint the app before a potentially large
    // Health Connect import starts writing to the same on-device database.
    if (AppState.currentState === "active") {
      void refreshGlucoseSilently();
    }
    const initialHealthRefresh = setTimeout(() => {
      if (AppState.currentState === "active") {
        void refreshSilently();
      }
    }, 8_000);
    // Native foreground glucose sync owns the short catch-up cadence. The UI
    // only polls once a minute while active so it cannot duplicate headless
    // work or keep importing data after the app moves to the background.
    const refreshInterval = setInterval(() => {
      // Frequent glucose polling must not also scan Health Connect, saved
      // insights, and Nightscout history. Those slower jobs run after the
      // initial paint, on app resume, and on explicit refresh.
      if (AppState.currentState === "active") {
        void refreshGlucoseSilently();
      }
    }, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshSilently();
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

  useEffect(() => {
    if (!repositoryState.ready || repositoryState.mode !== "live") return;

    const lane = createHevyForegroundSyncLane({
      syncIfDue: syncHevyIfDue,
      onImported: async (_result, lifecycle) => {
        await refreshEarliestLiveDate(lifecycle.isActive);
        if (!lifecycle.isActive()) return;
        setNow(Date.now());
        setRevision((value) => value + 1);
      },
      // The Hevy repository records its own actionable source failure. Refresh
      // consumers after an attempted check without turning it into a global
      // glucose-source error.
      onError: () => setRevision((value) => value + 1),
    });
    hevyForegroundLane.current = lane;
    const trigger = (state = AppState.currentState) =>
      triggerHevyForegroundSyncIfActive(lane, state);

    trigger();
    const interval = setInterval(trigger, HEVY_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      trigger(state);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      if (hevyForegroundLane.current === lane) {
        hevyForegroundLane.current = undefined;
      }
      lane.dispose();
    };
  }, [refreshEarliestLiveDate, repositoryState.mode, repositoryState.ready]);

  const reloadSources = useCallback(async () => {
    const generation = localDataChangeGeneration.current;
    const writeLease = await acquireLocalDataWriteLease();
    if (repositoryState.mode === "live") {
      await generateInsightReviewIfDue(Date.now(), 0, writeLease).catch(
        (error) => {
          if (isLocalDataWriteSupersededError(error)) throw error;
          return undefined;
        },
      );
    }
    if (generation !== localDataChangeGeneration.current) return;
    await configure(repositoryState.mode, writeLease);
  }, [configure, repositoryState.mode]);

  const changeDataMode = useCallback(
    async (mode: DataMode, operationLease?: LocalDataWriteLease) => {
      const writeLease = operationLease ?? (await acquireLocalDataWriteLease());
      await withLocalDataWriteLeaseTransaction(writeLease, async () => {
        setRepositoryState((state) => ({ ...state, ready: false }));
        await saveDataMode(mode);
      });
      await configure(mode, writeLease);
    },
    [configure],
  );

  const activateLibreSnapshot = useCallback(
    async (
      snapshot: LibreLinkUpSnapshot,
      credentials: LibreLinkUpCredentials,
      writeLease: LocalDataWriteLease,
      sourceWriteLease: SourceConnectionWriteLease,
    ) => {
      libreActivationInFlight.current = true;
      try {
        const configuredRepository = {
          credentials: configuredLibreCredentials.current,
          mode: repositoryState.mode,
          ready: repositoryState.ready,
        };
        // A different verified owner has already atomically replaced the old
        // DB lease. Drain the old in-memory lane before swapping repositories;
        // its eventual writes are independently rejected by the durable lease.
        const changesKnownAccount = libreActivationNeedsRefreshBarrier(
          configuredRepository,
          credentials,
        );
        if (changesKnownAccount) {
          await syncInFlight.current?.catch(() => undefined);
        }
        const activatedAt = Date.now();
        await publishVerifiedLibreSnapshotImmediately({
          persist: async () => undefined,
          assertCurrent: () => assertLocalDataWriteLeaseCurrent(writeLease),
          invalidateApp: () => undefined,
          publishNative: () =>
            updateGlucoseDisplayFromHistoryWithLease(
              writeLease,
              {},
              () => {
                setNow(activatedAt);
                setRevision((value) => value + 1);
              },
              sourceWriteLease,
            ),
          refreshBounds: () => refreshEarliestLiveDate(() => true, writeLease),
        });

        if (changesKnownAccount || configuredRepository.mode === "demo") {
          // Keep the activation barrier held while replacing a known old owner.
          await changeDataMode("live", writeLease);
          return;
        }

        // Every verified activation rotates the durable source generation.
        // Install a repository carrying that exact new lease even when the
        // account and patient are unchanged.
        await installRepositoryForVerifiedLibreOwner(() =>
          configure("live", writeLease),
        );
      } finally {
        libreActivationInFlight.current = false;
      }
    },
    [
      changeDataMode,
      configure,
      refreshEarliestLiveDate,
      repositoryState.mode,
      repositoryState.ready,
    ],
  );

  const connectNightscout = useCallback(
    async (connection: NightscoutConnection) => {
      const writeLease = await acquireLocalDataWriteLease();
      const candidate = await beginNightscoutConnectionChange(writeLease);
      const glucoseStore = new MemoryGlucoseHistoryStore();
      const source = new NightscoutGlucoseSource(
        connection,
        glucoseStore,
        fetch,
        Date.now,
        undefined,
        async () => undefined,
        async () => undefined,
        writeLease,
      );
      const latest = await source.importInitialHistory();
      if (!latest) {
        throw new Error(
          "Nightscout connected, but it did not return a glucose reading.",
        );
      }
      const readings = await source.getReadings({
        start: 0,
        end: Number.MAX_SAFE_INTEGER,
      });
      const sourceWriteLease = await activateNightscoutConnection(
        candidate,
        connection,
        verifiedSourceActivationOptions({
          sourceId: NIGHTSCOUT_SOURCE_ID,
          readings,
          clearHealthRecordsOnIdentityChange: true,
        }),
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      await changeDataMode("live", writeLease);
      await updateGlucoseDisplayFromHistoryWithLease(
        writeLease,
        {},
        undefined,
        sourceWriteLease,
      );
      await assertSourceConnectionActivationCurrent(
        sourceWriteLease,
        candidate.changeGeneration,
      );
      return latest;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectNightscout = useCallback(async () => {
    await disconnectNightscoutConnection();
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const connectDexcomShare = useCallback(
    async (connection: DexcomShareConnection) => {
      const writeLease = await acquireLocalDataWriteLease();
      const candidate = await beginDexcomShareConnectionChange(writeLease);
      const glucoseStore = new MemoryGlucoseHistoryStore();
      const source = new DexcomShareGlucoseSource(connection, glucoseStore);
      await source.refresh();
      const latest = await source.getLatestReading();
      if (!latest) {
        throw new Error(
          "Dexcom Share connected, but it did not return a glucose reading.",
        );
      }
      const readings = await source.getReadings({
        start: 0,
        end: Number.MAX_SAFE_INTEGER,
      });
      const sourceWriteLease = await activateDexcomShareConnection(
        candidate,
        connection,
        verifiedSourceActivationOptions({
          sourceId: "dexcom-share",
          readings,
        }),
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      await changeDataMode("live", writeLease);
      await updateGlucoseDisplayFromHistoryWithLease(
        writeLease,
        {},
        undefined,
        sourceWriteLease,
      );
      await assertSourceConnectionActivationCurrent(
        sourceWriteLease,
        candidate.changeGeneration,
      );
      return latest;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectDexcomShare = useCallback(async () => {
    await disconnectDexcomShareConnection();
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const connectMedtrum = useCallback(
    async (connection: MedtrumConnection) => {
      const writeLease = await acquireLocalDataWriteLease();
      const candidate = await beginMedtrumConnectionChange(writeLease);
      const glucoseStore = new MemoryGlucoseHistoryStore();
      const source = new MedtrumGlucoseSource(connection, glucoseStore);
      const result = await source.verifyConnection();
      if (!result.connection || !result.latest) return result;
      const readings = await source.getReadings({
        start: 0,
        end: Number.MAX_SAFE_INTEGER,
      });
      const sourceWriteLease = await activateMedtrumConnection(
        candidate,
        result.connection,
        verifiedSourceActivationOptions({
          sourceId: "medtrum-easyfollow",
          readings,
        }),
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      await changeDataMode("live", writeLease);
      await updateGlucoseDisplayFromHistoryWithLease(
        writeLease,
        {},
        undefined,
        sourceWriteLease,
      );
      await assertSourceConnectionActivationCurrent(
        sourceWriteLease,
        candidate.changeGeneration,
      );
      return result;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectMedtrum = useCallback(async () => {
    await disconnectMedtrumConnection();
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const connectXdrip = useCallback(
    async (connection: XdripConnection) => {
      const writeLease = await acquireLocalDataWriteLease();
      const candidate = await beginXdripConnectionChange(writeLease);
      const glucoseStore = new MemoryGlucoseHistoryStore();
      const source = new XdripGlucoseSource(connection, glucoseStore);
      await source.refresh();
      const latest = await source.getLatestReading();
      if (!latest) {
        throw new Error(
          "The xDrip endpoint connected, but it did not return a glucose reading.",
        );
      }
      const readings = await source.getReadings({
        start: 0,
        end: Number.MAX_SAFE_INTEGER,
      });
      const sourceWriteLease = await activateXdripConnection(
        candidate,
        connection,
        verifiedSourceActivationOptions({
          sourceId: "xdrip-local",
          readings,
        }),
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      await changeDataMode("live", writeLease);
      await updateGlucoseDisplayFromHistoryWithLease(
        writeLease,
        {},
        undefined,
        sourceWriteLease,
      );
      await assertSourceConnectionActivationCurrent(
        sourceWriteLease,
        candidate.changeGeneration,
      );
      return latest;
    },
    [changeDataMode, refreshEarliestLiveDate],
  );

  const disconnectXdrip = useCallback(async () => {
    await disconnectXdripConnection();
    await configure(repositoryState.mode);
    await updateGlucoseDisplayFromHistory().catch(() => undefined);
  }, [configure, repositoryState.mode]);

  const setNightscoutHistoryTarget = useCallback(
    async (targetDate: DateKey | undefined) => {
      const writeLease = await acquireLocalDataWriteLease();
      const owned = await loadOwnedNightscoutConnection(writeLease);
      const connection = owned.values.connection;
      const sourceWriteLease = owned.sourceWriteLease;
      if (!connection || !sourceWriteLease) {
        throw new Error("Connect Nightscout before building its history.");
      }
      const current = await loadNightscoutHistoryState(sourceWriteLease);
      if (!targetDate) {
        const paused = {
          ...current,
          targetDate: undefined,
          completedAt: undefined,
          lastError: undefined,
        };
        await saveNightscoutHistoryState(paused, sourceWriteLease);
        await withLocalDataWriteLeaseTransaction(writeLease, async () => {
          setRevision((value) => value + 1);
        });
        return paused;
      }
      if (targetDate > toDateKey(Date.now()) || targetDate < "2000-01-01") {
        throw new Error(
          "Choose a Nightscout history date between 2000 and today.",
        );
      }
      const now = Date.now();
      const bounds =
        await glucoseHistoryStore.current.getBounds(NIGHTSCOUT_SOURCE_ID);
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
      await saveNightscoutHistoryState(started, sourceWriteLease);
      const source = new NightscoutGlucoseSource(
        connection,
        glucoseHistoryStore.current.withSourceWriteLease(sourceWriteLease),
        fetch,
        Date.now,
        new NightscoutTreatmentImporter(
          connection,
          healthRecordStore.current.withSourceWriteLease(sourceWriteLease),
        ),
        undefined,
        undefined,
        writeLease,
        sourceWriteLease,
      );
      const result = await syncNightscoutHistoryIfDue(
        source,
        now,
        sourceWriteLease,
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      await withLocalDataWriteLeaseTransaction(writeLease, async () => {
        setNow(Date.now());
        setRevision((value) => value + 1);
      });
      return result;
    },
    [refreshEarliestLiveDate],
  );

  const importGlookoData = useCallback(
    async (
      prepared: PreparedGlookoImport,
      attestation?: GlookoManualImportAttestation,
      operationLease?: LocalDataWriteLease,
    ) => {
      const trace = createSavePipelineTrace("glooko-import");
      const writeLease =
        operationLease ??
        (await trace.measure("write-lease", acquireLocalDataWriteLease));
      assertManualGlookoImportIntegrity(prepared, attestation);

      return trace.run(() =>
        withGlookoDataCommit(async () => {
          const before = await loadGlookoSyncState(writeLease);
          const healthResult = await trace.measure("primary-write", () =>
            healthRecordStore.current
              .withWriteLease(writeLease)
              .writeImport(
                prepared.batch,
                prepared.preview.basal,
                prepared.preview.boluses,
                prepared.preview.context,
                prepared.sourcePayload,
                prepared.preview.dailyInsulinTotals,
                prepared.preview.rawRecords,
              ),
          );
          const insertedGlucose = await trace.measure("glucose-write", () =>
            writeGlookoGlucoseHistory(
              glucoseHistoryStore.current.withWriteLease(writeLease),
              prepared.preview.glucose,
            ),
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
            const unbound = await updateGlookoSyncState(
              (current) => ({
                ...current,
                automaticEnabled: false,
                nextEligibleAt: undefined,
                lastErrorCode: "unbound-existing-data",
                lastErrorMessage:
                  "Manual Glooko data is not bound to a verified automatic sign-in. Remove it before connecting another account.",
              }),
              writeLease,
            );
            setGlookoSyncState(unbound);
            const available = await updateGlookoBackgroundSyncRegistration(
              writeLease,
            ).catch((error) => {
              if (isLocalDataWriteSupersededError(error)) throw error;
              return false;
            });
            setGlookoBackgroundSyncAvailable(available);
          }
          await trace.measure("insight-invalidation", () =>
            requestPostCommitInsightRefresh(writeLease),
          );
          await refreshEarliestLiveDate(() => true, writeLease);
          if (repositoryState.mode === "demo") {
            await changeDataMode("live", writeLease);
          } else {
            await withLocalDataWriteLeaseTransaction(writeLease, async () => {
              setNow(Date.now());
              setRevision((value) => value + 1);
            });
          }
          return result;
        }),
      );
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const importGlookoReport = useCallback(
    async (
      fileName: string,
      bytes: Uint8Array,
      extractedText: string,
      pumpTrackIntervals: PumpTrackIntervalInput[] = [],
      subjectFingerprint?: string,
    ) => {
      const writeLease = await acquireLocalDataWriteLease();
      const commitLease = await T1ArcGlookoExport.beginDataCommitAsync();
      if (!commitLease.acquired) {
        throw new Error(
          "Another Glooko import or data reset is finishing. Try the report again in a moment.",
        );
      }
      const result = await (async () => {
        try {
          return await saveGlookoReport(
            fileName,
            bytes,
            extractedText,
            pumpTrackIntervals,
            Date.now(),
            subjectFingerprint,
            writeLease,
          );
        } finally {
          await T1ArcGlookoExport.endDataCommitAsync(commitLease.token).catch(
            () => false,
          );
        }
      })();
      const importedAt = Date.now();
      const activityCount = result.report.preview.pumpStateIntervals.filter(
        (interval) => interval.kind === "activity-mode",
      ).length;
      const pauseCount = result.report.preview.pumpStateIntervals.filter(
        (interval) => interval.kind === "automated-pause",
      ).length;
      const reportState = await loadGlookoReportSyncState();
      const nextReportState: GlookoReportSyncState = {
        ...reportState,
        lastAttemptAt: importedAt,
        lastCheckedAt: importedAt,
        lastSuccessAt: importedAt,
        consecutiveFailures: 0,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        lastReportStart: result.report.preview.reportStart,
        lastReportEnd: result.report.preview.reportEnd,
        lastDailyModeCount: result.report.preview.dailyModeSummaries.length,
        lastActivityCount: activityCount,
        lastPauseCount: pauseCount,
        lastInserted: result.inserted,
        lastReportSource: "manual",
      };
      await saveGlookoReportSyncState(nextReportState, writeLease);
      setGlookoReportSyncState(nextReportState);
      await clearSavedInsightReports(writeLease);
      await requestPostCommitInsightRefresh(writeLease, {
        inputAlreadyInvalidated: true,
      });
      await withLocalDataWriteLeaseTransaction(writeLease, async () => {
        setNow(Date.now());
        setRevision((value) => value + 1);
      });
      return result.report;
    },
    [],
  );

  const importDexcomData = useCallback(
    async (
      prepared: PreparedDexcomClarityImport,
      writeLease: LocalDataWriteLease,
    ) => {
      const healthResult = await healthRecordStore.current
        .withWriteLease(writeLease)
        .writeImport(prepared.batch, [], [], [], prepared.sourcePayload);
      const insertedGlucose = await writeDexcomGlucoseHistory(
        glucoseHistoryStore.current.withWriteLease(writeLease),
        prepared.preview.glucose,
      );
      const result = {
        ...healthResult,
        insertedGlucose,
        duplicateCount:
          healthResult.duplicateCount +
          Math.max(0, prepared.preview.glucose.length - insertedGlucose),
      };
      await clearSavedInsightReports(writeLease);
      await requestPostCommitInsightRefresh(writeLease, {
        inputAlreadyInvalidated: true,
      });
      await refreshEarliestLiveDate(() => true, writeLease);
      if (repositoryState.mode === "demo") {
        await changeDataMode("live", writeLease);
      } else {
        await withLocalDataWriteLeaseTransaction(writeLease, async () => {
          setNow(Date.now());
          setRevision((value) => value + 1);
        });
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
    async (outcome: GlookoSyncOutcome, showPersonalData = false) => {
      setGlookoSyncState(outcome.syncState);
      if (outcome.status === "success") {
        await generateInsightReviewIfDue(Date.now(), 0).catch(() => undefined);
        await refreshEarliestLiveDate();
        if (showPersonalData && repositoryState.mode === "demo") {
          await changeDataMode("live");
        } else {
          setNow(Date.now());
          setRevision((value) => value + 1);
        }
      }
      const available = await updateGlookoBackgroundSyncRegistration().catch(
        () => false,
      );
      setGlookoBackgroundSyncAvailable(available);
      return outcome;
    },
    [changeDataMode, refreshEarliestLiveDate, repositoryState.mode],
  );

  const syncGlooko = useCallback(async () => {
    setGlookoSyncing(true);
    try {
      return await completeGlookoOutcome(await syncGlookoManually(90), true);
    } finally {
      setGlookoSyncing(false);
    }
  }, [completeGlookoOutcome]);

  const syncGlookoQuietly = useCallback(async () => {
    setGlookoSyncing(true);
    try {
      return await completeGlookoOutcome(await syncGlookoSilentlyNow(14), true);
    } finally {
      setGlookoSyncing(false);
    }
  }, [completeGlookoOutcome]);

  const completeGlookoReportOutcome = useCallback(
    async (outcome: GlookoReportSyncOutcome) => {
      setGlookoReportSyncState(outcome.syncState);
      if (outcome.status === "success") {
        setNow(Date.now());
        setRevision((value) => value + 1);
      }
      const available = await updateGlookoBackgroundSyncRegistration().catch(
        () => false,
      );
      setGlookoBackgroundSyncAvailable(available);
      return outcome;
    },
    [],
  );

  const syncGlookoReport = useCallback(async () => {
    setGlookoReportSyncing(true);
    try {
      return await completeGlookoReportOutcome(
        await syncGlookoReportNow("manual"),
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
        // A PDF shared through Android is queued natively and is not reflected
        // in the persisted scheduling state, so still perform the cheap inbox
        // check below.
      }
      if (csvDue) {
        setGlookoSyncing(true);
        await completeGlookoOutcome(await syncGlookoIfDue("app-open"));
      }
      setGlookoReportSyncing(reportDue);
      await completeGlookoReportOutcome(
        await syncGlookoReportIfDue("app-open"),
      );
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
      if (AppState.currentState === "active") {
        void runAutomaticGlookoSync();
      }
    }, GLOOKO_FOREGROUND_CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void runAutomaticGlookoSync();
    });
    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      if (isGlookoSourceLink(url)) {
        void runAutomaticGlookoSync();
      }
    });
    return () => {
      clearInterval(foregroundInterval);
      subscription.remove();
      linkSubscription.remove();
    };
  }, [repositoryState.ready, runAutomaticGlookoSync]);

  const setGlookoAutomaticEnabled = useCallback(
    async (enabled: boolean) => {
      const next = await updateGlookoSyncState((current) => {
        const canEnable =
          glookoFailureDisposition(current.lastErrorCode) !== "action-required";
        const automaticEnabled = enabled && canEnable;
        return {
          ...current,
          automaticEnabled,
          nextEligibleAt: automaticEnabled ? undefined : current.nextEligibleAt,
        };
      });
      setGlookoSyncState(next);
      const available = await updateGlookoBackgroundSyncRegistration().catch(
        () => false,
      );
      setGlookoBackgroundSyncAvailable(available);
      if (next.automaticEnabled) {
        void runAutomaticGlookoSync();
      } else {
        await T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
          () => false,
        );
      }
      return next;
    },
    [runAutomaticGlookoSync],
  );

  const setGlookoHistoryBackfillTarget = useCallback(
    async (targetDate: DateKey | undefined, startBeforeDate?: DateKey) => {
      const next = await updateGlookoSyncState((current) => ({
        ...current,
        automaticEnabled:
          targetDate === undefined
            ? current.automaticEnabled
            : glookoFailureDisposition(current.lastErrorCode) !==
              "action-required",
        historyBackfillTargetDate: targetDate,
        historyBackfillBeforeDate:
          current.historyBackfillBeforeDate ?? startBeforeDate,
        lastHistoryBackfillAt:
          targetDate === undefined ? current.lastHistoryBackfillAt : undefined,
        nextEligibleAt:
          targetDate === undefined ? current.nextEligibleAt : undefined,
      }));
      setGlookoSyncState(next);
      const available = await updateGlookoBackgroundSyncRegistration().catch(
        () => false,
      );
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
      sessionStatus: "needs-sign-in",
      pendingExistingDataBinding: undefined,
      nextEligibleAt: undefined,
      lastErrorCode: "session-required",
      lastErrorMessage: "Sign into Glooko again to resume automatic refresh.",
    }));
    await T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
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
      existingDataBindingApproved = false,
    ) => {
      const writeLease = await acquireLocalDataWriteLease();
      const verification = verifyGlookoCredentials(
        credentialGeneration,
        async (writeLease) => {
          const pending = await updateGlookoSyncState(
            (current) => ({
              ...current,
              automaticEnabled: false,
              sessionStatus: "pending-verification",
              pendingExistingDataBinding: existingDataBindingApproved,
              nextEligibleAt: undefined,
              lastErrorCode: undefined,
              lastErrorMessage: undefined,
            }),
            writeLease,
          );
          setGlookoSyncState(pending);
        },
        GLOOKO_INITIAL_HISTORY_DAYS,
        existingDataBindingApproved,
        writeLease,
      );
      // The fresh reservation above happens synchronously. This optimistic
      // state is UI-only while the queued verifier persists the same state.
      setGlookoSyncState((current) => ({
        ...current,
        automaticEnabled: false,
        sessionStatus: "pending-verification",
        pendingExistingDataBinding: existingDataBindingApproved,
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
      if (outcome.status === "success") {
        await withLocalDataWriteLeaseTransaction(writeLease, () =>
          T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
            () => false,
          ),
        );
        const reportNext = await loadGlookoReportSyncState();
        const reportReady = {
          ...reportNext,
          nextEligibleAt: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
        };
        await saveGlookoReportSyncState(reportReady, writeLease);
        setGlookoReportSyncState(reportReady);
        void runInitialGlookoReportSync({
          sync: () => syncGlookoReportNow("app-open", writeLease),
          complete: completeGlookoReportOutcome,
          setSyncing: setGlookoReportSyncing,
        });
      }
      return outcome;
    },
    [completeGlookoOutcome, completeGlookoReportOutcome],
  );

  const hasSavedGlookoExport = useCallback(
    () => healthRecordStore.current.hasImportSourcePayload("glooko-export"),
    [],
  );

  const getGlookoArchiveSummary = useCallback(
    () => healthRecordStore.current.getImportSourceSummary("glooko-export"),
    [],
  );

  const reprocessAllGlookoData = useCallback(async () => {
    const writeLease = await acquireLocalDataWriteLease();
    return withGlookoDataCommit(async () => {
      const references =
        await healthRecordStore.current.getImportSourcePayloadReferences(
          "glooko-export",
        );
      if (!references.length) {
        throw new Error("There is no saved Glooko export to reprocess yet.");
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
        const retained = await healthRecordStore.current.getImportSourcePayload(
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
            throw new Error("Unsafe Glooko timestamp locale.");
          }
          const healthResult = await healthRecordStore.current
            .withWriteLease(writeLease)
            .writeImport(
              next.batch,
              next.preview.basal,
              next.preview.boluses,
              next.preview.context,
              undefined,
              next.preview.dailyInsulinTotals,
              next.preview.rawRecords,
            );
          const insertedGlucose = await writeGlookoGlucoseHistory(
            glucoseHistoryStore.current.withWriteLease(writeLease),
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
        } catch (error) {
          if (isLocalDataWriteSupersededError(error)) throw error;
          // One damaged or obsolete snapshot must not prevent later snapshots
          // from being re-read. The exact encrypted bytes remain untouched.
          result.archivesFailed += 1;
        } finally {
          retained.payload.bytes.fill(0);
        }
      }
      if (!result.archivesProcessed) {
        throw new Error(
          "Saved Glooko exports could not be reprocessed. Their encrypted source copies were kept unchanged.",
        );
      }
      await requestPostCommitInsightRefresh(writeLease);
      await refreshEarliestLiveDate(() => true, writeLease);
      if (repositoryState.mode === "demo") {
        await changeDataMode("live", writeLease);
      } else {
        await withLocalDataWriteLeaseTransaction(writeLease, async () => {
          setNow(Date.now());
          setRevision((value) => value + 1);
        });
      }
      return result;
    });
  }, [changeDataMode, refreshEarliestLiveDate, repositoryState.mode]);

  const saveManualContext = useCallback(
    async (draft: ManualContextDraft, existing?: HealthContextEvent) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace(
        existing ? "manual-context-update" : "manual-context-create",
      );
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", () =>
          acquireLocalDataWriteLease(),
        );
        const event = existing
          ? reviseManualContextEvent(existing, draft)
          : createManualContextEvent(draft);
        await trace.measure("primary-write", () =>
          healthRecordStore.current
            .withWriteLease(writeLease)
            .saveManualContext(event, {
              insightInvalidation: existing
                ? "clear-saved-reports"
                : "mark-dirty",
            }),
        );
        await trace.measure("insight-invalidation", () =>
          requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }),
        );
        if (repositoryState.mode === "demo") {
          await trace.measure("mode-transition", () =>
            changeDataMode("live", writeLease),
          );
        } else {
          await trace.measure("ui-publication", () =>
            scheduleCommittedDataWritePublication(
              writeLease,
              operationGeneration,
              event.start,
            ),
          );
        }
        if (existing) {
          schedulePostCommitBoundsRefresh(writeLease, operationGeneration);
        }
        return event;
      });
    },
    [
      changeDataMode,
      scheduleCommittedDataWritePublication,
      repositoryState.mode,
      schedulePostCommitBoundsRefresh,
    ],
  );

  const saveManualInsulin = useCallback(
    async (draft: ManualInsulinDraft, existing?: BolusDelivery) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace(
        existing ? "manual-insulin-update" : "manual-insulin-create",
      );
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", () =>
          acquireLocalDataWriteLease(),
        );
        const delivery = existing
          ? reviseManualInsulinDelivery(existing, draft)
          : createManualInsulinDelivery(draft);
        await trace.measure("primary-write", () =>
          healthRecordStore.current
            .withWriteLease(writeLease)
            .saveManualInsulin(delivery, {
              insightInvalidation: existing
                ? "clear-saved-reports"
                : "mark-dirty",
            }),
        );
        await trace.measure("insight-invalidation", () =>
          requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }),
        );
        if (repositoryState.mode === "demo") {
          await trace.measure("mode-transition", () =>
            changeDataMode("live", writeLease),
          );
        } else {
          await trace.measure("ui-publication", () =>
            scheduleCommittedDataWritePublication(
              writeLease,
              operationGeneration,
              delivery.timestamp,
            ),
          );
        }
        if (existing) {
          schedulePostCommitBoundsRefresh(writeLease, operationGeneration);
        }
        return delivery;
      });
    },
    [
      changeDataMode,
      repositoryState.mode,
      scheduleCommittedDataWritePublication,
      schedulePostCommitBoundsRefresh,
    ],
  );

  const logFood = useCallback(
    async (draft: FoodLogDraft, operationLease?: LocalDataWriteLease) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace("food-log-create");
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", async () =>
          operationLease ?? (await acquireLocalDataWriteLease()),
        );
        const result = await trace.measure("primary-write", () =>
          persistFoodLog(draft, writeLease, {
            insightInvalidation: "mark-dirty",
          }),
        );
        await trace.measure("insight-invalidation", () =>
          requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }),
        );
        if (repositoryState.mode === "demo") {
          await trace.measure("mode-transition", () =>
            changeDataMode("live", writeLease),
          );
        } else {
          await trace.measure("ui-publication", () =>
            scheduleCommittedDataWritePublication(
              writeLease,
              operationGeneration,
              result.log.timestamp,
            ),
          );
        }
        return result.log;
      });
    },
    [
      changeDataMode,
      scheduleCommittedDataWritePublication,
      repositoryState.mode,
    ],
  );

  const updateFoodPortions = useCallback(
    async (
      log: FoodLog,
      amounts: Record<string, number>,
      operationLease?: LocalDataWriteLease,
    ) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace("food-portions-update");
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", async () =>
          operationLease ?? (await acquireLocalDataWriteLease()),
        );
        const adjusted = await trace.measure("primary-write", () =>
          persistFoodLogPortions(log, amounts, writeLease, {
            insightInvalidation: "clear-saved-reports",
          }),
        );
        await trace.measure("insight-invalidation", () =>
          requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }),
        );
        await trace.measure("ui-publication", () =>
          scheduleCommittedDataWritePublication(
            writeLease,
            operationGeneration,
            adjusted.timestamp,
          ),
        );
        return adjusted;
      });
    },
    [scheduleCommittedDataWritePublication],
  );

  const updateFoodLog = useCallback(
    async (
      log: FoodLog,
      draft: FoodLogDraft,
      operationLease?: LocalDataWriteLease,
    ) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace("food-log-update");
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", async () =>
          operationLease ?? (await acquireLocalDataWriteLease()),
        );
        const adjusted = await trace.measure("primary-write", () =>
          persistFoodLogUpdate(log, draft, writeLease, {
            insightInvalidation: "clear-saved-reports",
          }),
        );
        await trace.measure("insight-invalidation", () =>
          requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }),
        );
        if (repositoryState.mode === "demo") {
          await trace.measure("mode-transition", () =>
            changeDataMode("live", writeLease),
          );
        } else {
          await trace.measure("ui-publication", () =>
            scheduleCommittedDataWritePublication(
              writeLease,
              operationGeneration,
              adjusted.timestamp,
            ),
          );
        }
        schedulePostCommitBoundsRefresh(writeLease, operationGeneration);
        return adjusted;
      });
    },
    [
      changeDataMode,
      scheduleCommittedDataWritePublication,
      repositoryState.mode,
      schedulePostCommitBoundsRefresh,
    ],
  );

  const clearImportedGlookoData = useCallback(async () => {
    const writeLease = await acquireLocalDataWriteLease();
    const barrier = beginGlookoDataChange();
    const reportBarrier = beginGlookoReportDataChange();
    let resetToken: string | undefined;
    try {
      // Stop future worker launches before waiting for any current work.
      let disabled = await updateGlookoSyncState(
        (current) => ({
          ...current,
          automaticEnabled: false,
          nextEligibleAt: undefined,
        }),
        writeLease,
      );
      setGlookoSyncState(disabled);
      let available = await updateGlookoBackgroundSyncRegistration(
        writeLease,
      ).catch(() => false);
      setGlookoBackgroundSyncAvailable(available);

      await Promise.all([barrier.ready, reportBarrier.ready]);
      // An invalidated predecessor may have completed a state write while it
      // was draining, so assert the disabled state once more before deletion.
      disabled = await updateGlookoSyncState(
        (current) => ({
          ...current,
          automaticEnabled: false,
          nextEligibleAt: undefined,
        }),
        writeLease,
      );
      setGlookoSyncState(disabled);
      available = await updateGlookoBackgroundSyncRegistration(
        writeLease,
      ).catch(() => false);
      setGlookoBackgroundSyncAvailable(available);

      const resetLease = await T1ArcGlookoExport.beginDataResetAsync();
      if (!resetLease.acquired) {
        throw new Error(
          "A Glooko import is still finishing. Wait a moment, then remove the imported data again.",
        );
      }
      resetToken = resetLease.token;

      await clearGlookoReportInbox();
      const artifactsCleared =
        await T1ArcGlookoExport.clearReportArtifactsAsync();
      if (!artifactsCleared) {
        throw new Error(
          "The private Glooko import files could not be fully removed. Try again.",
        );
      }

      const [healthResult, glucose] = await Promise.all([
        healthRecordStore.current
          .withWriteLease(writeLease)
          .clearImportedSource("glooko-export"),
        clearGlookoGlucoseHistory(
          glucoseHistoryStore.current.withWriteLease(writeLease),
        ),
      ]);
      const result = { ...healthResult, glucose };
      const next = await updateGlookoSyncState(
        (current) => ({
          ...DEFAULT_GLOOKO_SYNC_STATE,
          sessionStatus: current.sessionStatus,
        }),
        writeLease,
      );
      setGlookoSyncState(next);
      await saveGlookoReportSyncState(
        { ...DEFAULT_GLOOKO_REPORT_SYNC_STATE },
        writeLease,
      );
      setGlookoReportSyncState({
        ...DEFAULT_GLOOKO_REPORT_SYNC_STATE,
      });

      const resetEnded =
        await T1ArcGlookoExport.endDataResetAsync(resetToken);
      if (!resetEnded) {
        throw new Error("The protected Glooko data reset did not finish.");
      }
      resetToken = undefined;
      await clearSavedInsightReports(writeLease);
      await generateInsightReviewIfDue(Date.now(), 0, writeLease).catch(
        (error) => {
          if (isLocalDataWriteSupersededError(error)) throw error;
          return undefined;
        },
      );
      await refreshEarliestLiveDate(() => true, writeLease);
      setNow(Date.now());
      setRevision((value) => value + 1);
      return result;
    } finally {
      if (resetToken) {
        await T1ArcGlookoExport.endDataResetAsync(resetToken).catch(
          () => false,
        );
      }
      barrier.release();
      reportBarrier.release();
    }
  }, [refreshEarliestLiveDate]);

  const clearImportedDexcomData = useCallback(async () => {
    const writeLease = await acquireLocalDataWriteLease();
    const [healthResult, glucose] = await Promise.all([
      healthRecordStore.current
        .withWriteLease(writeLease)
        .clearImportedSource(DEXCOM_CLARITY_SOURCE_ID),
      clearDexcomGlucoseHistory(
        glucoseHistoryStore.current.withWriteLease(writeLease),
      ),
    ]);
    await clearSavedInsightReports(writeLease);
    await generateInsightReviewIfDue(Date.now(), 0, writeLease).catch(
      (error) => {
        if (isLocalDataWriteSupersededError(error)) throw error;
        return undefined;
      },
    );
    await refreshEarliestLiveDate(() => true, writeLease);
    await withLocalDataWriteLeaseTransaction(writeLease, async () => {
      setNow(Date.now());
      setRevision((value) => value + 1);
    });
    return { ...healthResult, glucose };
  }, [refreshEarliestLiveDate]);

  const eraseAllLocalHealthData = useCallback(
    () =>
      runExclusiveLocalDataMutation("erase", async () => {
        if (
          syncInFlight.current ||
          automaticGlookoInFlight.current ||
          glookoSyncing ||
          glookoReportSyncing
        ) {
          throw new Error(
            "Wait for the current source refresh to finish before erasing this device.",
          );
        }
        const hevyBarrier = beginHevyDataChange();
        let barrier: ReturnType<typeof beginGlookoDataChange> | undefined;
        let reportBarrier:
          ReturnType<typeof beginGlookoReportDataChange> | undefined;
        try {
          barrier = beginGlookoDataChange();
          reportBarrier = beginGlookoReportDataChange();
        } catch (error) {
          barrier?.release();
          hevyBarrier.release();
          throw error;
        }
        const foregroundHevyLane = hevyForegroundLane.current;
        const foregroundHevyBarrier =
          foregroundHevyLane?.beginExclusiveChange();
        localDataChangeGeneration.current += 1;
        let resetToken: string | undefined;
        let eraseCompleted = false;
        setSyncing(true);
        try {
          // Stop future Glooko launches before the privacy intent deliberately
          // makes every state mutator fail closed. The two barriers below then
          // drain CSV and report work that was already reserved in this runtime.
          const disabled = await updateGlookoSyncState((current) => ({
            ...current,
            automaticEnabled: false,
            nextEligibleAt: undefined,
          }));
          setGlookoSyncState(disabled);
          const available =
            await updateGlookoBackgroundSyncRegistration().catch(() => false);
          setGlookoBackgroundSyncAvailable(available);

          // Establish a durable cross-runtime boundary before any credential,
          // SecureStore, native-cache, or database cleanup begins. Its persistent
          // erase intent blocks work started during cleanup until WAL sanitization
          // and the final marker-only completion transaction have both succeeded.
          await invalidateLocalDataWritesForErase();
          // Invalidate the durable ownership marker before clearing credentials.
          // A headless runtime may finish an HTTP request already in flight, but
          // every eventual database write checks this marker transactionally.
          await invalidateHevyConnectionOwnership();
          await clearHevyConnection();
          await updateHevyBackgroundSyncRegistration().catch(() => false);

          await Promise.all([
            barrier.ready,
            reportBarrier.ready,
            hevyBarrier.ready,
            foregroundHevyBarrier?.ready ?? Promise.resolve(),
          ]);
          // A connection attempt already inside SecureStore when invalidated may
          // have settled while draining. Assert credential removal once more.
          await clearHevyConnection();
          await updateHevyBackgroundSyncRegistration().catch(() => false);

          const [glookoSessionCleared, glookoArtifactsCleared] =
            await Promise.all([
              T1ArcGlookoExport.clearSessionAsync(),
              T1ArcGlookoExport.clearReportArtifactsAsync(),
              clearGlookoReportInbox(),
            ]);
          if (!glookoSessionCleared || !glookoArtifactsCleared) {
            throw new Error(
              "The private Glooko connection files could not be fully removed. Try again.",
            );
          }

          // Atomically disable capture and clear the encrypted native queue before
          // the database erase. The native store serializes this against listener
          // callbacks, while the database epoch rejects a drain already in JS.
          await T1ArcNotificationSource.disableAndClearAsync();

          const alerts = await loadGlucoseAlertPreferences();
          await Promise.all([
            clearLibreLinkUpCredentials(),
            clearNightscoutConnection(),
            clearNightscoutHistoryState(),
            clearDexcomShareConnection(),
            clearMedtrumConnection(),
            clearXdripConnection(),
            clearTarvisStoredData(),
            clearTarvisTreatmentProfile(),
            T1ArcGlucoseDisplay.disableAsync(),
            T1ArcGlucoseDisplay.cancelGlookoSignInRequiredAsync(),
            saveGlucoseAlertPreferences({ ...alerts, enabled: false }),
            resetGlucoseAlertState(),
            clearInsightReviewPreferences(),
          ]);

          const resetLease = await T1ArcGlookoExport.beginDataResetAsync();
          if (!resetLease.acquired) {
            throw new Error(
              "A Glooko import is still finishing. Wait a moment, then erase this device again.",
            );
          }
          resetToken = resetLease.token;
          const removed = await eraseLocalHealthData();
          const resetEnded =
            await T1ArcGlookoExport.endDataResetAsync(resetToken);
          if (!resetEnded) {
            throw new Error("The protected local-data erase did not finish.");
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
          await changeDataMode("demo");
          // The erase has removed the pending intent and both Glooko barriers are
          // still held, so this final reconciliation cannot be overtaken by stale
          // CSV/report work re-registering the task.
          setGlookoBackgroundSyncAvailable(
            await updateGlookoBackgroundSyncRegistration().catch(() => false),
          );
          // Reconcile once more after every pending source callback/configuration
          // has been invalidated so stale UI work cannot re-register Hevy.
          await updateHevyBackgroundSyncRegistration().catch(() => false);
          eraseCompleted = true;
          return removed;
        } finally {
          if (resetToken) {
            await T1ArcGlookoExport.endDataResetAsync(resetToken).catch(
              () => false,
            );
          }
          barrier?.release();
          reportBarrier?.release();
          hevyBarrier.release();
          if (eraseCompleted) foregroundHevyLane?.dispose();
          foregroundHevyBarrier?.release();
          setSyncing(false);
        }
      }),
    [changeDataMode, glookoReportSyncing, glookoSyncing],
  );

  const deleteManualContext = useCallback(
    async (id: string) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace("manual-context-delete");
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", () =>
          acquireLocalDataWriteLease(),
        );
        const deleted = await trace.measure("primary-write", () =>
          healthRecordStore.current
            .withWriteLease(writeLease)
            .deleteManualContext(id),
        );
        if (deleted) {
          // Once the store confirms deletion, this public callback must resolve
          // `true`. Every derived-data update is best-effort so post-commit work
          // cannot make the UI claim the reading was not removed.
          try {
            await trace.measure("ui-publication", () =>
              scheduleCommittedDataWritePublication(
                writeLease,
                operationGeneration,
              ),
            );
          } catch (error) {
            if (!isLocalDataWriteSupersededError(error)) {
              setNow(Date.now());
              setRevision((value) => value + 1);
            }
          }
          void requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }).catch(() => undefined);
          schedulePostCommitBoundsRefresh(writeLease, operationGeneration);
        }
        return deleted;
      });
    },
    [
      scheduleCommittedDataWritePublication,
      schedulePostCommitBoundsRefresh,
    ],
  );

  const deleteManualInsulin = useCallback(
    async (id: string) => {
      const operationGeneration = localDataChangeGeneration.current;
      const trace = createSavePipelineTrace("manual-insulin-delete");
      return trace.run(async () => {
        const writeLease = await trace.measure("write-lease", () =>
          acquireLocalDataWriteLease(),
        );
        const deleted = await trace.measure("primary-write", () =>
          healthRecordStore.current
            .withWriteLease(writeLease)
            .deleteManualInsulin(id),
        );
        if (deleted) {
          try {
            await trace.measure("ui-publication", () =>
              scheduleCommittedDataWritePublication(
                writeLease,
                operationGeneration,
              ),
            );
          } catch (error) {
            if (!isLocalDataWriteSupersededError(error)) {
              setNow(Date.now());
              setRevision((value) => value + 1);
            }
          }
          void requestPostCommitInsightRefresh(writeLease, {
            inputAlreadyInvalidated: true,
          }).catch(() => undefined);
          schedulePostCommitBoundsRefresh(writeLease, operationGeneration);
        }
        return deleted;
      });
    },
    [
      scheduleCommittedDataWritePublication,
      schedulePostCommitBoundsRefresh,
    ],
  );

  const value = useMemo<DataContextValue>(() => {
    const today = toDateKey(now);
    const ownerIdentity =
      repositoryState.mode === "demo"
        ? "demo-fixture-v1"
        : repositoryState.tarvisLocalDataEpoch === undefined
          ? "dataset-owner-unavailable-v1"
          : resolveTarvisDatasetOwnerIdentity({
              dataMode: repositoryState.mode,
              localDataEpoch: repositoryState.tarvisLocalDataEpoch,
              ownedSources: repositoryState.tarvisOwnerSources,
              glookoFingerprint: glookoSyncState.verifiedAccountFingerprint,
            });
    return {
      now,
      today,
      earliestDate:
        repositoryState.mode === "demo"
          ? addDays(today, -20)
          : earliestLiveDate,
      repository: repositoryState.repository,
      dataMode: repositoryState.mode,
      ownerIdentity,
      demoMode: repositoryState.mode === "demo",
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
      connectDexcomShare,
      disconnectDexcomShare,
      connectMedtrum,
      disconnectMedtrum,
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
      saveManualInsulin,
      logFood,
      updateFoodLog,
      updateFoodPortions,
      deleteManualContext,
      deleteManualInsulin,
    };
  }, [
    changeDataMode,
    activateLibreSnapshot,
    connectNightscout,
    disconnectNightscout,
    connectDexcomShare,
    disconnectDexcomShare,
    connectMedtrum,
    disconnectMedtrum,
    connectXdrip,
    disconnectXdrip,
    setNightscoutHistoryTarget,
    clearImportedGlookoData,
    eraseAllLocalHealthData,
    deleteManualContext,
    deleteManualInsulin,
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
    saveManualInsulin,
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
    throw new Error("useDataContext must be used inside DataProvider.");
  }
  return context;
}
