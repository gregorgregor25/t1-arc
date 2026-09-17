import { describe, expect, it, vi } from 'vitest';

import { generateInsightReviewIfDue } from '@/data/insights/insightReviewGenerator';

const mocks = vi.hoisted(() => ({
  getSavedInsightReport: vi.fn(async (): Promise<any> => undefined),
  acquireInsightInputGeneration: vi.fn(async () => 0),
  assertInsightInputGenerationCurrent: vi.fn(async () => undefined),
  removeSavedInsightReport: vi.fn(async () => undefined),
  saveInsightReport: vi.fn<(...args: any[]) => Promise<any>>(),
  pruneInsightReports: vi.fn(async () => undefined),
  getGlucoseReadings: vi.fn(async () => []),
  getInsulinBounds: vi.fn(async () => ({ count: 0 })),
  getBasalDeliveries: vi.fn(async () => []),
  getBolusDeliveries: vi.fn(async () => []),
  getDailyInsulinTotals: vi.fn(async () => []),
  getPumpStateIntervals: vi.fn(async () => []),
  getContextEvents: vi.fn(async () => []),
  getRawSourceRecords: vi.fn(async () => []),
  getDailyHealthMetricSnapshot: vi.fn(async () => ({})),
  buildInsightReport: vi.fn((..._args: any[]): any => ({ findings: [] })),
  hasInsightReviewEvidence: vi.fn(() => false),
}));

vi.mock('@/data/insights/insightReportRepository', () => ({
  acquireInsightInputGeneration: mocks.acquireInsightInputGeneration,
  assertInsightInputGenerationCurrent:
    mocks.assertInsightInputGenerationCurrent,
  getSavedInsightReport: mocks.getSavedInsightReport,
  removeSavedInsightReport: mocks.removeSavedInsightReport,
  saveInsightReport: mocks.saveInsightReport,
  pruneInsightReports: mocks.pruneInsightReports,
}));

vi.mock('@/data/persistence/SqliteGlucoseHistoryStore', () => ({
  SqliteGlucoseHistoryStore: class {
    getReadings = mocks.getGlucoseReadings;
  },
}));

vi.mock('@/data/persistence/SqliteHealthRecordStore', () => ({
  SqliteHealthRecordStore: class {
    getInsulinBounds = mocks.getInsulinBounds;
    getBasalDeliveries = mocks.getBasalDeliveries;
    getBolusDeliveries = mocks.getBolusDeliveries;
    getDailyInsulinTotals = mocks.getDailyInsulinTotals;
    getPumpStateIntervals = mocks.getPumpStateIntervals;
    getContextEvents = mocks.getContextEvents;
    getRawSourceRecords = mocks.getRawSourceRecords;
  },
}));

vi.mock('@/data/healthConnect/dailyHealthMetrics', () => ({
  getDailyHealthMetricSnapshot: mocks.getDailyHealthMetricSnapshot,
}));

vi.mock('@/domain/insights', () => ({
  buildInsightReport: mocks.buildInsightReport,
}));

vi.mock('@/domain/insightPersistence', () => ({
  hasInsightReviewEvidence: mocks.hasInsightReviewEvidence,
}));

vi.mock('@/data/glooko/glookoReportEvidence', () => ({
  buildGlookoReportFindings: vi.fn(() => []),
}));

vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: 0 }),
}));

describe('insight review generation cadence', () => {
  it('invalidates cached attempts when durable inputs change and preserves forced regeneration', async () => {
    const now = Date.parse('2026-08-19T12:00:00+01:00');

    const first = await generateInsightReviewIfDue(now);
    const cached = await generateInsightReviewIfDue(now + 60_000);

    expect(first.skipped).toBe(true);
    expect(first.saved.inputFingerprint).toBe('no-glucose-evidence');
    expect(cached).toBe(first);
    expect(mocks.getInsulinBounds).toHaveBeenCalledOnce();
    expect(mocks.getGlucoseReadings).toHaveBeenCalledTimes(2);

    mocks.acquireInsightInputGeneration.mockResolvedValue(1);
    const afterDurableChange = await generateInsightReviewIfDue(
      now + 120_000,
    );

    expect(mocks.getInsulinBounds).toHaveBeenCalledTimes(2);
    expect(mocks.getGlucoseReadings).toHaveBeenCalledTimes(4);
    expect(afterDurableChange).not.toBe(first);

    const cachedAfterChange = await generateInsightReviewIfDue(
      now + 180_000,
    );
    expect(cachedAfterChange).toBe(afterDurableChange);
    expect(mocks.getInsulinBounds).toHaveBeenCalledTimes(2);

    await generateInsightReviewIfDue(now + 120_000 + 6 * 3_600_000 + 1);

    expect(mocks.getInsulinBounds).toHaveBeenCalledTimes(3);
    expect(mocks.getGlucoseReadings).toHaveBeenCalledTimes(6);

    await generateInsightReviewIfDue(
      now + 120_000 + 6 * 3_600_000 + 60_000,
      0,
    );

    expect(mocks.getInsulinBounds).toHaveBeenCalledTimes(4);
    expect(mocks.getGlucoseReadings).toHaveBeenCalledTimes(8);
  });

  it('rebuilds a recent saved report after a durable generation change', async () => {
    vi.clearAllMocks();
    const now = Date.parse('2026-08-20T12:00:00+01:00');
    const staleReport = {
      inputGeneration: 7,
      generatedAt: now - 60_000,
      currentRange: { start: now - 7 * 86_400_000, end: now },
      previousRange: { start: now - 14 * 86_400_000, end: now - 7 * 86_400_000 },
      ready: true,
      headline: 'Previous review',
      summary: 'Previous summary',
      findings: [],
    };
    const rebuiltReport = {
      ...staleReport,
      inputGeneration: 8,
      generatedAt: now,
      headline: 'Rebuilt review',
    };
    mocks.acquireInsightInputGeneration.mockResolvedValue(8);
    mocks.hasInsightReviewEvidence.mockReturnValue(true);
    mocks.getSavedInsightReport.mockResolvedValue({
      id: 'recent-review',
      report: staleReport,
      generatedAt: staleReport.generatedAt,
      updatedAt: now - 1_000,
      inputFingerprint: 'previous',
    });
    mocks.buildInsightReport.mockReturnValue(rebuiltReport);
    mocks.saveInsightReport.mockResolvedValue({
      saved: {
        id: 'rebuilt-review',
        report: rebuiltReport,
        generatedAt: now,
        updatedAt: now,
        inputFingerprint: 'rebuilt',
      },
      changed: true,
    });

    const result = await generateInsightReviewIfDue(
      now,
      6 * 3_600_000,
      { epoch: 8 },
    );

    expect(result.skipped).toBe(false);
    expect(mocks.getInsulinBounds).toHaveBeenCalledOnce();
    expect(mocks.getGlucoseReadings).toHaveBeenCalledTimes(2);
    expect(mocks.buildInsightReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      now,
      expect.anything(),
      8,
    );
    expect(mocks.saveInsightReport).toHaveBeenCalledOnce();
  });
});
