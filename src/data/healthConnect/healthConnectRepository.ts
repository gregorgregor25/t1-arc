import T1ArcHealthConnect, {
  HealthConnectCategoryId,
  HealthConnectRecord,
  HealthConnectSource,
  HealthConnectStatus,
} from '../../../modules/t1arc-health-connect';
import { AppState, type AppStateStatus } from 'react-native';

import {
  DEFAULT_HEALTH_CONNECT_CATEGORIES,
  healthConnectRecordId,
  healthConnectRecordToContext,
  STARTER_HEALTH_CONNECT_CATEGORIES,
} from './healthConnectRecords';
import { earliestHealthConnectReadableTime } from './healthConnectPermissionPolicy';
import {
  buildHealthConnectExternalIdFilter,
  healthConnectParentRecordIds,
  HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY,
  reconcileHealthConnectWindowInTransaction,
  resolveAndPromoteHealthConnectRecordId,
} from './healthConnectReconciliation';
import {
  chooseAutomaticHealthConnectSource,
  healthConnectSourceDisplayName,
} from './healthConnectSourcePolicy';
import {
  openT1ArcDatabase,
  withT1ArcTransaction,
} from '@/data/persistence/t1arcDatabase';
import { LOCAL_DATA_RESET_SENTINEL_KEY } from '@/data/privacy/localDataResetSentinel';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';
import { HealthContextEvent } from '@/domain/models';

const INCREMENTAL_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_CATEGORY = 10_000;
const MAX_CHANGE_PAGES_PER_CATEGORY = 10_000;
// Health Connect can return 500 normalized records in one native page (and a
// sampled record can expand further). Keeping that whole page inside one
// BEGIN IMMEDIATE held the only SQLite writer for minutes on a real phone,
// starving the latency-critical glucose commit. Each batch remains atomic,
// while the page token advances only after every batch has completed.
export const HEALTH_CONNECT_WRITE_BATCH_SIZE = 25;
const FOREGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const BACKGROUND_STATE_KEY = 'health-connect-background-state-v1';
// Kept outside portable preferences and never reset, so a configuration fence
// cannot return to an earlier value after local data is cleared or restored.
const HEALTH_CONNECT_CONFIG_REVISION_KEY =
  'health-connect-config-revision-v1';

type T1ArcDatabase = Awaited<ReturnType<typeof openT1ArcDatabase>>;

export class HealthConnectConfigurationSupersededError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      'Health Connect configuration changed while this sync was in progress.',
    );
    this.name = 'HealthConnectConfigurationSupersededError';
  }
}

function isHealthConnectConfigurationSupersededError(
  error: unknown,
): error is HealthConnectConfigurationSupersededError {
  return error instanceof HealthConnectConfigurationSupersededError;
}

interface PreferenceRow {
  category: HealthConnectCategoryId;
  enabled: number;
  preferred_source_package: string | null;
  preferred_source_mode: 'automatic' | 'manual' | null;
  updated_at_ms: number;
}

interface SyncRow {
  category: HealthConnectCategoryId;
  last_attempt_at_ms: number | null;
  last_success_at_ms: number | null;
  data_start_ms: number | null;
  data_through_ms: number | null;
  record_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  changes_token: string | null;
  changes_token_source_package: string | null;
}

interface SourceRow {
  package_name: string;
  display_name: string;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
  record_count: number;
}

interface SourceCategoryRow {
  package_name: string;
  kind: HealthConnectRecord['kind'];
  record_count: number;
  data_start_ms: number;
  data_through_ms: number;
}

export interface HealthConnectPreference {
  category: HealthConnectCategoryId;
  enabled: boolean;
  preferredSourcePackage?: string;
  preferredSourceMode?: 'automatic' | 'manual';
  updatedAt: number;
}

export interface HealthConnectSyncState {
  category: HealthConnectCategoryId;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  dataStart?: number;
  dataThrough?: number;
  recordCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  changesToken?: string;
  changesTokenSourcePackage?: string;
}

export interface StoredHealthConnectSource extends HealthConnectSource {
  firstSeenAt: number;
  lastSeenAt: number;
  recordCount: number;
  categories: HealthConnectCategoryId[];
  categoryStats: HealthConnectSourceCategoryStats[];
}

export interface HealthConnectSourceCategoryStats {
  category: HealthConnectCategoryId;
  recordCount: number;
  dataStart: number;
  dataThrough: number;
}

export interface HealthConnectOverview {
  totalRecords: number;
  earliest?: number;
  latest?: number;
  preferences: HealthConnectPreference[];
  sync: HealthConnectSyncState[];
  sources: StoredHealthConnectSource[];
  background?: HealthConnectBackgroundState;
}

export interface HealthConnectSyncResult {
  categories: HealthConnectCategoryId[];
  successfulCategories: HealthConnectCategoryId[];
  failures: HealthConnectSyncFailure[];
  recordsProcessed: number;
  recordsRemoved: number;
  contextUpdated: number;
  contextRemoved: number;
  sourcesFound: number;
  startedAt: number;
  completedAt: number;
}

export interface HealthConnectSyncFailure {
  category: HealthConnectCategoryId;
  code: 'read_failed';
  message: string;
}

export interface HealthConnectBackgroundState {
  lastRunAt: number;
  outcome: 'success' | 'skipped' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsRemoved: number;
  failures: number;
}

function parseHealthConnectConfigurationRevision(value?: string) {
  const revision = Number(value ?? 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

async function readHealthConnectConfigurationRevision(
  database: T1ArcDatabase,
) {
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    HEALTH_CONNECT_CONFIG_REVISION_KEY,
  );
  return parseHealthConnectConfigurationRevision(row?.value);
}

async function assertHealthConnectConfigurationRevisionInTransaction(
  database: T1ArcDatabase,
  expectedRevision: number,
) {
  const actualRevision = await readHealthConnectConfigurationRevision(database);
  if (actualRevision !== expectedRevision) {
    throw new HealthConnectConfigurationSupersededError(
      expectedRevision,
      actualRevision,
    );
  }
}

async function bumpHealthConnectConfigurationRevisionInTransaction(
  database: T1ArcDatabase,
) {
  await database.runAsync(
    `INSERT INTO app_metadata (key, value) VALUES (?, '1')
     ON CONFLICT(key) DO UPDATE SET
       value = CAST(app_metadata.value AS INTEGER) + 1`,
    HEALTH_CONNECT_CONFIG_REVISION_KEY,
  );
}

function preferenceFromRow(row: PreferenceRow): HealthConnectPreference {
  return {
    category: row.category,
    enabled: row.enabled === 1,
    preferredSourcePackage: row.preferred_source_package ?? undefined,
    // Preferences created before source modes existed were user-facing
    // selections, so preserve them as manual rather than silently replacing.
    preferredSourceMode: row.preferred_source_package
      ? (row.preferred_source_mode ?? 'manual')
      : undefined,
    updatedAt: row.updated_at_ms,
  };
}

function syncFromRow(row: SyncRow): HealthConnectSyncState {
  return {
    category: row.category,
    lastAttemptAt: row.last_attempt_at_ms ?? undefined,
    lastSuccessAt: row.last_success_at_ms ?? undefined,
    dataStart: row.data_start_ms ?? undefined,
    dataThrough: row.data_through_ms ?? undefined,
    recordCount: row.record_count,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorMessage: row.last_error_message ?? undefined,
    changesToken: row.changes_token ?? undefined,
    changesTokenSourcePackage: row.changes_token_source_package ?? undefined,
  };
}

export function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  return T1ArcHealthConnect.getStatusAsync();
}

async function requestHealthConnectPermissionScope(
  categories: HealthConnectCategoryId[],
  requestHistory: boolean,
  requestBackground: boolean,
) {
  const nativeRequest = T1ArcHealthConnect.requestPermissionsAsync(
    categories,
    requestHistory,
    requestBackground,
  );
  let observedAway = AppState.currentState !== 'active';
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveAfterResume: ((status: HealthConnectStatus) => void) | undefined;
  const resumedStatus = new Promise<HealthConnectStatus>((resolve) => {
    resolveAfterResume = resolve;
  });
  const subscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        observedAway = true;
        return;
      }
      if (!observedAway || resumeTimer) return;

      // Android 16 can finish a Health Connect permission flow without
      // completing the Jetpack activity-result callback. Re-read the
      // authoritative permission state after T1 Arc resumes so the UI cannot
      // remain on "Waiting for approval".
      resumeTimer = setTimeout(() => {
        void getHealthConnectStatus()
          .then((nextStatus) => resolveAfterResume?.(nextStatus))
          .catch(() => undefined);
      }, 750);
    },
  );

  try {
    return await Promise.race([nativeRequest, resumedStatus]);
  } finally {
    subscription.remove();
    if (resumeTimer) clearTimeout(resumeTimer);
    resolveAfterResume = undefined;
  }
}

/** Requests only the ordinary read permissions for the chosen categories. */
export function requestHealthConnectPermissions(
  categories: HealthConnectCategoryId[],
) {
  return requestHealthConnectPermissionScope(categories, false, false);
}

/** Requests only the optional permission to read records older than 30 days. */
export function requestHealthConnectHistoryPermission() {
  return requestHealthConnectPermissionScope([], true, false);
}

/** Requests only the optional permission to read while T1 Arc is not open. */
export function requestHealthConnectBackgroundPermission() {
  return requestHealthConnectPermissionScope([], false, true);
}

export function openHealthConnectSourceDiscovery(
  categories: HealthConnectCategoryId[],
) {
  return T1ArcHealthConnect.openSourceDiscoveryAsync(categories);
}

export function openHealthConnectSettings() {
  return T1ArcHealthConnect.openSettingsAsync();
}

export function openHealthConnectInstall() {
  return T1ArcHealthConnect.openInstallAsync();
}

async function loadHealthConnectPreferencesFromDatabase(
  database: T1ArcDatabase,
): Promise<HealthConnectPreference[]> {
  const rows = await database.getAllAsync<PreferenceRow>(
    `SELECT category, enabled, preferred_source_package,
       preferred_source_mode, updated_at_ms
     FROM health_connect_preferences`,
  );
  if (!rows.length) {
    const resetSentinel = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key = ?',
      LOCAL_DATA_RESET_SENTINEL_KEY,
    );
    const starter = new Set(STARTER_HEALTH_CONNECT_CATEGORIES);
    return DEFAULT_HEALTH_CONNECT_CATEGORIES.map(
      (category): HealthConnectPreference => ({
        category,
        enabled: !resetSentinel && starter.has(category),
        updatedAt: 0,
      }),
    );
  }
  const byCategory = new Map(
    rows.map((row) => [row.category, preferenceFromRow(row)]),
  );
  return DEFAULT_HEALTH_CONNECT_CATEGORIES.map(
    (category): HealthConnectPreference =>
      byCategory.get(category) ?? {
        category,
        // A category introduced by a newer app version must remain off until
        // the person explicitly selects it.
        enabled: false,
        updatedAt: 0,
      },
  );
}

export async function loadHealthConnectPreferences(): Promise<
  HealthConnectPreference[]
> {
  const database = await openT1ArcDatabase();
  return loadHealthConnectPreferencesFromDatabase(database);
}

async function captureHealthConnectSyncConfiguration(
  writeLease: LocalDataWriteLease,
) {
  return withHealthConnectWriteLease(writeLease, async (database) => {
    const preferences =
      await loadHealthConnectPreferencesFromDatabase(database);
    const revision =
      await readHealthConnectConfigurationRevision(database);
    return { preferences, revision };
  });
}

export async function saveHealthConnectPreferences(
  enabledCategories: HealthConnectCategoryId[],
  writeLease?: LocalDataWriteLease,
) {
  const lease = writeLease ?? (await acquireLocalDataWriteLease());
  const enabled = new Set(enabledCategories);
  const updatedAt = Date.now();
  const preferenceValues = DEFAULT_HEALTH_CONNECT_CATEGORIES.map(
    () => '(?, ?, NULL, NULL, ?)',
  ).join(', ');
  const preferenceParameters: (string | number)[] = [];
  for (const category of DEFAULT_HEALTH_CONNECT_CATEGORIES) {
    preferenceParameters.push(
      category,
      enabled.has(category) ? 1 : 0,
      updatedAt,
    );
  }
  await withHealthConnectWriteLease(lease, async (database) => {
    await database.runAsync(
      'DELETE FROM app_metadata WHERE key = ?',
      LOCAL_DATA_RESET_SENTINEL_KEY,
    );
    // This list is bounded to the 13 app-defined categories (39 bind values),
    // so one statement avoids bridge round trips without approaching SQLite's
    // variable limit. Conflict updates deliberately leave source choices intact.
    await database.runAsync(
      `INSERT INTO health_connect_preferences (
         category, enabled, preferred_source_package,
         preferred_source_mode, updated_at_ms
       ) VALUES ${preferenceValues}
       ON CONFLICT(category) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at_ms = excluded.updated_at_ms`,
      ...preferenceParameters,
    );
    await bumpHealthConnectConfigurationRevisionInTransaction(database);
  });
}

async function writePreferredHealthConnectSourceInTransaction(
  database: T1ArcDatabase,
  category: HealthConnectCategoryId,
  packageName?: string,
  mode: 'automatic' | 'manual' = 'manual',
) {
  await database.runAsync(
    `INSERT INTO health_connect_preferences (
       category, enabled, preferred_source_package,
       preferred_source_mode, updated_at_ms
     ) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(category) DO UPDATE SET
       preferred_source_package = excluded.preferred_source_package,
       preferred_source_mode = excluded.preferred_source_mode,
       updated_at_ms = excluded.updated_at_ms`,
    category,
    packageName ?? null,
    packageName ? mode : null,
    Date.now(),
  );
  await database.runAsync(
    `UPDATE health_connect_sync_state
     SET changes_token = NULL, changes_token_source_package = NULL
     WHERE category = ?`,
    category,
  );
  await database.runAsync(
    'DELETE FROM app_metadata WHERE key = ?',
    LOCAL_DATA_RESET_SENTINEL_KEY,
  );
}

export async function savePreferredHealthConnectSource(
  category: HealthConnectCategoryId,
  packageName?: string,
  mode: 'automatic' | 'manual' = 'manual',
  writeLease?: LocalDataWriteLease,
) {
  const lease = writeLease ?? (await acquireLocalDataWriteLease());
  await withHealthConnectWriteLease(lease, async (database) => {
    await writePreferredHealthConnectSourceInTransaction(
      database,
      category,
      packageName,
      mode,
    );
    await bumpHealthConnectConfigurationRevisionInTransaction(database);
  });
}

export async function getHealthConnectOverview(): Promise<HealthConnectOverview> {
  const database = await openT1ArcDatabase();
  const [bounds, preferences, sync, sources, sourceCategories, backgroundRow] =
    await Promise.all([
      database.getFirstAsync<{
        total: number;
        earliest: number | null;
        latest: number | null;
      }>(
        `SELECT COUNT(*) AS total, MIN(start_ms) AS earliest,
         MAX(end_ms) AS latest
       FROM health_connect_records`,
      ),
      loadHealthConnectPreferences(),
      database.getAllAsync<SyncRow>(
        `SELECT category, last_attempt_at_ms, last_success_at_ms,
         data_start_ms, data_through_ms, record_count,
         last_error_code, last_error_message, changes_token,
         changes_token_source_package
       FROM health_connect_sync_state
       ORDER BY category`,
      ),
      database.getAllAsync<SourceRow>(
        `SELECT s.package_name, s.display_name, s.first_seen_at_ms,
         s.last_seen_at_ms, COUNT(r.id) AS record_count
       FROM health_connect_sources s
       LEFT JOIN health_connect_records r
         ON r.source_package = s.package_name
       GROUP BY s.package_name, s.display_name, s.first_seen_at_ms,
         s.last_seen_at_ms
       ORDER BY record_count DESC, s.display_name ASC`,
      ),
      database.getAllAsync<SourceCategoryRow>(
        `SELECT source_package AS package_name, kind,
         COUNT(*) AS record_count, MIN(start_ms) AS data_start_ms,
         MAX(end_ms) AS data_through_ms
       FROM health_connect_records
       GROUP BY source_package, kind`,
      ),
      database.getFirstAsync<{ value: string }>(
        `SELECT value FROM app_metadata WHERE key = ?`,
        BACKGROUND_STATE_KEY,
      ),
    ]);
  const categoryStatsByPackage = new Map<
    string,
    Map<HealthConnectCategoryId, HealthConnectSourceCategoryStats>
  >();
  for (const row of sourceCategories) {
    const category = categoryForRecordKind(row.kind);
    const packageStats =
      categoryStatsByPackage.get(row.package_name) ?? new Map();
    const existing = packageStats.get(category);
    packageStats.set(category, {
      category,
      recordCount: (existing?.recordCount ?? 0) + row.record_count,
      dataStart: Math.min(existing?.dataStart ?? Infinity, row.data_start_ms),
      dataThrough: Math.max(
        existing?.dataThrough ?? -Infinity,
        row.data_through_ms,
      ),
    });
    categoryStatsByPackage.set(row.package_name, packageStats);
  }

  return {
    totalRecords: bounds?.total ?? 0,
    earliest: bounds?.earliest ?? undefined,
    latest: bounds?.latest ?? undefined,
    preferences,
    sync: sync.map(syncFromRow),
    background: parseHealthConnectBackgroundState(backgroundRow?.value),
    sources: sources.map((source) => ({
      packageName: source.package_name,
      displayName: healthConnectSourceDisplayName(
        source.package_name,
        source.display_name,
      ),
      firstSeenAt: source.first_seen_at_ms,
      lastSeenAt: source.last_seen_at_ms,
      recordCount: source.record_count,
      categories: [
        ...(categoryStatsByPackage.get(source.package_name)?.keys() ?? []),
      ],
      categoryStats: [
        ...(categoryStatsByPackage.get(source.package_name)?.values() ?? []),
      ],
    })),
  };
}

export async function getHealthConnectDataBounds() {
  const database = await openT1ArcDatabase();
  const row = await database.getFirstAsync<{
    earliest: number | null;
    latest: number | null;
  }>(
    `SELECT MIN(start_ms) AS earliest, MAX(end_ms) AS latest
     FROM health_connect_records`,
  );
  return {
    earliest: row?.earliest ?? undefined,
    latest: row?.latest ?? undefined,
  };
}

function parseHealthConnectBackgroundState(
  value?: string,
): HealthConnectBackgroundState | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<HealthConnectBackgroundState>;
    if (
      typeof parsed.lastRunAt !== 'number' ||
      !Number.isFinite(parsed.lastRunAt) ||
      (parsed.outcome !== 'success' &&
        parsed.outcome !== 'skipped' &&
        parsed.outcome !== 'partial' &&
        parsed.outcome !== 'failed')
    ) {
      return undefined;
    }
    return {
      lastRunAt: parsed.lastRunAt,
      outcome: parsed.outcome,
      recordsProcessed:
        typeof parsed.recordsProcessed === 'number' &&
        Number.isFinite(parsed.recordsProcessed)
          ? Math.max(0, Math.floor(parsed.recordsProcessed))
          : 0,
      recordsRemoved:
        typeof parsed.recordsRemoved === 'number' &&
        Number.isFinite(parsed.recordsRemoved)
          ? Math.max(0, Math.floor(parsed.recordsRemoved))
          : 0,
      failures:
        typeof parsed.failures === 'number' && Number.isFinite(parsed.failures)
          ? Math.max(0, Math.floor(parsed.failures))
          : 0,
    };
  } catch {
    return undefined;
  }
}

export async function saveHealthConnectBackgroundState(
  state: HealthConnectBackgroundState,
  writeLease: LocalDataWriteLease,
) {
  await withHealthConnectWriteLease(writeLease, (database) =>
    database.runAsync(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      BACKGROUND_STATE_KEY,
      JSON.stringify(state),
    ),
  );
}

function categoryForRecordKind(
  kind: HealthConnectRecord['kind'],
): HealthConnectCategoryId {
  if (kind === 'workout') return 'workouts';
  if (
    kind === 'workout_power' ||
    kind === 'workout_speed' ||
    kind === 'walking_cadence' ||
    kind === 'cycling_cadence'
  ) {
    return 'workouts';
  }
  if (kind === 'elevation_gained' || kind === 'floors_climbed') {
    return 'distance';
  }
  if (kind === 'total_calories') return 'active_calories';
  if (kind === 'heart_rate' || kind === 'resting_heart_rate') {
    return 'heart_rate';
  }
  if (
    kind === 'body_fat' ||
    kind === 'lean_body_mass' ||
    kind === 'body_water_mass' ||
    kind === 'bone_mass' ||
    kind === 'height' ||
    kind === 'basal_metabolic_rate'
  ) {
    return 'body_composition';
  }
  if (
    kind === 'blood_pressure_systolic' ||
    kind === 'blood_pressure_diastolic' ||
    kind === 'oxygen_saturation' ||
    kind === 'respiratory_rate' ||
    kind === 'heart_rate_variability_rmssd' ||
    kind === 'vo2_max' ||
    kind === 'body_temperature'
  ) {
    return 'vitals';
  }
  if (
    kind === 'menstruation_period' ||
    kind === 'menstruation_flow' ||
    kind === 'ovulation_test' ||
    kind === 'basal_body_temperature' ||
    kind === 'cervical_mucus' ||
    kind === 'intermenstrual_bleeding'
  ) {
    return 'cycle';
  }
  return kind;
}

function contextColumns(event: HealthContextEvent) {
  return {
    activityType: event.kind === 'activity' ? event.activityType : null,
    durationMinutes:
      event.kind === 'activity' || event.kind === 'sleep'
        ? event.durationMinutes
        : null,
    intensity: event.kind === 'activity' ? event.intensity : null,
    kilograms: event.kind === 'weight' ? event.kilograms : null,
    mealType: event.kind === 'meal' ? event.mealType : null,
    carbsGrams: event.kind === 'meal' ? (event.carbsGrams ?? null) : null,
    energyKcal: event.kind === 'meal' ? (event.energyKcal ?? null) : null,
    proteinGrams: event.kind === 'meal' ? (event.proteinGrams ?? null) : null,
    fatGrams: event.kind === 'meal' ? (event.fatGrams ?? null) : null,
    fibreGrams: event.kind === 'meal' ? (event.fibreGrams ?? null) : null,
    sugarsGrams: event.kind === 'meal' ? (event.sugarsGrams ?? null) : null,
    saturatedFatGrams:
      event.kind === 'meal' ? (event.saturatedFatGrams ?? null) : null,
  };
}

function withHealthConnectWriteLease<T>(
  writeLease: LocalDataWriteLease,
  task: (database: T1ArcDatabase) => Promise<T>,
  expectedConfigurationRevision?: number,
) {
  return withT1ArcTransaction(async (database) => {
    // This must remain the first callback operation. The transaction-level
    // comparison is what closes the race with an erase in another JS runtime.
    await assertLocalDataWriteLeaseInTransaction(database, writeLease);
    if (expectedConfigurationRevision !== undefined) {
      await assertHealthConnectConfigurationRevisionInTransaction(
        database,
        expectedConfigurationRevision,
      );
    }
    return task(database);
  });
}

async function writePageInTransaction(
  database: T1ArcDatabase,
  records: HealthConnectRecord[],
  sources: HealthConnectSource[],
  importedAt: number,
) {
  let contextUpdated = 0;
  const sourceLabels = new Map(
    sources.map((source) => [source.packageName, source.displayName]),
  );
  for (const source of sources) {
    await database.runAsync(
      `INSERT INTO health_connect_sources (
           package_name, display_name, first_seen_at_ms, last_seen_at_ms
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(package_name) DO UPDATE SET
           display_name = excluded.display_name,
           last_seen_at_ms = excluded.last_seen_at_ms`,
      source.packageName,
      source.displayName,
      importedAt,
      importedAt,
    );
  }

  for (const record of records) {
    const id = await resolveAndPromoteHealthConnectRecordId(
      database,
      record,
      healthConnectRecordId(record),
    );
    await database.runAsync(
      `INSERT INTO health_connect_records (
           id, external_id, parent_external_id, kind, source_package,
           start_ms, end_ms, last_modified_ms, recording_method,
           value, unit, payload_json, imported_at_ms, reconciliation_scope
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current')
         ON CONFLICT(id) DO UPDATE SET
           external_id = excluded.external_id,
           parent_external_id = excluded.parent_external_id,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           last_modified_ms = excluded.last_modified_ms,
           recording_method = excluded.recording_method,
           value = excluded.value,
           unit = excluded.unit,
           payload_json = excluded.payload_json,
           imported_at_ms = excluded.imported_at_ms,
           reconciliation_scope = 'current'`,
      id,
      record.externalId,
      record.parentExternalId ?? null,
      record.kind,
      record.sourcePackage,
      record.startTimeMs,
      record.endTimeMs,
      record.lastModifiedTimeMs,
      record.recordingMethod,
      record.value ?? null,
      record.unit ?? null,
      JSON.stringify(record),
      importedAt,
    );

    const mappedContext = healthConnectRecordToContext(
      record,
      importedAt,
      sourceLabels.get(record.sourcePackage),
    );
    const context = mappedContext ? { ...mappedContext, id } : undefined;
    if (!context) continue;
    if (context.kind === 'note') {
      await database.runAsync(
        `INSERT INTO context_notes (
           id, source_id, origin, start_ms, end_ms, title, category, detail,
           recorded_at_ms, source_file, source_row
         ) VALUES (?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           source_id = excluded.source_id,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           title = excluded.title,
           category = excluded.category,
           detail = excluded.detail,
           recorded_at_ms = excluded.recorded_at_ms,
           source_file = excluded.source_file`,
        context.id,
        context.sourceId,
        context.start,
        context.end ?? null,
        context.title,
        context.category,
        context.detail ?? null,
        context.recordedAt ?? importedAt,
        context.sourceFile ?? 'Health Connect',
      );
      contextUpdated += 1;
      continue;
    }
    const columns = contextColumns(context);
    await database.runAsync(
      `INSERT INTO context_events (
           id, source_id, origin, kind, start_ms, end_ms, title,
           meal_type, carbs_grams, energy_kcal, protein_grams, fat_grams,
           fibre_grams, sugars_grams, saturated_fat_grams, activity_type,
           duration_minutes, intensity, quality_percent, kilograms, amount,
           unit, recorded_at_ms, source_file, source_row
         ) VALUES (?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, NULL, ?, NULL, NULL, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           source_id = excluded.source_id,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           title = excluded.title,
           meal_type = excluded.meal_type,
           carbs_grams = excluded.carbs_grams,
           energy_kcal = excluded.energy_kcal,
           protein_grams = excluded.protein_grams,
           fat_grams = excluded.fat_grams,
           fibre_grams = excluded.fibre_grams,
           sugars_grams = excluded.sugars_grams,
           saturated_fat_grams = excluded.saturated_fat_grams,
           activity_type = excluded.activity_type,
           duration_minutes = excluded.duration_minutes,
           intensity = excluded.intensity,
           kilograms = excluded.kilograms,
           recorded_at_ms = excluded.recorded_at_ms`,
      context.id,
      context.sourceId,
      context.kind,
      context.start,
      context.end ?? null,
      context.title,
      columns.mealType,
      columns.carbsGrams,
      columns.energyKcal,
      columns.proteinGrams,
      columns.fatGrams,
      columns.fibreGrams,
      columns.sugarsGrams,
      columns.saturatedFatGrams,
      columns.activityType,
      columns.durationMinutes,
      columns.intensity,
      columns.kilograms,
      context.recordedAt ?? importedAt,
      context.sourceFile ?? 'Health Connect',
    );
    contextUpdated += 1;
  }
  return contextUpdated;
}

export async function writeHealthConnectPageInBatches(
  records: HealthConnectRecord[],
  sources: HealthConnectSource[],
  importedAt: number,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  if (records.length === 0 && sources.length === 0) return 0;
  let contextUpdated = 0;
  // A source-only page still needs one transaction to retain its label.
  const batchCount = Math.max(
    1,
    Math.ceil(records.length / HEALTH_CONNECT_WRITE_BATCH_SIZE),
  );
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    const offset = batchIndex * HEALTH_CONNECT_WRITE_BATCH_SIZE;
    const batch = records.slice(
      offset,
      offset + HEALTH_CONNECT_WRITE_BATCH_SIZE,
    );
    contextUpdated += await withHealthConnectWriteLease(
      writeLease,
      (database) =>
        writePageInTransaction(database, batch, sources, importedAt),
      expectedConfigurationRevision,
    );
  }
  return contextUpdated;
}

function saveHealthConnectChangesTokenInTransaction(
  database: T1ArcDatabase,
  category: HealthConnectCategoryId,
  token: string,
  sourcePackage?: string,
) {
  return database.runAsync(
    `INSERT INTO health_connect_sync_state (
       category, record_count, changes_token,
       changes_token_source_package
     ) VALUES (?, 0, ?, ?)
     ON CONFLICT(category) DO UPDATE SET
       changes_token = excluded.changes_token,
       changes_token_source_package =
         excluded.changes_token_source_package`,
    category,
    token,
    sourcePackage ?? null,
  );
}

async function saveHealthConnectChangesToken(
  category: HealthConnectCategoryId,
  token: string,
  sourcePackage?: string,
  writeLease?: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  const lease = writeLease ?? (await acquireLocalDataWriteLease());
  await withHealthConnectWriteLease(
    lease,
    (database) =>
      saveHealthConnectChangesTokenInTransaction(
        database,
        category,
        token,
        sourcePackage,
      ),
    expectedConfigurationRevision,
  );
}

async function clearHealthConnectChangesToken(
  category: HealthConnectCategoryId,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  await withHealthConnectWriteLease(
    writeLease,
    (database) =>
      database.runAsync(
        `UPDATE health_connect_sync_state
         SET changes_token = NULL,
             changes_token_source_package = NULL
         WHERE category = ?`,
        category,
      ),
    expectedConfigurationRevision,
  );
}

async function removeHealthConnectRecordsByExternalIdInTransaction(
  database: T1ArcDatabase,
  externalIds: string[],
) {
  const filter = buildHealthConnectExternalIdFilter(externalIds);
  if (!filter) return { recordsRemoved: 0, contextRemoved: 0 };
  const contextEvents = await database.runAsync(
    `DELETE FROM context_events
       WHERE id IN (
         SELECT id FROM health_connect_records
         WHERE ${filter.whereSql}
       )`,
    ...filter.parameters,
  );
  const contextNotes = await database.runAsync(
    `DELETE FROM context_notes
       WHERE id IN (
         SELECT id FROM health_connect_records
         WHERE ${filter.whereSql}
       )`,
    ...filter.parameters,
  );
  const records = await database.runAsync(
    `DELETE FROM health_connect_records
       WHERE ${filter.whereSql}`,
    ...filter.parameters,
  );
  return {
    recordsRemoved: records.changes,
    contextRemoved: contextEvents.changes + contextNotes.changes,
  };
}

export async function removeHealthConnectRecordsByExternalIdInBatches(
  externalIds: string[],
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  const uniqueIds = [...new Set(externalIds.filter(Boolean))];
  const removed = { recordsRemoved: 0, contextRemoved: 0 };
  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += HEALTH_CONNECT_WRITE_BATCH_SIZE
  ) {
    const batch = uniqueIds.slice(
      offset,
      offset + HEALTH_CONNECT_WRITE_BATCH_SIZE,
    );
    const result = await withHealthConnectWriteLease(
      writeLease,
      (database) =>
        removeHealthConnectRecordsByExternalIdInTransaction(database, batch),
      expectedConfigurationRevision,
    );
    removed.recordsRemoved += result.recordsRemoved;
    removed.contextRemoved += result.contextRemoved;
  }
  return removed;
}

interface HealthConnectChangesResult {
  token: string;
  tokenExpired: boolean;
  recordsProcessed: number;
  recordsRemoved: number;
  contextUpdated: number;
  contextRemoved: number;
  sources: HealthConnectSource[];
}

async function applyHealthConnectChanges(
  category: HealthConnectCategoryId,
  initialToken: string,
  preferredSourcePackage: string | undefined,
  importedAt: number,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision: number,
): Promise<HealthConnectChangesResult> {
  let token = initialToken;
  let pages = 0;
  let recordsProcessed = 0;
  let recordsRemoved = 0;
  let contextUpdated = 0;
  let contextRemoved = 0;
  const sources = new Map<string, HealthConnectSource>();

  while (true) {
    const page = await T1ArcHealthConnect.readChangesPageAsync(token);
    if (page.tokenExpired) {
      return {
        token,
        tokenExpired: true,
        recordsProcessed,
        recordsRemoved,
        contextUpdated,
        contextRemoved,
        sources: [...sources.values()],
      };
    }

    // Replace the complete parent before inserting changed samples. This
    // removes heart-rate samples or blood-pressure components that disappeared
    // in an edit, rather than leaving stale child rows behind.
    const upsertParents = healthConnectParentRecordIds(page.upserted);
    await removeHealthConnectRecordsByExternalIdInBatches(
      upsertParents,
      writeLease,
      expectedConfigurationRevision,
    );
    const deleted = await removeHealthConnectRecordsByExternalIdInBatches(
      page.deletedRecordIds,
      writeLease,
      expectedConfigurationRevision,
    );
    contextUpdated += await writeHealthConnectPageInBatches(
      page.upserted,
      page.sources,
      importedAt,
      writeLease,
      expectedConfigurationRevision,
    );
    recordsRemoved += deleted.recordsRemoved;
    contextRemoved += deleted.contextRemoved;
    recordsProcessed += page.upserted.length;
    page.sources.forEach((source) => sources.set(source.packageName, source));
    token = page.nextChangesToken;
    await saveHealthConnectChangesToken(
      category,
      token,
      preferredSourcePackage,
      writeLease,
      expectedConfigurationRevision,
    );
    pages += 1;
    if (!page.hasMore) break;
    if (pages > MAX_CHANGE_PAGES_PER_CATEGORY) {
      throw new Error(
        `Health Connect returned too many change pages for ${category}.`,
      );
    }
  }

  return {
    token,
    tokenExpired: false,
    recordsProcessed,
    recordsRemoved,
    contextUpdated,
    contextRemoved,
    sources: [...sources.values()],
  };
}

async function markSyncAttempt(
  category: HealthConnectCategoryId,
  attemptedAt: number,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision: number,
  requiresFullScan: boolean,
) {
  await withHealthConnectWriteLease(
    writeLease,
    async (database) => {
      await database.runAsync(
        `INSERT INTO health_connect_sync_state (
           category, last_attempt_at_ms, record_count
         ) VALUES (?, ?, 0)
         ON CONFLICT(category) DO UPDATE SET
           last_attempt_at_ms = excluded.last_attempt_at_ms,
           last_error_code = NULL,
           last_error_message = NULL`,
        category,
        attemptedAt,
      );
      if (requiresFullScan) {
        await database.runAsync(
          `UPDATE health_connect_sync_state
           SET changes_token = NULL,
               changes_token_source_package = NULL
           WHERE category = ?`,
          category,
        );
      }
    },
    expectedConfigurationRevision,
  );
}

interface AuthoritativeHealthConnectChangesToken {
  token: string;
  sourcePackage?: string;
}

async function markSyncSuccess(
  category: HealthConnectCategoryId,
  completedAt: number,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision: number,
  authoritativeChangesToken?: AuthoritativeHealthConnectChangesToken,
) {
  const kinds = HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY[category];
  const placeholders = kinds.map(() => '?').join(', ');
  await withHealthConnectWriteLease(
    writeLease,
    async (database) => {
      await database.runAsync(
        `INSERT INTO health_connect_sync_state (
           category, last_attempt_at_ms, last_success_at_ms,
           data_start_ms, data_through_ms, record_count
         )
         SELECT ?, ?, ?, MIN(start_ms), MAX(end_ms), COUNT(*)
         FROM health_connect_records WHERE kind IN (${placeholders})
         ON CONFLICT(category) DO UPDATE SET
           last_success_at_ms = excluded.last_success_at_ms,
           data_start_ms = excluded.data_start_ms,
           data_through_ms = excluded.data_through_ms,
           record_count = excluded.record_count,
           last_error_code = NULL,
           last_error_message = NULL`,
        category,
        completedAt,
        completedAt,
        ...kinds,
      );
      if (authoritativeChangesToken) {
        await saveHealthConnectChangesTokenInTransaction(
          database,
          category,
          authoritativeChangesToken.token,
          authoritativeChangesToken.sourcePackage,
        );
      }
    },
    expectedConfigurationRevision,
  );
}

async function markSyncError(
  category: HealthConnectCategoryId,
  error: unknown,
  writeLease: LocalDataWriteLease,
  expectedConfigurationRevision: number,
) {
  await withHealthConnectWriteLease(
    writeLease,
    (database) =>
      database.runAsync(
        `INSERT INTO health_connect_sync_state (
           category, last_attempt_at_ms, record_count,
           last_error_code, last_error_message
         ) VALUES (?, ?, 0, 'read_failed', ?)
         ON CONFLICT(category) DO UPDATE SET
           last_error_code = excluded.last_error_code,
           last_error_message = excluded.last_error_message`,
        category,
        Date.now(),
        error instanceof Error ? error.message : 'Health Connect read failed.',
      ),
    expectedConfigurationRevision,
  );
}

async function reconcileSuccessfulWindow(
  category: HealthConnectCategoryId,
  startTimeMs: number,
  endTimeMs: number,
  importedAt: number,
  preferredSourcePackage?: string,
  writeLease?: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  const lease = writeLease ?? (await acquireLocalDataWriteLease());
  return withHealthConnectWriteLease(
    lease,
    (database) =>
      reconcileHealthConnectWindowInTransaction(
        database,
        category,
        startTimeMs,
        endTimeMs,
        importedAt,
        preferredSourcePackage,
      ),
    expectedConfigurationRevision,
  );
}

export async function lockHealthConnectSources(
  categories: HealthConnectCategoryId[],
  writeLease?: LocalDataWriteLease,
  expectedConfigurationRevision?: number,
) {
  const lease = writeLease ?? (await acquireLocalDataWriteLease());
  let nextExpectedRevision =
    expectedConfigurationRevision ??
    (await withHealthConnectWriteLease(lease, (database) =>
      readHealthConnectConfigurationRevision(database),
    ));
  const overview = await getHealthConnectOverview();
  for (const category of categories) {
    const candidates = overview.sources.flatMap((source) => {
      const stats = source.categoryStats.find(
        (item) => item.category === category,
      );
      return stats
        ? [
            {
              packageName: source.packageName,
              recordCount: stats.recordCount,
              dataThrough: stats.dataThrough,
            },
          ]
        : [];
    });
    const decision = chooseAutomaticHealthConnectSource(category, candidates);
    if (!decision) continue;

    const changed = await withHealthConnectWriteLease(
      lease,
      async (database) => {
        const current = await database.getFirstAsync<PreferenceRow>(
          `SELECT category, enabled, preferred_source_package,
             preferred_source_mode, updated_at_ms
           FROM health_connect_preferences
           WHERE category = ?`,
          category,
        );
        const currentMode = current?.preferred_source_package
          ? (current.preferred_source_mode ?? 'manual')
          : undefined;
        // This read and the automatic write share one transaction. Whichever
        // commits last between this and a manual choice therefore observes the
        // other, and an automatic decision can never replace manual intent.
        if (
          current?.enabled === 0 ||
          currentMode === 'manual' ||
          (current?.preferred_source_package === decision.packageName &&
            currentMode === 'automatic')
        ) {
          return false;
        }
        await writePreferredHealthConnectSourceInTransaction(
          database,
          category,
          decision.packageName,
          'automatic',
        );
        await bumpHealthConnectConfigurationRevisionInTransaction(database);
        return true;
      },
      nextExpectedRevision,
    );
    if (changed) {
      nextExpectedRevision += 1;
    }
  }
  return nextExpectedRevision;
}

export async function useAutomaticHealthConnectSource(
  category: HealthConnectCategoryId,
) {
  const writeLease = await acquireLocalDataWriteLease();
  await savePreferredHealthConnectSource(
    category,
    undefined,
    'manual',
    writeLease,
  );
  await lockHealthConnectSources([category], writeLease);
}

let healthConnectSyncInFlight: Promise<HealthConnectSyncResult> | undefined;

async function performHealthConnectSync(options?: {
  categories?: HealthConnectCategoryId[];
  fullHistory?: boolean;
  writeLease?: LocalDataWriteLease;
}): Promise<HealthConnectSyncResult> {
  const writeLease =
    options?.writeLease ?? (await acquireLocalDataWriteLease());
  const startedAt = Date.now();
  const status = await getHealthConnectStatus();
  if (status.availability !== 'available') {
    throw new Error('Health Connect is unavailable or needs an update.');
  }

  const { preferences, revision: configurationRevision } =
    await captureHealthConnectSyncConfiguration(writeLease);
  const requested =
    options?.categories ??
    preferences
      .filter((preference) => preference.enabled)
      .map((preference) => preference.category);
  const fullyGranted = new Set(
    status.categories
      .filter((category) => category.granted)
      .map((category) => category.id),
  );
  const categories = requested.filter((category) => fullyGranted.has(category));
  if (!categories.length) {
    throw new Error('Allow at least one Health Connect category first.');
  }

  const overview = await getHealthConnectOverview();
  const stateByCategory = new Map(
    overview.sync.map((state) => [state.category, state]),
  );
  const preferenceByCategory = new Map(
    preferences.map((preference) => [preference.category, preference]),
  );
  let recordsProcessed = 0;
  let recordsRemoved = 0;
  let contextUpdated = 0;
  let contextRemoved = 0;
  const sourcesFound = new Set<string>();
  const successfulCategories: HealthConnectCategoryId[] = [];
  const failures: HealthConnectSyncFailure[] = [];

  for (const category of categories) {
    const attemptedAt = Date.now();
    const prior = stateByCategory.get(category);
    const preferredSource =
      preferenceByCategory.get(category)?.preferredSourcePackage;
    const priorChangesToken = prior?.changesToken;
    const tokenMatchesSource = Boolean(
      priorChangesToken &&
        prior?.changesTokenSourcePackage === preferredSource,
    );
    let fullHistory = Boolean(
      options?.fullHistory || !prior?.lastSuccessAt || !tokenMatchesSource,
    );
    let fullScanMarkerPersisted = fullHistory;
    await markSyncAttempt(
      category,
      attemptedAt,
      writeLease,
      configurationRevision,
      fullHistory,
    );
    let authoritativeChangesToken:
      | AuthoritativeHealthConnectChangesToken
      | undefined;
    let pageToken: string | null = null;
    let pages = 0;

    try {
      if (!fullHistory && tokenMatchesSource) {
        const changes = await applyHealthConnectChanges(
          category,
          priorChangesToken!,
          preferredSource,
          attemptedAt,
          writeLease,
          configurationRevision,
        );
        recordsProcessed += changes.recordsProcessed;
        recordsRemoved += changes.recordsRemoved;
        contextUpdated += changes.contextUpdated;
        contextRemoved += changes.contextRemoved;
        changes.sources.forEach((source) =>
          sourcesFound.add(source.packageName),
        );
        fullHistory = changes.tokenExpired;
      }

      if (fullHistory) {
        // Clearing the authoritative cursor is the durable full-scan marker.
        // If the process dies after this commit, a restart cannot mistake the
        // prior successful scan for permission to use an incremental window.
        if (!fullScanMarkerPersisted) {
          await clearHealthConnectChangesToken(
            category,
            writeLease,
            configurationRevision,
          );
          fullScanMarkerPersisted = true;
        }
        const freshToken = await T1ArcHealthConnect.getChangesTokenAsync(
          category,
          preferredSource ? [preferredSource] : [],
        );
        // Keep this process-local until reconciliation is complete. Success
        // and token promotion commit together in markSyncSuccess below.
        authoritativeChangesToken = {
          token: freshToken,
          sourcePackage: preferredSource,
        };
      }

      const earliestReadableTime = earliestHealthConnectReadableTime({
        historyGranted: status.historyGranted,
        attemptedAt,
        firstAttemptAt: prior?.lastAttemptAt,
      });
      const startTimeMs = fullHistory
        ? earliestReadableTime
        : Math.max(
            earliestReadableTime,
            (prior?.lastSuccessAt ?? attemptedAt) - INCREMENTAL_OVERLAP_MS,
          );
      do {
        const page = await T1ArcHealthConnect.readRecordsPageAsync(
          category,
          startTimeMs,
          attemptedAt,
          preferredSource ? [preferredSource] : [],
          pageToken,
        );
        contextUpdated += await writeHealthConnectPageInBatches(
          page.records,
          page.sources,
          attemptedAt,
          writeLease,
          configurationRevision,
        );
        recordsProcessed += page.records.length;
        page.sources.forEach((source) => sourcesFound.add(source.packageName));
        pageToken = page.nextPageToken;
        pages += 1;
        if (pages > MAX_PAGES_PER_CATEGORY) {
          throw new Error(
            `Health Connect returned too many pages for ${category}.`,
          );
        }
      } while (pageToken);
      const reconciled = await reconcileSuccessfulWindow(
        category,
        startTimeMs,
        attemptedAt,
        attemptedAt,
        preferredSource,
        writeLease,
        configurationRevision,
      );
      recordsRemoved += reconciled.recordsRemoved;
      contextRemoved += reconciled.contextRemoved;
      await markSyncSuccess(
        category,
        Date.now(),
        writeLease,
        configurationRevision,
        authoritativeChangesToken,
      );
      successfulCategories.push(category);
    } catch (error) {
      if (
        isLocalDataWriteSupersededError(error) ||
        isHealthConnectConfigurationSupersededError(error)
      ) {
        throw error;
      }
      // Keep the durable full-scan marker on failure. The clear is idempotent
      // and revision-fenced, including failures returned by a deferred native
      // call after the selected source changed.
      if (fullHistory) {
        await clearHealthConnectChangesToken(
          category,
          writeLease,
          configurationRevision,
        );
      }
      await markSyncError(
        category,
        error,
        writeLease,
        configurationRevision,
      );
      failures.push({
        category,
        code: 'read_failed',
        message:
          error instanceof Error
            ? error.message
            : `Health Connect could not read ${category}.`,
      });
    }
  }

  await lockHealthConnectSources(
    successfulCategories,
    writeLease,
    configurationRevision,
  );

  if (!successfulCategories.length && failures.length) {
    throw new Error(
      failures.length === 1
        ? failures[0]!.message
        : `Health Connect could not update any selected category. ${failures
            .map((failure) => failure.message)
            .join(' ')}`,
    );
  }

  return {
    categories,
    successfulCategories,
    failures,
    recordsProcessed,
    recordsRemoved,
    contextUpdated,
    contextRemoved,
    sourcesFound: sourcesFound.size,
    startedAt,
    completedAt: Date.now(),
  };
}

/**
 * Serialises manual, foreground and Android background imports. Health Connect
 * can invoke the background task while the app is opening, so sharing the
 * in-flight import prevents duplicate reads and competing database writes.
 */
export function syncHealthConnect(options?: {
  categories?: HealthConnectCategoryId[];
  fullHistory?: boolean;
  writeLease?: LocalDataWriteLease;
}): Promise<HealthConnectSyncResult> {
  if (healthConnectSyncInFlight) {
    return healthConnectSyncInFlight;
  }

  const syncPromise = performHealthConnectSync(options);
  healthConnectSyncInFlight = syncPromise;
  const clearInFlight = () => {
    if (healthConnectSyncInFlight === syncPromise) {
      healthConnectSyncInFlight = undefined;
    }
  };
  void syncPromise.then(clearInFlight, clearInFlight);
  return syncPromise;
}

/**
 * Keeps connected health context current when T1 Arc is opened or refreshed.
 * Android may provide the records from Samsung Health, Fitbit, or another
 * source; the selected package and full provenance remain intact.
 */
export async function syncHealthConnectIfDue(
  now = Date.now(),
  minimumIntervalMs = FOREGROUND_SYNC_INTERVAL_MS,
  writeLease?: LocalDataWriteLease,
) {
  const status = await getHealthConnectStatus();
  if (status.availability !== 'available') return undefined;

  const overview = await getHealthConnectOverview();
  const granted = new Set(
    status.categories
      .filter((category) => category.granted)
      .map((category) => category.id),
  );
  const categories = overview.preferences
    .filter(
      (preference) => preference.enabled && granted.has(preference.category),
    )
    .map((preference) => preference.category);
  if (!categories.length) return undefined;

  const syncByCategory = new Map(
    overview.sync.map((state) => [state.category, state]),
  );
  const due = categories.some((category) => {
    const lastAttempt = syncByCategory.get(category)?.lastAttemptAt;
    return !lastAttempt || now - lastAttempt >= minimumIntervalMs;
  });
  if (!due) return undefined;

  return syncHealthConnect({ categories, writeLease });
}
