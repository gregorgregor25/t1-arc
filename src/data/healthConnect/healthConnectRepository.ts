import DaymarkHealthConnect, {
  HealthConnectCategoryId,
  HealthConnectRecord,
  HealthConnectSource,
  HealthConnectStatus,
} from '../../../modules/daymark-health-connect';

import {
  DEFAULT_HEALTH_CONNECT_CATEGORIES,
  healthConnectRecordId,
  healthConnectRecordToContext,
} from './healthConnectRecords';
import {
  openDaymarkDatabase,
  withDaymarkTransaction,
} from '@/data/persistence/daymarkDatabase';
import { HealthContextEvent } from '@/domain/models';

const EARLIEST_IMPORT_MS = Date.parse('2000-01-01T00:00:00Z');
const INCREMENTAL_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_CATEGORY = 10_000;

interface PreferenceRow {
  category: HealthConnectCategoryId;
  enabled: number;
  preferred_source_package: string | null;
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
}

export interface HealthConnectPreference {
  category: HealthConnectCategoryId;
  enabled: boolean;
  preferredSourcePackage?: string;
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
}

export interface StoredHealthConnectSource extends HealthConnectSource {
  firstSeenAt: number;
  lastSeenAt: number;
  recordCount: number;
  categories: HealthConnectCategoryId[];
}

export interface HealthConnectOverview {
  totalRecords: number;
  earliest?: number;
  latest?: number;
  preferences: HealthConnectPreference[];
  sync: HealthConnectSyncState[];
  sources: StoredHealthConnectSource[];
}

export interface HealthConnectSyncResult {
  categories: HealthConnectCategoryId[];
  recordsProcessed: number;
  contextUpdated: number;
  sourcesFound: number;
  startedAt: number;
  completedAt: number;
}

function preferenceFromRow(row: PreferenceRow): HealthConnectPreference {
  return {
    category: row.category,
    enabled: row.enabled === 1,
    preferredSourcePackage: row.preferred_source_package ?? undefined,
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
  };
}

export function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  return DaymarkHealthConnect.getStatusAsync();
}

export function requestHealthConnectPermissions(
  categories: HealthConnectCategoryId[],
) {
  return DaymarkHealthConnect.requestPermissionsAsync(
    categories,
    true,
    false,
  );
}

export function openHealthConnectSourceDiscovery(
  categories: HealthConnectCategoryId[],
) {
  return DaymarkHealthConnect.openSourceDiscoveryAsync(categories);
}

export function openHealthConnectSettings() {
  return DaymarkHealthConnect.openSettingsAsync();
}

export function openHealthConnectInstall() {
  return DaymarkHealthConnect.openInstallAsync();
}

export async function loadHealthConnectPreferences(): Promise<
  HealthConnectPreference[]
> {
  const database = await openDaymarkDatabase();
  const rows = await database.getAllAsync<PreferenceRow>(
    `SELECT category, enabled, preferred_source_package, updated_at_ms
     FROM health_connect_preferences`,
  );
  if (!rows.length) {
    return DEFAULT_HEALTH_CONNECT_CATEGORIES.map(
      (category): HealthConnectPreference => ({
        category,
        enabled: true,
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
        enabled: true,
        updatedAt: 0,
      },
  );
}

export async function saveHealthConnectPreferences(
  enabledCategories: HealthConnectCategoryId[],
) {
  const enabled = new Set(enabledCategories);
  const updatedAt = Date.now();
  await withDaymarkTransaction(async (database) => {
    for (const category of DEFAULT_HEALTH_CONNECT_CATEGORIES) {
      await database.runAsync(
        `INSERT INTO health_connect_preferences (
           category, enabled, preferred_source_package, updated_at_ms
         ) VALUES (?, ?, NULL, ?)
         ON CONFLICT(category) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at_ms = excluded.updated_at_ms`,
        category,
        enabled.has(category) ? 1 : 0,
        updatedAt,
      );
    }
  });
}

export async function savePreferredHealthConnectSource(
  category: HealthConnectCategoryId,
  packageName?: string,
) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
    `INSERT INTO health_connect_preferences (
       category, enabled, preferred_source_package, updated_at_ms
     ) VALUES (?, 1, ?, ?)
     ON CONFLICT(category) DO UPDATE SET
       preferred_source_package = excluded.preferred_source_package,
       updated_at_ms = excluded.updated_at_ms`,
    category,
    packageName ?? null,
    Date.now(),
  );
}

export async function getHealthConnectOverview(): Promise<HealthConnectOverview> {
  const database = await openDaymarkDatabase();
  const [bounds, preferences, sync, sources, sourceCategories] = await Promise.all([
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
         last_error_code, last_error_message
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
      `SELECT DISTINCT source_package AS package_name, kind
       FROM health_connect_records`,
    ),
  ]);
  const categoriesByPackage = new Map<string, Set<HealthConnectCategoryId>>();
  for (const row of sourceCategories) {
    const categories =
      categoriesByPackage.get(row.package_name) ??
      new Set<HealthConnectCategoryId>();
    categories.add(categoryForRecordKind(row.kind));
    categoriesByPackage.set(row.package_name, categories);
  }

  return {
    totalRecords: bounds?.total ?? 0,
    earliest: bounds?.earliest ?? undefined,
    latest: bounds?.latest ?? undefined,
    preferences,
    sync: sync.map(syncFromRow),
    sources: sources.map((source) => ({
      packageName: source.package_name,
      displayName: source.display_name,
      firstSeenAt: source.first_seen_at_ms,
      lastSeenAt: source.last_seen_at_ms,
      recordCount: source.record_count,
      categories: [
        ...(categoriesByPackage.get(source.package_name) ?? new Set()),
      ],
    })),
  };
}

function categoryForRecordKind(
  kind: HealthConnectRecord['kind'],
): HealthConnectCategoryId {
  if (kind === 'workout') return 'workouts';
  if (kind === 'heart_rate' || kind === 'resting_heart_rate') {
    return 'heart_rate';
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
  };
}

async function writePage(
  records: HealthConnectRecord[],
  sources: HealthConnectSource[],
  importedAt: number,
) {
  let contextUpdated = 0;
  await withDaymarkTransaction(async (database) => {
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
      const id = healthConnectRecordId(record);
      await database.runAsync(
        `INSERT INTO health_connect_records (
           id, external_id, parent_external_id, kind, source_package,
           start_ms, end_ms, last_modified_ms, recording_method,
           value, unit, payload_json, imported_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           parent_external_id = excluded.parent_external_id,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           last_modified_ms = excluded.last_modified_ms,
           recording_method = excluded.recording_method,
           value = excluded.value,
           unit = excluded.unit,
           payload_json = excluded.payload_json,
           imported_at_ms = excluded.imported_at_ms`,
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

      const context = healthConnectRecordToContext(record, importedAt);
      if (!context) continue;
      const columns = contextColumns(context);
      await database.runAsync(
        `INSERT INTO context_events (
           id, source_id, origin, kind, start_ms, end_ms, title,
           meal_type, carbs_grams, activity_type, duration_minutes,
           intensity, quality_percent, kilograms, amount, unit,
           recorded_at_ms, source_file, source_row
         ) VALUES (?, ?, 'imported', ?, ?, ?, ?, NULL, NULL, ?, ?, ?,
           NULL, ?, NULL, NULL, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           source_id = excluded.source_id,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           title = excluded.title,
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
        columns.activityType,
        columns.durationMinutes,
        columns.intensity,
        columns.kilograms,
        context.recordedAt ?? importedAt,
        context.sourceFile ?? 'Health Connect',
      );
      contextUpdated += 1;
    }
  });
  return contextUpdated;
}

async function markSyncAttempt(
  category: HealthConnectCategoryId,
  attemptedAt: number,
) {
  const database = await openDaymarkDatabase();
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
}

async function markSyncSuccess(
  category: HealthConnectCategoryId,
  completedAt: number,
) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
    `INSERT INTO health_connect_sync_state (
       category, last_attempt_at_ms, last_success_at_ms,
       data_start_ms, data_through_ms, record_count
     )
     SELECT ?, ?, ?, MIN(start_ms), MAX(end_ms), COUNT(*)
     FROM health_connect_records WHERE kind IN (
       CASE WHEN ? = 'workouts' THEN 'workout' ELSE ? END,
       CASE WHEN ? = 'heart_rate' THEN 'resting_heart_rate' ELSE ? END
     )
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
    category,
    category,
    category,
    category,
  );
}

async function markSyncError(
  category: HealthConnectCategoryId,
  error: unknown,
) {
  const database = await openDaymarkDatabase();
  await database.runAsync(
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
  );
}

async function chooseUnambiguousSources(
  categories: HealthConnectCategoryId[],
) {
  const overview = await getHealthConnectOverview();
  for (const category of categories) {
    const preference = overview.preferences.find(
      (item) => item.category === category,
    );
    if (preference?.preferredSourcePackage) continue;
    const candidates = overview.sources.filter((source) =>
      source.categories.includes(category),
    );
    if (candidates.length === 1) {
      await savePreferredHealthConnectSource(
        category,
        candidates[0]!.packageName,
      );
    }
  }
}

export async function syncHealthConnect(options?: {
  categories?: HealthConnectCategoryId[];
  fullHistory?: boolean;
}): Promise<HealthConnectSyncResult> {
  const startedAt = Date.now();
  const status = await getHealthConnectStatus();
  if (status.availability !== 'available') {
    throw new Error('Health Connect is unavailable or needs an update.');
  }

  const preferences = await loadHealthConnectPreferences();
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
  const categories = requested.filter((category) =>
    fullyGranted.has(category),
  );
  if (!categories.length) {
    throw new Error('Allow at least one Health Connect category first.');
  }

  await saveHealthConnectPreferences(requested);
  const overview = await getHealthConnectOverview();
  const stateByCategory = new Map(
    overview.sync.map((state) => [state.category, state]),
  );
  const preferenceByCategory = new Map(
    preferences.map((preference) => [preference.category, preference]),
  );
  let recordsProcessed = 0;
  let contextUpdated = 0;
  const sourcesFound = new Set<string>();

  for (const category of categories) {
    const attemptedAt = Date.now();
    await markSyncAttempt(category, attemptedAt);
    const prior = stateByCategory.get(category);
    const fullHistory = options?.fullHistory || !prior?.lastSuccessAt;
    const startTimeMs = fullHistory
      ? EARLIEST_IMPORT_MS
      : Math.max(
          EARLIEST_IMPORT_MS,
          (prior?.lastSuccessAt ?? attemptedAt) - INCREMENTAL_OVERLAP_MS,
        );
    const preferredSource =
      preferenceByCategory.get(category)?.preferredSourcePackage;
    let pageToken: string | null = null;
    let pages = 0;

    try {
      do {
        const page = await DaymarkHealthConnect.readRecordsPageAsync(
          category,
          startTimeMs,
          attemptedAt,
          preferredSource ? [preferredSource] : [],
          pageToken,
        );
        contextUpdated += await writePage(
          page.records,
          page.sources,
          attemptedAt,
        );
        recordsProcessed += page.records.length;
        page.sources.forEach((source) =>
          sourcesFound.add(source.packageName),
        );
        pageToken = page.nextPageToken;
        pages += 1;
        if (pages > MAX_PAGES_PER_CATEGORY) {
          throw new Error(
            `Health Connect returned too many pages for ${category}.`,
          );
        }
      } while (pageToken);
      await markSyncSuccess(category, Date.now());
    } catch (error) {
      await markSyncError(category, error);
      throw error;
    }
  }

  await chooseUnambiguousSources(categories);

  return {
    categories,
    recordsProcessed,
    contextUpdated,
    sourcesFound: sourcesFound.size,
    startedAt,
    completedAt: Date.now(),
  };
}
