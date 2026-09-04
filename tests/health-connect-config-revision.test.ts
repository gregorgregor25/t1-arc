import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthConnectRecord } from '../modules/t1arc-health-connect/src/T1ArcHealthConnect.types';

import {
  lockHealthConnectSources,
  saveHealthConnectPreferences,
  savePreferredHealthConnectSource,
  syncHealthConnect,
} from '@/data/healthConnect/healthConnectRepository';

type PreferenceRow = {
  category: string;
  enabled: number;
  preferred_source_package: string | null;
  preferred_source_mode: 'automatic' | 'manual' | null;
  updated_at_ms: number;
};

type SyncRow = {
  category: string;
  last_attempt_at_ms: number | null;
  last_success_at_ms: number | null;
  data_start_ms: number | null;
  data_through_ms: number | null;
  record_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  changes_token: string | null;
  changes_token_source_package: string | null;
};

const state = vi.hoisted(() => ({
  configRevision: 0,
  preferences: new Map<string, PreferenceRow>(),
  sync: new Map<string, SyncRow>(),
  sources: [] as Record<string, unknown>[],
  sourceCategories: [] as Record<string, unknown>[],
  recordWrites: 0,
  successWrites: 0,
  errorWrites: 0,
}));

const nativeHealthConnect = vi.hoisted(() => ({
  getStatusAsync: vi.fn(),
  getChangesTokenAsync: vi.fn(),
  readRecordsPageAsync: vi.fn(),
  readChangesPageAsync: vi.fn(),
}));

function revisionMetadataKey(value: unknown) {
  return (
    typeof value === 'string' &&
    /health-connect.*config.*revision/i.test(value)
  );
}

const persistence = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(async (sql: string) => {
      if (sql.includes('FROM health_connect_preferences')) {
        return [...state.preferences.values()].map((row) => ({ ...row }));
      }
      if (sql.includes('FROM health_connect_sync_state')) {
        return [...state.sync.values()].map((row) => ({ ...row }));
      }
      if (sql.includes('FROM health_connect_sources s')) {
        return state.sources.map((row) => ({ ...row }));
      }
      if (sql.includes('GROUP BY source_package, kind')) {
        return state.sourceCategories.map((row) => ({ ...row }));
      }
      return [];
    }),
    getFirstAsync: vi.fn(
      async (sql: string, ...parameters: unknown[]) => {
        if (sql.includes('COUNT(*) AS total')) {
          return { total: 0, earliest: null, latest: null };
        }
        if (
          sql.includes('FROM health_connect_preferences') &&
          typeof parameters[0] === 'string'
        ) {
          const row = state.preferences.get(parameters[0]);
          return row ? { ...row } : null;
        }
        if (
          sql.includes('FROM app_metadata') &&
          revisionMetadataKey(parameters[0])
        ) {
          return { value: String(state.configRevision) };
        }
        return null;
      },
    ),
    runAsync: vi.fn(async (sql: string, ...parameters: unknown[]) => {
      if (
        sql.includes('app_metadata') &&
        parameters.some(revisionMetadataKey)
      ) {
        state.configRevision += 1;
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO health_connect_preferences')) {
        const category = parameters[0] as string;
        const existing = state.preferences.get(category);
        if (sql.includes('VALUES (?, ?, NULL, NULL')) {
          state.preferences.set(category, {
            category,
            enabled: parameters[1] as number,
            preferred_source_package:
              existing?.preferred_source_package ?? null,
            preferred_source_mode: existing?.preferred_source_mode ?? null,
            updated_at_ms: parameters[2] as number,
          });
        } else {
          state.preferences.set(category, {
            category,
            enabled: existing?.enabled ?? 1,
            preferred_source_package: (parameters[1] as string | null) ?? null,
            preferred_source_mode:
              (parameters[2] as 'automatic' | 'manual' | null) ?? null,
            updated_at_ms: parameters[3] as number,
          });
        }
        return { changes: 1 };
      }

      if (
        sql.includes('UPDATE health_connect_sync_state') &&
        sql.includes('changes_token = NULL')
      ) {
        const category = parameters.at(-1) as string;
        const row = state.sync.get(category);
        if (row) {
          row.changes_token = null;
          row.changes_token_source_package = null;
        }
        return { changes: row ? 1 : 0 };
      }

      if (
        sql.includes('INSERT INTO health_connect_sync_state') &&
        sql.includes('changes_token')
      ) {
        const category = parameters[0] as string;
        const row = state.sync.get(category) ?? emptySyncRow(category);
        row.changes_token = parameters[1] as string;
        row.changes_token_source_package =
          (parameters[2] as string | null) ?? null;
        state.sync.set(category, row);
        return { changes: 1 };
      }

      if (
        sql.includes('INSERT INTO health_connect_sync_state') &&
        sql.includes('last_success_at_ms')
      ) {
        const category = parameters[0] as string;
        const row = state.sync.get(category) ?? emptySyncRow(category);
        row.last_attempt_at_ms = parameters[1] as number;
        row.last_success_at_ms = parameters[2] as number;
        row.last_error_code = null;
        row.last_error_message = null;
        state.sync.set(category, row);
        state.successWrites += 1;
        return { changes: 1 };
      }

      if (
        sql.includes('INSERT INTO health_connect_sync_state') &&
        sql.includes("'read_failed'")
      ) {
        const category = parameters[0] as string;
        const row = state.sync.get(category) ?? emptySyncRow(category);
        row.last_error_code = 'read_failed';
        row.last_error_message = parameters.at(-1) as string;
        state.sync.set(category, row);
        state.errorWrites += 1;
        return { changes: 1 };
      }

      if (
        sql.includes('INSERT INTO health_connect_sync_state') &&
        sql.includes('last_attempt_at_ms')
      ) {
        const category = parameters[0] as string;
        const row = state.sync.get(category) ?? emptySyncRow(category);
        row.last_attempt_at_ms = parameters[1] as number;
        state.sync.set(category, row);
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO health_connect_records')) {
        state.recordWrites += 1;
      }
      return { changes: 0 };
    }),
  };

  return {
    database,
    openT1ArcDatabase: vi.fn(async () => database),
    withT1ArcTransaction: vi.fn(
      async (work: (value: typeof database) => Promise<unknown>) =>
        work(database),
    ),
  };
});

vi.mock('../modules/t1arc-health-connect', () => ({
  default: nativeHealthConnect,
}));

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(),
  },
}));

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: persistence.openT1ArcDatabase,
  withT1ArcTransaction: persistence.withT1ArcTransaction,
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => {
  class LocalDataWriteSupersededError extends Error {}
  return {
    acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 1 })),
    assertLocalDataWriteLeaseInTransaction: vi.fn(async () => undefined),
    isLocalDataWriteSupersededError: (error: unknown) =>
      error instanceof LocalDataWriteSupersededError,
    LocalDataWriteSupersededError,
  };
});

function emptySyncRow(category: string): SyncRow {
  return {
    category,
    last_attempt_at_ms: null,
    last_success_at_ms: null,
    data_start_ms: null,
    data_through_ms: null,
    record_count: 0,
    last_error_code: null,
    last_error_message: null,
    changes_token: null,
    changes_token_source_package: null,
  };
}

function preference(
  sourcePackage: string | null = null,
  mode: 'automatic' | 'manual' | null = null,
): PreferenceRow {
  return {
    category: 'steps',
    enabled: 1,
    preferred_source_package: sourcePackage,
    preferred_source_mode: mode,
    updated_at_ms: 1,
  };
}

function stepRecord(sourcePackage = 'com.example.source-a'): HealthConnectRecord {
  return {
    externalId: 'steps-1',
    kind: 'steps',
    sourcePackage,
    startTimeMs: 1_000,
    endTimeMs: 2_000,
    lastModifiedTimeMs: 3_000,
    recordingMethod: 1,
    clientRecordVersion: 1,
    value: 100,
    unit: 'count',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Health Connect configuration revision fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.configRevision = 0;
    state.preferences.clear();
    state.preferences.set('steps', preference());
    state.sync.clear();
    state.sources.length = 0;
    state.sourceCategories.length = 0;
    state.recordWrites = 0;
    state.successWrites = 0;
    state.errorWrites = 0;
    nativeHealthConnect.getStatusAsync.mockResolvedValue({
      availability: 'available',
      historyGranted: true,
      categories: [{ id: 'steps', granted: true }],
    });
    nativeHealthConnect.getChangesTokenAsync.mockResolvedValue('fresh-token');
    nativeHealthConnect.readChangesPageAsync.mockResolvedValue({
      upserted: [],
      deletedRecordIds: [],
      sources: [],
      nextChangesToken: 'next-token',
      hasMore: false,
      tokenExpired: false,
    });
  });

  it('increments one durable revision in each configuration transaction', async () => {
    await saveHealthConnectPreferences(['steps']);
    expect(state.configRevision).toBe(1);

    await savePreferredHealthConnectSource(
      'steps',
      'com.example.source-a',
      'manual',
    );

    expect(state.configRevision).toBe(2);
    expect(persistence.withT1ArcTransaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'the category is paused',
      change: () => saveHealthConnectPreferences([]),
    },
    {
      name: 'source A is manually changed to source B',
      change: () =>
        savePreferredHealthConnectSource(
          'steps',
          'com.example.source-b',
          'manual',
        ),
    },
  ])('rejects a deferred native page after $name', async ({ change }) => {
    state.preferences.set(
      'steps',
      preference('com.example.source-a', 'manual'),
    );
    const page = deferred<{
      records: HealthConnectRecord[];
      sources: never[];
      nextPageToken: null;
    }>();
    nativeHealthConnect.readRecordsPageAsync.mockReturnValueOnce(page.promise);

    const sync = syncHealthConnect({ categories: ['steps'], fullHistory: true });
    await vi.waitFor(() => {
      expect(nativeHealthConnect.readRecordsPageAsync).toHaveBeenCalledOnce();
    });

    await change();
    page.resolve({
      records: [stepRecord()],
      sources: [],
      nextPageToken: null,
    });

    await expect(sync).rejects.toMatchObject({
      name: 'HealthConnectConfigurationSupersededError',
    });
    expect(state.recordWrites).toBe(0);
    expect(state.successWrites).toBe(0);
    expect(state.errorWrites).toBe(0);
    expect(state.sync.get('steps')?.changes_token ?? null).toBeNull();
  });

  it('does not let a deferred automatic choice overwrite a manual source', async () => {
    const sourceStats = deferred<Record<string, unknown>[]>();
    persistence.database.getAllAsync.mockImplementation(
      async (sql: string) => {
        if (sql.includes('FROM health_connect_preferences')) {
          return [...state.preferences.values()].map((row) => ({ ...row }));
        }
        if (sql.includes('FROM health_connect_sync_state')) return [];
        if (sql.includes('FROM health_connect_sources s')) {
          return [
            {
              package_name: 'com.example.source-a',
              display_name: 'Source A',
              first_seen_at_ms: 1,
              last_seen_at_ms: 2,
              record_count: 100,
            },
          ];
        }
        if (sql.includes('GROUP BY source_package, kind')) {
          return sourceStats.promise;
        }
        return [];
      },
    );

    const automaticChoice = lockHealthConnectSources(['steps']);
    await vi.waitFor(() => {
      expect(persistence.database.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY source_package, kind'),
      );
    });

    await savePreferredHealthConnectSource(
      'steps',
      'com.example.source-b',
      'manual',
    );
    sourceStats.resolve([
      {
        package_name: 'com.example.source-a',
        kind: 'steps',
        record_count: 100,
        data_start_ms: 1,
        data_through_ms: 2,
      },
    ]);

    await expect(automaticChoice).rejects.toMatchObject({
      name: 'HealthConnectConfigurationSupersededError',
    });
    expect(state.configRevision).toBe(1);
    expect(state.preferences.get('steps')).toMatchObject({
      preferred_source_package: 'com.example.source-b',
      preferred_source_mode: 'manual',
    });
  });

  it('persists full-scan intent before a native page so restart still plans full history', async () => {
    state.preferences.set(
      'steps',
      preference('com.example.source-a', 'manual'),
    );
    state.sync.set('steps', {
      ...emptySyncRow('steps'),
      last_attempt_at_ms: 10,
      last_success_at_ms: 20,
      changes_token: 'old-token',
      changes_token_source_package: 'com.example.source-a',
    });
    nativeHealthConnect.getChangesTokenAsync
      .mockResolvedValueOnce('full-token-before-crash')
      .mockResolvedValueOnce('full-token-after-restart');
    const crashedPage = deferred<{
      records: HealthConnectRecord[];
      sources: never[];
      nextPageToken: null;
    }>();
    nativeHealthConnect.readRecordsPageAsync
      .mockReturnValueOnce(crashedPage.promise)
      .mockResolvedValueOnce({ records: [], sources: [], nextPageToken: null });

    const interruptedSync = syncHealthConnect({
      categories: ['steps'],
      fullHistory: true,
    });
    await vi.waitFor(() => {
      expect(nativeHealthConnect.readRecordsPageAsync).toHaveBeenCalledOnce();
    });
    const durableTokenAtCrash = state.sync.get('steps')?.changes_token;

    vi.resetModules();
    const restartedRepository = await import(
      '@/data/healthConnect/healthConnectRepository'
    );
    await restartedRepository.syncHealthConnect({ categories: ['steps'] });

    expect(durableTokenAtCrash).toBeNull();
    expect(nativeHealthConnect.getChangesTokenAsync).toHaveBeenCalledTimes(2);
    expect(nativeHealthConnect.readChangesPageAsync).not.toHaveBeenCalled();
    expect(state.sync.get('steps')).toMatchObject({
      changes_token: 'full-token-after-restart',
      changes_token_source_package: 'com.example.source-a',
    });

    // Settle the simulated pre-crash runtime without allowing its stale page
    // to mutate the durable state used by later tests.
    await restartedRepository.saveHealthConnectPreferences([]);
    crashedPage.resolve({ records: [], sources: [], nextPageToken: null });
    await interruptedSync.catch(() => undefined);
  });
});
