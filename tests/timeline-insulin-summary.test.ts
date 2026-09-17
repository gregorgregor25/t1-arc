import { describe, expect, it } from 'vitest';

import { BasalDelivery, BolusDelivery } from '../src/domain/models';
import {
  dayRange,
  multiDayRange,
  zonedDateTimeToTimestamp,
} from '../src/domain/time';
import {
  selectLatestInsulinDailyTotalSelections,
  summarizeInsulinByDay,
  summarizeInsulinRange,
} from '../src/domain/timelineInsulinSummary';

const AFTER_TEST_DATES = Date.UTC(2026, 11, 31);

describe('summarizeInsulinByDay', () => {
  it('totals basal and bolus deliveries into London calendar days', () => {
    const range = multiDayRange('2026-07-26', 2, AFTER_TEST_DATES);
    const basal: BasalDelivery[] = [
      {
        id: 'basal',
        start: range.start,
        end: range.end,
        rateUnitsPerHour: 1,
        units: 48,
        sourceId: 'test',
      },
    ];
    const boluses: BolusDelivery[] = [
      {
        id: 'first',
        timestamp: zonedDateTimeToTimestamp('2026-07-25', 12),
        units: 3,
        sourceId: 'test',
      },
      {
        id: 'second',
        timestamp: zonedDateTimeToTimestamp('2026-07-26', 18),
        units: 4.5,
        sourceId: 'test',
      },
    ];

    const result = summarizeInsulinByDay(basal, boluses, range);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      dateKey: '2026-07-25',
      basalUnits: 24,
      bolusUnits: 3,
      totalUnits: 27,
    });
    expect(result[1]).toMatchObject({
      dateKey: '2026-07-26',
      basalUnits: 24,
      bolusUnits: 4.5,
      totalUnits: 28.5,
    });
  });

  it('clips basal delivery to a partial requested day', () => {
    const fullDay = dayRange('2026-07-26', AFTER_TEST_DATES);
    const range = {
      start: zonedDateTimeToTimestamp('2026-07-26', 6),
      end: zonedDateTimeToTimestamp('2026-07-26', 18),
    };
    const basal: BasalDelivery[] = [
      {
        id: 'basal',
        start: fullDay.start,
        end: fullDay.end,
        rateUnitsPerHour: 0.8,
        units: 19.2,
        sourceId: 'test',
      },
    ];

    expect(summarizeInsulinByDay(basal, [], range)[0]?.basalUnits).toBeCloseTo(
      9.6,
    );
  });

  it('respects the 23-hour London daylight-saving day', () => {
    const range = dayRange('2026-03-29', AFTER_TEST_DATES);
    const basal: BasalDelivery[] = [
      {
        id: 'basal',
        start: range.start,
        end: range.end,
        rateUnitsPerHour: 1,
        units: 23,
        sourceId: 'test',
      },
    ];

    expect(summarizeInsulinByDay(basal, [], range)[0]?.basalUnits).toBeCloseTo(
      23,
    );
  });

  it('uses source-reported daily totals when detailed basal rows are sparse', () => {
    const range = dayRange('2026-07-26', AFTER_TEST_DATES);
    const result = summarizeInsulinByDay([], [], range, [
      {
        id: 'reported',
        timestamp: range.end - 1,
        dateKey: '2026-07-26',
        basalUnits: 11.4,
        bolusUnits: 18.2,
        totalUnits: 29.6,
        sourceId: 'glooko-export',
      },
    ]);

    expect(result[0]).toMatchObject({
      basalUnits: 11.4,
      bolusUnits: 18.2,
      totalUnits: 29.6,
    });
  });

  it('selects the newest snapshot within provenance and exposes other sources', () => {
    const timestamp = zonedDateTimeToTimestamp('2026-07-26', 23, 59);
    const selections = selectLatestInsulinDailyTotalSelections([
      {
        id: 'glooko-old',
        timestamp,
        dateKey: '2026-07-26',
        basalUnits: 10,
        bolusUnits: 20,
        totalUnits: 30,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
        importedAt: timestamp + 1_000,
      },
      {
        id: 'glooko-new',
        timestamp,
        dateKey: '2026-07-26',
        basalUnits: 12,
        bolusUnits: 21,
        totalUnits: 33,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
        importedAt: timestamp + 2_000,
      },
      {
        id: 'other-device',
        timestamp,
        dateKey: '2026-07-26',
        basalUnits: 8,
        bolusUnits: 9,
        totalUnits: 17,
        sourceId: 'other-source',
        sourceDeviceId: 'pump-b',
        importedAt: timestamp + 3_000,
      },
    ]);

    expect(selections).toHaveLength(1);
    expect(selections[0]?.total.id).toBe('other-device');
    expect(selections[0]?.alternatives.map((total) => total.id)).toEqual([
      'glooko-new',
    ]);
  });

  it('uses the newest exact source total and breakdown in a history summary', () => {
    const range = dayRange('2026-07-26', AFTER_TEST_DATES);
    const summary = summarizeInsulinRange([], [], range, [
      {
        id: 'old',
        timestamp: range.end - 1,
        dateKey: '2026-07-26',
        basalUnits: 0,
        bolusUnits: 23.2,
        totalUnits: 23.2,
        sourceId: 'glooko-export',
        importedAt: range.end + 1_000,
      },
      {
        id: 'new',
        timestamp: range.end - 1,
        dateKey: '2026-07-26',
        basalUnits: 16.8,
        bolusUnits: 23.2,
        totalUnits: 40,
        sourceId: 'glooko-export',
        importedAt: range.end + 2_000,
      },
    ]);

    expect(summary.stats).toEqual({
      basalUnits: 16.8,
      bolusUnits: 23.2,
      totalUnits: 40,
    });
    expect(summary.sourceTotals.map((total) => total.id)).toEqual(['new']);
  });

  it('uses the greatest source timestamp despite a later import of an older cumulative snapshot', () => {
    const dateKey = '2026-05-26';
    const at = (hour: number, minute: number) =>
      zonedDateTimeToTimestamp(dateKey, hour, minute);
    const selections = selectLatestInsulinDailyTotalSelections([
      {
        id: 'earliest-incomplete-imported-last',
        timestamp: at(15, 3),
        dateKey,
        basalUnits: 8.85,
        bolusUnits: 12.15,
        totalUnits: 21,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
        importedAt: at(23, 59) + 20_000,
      },
      {
        id: 'middle',
        timestamp: at(21, 13),
        dateKey,
        basalUnits: 10.5,
        bolusUnits: 15.65,
        totalUnits: 26.15,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
        importedAt: at(23, 59) + 10_000,
      },
      {
        id: 'latest-complete-source-snapshot',
        timestamp: at(23, 58),
        dateKey,
        basalUnits: 10.65,
        bolusUnits: 15.65,
        totalUnits: 26.3,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
        importedAt: at(23, 59),
      },
    ]);

    expect(selections[0]?.total).toMatchObject({
      id: 'latest-complete-source-snapshot',
      totalUnits: 26.3,
    });
  });

  it('uses completeness and import time only when source timestamps tie', () => {
    const timestamp = zonedDateTimeToTimestamp('2026-05-26', 23, 58);
    const selections = selectLatestInsulinDailyTotalSelections([
      {
        id: 'complete-earlier-import',
        timestamp,
        dateKey: '2026-05-26',
        basalUnits: 10.65,
        bolusUnits: 15.65,
        totalUnits: 26.3,
        sourceId: 'glooko-export',
        importedAt: timestamp + 1_000,
      },
      {
        id: 'incomplete-later-import',
        timestamp,
        dateKey: '2026-05-26',
        totalUnits: 26.3,
        sourceId: 'glooko-export',
        importedAt: timestamp + 2_000,
      },
    ]);

    expect(selections[0]?.total.id).toBe('complete-earlier-import');
  });

  it('does not invent a missing source breakdown from the aggregate total', () => {
    const range = dayRange('2026-07-26', AFTER_TEST_DATES);
    const summary = summarizeInsulinRange(
      [],
      [
        {
          id: 'same-device-bolus',
          timestamp: range.start + 60_000,
          units: 5,
          sourceId: 'glooko-export',
          sourceDeviceId: 'pdm-a',
        },
        {
          id: 'replacement-device-bolus',
          timestamp: range.start + 60_000,
          units: 23.2,
          sourceId: 'glooko-export',
          sourceDeviceId: 'pdm-b',
        },
      ],
      range,
      [
        {
          id: 'total-only',
          timestamp: range.end - 1,
          dateKey: '2026-07-26',
          totalUnits: 40,
          sourceId: 'glooko-export',
          sourceDeviceId: 'pdm-a',
        },
      ],
    );

    expect(summary.stats).toEqual({
      basalUnits: 0,
      bolusUnits: 5,
      totalUnits: 40,
    });
    expect(summary.sourceProvidesBasalEveryDay).toBe(false);
  });

  it('requires a source breakdown on every requested London day', () => {
    const range = multiDayRange('2026-07-26', 2, AFTER_TEST_DATES);
    const firstDateKey = '2026-07-25';
    const firstDayEnd = zonedDateTimeToTimestamp('2026-07-26');
    const summary = summarizeInsulinRange([], [], range, [
      {
        id: 'first-day-only',
        timestamp: firstDayEnd - 1,
        dateKey: firstDateKey,
        basalUnits: 12,
        bolusUnits: 8,
        totalUnits: 20,
        sourceId: 'glooko-export',
        importedAt: firstDayEnd + 1_000,
      },
    ]);

    expect(summary.sourceTotals).toHaveLength(1);
    expect(summary.sourceCoversEveryDay).toBe(false);
    expect(summary.sourceProvidesBasalEveryDay).toBe(false);
    expect(summary.sourceProvidesBolusEveryDay).toBe(false);
  });

  it('preserves a smaller source total while exposing larger fallback components', () => {
    const range = dayRange('2026-07-26', AFTER_TEST_DATES);
    const basal = [
      {
        id: 'automated-basal',
        start: range.start,
        end: range.end,
        units: 16.8,
        rateUnitsPerHour: 0.7,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
      },
    ];
    const sourceTotals = [
      {
        id: 'source-total-without-basal',
        timestamp: range.end - 1,
        dateKey: '2026-07-26',
        bolusUnits: 23.2,
        totalUnits: 23.2,
        sourceId: 'glooko-export',
        sourceDeviceId: 'pdm-a',
      },
    ];
    const summary = summarizeInsulinRange(basal, [], range, sourceTotals);
    const [day] = summarizeInsulinByDay(basal, [], range, sourceTotals);

    expect(summary.stats).toEqual({
      basalUnits: 16.8,
      bolusUnits: 23.2,
      totalUnits: 23.2,
    });
    expect(day?.sourceMinusBreakdownUnits).toBe(-16.8);
  });

  it('marks a same-day source snapshot partial and retains its as-of time', () => {
    const range = dayRange('2026-08-07', AFTER_TEST_DATES);
    const importedAt = zonedDateTimeToTimestamp('2026-08-07', 14, 35);
    const summary = summarizeInsulinRange([], [], range, [
      {
        id: 'today-snapshot',
        timestamp: importedAt,
        dateKey: '2026-08-07',
        basalUnits: 8,
        bolusUnits: 12,
        totalUnits: 20,
        sourceId: 'glooko-export',
        importedAt,
      },
    ]);

    expect(summary.partial).toBe(true);
    expect(summary.sourceAsOf).toBe(importedAt);
  });

  it('uses the source timestamp rather than a later import as the as-of time', () => {
    const rangeEnd = zonedDateTimeToTimestamp('2026-08-07', 14, 35);
    const range = dayRange('2026-08-07', rangeEnd);
    const sourceTimestamp = zonedDateTimeToTimestamp('2026-08-07', 10, 5);
    const importedAt = zonedDateTimeToTimestamp('2026-08-07', 14, 30);
    const summary = summarizeInsulinRange([], [], range, [
      {
        id: 'delayed-today-snapshot',
        timestamp: sourceTimestamp,
        dateKey: '2026-08-07',
        basalUnits: 5,
        bolusUnits: 10,
        totalUnits: 15,
        sourceId: 'glooko-export',
        importedAt,
      },
    ]);

    expect(summary.partial).toBe(true);
    expect(summary.sourceAsOf).toBe(sourceTimestamp);
    expect(summary.sourceAsOf).not.toBe(importedAt);
  });
});
