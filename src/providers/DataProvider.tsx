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

import {
  registerLibreBackgroundSync,
  unregisterLibreBackgroundSync,
} from '@/data/background/libreSyncTask';
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import { DiabetesRepository } from '@/data/contracts';
import { createDemoRepository } from '@/data/demoRepository';
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from '@/data/import/glookoImport';
import {
  saveFoodLog as persistFoodLog,
} from '@/data/food/foodLogRepository';
import { FoodLog, FoodLogDraft } from '@/data/food/types';
import {
  DataMode,
  loadDataMode,
  loadLibreLinkUpCredentials,
  saveDataMode,
} from '@/data/libreLinkUp/secureStore';
import { persistVerifiedLibreSnapshot } from '@/data/libreLinkUp/activateSnapshot';
import { LibreLinkUpSnapshot } from '@/data/libreLinkUp/types';
import { createLiveRepository } from '@/data/live/createLiveRepository';
import {
  createManualContextEvent,
  ManualContextDraft,
} from '@/data/manualContext';
import {
  ImportedSourceDeleteResult,
  ImportWriteResult,
} from '@/data/persistence/HealthRecordStore';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { HealthContextEvent } from '@/domain/models';
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
  refreshData(): Promise<void>;
  reloadSources(): Promise<void>;
  setDataMode(mode: DataMode): Promise<void>;
  activateLibreSnapshot(snapshot: LibreLinkUpSnapshot): Promise<void>;
  importGlookoData(prepared: PreparedGlookoImport): Promise<ImportWriteResult>;
  hasSavedGlookoExport(): Promise<boolean>;
  reprocessLatestGlookoData(): Promise<{
    prepared: PreparedGlookoImport;
    result: ImportWriteResult;
  }>;
  clearImportedGlookoData(): Promise<ImportedSourceDeleteResult>;
  saveManualContext(draft: ManualContextDraft): Promise<HealthContextEvent>;
  logFood(draft: FoodLogDraft): Promise<FoodLog>;
  deleteManualContext(id: string): Promise<boolean>;
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
  const syncInFlight = useRef(false);
  const healthRecordStore = useRef(new SqliteHealthRecordStore());
  const glucoseHistoryStore = useRef(new SqliteGlucoseHistoryStore());
  const [repositoryState, setRepositoryState] = useState<RepositoryState>({
    mode: 'demo',
    ready: false,
    backgroundSyncAvailable: false,
  });
  const configurationId = useRef(0);

  const refreshEarliestLiveDate = useCallback(async () => {
    const [glucose, insulin, context] = await Promise.all([
      glucoseHistoryStore.current.getBounds(),
      healthRecordStore.current.getInsulinBounds(),
      healthRecordStore.current.getContextBounds(),
    ]);
    const candidates = [
      glucose.earliest,
      insulin.earliest,
      context.earliest,
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
        const [credentials, storedMode] = await Promise.all([
          loadLibreLinkUpCredentials(),
          loadDataMode(),
        ]);
        const preferredMode =
          requestedMode ?? storedMode ?? (credentials ? 'live' : 'demo');
        const mode: DataMode =
          preferredMode === 'live' && credentials ? 'live' : 'demo';
        const repository =
          mode === 'live' && credentials
            ? createLiveRepository(credentials)
            : createDemoRepository(initialNow);

        await saveDataMode(mode);
        let backgroundSyncAvailable = false;
        if (credentials) {
          backgroundSyncAvailable = await registerLibreBackgroundSync();
        } else {
          await unregisterLibreBackgroundSync();
        }

        if (id !== configurationId.current) return;
        if (mode === 'live') await refreshEarliestLiveDate();
        if (id !== configurationId.current) return;
        setRepositoryState({
          repository,
          mode,
          ready: true,
          backgroundSyncAvailable,
        });
        setRevision((value) => value + 1);
      } catch (error) {
        if (id !== configurationId.current) return;
        setRepositoryState({
          repository: createDemoRepository(initialNow),
          mode: 'demo',
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

  const refreshData = useCallback(async () => {
    const repository = repositoryState.repository;
    if (!repository || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      await repository.refresh();
      setRepositoryState((state) => ({ ...state, sourceError: undefined }));
    } catch (error) {
      setRepositoryState((state) => ({
        ...state,
        sourceError:
          error instanceof Error ? error.message : 'Unable to refresh data.',
      }));
    } finally {
      if (repositoryState.mode === 'live') {
        await refreshEarliestLiveDate();
        await updateGlucoseDisplayFromHistory().catch(() => undefined);
      }
      setNow(Date.now());
      setRevision((value) => value + 1);
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [
    refreshEarliestLiveDate,
    repositoryState.mode,
    repositoryState.repository,
  ]);

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const clockInterval = setInterval(updateClock, 30_000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    if (!repositoryState.ready || !repositoryState.repository) return;
    void refreshData();
    const refreshInterval = setInterval(() => {
      void refreshData();
    }, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshData();
    });
    return () => {
      clearInterval(refreshInterval);
      subscription.remove();
    };
  }, [
    refreshData,
    repositoryState.ready,
    repositoryState.repository,
  ]);

  const reloadSources = useCallback(
    async () => configure(repositoryState.mode),
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

  const importGlookoData = useCallback(
    async (prepared: PreparedGlookoImport) => {
      const result = await healthRecordStore.current.writeImport(
        prepared.batch,
          prepared.preview.basal,
          prepared.preview.boluses,
          prepared.preview.context,
          prepared.sourcePayload,
        );
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
      return result;
    },
    [refreshEarliestLiveDate],
  );

  const hasSavedGlookoExport = useCallback(
    () =>
      healthRecordStore.current.hasImportSourcePayload('glooko-export'),
    [],
  );

  const reprocessLatestGlookoData = useCallback(async () => {
    const retained =
      await healthRecordStore.current.getLatestImportSourcePayload(
        'glooko-export',
      );
    if (!retained) {
      throw new Error('There is no saved Glooko export to reprocess yet.');
    }
    try {
      const next = await prepareGlookoImport(
        retained.batch.fileName,
        retained.payload.bytes,
        retained.batch.importedAt,
      );
      const prepared: PreparedGlookoImport = {
        preview: next.preview,
        batch: next.batch,
      };
      const result = await healthRecordStore.current.writeImport(
        prepared.batch,
        prepared.preview.basal,
        prepared.preview.boluses,
        prepared.preview.context,
      );
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
      return { prepared, result };
    } finally {
      retained.payload.bytes.fill(0);
    }
  }, [refreshEarliestLiveDate]);

  const saveManualContext = useCallback(
    async (draft: ManualContextDraft) => {
      const event = createManualContextEvent(draft);
      await healthRecordStore.current.saveManualContext(event);
      await refreshEarliestLiveDate();
      setNow(Date.now());
      setRevision((value) => value + 1);
      return event;
    },
    [refreshEarliestLiveDate],
  );

  const logFood = useCallback(async (draft: FoodLogDraft) => {
    const result = await persistFoodLog(draft);
    await refreshEarliestLiveDate();
    setNow(Date.now());
    setRevision((value) => value + 1);
    return result.log;
  }, [refreshEarliestLiveDate]);

  const clearImportedGlookoData = useCallback(async () => {
    const result =
      await healthRecordStore.current.clearImportedSource('glooko-export');
    await refreshEarliestLiveDate();
    setNow(Date.now());
    setRevision((value) => value + 1);
    return result;
  }, [refreshEarliestLiveDate]);

  const deleteManualContext = useCallback(async (id: string) => {
    const deleted = await healthRecordStore.current.deleteManualContext(id);
    if (deleted) {
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
      refreshData,
      reloadSources,
      setDataMode: changeDataMode,
      activateLibreSnapshot,
      importGlookoData,
      hasSavedGlookoExport,
      reprocessLatestGlookoData,
      clearImportedGlookoData,
      saveManualContext,
      logFood,
      deleteManualContext,
    };
  }, [
    changeDataMode,
    activateLibreSnapshot,
    clearImportedGlookoData,
    deleteManualContext,
    importGlookoData,
    hasSavedGlookoExport,
    reprocessLatestGlookoData,
    earliestLiveDate,
    now,
    refreshData,
    reloadSources,
    repositoryState,
    revision,
    syncing,
    logFood,
    saveManualContext,
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
