import {
  acquireInsightInputGeneration,
  assertInsightInputGenerationCurrent,
  getSavedInsightReport,
  pruneInsightReports,
  removeSavedInsightReport,
  saveInsightReport,
  SavedInsightReport,
} from './insightReportRepository';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { getDailyHealthMetricSnapshot } from '@/data/healthConnect/dailyHealthMetrics';
import { GLOOKO_SOURCE_ID } from '@/data/import/glookoCsv';
import { buildGlookoReportFindings } from '@/data/glooko/glookoReportEvidence';
import { buildInsightReport } from '@/domain/insights';
import { hasInsightReviewEvidence } from '@/domain/insightPersistence';
import { TimelineData, TimeRange } from '@/domain/models';
import {
  addDays,
  dayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

const DEFAULT_REVIEW_REFRESH_MS = 6 * 3_600_000;
const REVIEW_RETENTION_DAYS = 120;

const glucoseStore = new SqliteGlucoseHistoryStore();
const healthStore = new SqliteHealthRecordStore();

export interface InsightReviewGenerationResult {
  saved: SavedInsightReport;
  changed: boolean;
  skipped: boolean;
}

let reviewGenerationInFlight:
  | {
      epoch: number;
      inputGeneration: number;
      promise: Promise<InsightReviewGenerationResult>;
    }
  | undefined;
let noEvidenceAttempt:
  | {
      attemptedAt: number;
      epoch: number;
      inputGeneration: number;
      result: InsightReviewGenerationResult;
    }
  | undefined;

function rollingReviewId(now: number) {
  const today = toDateKey(now);
  return `rolling-week:${dayRange(today, now).start}`;
}

async function loadStoredTimeline(
  range: TimeRange,
  insulinAvailable: boolean,
): Promise<TimelineData> {
  const [
    glucose,
    basal,
    boluses,
    dailyInsulinTotals,
    pumpStates,
    context,
  ] = await Promise.all([
    glucoseStore.getReadings(range),
    healthStore.getBasalDeliveries(range),
    healthStore.getBolusDeliveries(range),
    healthStore.getDailyInsulinTotals(range),
    healthStore.getPumpStateIntervals(range),
    healthStore.getContextEvents(range),
  ]);
  return {
    range,
    glucose,
    basal,
    boluses,
    dailyInsulinTotals,
    pumpStates,
    context,
    sources: [
      {
        id: 'stored-glucose',
        label: 'Glucose',
        detail: 'Encrypted on-device glucose history',
        freshness: glucose.length ? 'current' : 'missing',
        origin: 'imported',
        recordCount: glucose.length,
        isLive: false,
      },
      {
        id: 'glooko-export',
        label: 'Insulin',
        detail: 'Encrypted on-device pump delivery history',
        freshness: insulinAvailable ? 'delayed' : 'missing',
        origin: 'imported',
        recordCount: basal.length + boluses.length,
        isLive: false,
      },
    ],
  };
}

/**
 * Builds a seven-complete-day review from encrypted local records. Calling
 * this repeatedly is cheap: the same period is recomputed at most every six
 * hours, and unchanged evidence does not create a new unread review.
 */
async function performInsightReviewGeneration(
  now: number,
  minimumRefreshMs: number,
  writeLease: LocalDataWriteLease,
  inputGeneration: number,
): Promise<InsightReviewGenerationResult> {
  const today = toDateKey(now);
  const todayStart = dayRange(today, now).start;
  const id = rollingReviewId(now);
  const existing = await getSavedInsightReport(id);
  if (existing && !hasInsightReviewEvidence(existing.report)) {
    await removeSavedInsightReport(id, writeLease);
  }
  if (
    existing &&
    hasInsightReviewEvidence(existing.report) &&
    existing.report.inputGeneration === inputGeneration &&
    now - existing.updatedAt < minimumRefreshMs
  ) {
    await assertInsightInputGenerationCurrent(inputGeneration);
    return { saved: existing, changed: false, skipped: true };
  }

  const currentRange = {
    start: dayRange(addDays(today, -7), now).start,
    end: todayStart,
  };
  const previousRange = {
    start: dayRange(addDays(today, -14), now).start,
    end: currentRange.start,
  };
  const insulinBounds = await healthStore.getInsulinBounds();
  const [current, previous, currentHealth, previousHealth, pumpReportRecords] =
    await Promise.all([
      loadStoredTimeline(currentRange, insulinBounds.count > 0),
      loadStoredTimeline(previousRange, insulinBounds.count > 0),
      getDailyHealthMetricSnapshot(currentRange),
      getDailyHealthMetricSnapshot(previousRange),
      healthStore.getRawSourceRecords(GLOOKO_SOURCE_ID, undefined, [
        'pump-mode-summary',
        'pump-mode-daily',
        'pump-state-interval',
        'pump-settings',
      ]),
    ]);
  await assertInsightInputGenerationCurrent(inputGeneration);
  const report = buildInsightReport(
    current,
    previous,
    now,
    {
      current: currentHealth,
      previous: previousHealth,
    },
    inputGeneration,
  );
  report.findings.push(
    ...buildGlookoReportFindings(pumpReportRecords, currentRange),
  );
  if (!hasInsightReviewEvidence(report)) {
    await assertInsightInputGenerationCurrent(inputGeneration);
    return {
      saved: {
        id,
        report,
        generatedAt: now,
        updatedAt: now,
        inputFingerprint: 'no-glucose-evidence',
      },
      changed: false,
      skipped: true,
    };
  }
  const result = await saveInsightReport(report, writeLease);
  const retentionBoundary = zonedDateTimeToTimestamp(
    addDays(today, -REVIEW_RETENTION_DAYS),
  );
  await pruneInsightReports(retentionBoundary, writeLease);
  await assertInsightInputGenerationCurrent(inputGeneration);
  return { ...result, skipped: false };
}

export async function generateInsightReviewIfDue(
  now = Date.now(),
  minimumRefreshMs = DEFAULT_REVIEW_REFRESH_MS,
  lease?: LocalDataWriteLease,
): Promise<InsightReviewGenerationResult> {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const inputGeneration = await acquireInsightInputGeneration();
  if (reviewGenerationInFlight?.epoch === writeLease.epoch) {
    if (
      minimumRefreshMs !== 0 &&
      reviewGenerationInFlight.inputGeneration === inputGeneration
    ) {
      return reviewGenerationInFlight.promise;
    }
    const settledGeneration = reviewGenerationInFlight.promise.then(
      () => undefined,
      () => undefined,
    );
    return settledGeneration.then(() =>
      generateInsightReviewIfDue(now, minimumRefreshMs, writeLease),
    );
  }
  const elapsedSinceNoEvidenceAttempt = noEvidenceAttempt
    ? now - noEvidenceAttempt.attemptedAt
    : undefined;
  if (
    minimumRefreshMs > 0 &&
    noEvidenceAttempt?.epoch === writeLease.epoch &&
    noEvidenceAttempt?.inputGeneration === inputGeneration &&
    noEvidenceAttempt?.result.saved.id === rollingReviewId(now) &&
    elapsedSinceNoEvidenceAttempt !== undefined &&
    elapsedSinceNoEvidenceAttempt >= 0 &&
    elapsedSinceNoEvidenceAttempt < minimumRefreshMs
  ) {
    return Promise.resolve(noEvidenceAttempt.result);
  }
  const generation = performInsightReviewGeneration(
    now,
    minimumRefreshMs,
    writeLease,
    inputGeneration,
  );
  reviewGenerationInFlight = {
    epoch: writeLease.epoch,
    inputGeneration,
    promise: generation,
  };
  const clearInFlight = () => {
    if (reviewGenerationInFlight?.promise === generation) {
      reviewGenerationInFlight = undefined;
    }
  };
  void generation.then(
    (result) => {
      if (
        result.skipped &&
        result.saved.inputFingerprint === 'no-glucose-evidence'
      ) {
        noEvidenceAttempt = {
          attemptedAt: now,
          epoch: writeLease.epoch,
          inputGeneration,
          result,
        };
      } else {
        noEvidenceAttempt = undefined;
      }
      clearInFlight();
    },
    clearInFlight,
  );
  return generation;
}
