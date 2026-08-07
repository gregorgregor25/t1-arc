import { File } from 'expo-file-system';

import DaymarkGlookoExport, {
  GlookoExportResult,
} from '../../../modules/daymark-glooko-export';
import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';
import {
  glookoRangeDays,
  GLOOKO_MAX_EXPORT_DAYS,
  isDateKey,
} from './glookoBackfill';
import {
  GLOOKO_INCREMENTAL_INTERVAL_MS,
  GlookoAutomaticPlan,
  GlookoSyncState,
  glookoFailureBackoffMs,
  planAutomaticGlookoSync,
} from './glookoSyncPolicy';
import {
  loadGlookoSyncState,
  saveGlookoSyncState,
} from './glookoSyncState';
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from '@/data/import/glookoImport';
import { writeGlookoGlucoseHistory } from '@/data/import/glookoGlucoseImport';
import { ImportWriteResult } from '@/data/persistence/HealthRecordStore';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { addDays, DateKey, toDateKey } from '@/domain/time';

export type GlookoSyncOrigin = 'manual' | 'app-open' | 'background';

export interface GlookoSyncSuccess {
  status: 'success';
  origin: GlookoSyncOrigin;
  days: number;
  prepared: PreparedGlookoImport;
  result: ImportWriteResult;
  syncState: GlookoSyncState;
  diagnostic?: string;
}

export interface GlookoSyncSkipped {
  status: 'skipped';
  origin: GlookoSyncOrigin;
  plan: GlookoAutomaticPlan;
  syncState: GlookoSyncState;
}

export interface GlookoSyncUnavailable {
  status: 'session-required' | 'cancelled' | 'failed';
  origin: GlookoSyncOrigin;
  days: number;
  message: string;
  syncState: GlookoSyncState;
  diagnostic?: string;
}

export type GlookoSyncOutcome =
  | GlookoSyncSuccess
  | GlookoSyncSkipped
  | GlookoSyncUnavailable;

let syncInFlight: Promise<GlookoSyncOutcome> | undefined;
let syncInFlightInteractive = false;

function trackSync(
  promise: Promise<GlookoSyncOutcome>,
  interactive: boolean,
) {
  const tracked = promise.finally(() => {
    if (syncInFlight === tracked) {
      syncInFlight = undefined;
      syncInFlightInteractive = false;
    }
  });
  syncInFlight = tracked;
  syncInFlightInteractive = interactive;
  return tracked;
}

async function waitForSilentSyncToFinish() {
  while (syncInFlight && !syncInFlightInteractive) {
    const current = syncInFlight;
    await current.catch(() => undefined);
  }
}

function insertedRecords(result: ImportWriteResult) {
  return (
    result.insertedGlucose +
    result.insertedBasal +
    result.insertedBoluses +
    result.insertedContext +
    result.insertedDailyTotals
  );
}

function parsedRecords(prepared: PreparedGlookoImport) {
  return prepared.preview.recognisedFiles.reduce(
    (total, file) => total + file.records,
    0,
  );
}

function releasedPrepared(
  prepared: PreparedGlookoImport,
): PreparedGlookoImport {
  return {
    preview: prepared.preview,
    batch: prepared.batch,
  };
}

async function markFailure(
  state: GlookoSyncState,
  now: number,
  code: string,
  message: string,
  sessionRequired: boolean,
) {
  const failures = state.consecutiveFailures + 1;
  const next: GlookoSyncState = {
    ...state,
    sessionStatus: sessionRequired ? 'needs-sign-in' : state.sessionStatus,
    lastAttemptAt: now,
    consecutiveFailures: failures,
    nextEligibleAt: sessionRequired
      ? undefined
      : now + glookoFailureBackoffMs(failures),
    lastErrorCode: code,
    lastErrorMessage: message.slice(0, 240),
  };
  await saveGlookoSyncState(next);
  return next;
}

async function readPreparedExport(exported: Extract<
  GlookoExportResult,
  { status: 'downloaded' }
>) {
  const cachedFile = new File(exported.uri);
  let bytes: Uint8Array | undefined;
  try {
    bytes = await cachedFile.bytes();
    return await prepareGlookoImport(exported.fileName, bytes);
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    try {
      if (cachedFile.exists) cachedFile.delete();
    } catch {
      // The native connector may already have released its private cache file.
    }
  }
}

async function executeSync(
  origin: GlookoSyncOrigin,
  days: number,
  interactive: boolean,
  historicalRange?: { startDate: DateKey; endDate: DateKey },
): Promise<GlookoSyncOutcome> {
  const startedAt = Date.now();
  const previous = await loadGlookoSyncState();
  const requestedEndDate = historicalRange?.endDate ?? toDateKey(startedAt);
  const requestedStartDate =
    historicalRange?.startDate ?? addDays(requestedEndDate, -(days - 1));
  const attemptState: GlookoSyncState = {
    ...previous,
    lastAttemptAt: startedAt,
    lastRangeDays: days,
    ...(historicalRange
      ? {}
      : {
          lastRequestedStartDate: requestedStartDate,
          lastRequestedEndDate: requestedEndDate,
        }),
  };
  let preparedToRelease: PreparedGlookoImport | undefined;
  let downloadedAt: number | undefined;
  await saveGlookoSyncState(attemptState);

  try {
    const exported = historicalRange
      ? interactive
        ? await DaymarkGlookoExport.startRangeExportAsync(
            historicalRange.startDate,
            historicalRange.endDate,
          )
        : await DaymarkGlookoExport.startSilentRangeExportAsync(
            historicalRange.startDate,
            historicalRange.endDate,
          )
      : interactive
        ? await DaymarkGlookoExport.startExportAsync(days)
        : await DaymarkGlookoExport.startSilentExportAsync(days);
    if (exported.status !== 'downloaded') {
      const sessionRequired =
        exported.status === 'session-required';
      const message =
        exported.message ??
        (sessionRequired
          ? 'Open T1 Arc and sign into Glooko again.'
          : 'Glooko did not provide an export.');
      const next = await markFailure(
        attemptState,
        startedAt,
        sessionRequired ? 'session-required' : exported.reason ?? 'cancelled',
        message,
        sessionRequired,
      );
      if (sessionRequired && origin === 'background') {
        await DaymarkGlucoseDisplay.showGlookoSignInRequiredAsync().catch(
          () => false,
        );
      }
      return {
        status: sessionRequired ? 'session-required' : 'cancelled',
        origin,
        days,
        message,
        syncState: next,
        diagnostic: exported.diagnostic,
      };
    }

    downloadedAt = Date.now();
    await saveGlookoSyncState({
      ...attemptState,
      lastDownloadedAt: downloadedAt,
    });
    const prepared = await readPreparedExport(exported);
    preparedToRelease = prepared;
    const store = new SqliteHealthRecordStore();
    // Daily 30-day and weekly/manual 90-day archives are retained in full.
    // Hourly two-week snapshots are normalised but not retained as repeated
    // archive copies; the daily archive preserves every source file and field.
    const retainSource =
      interactive || days >= 30 || historicalRange !== undefined;
    const healthResult = await store.writeImport(
      prepared.batch,
      prepared.preview.basal,
      prepared.preview.boluses,
      prepared.preview.context,
      retainSource ? prepared.sourcePayload : undefined,
      prepared.preview.dailyInsulinTotals,
      prepared.preview.rawRecords,
    );
    const insertedGlucose = await writeGlookoGlucoseHistory(
      new SqliteGlucoseHistoryStore(),
      prepared.preview.glucose,
    );
    const result = {
      ...healthResult,
      insertedGlucose,
      duplicateCount:
        healthResult.duplicateCount +
        Math.max(0, prepared.preview.glucose.length - insertedGlucose),
    };
    const completedAt = Date.now();
    const insertedCount = insertedRecords(result);
    const parsedCount = parsedRecords(prepared);
    const sourceAdvanced =
      prepared.preview.dataThrough !== undefined &&
      (previous.dataThrough === undefined ||
        prepared.preview.dataThrough > previous.dataThrough);
    const recentDataChanged =
      !historicalRange && (sourceAdvanced || insertedCount > 0);
    const checkOutcome =
      parsedCount === 0
        ? 'empty-range' as const
        : recentDataChanged
          ? 'new-data' as const
          : 'no-new-data' as const;
    const next: GlookoSyncState = {
      ...attemptState,
      automaticEnabled: true,
      sessionStatus: 'ready',
      lastAttemptAt: startedAt,
      lastCheckedAt: historicalRange
        ? previous.lastCheckedAt
        : completedAt,
      lastDownloadedAt: downloadedAt ?? completedAt,
      lastDataChangedAt: recentDataChanged
        ? completedAt
        : previous.lastDataChangedAt,
      lastSuccessAt: historicalRange
        ? previous.lastSuccessAt
        : completedAt,
      lastAutomaticAt: interactive ? previous.lastAutomaticAt : completedAt,
      lastFullSuccessAt:
        days >= 30 && !historicalRange
          ? completedAt
          : previous.lastFullSuccessAt,
      lastExtendedSuccessAt:
        days >= 90 && !historicalRange
          ? completedAt
          : previous.lastExtendedSuccessAt,
      dataThrough:
        prepared.preview.dataThrough === undefined
          ? previous.dataThrough
          : previous.dataThrough === undefined
            ? prepared.preview.dataThrough
            : Math.max(previous.dataThrough, prepared.preview.dataThrough),
      nextEligibleAt: completedAt + GLOOKO_INCREMENTAL_INTERVAL_MS,
      consecutiveFailures: 0,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      lastRangeDays: days,
      lastInsertedRecords: insertedCount,
      lastParsedRecords: historicalRange
        ? previous.lastParsedRecords
        : parsedCount,
      lastCheckOutcome: historicalRange
        ? previous.lastCheckOutcome
        : checkOutcome,
      historyBackfillBeforeDate: historicalRange
        ? previous.historyBackfillBeforeDate === undefined ||
          historicalRange.startDate <
            previous.historyBackfillBeforeDate
          ? historicalRange.startDate
          : previous.historyBackfillBeforeDate
        : previous.historyBackfillBeforeDate,
      lastHistoryBackfillAt: historicalRange
        ? completedAt
        : previous.lastHistoryBackfillAt,
    };
    await saveGlookoSyncState(next);
    await DaymarkGlucoseDisplay.cancelGlookoSignInRequiredAsync().catch(
      () => false,
    );
    return {
      status: 'success',
      origin,
      days,
      prepared: releasedPrepared(prepared),
      result,
      syncState: next,
      diagnostic: exported.diagnostic,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Glooko could not be refreshed on this device.';
    const next = await markFailure(
      downloadedAt
        ? { ...attemptState, lastDownloadedAt: downloadedAt }
        : attemptState,
      startedAt,
      'unexpected',
      message,
      false,
    );
    return {
      status: 'failed',
      origin,
      days,
      message,
      syncState: next,
    };
  } finally {
    preparedToRelease?.sourcePayload?.bytes.fill(0);
  }
}

export async function syncGlookoManually(days = 90) {
  await waitForSilentSyncToFinish();
  if (syncInFlight) return syncInFlight;
  return trackSync(executeSync('manual', days, true), true);
}

/**
 * Runs the same saved-session, invisible export used by foreground and
 * background automation without waiting for the normal due-time policy.
 */
export async function syncGlookoSilentlyNow(days = 1) {
  if (!Number.isInteger(days) || days < 1 || days > GLOOKO_MAX_EXPORT_DAYS) {
    throw new Error('A quiet Glooko refresh must contain 1 to 90 days.');
  }
  if (syncInFlight) return syncInFlight;
  return trackSync(executeSync('app-open', days, false), false);
}

export async function syncGlookoHistoryRange(
  startDate: DateKey,
  endDate: DateKey,
) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    throw new Error('Choose a valid Glooko history range.');
  }
  const days = glookoRangeDays(startDate, endDate);
  if (days < 1 || days > GLOOKO_MAX_EXPORT_DAYS) {
    throw new Error('A Glooko history range must contain 1 to 90 days.');
  }
  await waitForSilentSyncToFinish();
  if (syncInFlight) return syncInFlight;
  return trackSync(
    executeSync('manual', days, true, {
      startDate,
      endDate,
    }),
    true,
  );
}

export async function syncGlookoIfDue(
  origin: Exclude<GlookoSyncOrigin, 'manual'>,
) {
  if (syncInFlight) return syncInFlight;
  const state = await loadGlookoSyncState();
  const plan = planAutomaticGlookoSync(state);
  if (!plan.due) {
    return {
      status: 'skipped',
      origin,
      plan,
      syncState: state,
    } satisfies GlookoSyncSkipped;
  }
  return trackSync(
    executeSync(
      origin,
      plan.days,
      false,
      plan.reason === 'history-backfill'
        ? plan.historicalRange
        : undefined,
    ),
    false,
  );
}
