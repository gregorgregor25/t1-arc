import { describe, expect, it } from 'vitest';

import { buildDailyTimelineSummaries } from '@/domain/dailyTimelineSummary';
import { GlucoseReading, TimelineData } from '@/domain/models';
import {
  dayRange,
  multiDayRange,
  zonedDateTimeToTimestamp,
} from '@/domain/time';

function glucose(
  id: string,
  timestamp: number,
  mmolL: number,
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: 'flat',
    quality: 'measured',
    sourceId: 'test',
  };
}

describe('daily timeline summaries', () => {
  it('groups glucose, overlapping basal, bolus and meals by London day', () => {
    const range = multiDayRange(
      '2026-07-26',
      2,
      zonedDateTimeToTimestamp('2026-07-27'),
    );
    const first = dayRange('2026-07-25');
    const second = dayRange('2026-07-26');
    const data: TimelineData = {
      range,
      glucose: [
        glucose('first-a', first.start, 6),
        glucose('first-b', first.start + 5 * 60_000, 7),
        glucose('second-a', second.start, 11),
        glucose('second-b', second.start + 5 * 60_000, 9),
      ],
      basal: [
        {
          id: 'cross-midnight-basal',
          start: first.end - 60 * 60_000,
          end: second.start + 60 * 60_000,
          rateUnitsPerHour: 1,
          units: 2,
          sourceId: 'test',
        },
      ],
      boluses: [
        {
          id: 'second-bolus',
          timestamp: second.start + 12 * 60 * 60_000,
          units: 4,
          sourceId: 'test',
        },
      ],
      dailyInsulinTotals: [
        {
          id: 'second-total',
          sourceId: 'glooko-export',
          timestamp: second.end - 60_000,
          dateKey: '2026-07-26',
          totalUnits: 7,
          importedAt: second.end,
        },
      ],
      context: [
        {
          id: 'first-meal',
          kind: 'meal',
          start: first.start + 8 * 60 * 60_000,
          sourceId: 'test',
          origin: 'manual',
          title: 'Breakfast',
          mealType: 'breakfast',
          carbsGrams: 42,
        },
        {
          id: 'second-meal',
          kind: 'meal',
          start: second.start + 12 * 60 * 60_000,
          sourceId: 'test',
          origin: 'manual',
          title: 'Lunch',
          mealType: 'lunch',
          carbsGrams: 57,
        },
      ],
      sources: [],
    };

    const summaries = buildDailyTimelineSummaries(data);

    expect(summaries.map((summary) => summary.date)).toEqual([
      '2026-07-26',
      '2026-07-25',
    ]);
    expect(summaries[0]?.glucoseReadings).toBe(2);
    expect(summaries[0]?.insulin.totalUnits).toBe(7);
    expect(summaries[0]?.sourceReportedInsulinUnits).toBe(7);
    expect(summaries[0]?.carbohydrateGrams).toBe(57);
    expect(summaries[0]?.carbohydrateKnownCount).toBe(1);
    expect(summaries[0]?.nutritionPossibleDuplicatePairs).toBe(0);
    expect(summaries[1]?.insulin.totalUnits).toBe(1);
    expect(summaries[1]?.sourceReportedInsulinUnits).toBeUndefined();
    expect(summaries[1]?.carbohydrateGrams).toBe(42);
  });

  it('marks a daily carbohydrate total as partial instead of treating missing values as zero', () => {
    const range = dayRange('2026-07-26');
    const data: TimelineData = {
      range,
      glucose: [],
      basal: [],
      boluses: [],
      context: [
        {
          id: 'known',
          kind: 'meal',
          start: range.start + 10 * 60 * 60_000,
          sourceId: 't1arc-food',
          origin: 'manual',
          title: 'Breakfast',
          mealType: 'breakfast',
          carbsGrams: 42,
        },
        {
          id: 'unknown',
          kind: 'meal',
          start: range.start + 14 * 60 * 60_000,
          sourceId: 'health-connect:mfp',
          origin: 'imported',
          title: 'Meal summary',
          mealType: 'lunch',
          energyKcal: 500,
        },
      ],
      sources: [],
    };

    const [summary] = buildDailyTimelineSummaries(data);

    expect(summary?.carbohydrateGrams).toBe(42);
    expect(summary?.carbohydrateKnownCount).toBe(1);
    expect(summary?.carbohydratePartialCount).toBe(0);
    expect(summary?.mealCount).toBe(2);
  });

  it('uses the real 25-hour London day across the autumn clock change', () => {
    const range = dayRange('2026-10-25');
    const data: TimelineData = {
      range,
      glucose: [],
      basal: [],
      boluses: [],
      context: [],
      sources: [],
    };

    const [summary] = buildDailyTimelineSummaries(data);

    expect((range.end - range.start) / 3_600_000).toBe(25);
    expect(summary?.date).toBe('2026-10-25');
    expect(summary?.glucose.coveragePercent).toBe(0);
  });

  it('shows the latest source snapshot as a partial as-of daily summary', () => {
    const importedAt = zonedDateTimeToTimestamp('2026-08-07', 14, 35);
    const range = dayRange('2026-08-07', zonedDateTimeToTimestamp('2026-08-08'));
    const data: TimelineData = {
      range,
      glucose: [],
      basal: [],
      boluses: [],
      dailyInsulinTotals: [
        {
          id: 'stale',
          sourceId: 'glooko-export',
          timestamp: importedAt,
          dateKey: '2026-08-07',
          basalUnits: 5,
          bolusUnits: 10,
          totalUnits: 15,
          importedAt: importedAt - 60_000,
        },
        {
          id: 'latest',
          sourceId: 'glooko-export',
          timestamp: importedAt,
          dateKey: '2026-08-07',
          basalUnits: 8,
          bolusUnits: 12,
          totalUnits: 20,
          importedAt,
        },
      ],
      context: [],
      sources: [],
    };

    const [summary] = buildDailyTimelineSummaries(data);

    expect(summary?.insulin).toEqual({
      basalUnits: 8,
      bolusUnits: 12,
      totalUnits: 20,
    });
    expect(summary?.insulinPartial).toBe(true);
    expect(summary?.insulinSourceAsOf).toBe(importedAt);
  });
});
