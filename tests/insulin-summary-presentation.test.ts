import { describe, expect, it } from 'vitest';

import { presentInsulinRangeSummary } from '@/domain/insulinSummaryPresentation';
import { InsulinRangeSummary } from '@/domain/timelineInsulinSummary';
import { zonedDateTimeToTimestamp } from '@/domain/time';

function summary(
  update: Partial<InsulinRangeSummary> = {},
): InsulinRangeSummary {
  const importedAt = zonedDateTimeToTimestamp('2026-08-07', 14, 35);
  return {
    stats: { basalUnits: 8, bolusUnits: 12, totalUnits: 20 },
    sourceTotals: [
      {
        id: 'source-total',
        sourceId: 'glooko-export',
        timestamp: importedAt,
        dateKey: '2026-08-07',
        basalUnits: 8,
        bolusUnits: 12,
        totalUnits: 20,
        importedAt,
      },
    ],
    sourceAsOf: importedAt,
    partial: true,
    sourceCoversEveryDay: true,
    sourceProvidesBasalEveryDay: true,
    sourceProvidesBolusEveryDay: true,
    sourceConflictCount: 0,
    ...update,
  };
}

describe('insulin summary presentation', () => {
  it('labels a partial source total with an as-of time', () => {
    const result = presentInsulinRangeSummary(summary(), 'Today so far');

    expect(result.rangeLabel).toBe('Today so far');
    expect(result.sourceDetail).toBe(
      'Source-reported daily total · source data as of 14:35',
    );
    expect(result.separateBreakdown).toBe(false);
  });

  it('discloses fallback breakdown records and competing provenance', () => {
    const result = presentInsulinRangeSummary(
      summary({
        partial: false,
        sourceProvidesBasalEveryDay: false,
        sourceConflictCount: 1,
      }),
      'Selected day',
    );

    expect(result.sourceDetail).toContain(
      'missing source breakdown filled from same-source delivery records',
    );
    expect(result.sourceDetail).toContain(
      'latest shown; 1 other source/device total available',
    );
  });

  it('discloses a source total that cannot be fully split', () => {
    const result = presentInsulinRangeSummary(
      summary({
        stats: { basalUnits: 0, bolusUnits: 12, totalUnits: 20 },
        partial: false,
        sourceProvidesBasalEveryDay: false,
      }),
      'Selected day',
    );

    expect(result.sourceDetail).toContain(
      '8.0 U not split into basal or bolus by the available source records',
    );
  });

  it('keeps component records separate when they exceed the source total', () => {
    const result = presentInsulinRangeSummary(
      summary({
        stats: { basalUnits: 16.8, bolusUnits: 23.2, totalUnits: 23.2 },
        partial: false,
        sourceProvidesBasalEveryDay: false,
      }),
      'Selected day',
    );

    expect(result.sourceMinusBreakdownUnits).toBe(-16.8);
    expect(result.separateBreakdown).toBe(true);
    expect(result.sourceDetail).toContain(
      'basal + bolus is 16.8 U above the source total; components shown separately',
    );
  });
});
