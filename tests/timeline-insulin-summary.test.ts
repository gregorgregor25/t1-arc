import { describe, expect, it } from 'vitest';

import {
  BasalDelivery,
  BolusDelivery,
} from '../src/domain/models';
import {
  dayRange,
  multiDayRange,
  zonedDateTimeToTimestamp,
} from '../src/domain/time';
import { summarizeInsulinByDay } from '../src/domain/timelineInsulinSummary';

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

    expect(
      summarizeInsulinByDay(basal, [], range)[0]?.basalUnits,
    ).toBeCloseTo(9.6);
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

    expect(
      summarizeInsulinByDay(basal, [], range)[0]?.basalUnits,
    ).toBeCloseTo(23);
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
});
