import { describe, expect, it, vi } from 'vitest';

import {
  dailySummaryAccessibilityLabel,
  presentDailySummaryGlucose,
  presentDailySummaryInsulin,
} from '@/components/DailySummaryCard';
import { DailyTimelineSummary } from '@/domain/dailyTimelineSummary';
import { zonedDateTimeToTimestamp } from '@/domain/time';

vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock('react-native', () => ({
  Pressable: () => null,
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Text: () => null,
  View: () => null,
}));
vi.mock('@/theme/theme', () => ({ useAppTheme: vi.fn() }));
vi.mock('@/components/SectionCard', () => ({ SectionCard: () => null }));
vi.mock('@/providers/RegionalProfileProvider', () => ({
  useRegionalProfile: () => ({
    defaults: {
      locale: 'en-GB',
      timeZone: 'Europe/London',
      glucoseUnit: 'mmolL',
      measurementSystem: 'metric',
      energyUnit: 'kcal',
    },
  }),
}));

function summary(
  overrides: Partial<DailyTimelineSummary> = {},
): DailyTimelineSummary {
  return {
    date: '2026-08-18',
    glucose: {
      averageMmolL: 6.2,
      coefficientOfVariationPercent: 12,
      coveragePercent: 90,
      observedMinutes: 1_200,
      standardDeviationMmolL: 0.8,
      timeAbovePercent: 5,
      timeBelowPercent: 5,
      timeInRangePercent: 90,
    },
    glucoseReadings: 250,
    insulin: { basalUnits: 3, bolusUnits: 1.2, totalUnits: 4.2 },
    insulinPartial: false,
    insulinSourceConflictCount: 0,
    mealCount: 0,
    carbohydrateKnownCount: 0,
    carbohydratePartialCount: 0,
    nutritionPossibleDuplicatePairs: 0,
    ...overrides,
  };
}

describe('daily summary insulin presentation', () => {
  it('uses the authoritative source total in both visible and accessible copy', () => {
    const input = summary({
      sourceReportedInsulinUnits: 7.5,
      insulinSourceConflictCount: 1,
    });

    expect(presentDailySummaryInsulin(input)).toEqual({
      qualifier: 'INSULIN · LATEST SOURCE',
      spokenValue: '7.5 units',
      value: '7.5 U',
    });
    const accessibilityLabel = dailySummaryAccessibilityLabel(input);
    expect(accessibilityLabel).toContain('INSULIN · LATEST SOURCE, 7.5 units');
    expect(accessibilityLabel).not.toContain('4.2 units');
  });

  it('keeps partial source timing and an unavailable value consistent', () => {
    const asOf = zonedDateTimeToTimestamp('2026-08-18', 14, 30);
    const partial = summary({
      sourceReportedInsulinUnits: 3.25,
      insulinPartial: true,
      insulinSourceAsOf: asOf,
    });
    const unavailable = summary({
      insulin: { basalUnits: 0, bolusUnits: 0, totalUnits: 0 },
    });

    expect(presentDailySummaryInsulin(partial)).toEqual({
      qualifier: 'INSULIN · AS OF 14:30',
      spokenValue: '3.3 units',
      value: '3.3 U',
    });
    expect(presentDailySummaryInsulin(unavailable)).toEqual({
      qualifier: 'INSULIN',
      spokenValue: 'unavailable',
      value: '—',
    });
    expect(dailySummaryAccessibilityLabel(unavailable)).toContain(
      'INSULIN, unavailable',
    );
  });

  it('shows an explicit source-reported zero instead of calling it unavailable', () => {
    const input = summary({ sourceReportedInsulinUnits: 0 });

    expect(presentDailySummaryInsulin(input)).toEqual({
      qualifier: 'INSULIN · SOURCE',
      spokenValue: '0.0 units',
      value: '0.0 U',
    });
  });
});

describe('daily summary glucose presentation', () => {
  it('shows an explicit no-data state instead of a fabricated zero-percent TIR', () => {
    const input = summary({
      glucoseReadings: 0,
      glucose: {
        averageMmolL: 6.2,
        coefficientOfVariationPercent: 12,
        coveragePercent: 0,
        observedMinutes: 0,
        standardDeviationMmolL: 0.8,
        timeAbovePercent: 0,
        timeBelowPercent: 0,
        timeInRangePercent: 0,
      },
    });

    expect(presentDailySummaryGlucose(input)).toMatchObject({
      accessibilitySummary: 'No glucose data.',
      coverage: 'No glucose data',
      hasGlucose: false,
      rangeAccessibilityLabel: 'No glucose data',
      readings: '—',
      readingsLabel: 'NO READINGS',
      timeInRange: '—',
      timeInRangeLabel: 'NO GLUCOSE DATA',
    });
    const accessibilityLabel = dailySummaryAccessibilityLabel(input);
    expect(accessibilityLabel).toContain('No glucose data');
    expect(accessibilityLabel).not.toContain('Time in range 0 percent');
    expect(accessibilityLabel).not.toContain('Coverage 0 percent');
  });
});
