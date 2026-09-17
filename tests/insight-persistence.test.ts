import { describe, expect, it } from 'vitest';

import {
  fingerprintInsightReport,
  hasInsightReviewEvidence,
  insightEvidenceRecordCount,
  insightReportId,
} from '../src/domain/insightPersistence';
import { InsightReport } from '../src/domain/insights';

function report(): InsightReport {
  return {
    generatedAt: 100,
    currentRange: { start: 20, end: 30 },
    previousRange: { start: 10, end: 20 },
    ready: true,
    headline: 'A review',
    summary: 'A summary',
    current: {
      glucoseAverage: 7,
      glucoseStandardDeviation: 1,
      glucoseCvPercent: 14,
      timeInRangePercent: 80,
      timeAbovePercent: 15,
      timeBelowPercent: 5,
      coveragePercent: 95,
      glucoseReadings: 100,
      highGlucoseRuns: 2,
      lowGlucoseRuns: 1,
      insulinUnits: 200,
      mealCarbsPerDay: 150,
      lateMeals: 2,
      sleepMinutesPerNight: 450,
      activityMinutes: 120,
    },
    previous: {
      glucoseAverage: 7.2,
      glucoseStandardDeviation: 1.1,
      glucoseCvPercent: 15,
      timeInRangePercent: 78,
      timeAbovePercent: 17,
      timeBelowPercent: 5,
      coveragePercent: 94,
      glucoseReadings: 100,
      highGlucoseRuns: 3,
      lowGlucoseRuns: 1,
      insulinUnits: 205,
      mealCarbsPerDay: 160,
      lateMeals: 3,
      sleepMinutesPerNight: 430,
      activityMinutes: 90,
    },
    findings: [
      {
        id: 'finding',
        kind: 'observation',
        category: 'glucose',
        title: 'Finding',
        summary: 'Supported',
        evidence: [
          {
            id: 'evidence',
            label: 'Evidence',
            description: 'Three references with one duplicate',
            range: { start: 20, end: 30 },
            recordIds: ['reading-1', 'reading-2', 'reading-1'],
            examples: [],
          },
        ],
      },
    ],
  };
}

describe('insight persistence metadata', () => {
  it('keeps the fingerprint stable when only generation time changes', () => {
    const first = report();
    const second = { ...first, generatedAt: 999 };
    expect(fingerprintInsightReport(second)).toBe(
      fingerprintInsightReport(first),
    );
  });

  it('changes the fingerprint when a calculated value changes', () => {
    const first = report();
    const second = {
      ...first,
      current: { ...first.current, timeInRangePercent: 81 },
    };
    expect(fingerprintInsightReport(second)).not.toBe(
      fingerprintInsightReport(first),
    );
  });

  it('uses the period end as identity and counts unique evidence rows', () => {
    const value = report();
    expect(insightReportId(value)).toBe('rolling-week:30');
    expect(insightEvidenceRecordCount(value)).toBe(2);
  });

  it('retains partial baselines but rejects a zero-reading review', () => {
    const partial = report();
    partial.ready = false;
    partial.current.glucoseReadings = 1;
    partial.previous.glucoseReadings = 0;
    expect(hasInsightReviewEvidence(partial)).toBe(true);

    partial.current.glucoseReadings = 0;
    expect(hasInsightReviewEvidence(partial)).toBe(false);
  });
});
