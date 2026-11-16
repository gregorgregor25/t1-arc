import { describe, expect, it } from 'vitest';

import {
  reconcileBasalSources,
  reconcileBolusSources,
} from '@/domain/insulinSourceReconciliation';
import type { BasalDelivery, BolusDelivery } from '@/domain/models';
import { dayRange } from '@/domain/time';
import { summarizeInsulinRange } from '@/domain/timelineInsulinSummary';

const minute = 60_000;
// 25 October 2026: UK clocks go back, so the Europe/London day has 25 hours.
const DST_DAY = dayRange('2026-10-25', Date.parse('2026-10-27T00:00:00Z'));

function bolus(id: string, sourceId: string, timestamp: number, units: number): BolusDelivery {
  return { id, sourceId, timestamp, units, deliveryType: 'Meal Bolus' };
}

function basal(
  id: string,
  sourceId: string,
  start: number,
  end: number,
  rate: number,
  importedAt?: number,
): BasalDelivery {
  return {
    id,
    sourceId,
    start,
    end,
    rateUnitsPerHour: rate,
    units: (rate * (end - start)) / 3_600_000,
    unitsEstimated: sourceId === 'nightscout',
    importedAt,
  };
}

describe('cross-source insulin reconciliation', () => {
  it('counts a bolus recorded by Glooko and Nightscout once, keeping the Glooko record', () => {
    const at = Date.parse('2026-10-25T07:30:00Z');
    const records = [
      bolus('glooko:1', 'glooko-export', at, 4),
      bolus('nightscout:bolus:a', 'nightscout', at + 40_000, 4.02),
      bolus('nightscout:bolus:b', 'nightscout', at + 30 * minute, 4),
    ];
    const result = reconcileBolusSources(records);
    expect(result.boluses.map((record) => record.id)).toEqual([
      'glooko:1',
      'nightscout:bolus:b',
    ]);
    expect(result.hidden).toEqual([
      { record: records[1], keptId: 'glooko:1' },
    ]);
  });

  it('prefers the AAPS copy received on the phone over the Nightscout copy of the same bolus', () => {
    const at = Date.parse('2026-11-10T12:00:00Z');
    const result = reconcileBolusSources([
      bolus('nightscout:bolus:x', 'nightscout', at, 0.3),
      bolus('aaps-local:bolus:x', 'aaps-local', at, 0.3),
    ]);
    expect(result.boluses.map((record) => record.sourceId)).toEqual(['aaps-local']);
  });

  it('never hides manual doses or unrelated sources, and matches each record at most once', () => {
    const at = Date.parse('2026-11-10T12:00:00Z');
    const result = reconcileBolusSources([
      bolus('manual:1', 'manual-context', at, 2),
      bolus('glooko:1', 'glooko-export', at, 2),
      bolus('nightscout:bolus:1', 'nightscout', at, 2),
      bolus('nightscout:bolus:2', 'nightscout', at + 20_000, 2),
    ]);
    expect(result.boluses.map((record) => record.id)).toEqual([
      'manual:1',
      'glooko:1',
      'nightscout:bolus:2',
    ]);
  });

  it('clips Nightscout basal where Glooko already covers the period', () => {
    const start = Date.parse('2026-10-25T00:00:00+01:00');
    const result = reconcileBasalSources([
      basal('glooko:basal', 'glooko-export', start, start + 60 * minute, 1),
      basal('nightscout:basal:t', 'nightscout', start + 30 * minute, start + 90 * minute, 2),
    ]);
    expect(result.map(({ id, start: s, end, units }) => ({ id, s, end, units }))).toEqual([
      { id: 'glooko:basal', s: start, end: start + 60 * minute, units: 1 },
      { id: 'nightscout:basal:t', s: start + 60 * minute, end: start + 90 * minute, units: 1 },
    ]);
  });

  it('ends an older stored Nightscout temporary basal when the next one starts', () => {
    const start = Date.parse('2026-11-10T08:00:00Z');
    const result = reconcileBasalSources([
      basal('nightscout:basal:1', 'nightscout', start, start + 30 * minute, 1.2, 1),
      basal('nightscout:basal:2', 'nightscout', start + 5 * minute, start + 35 * minute, 0.6, 2),
      // A second copy with the same start: the newest import wins.
      basal('nightscout:basal:3', 'nightscout', start + 5 * minute, start + 20 * minute, 0.6, 3),
    ]);
    expect(result.map(({ id, end }) => ({ id, end }))).toEqual([
      { id: 'nightscout:basal:1', end: start + 5 * minute },
      { id: 'nightscout:basal:3', end: start + 20 * minute },
    ]);
    expect(result[0]!.units).toBeCloseTo(0.1, 10);
  });

  it('does not double-count Today totals on a 25-hour Europe/London day with partial coverage', () => {
    const at = Date.parse('2026-10-25T01:30:00+01:00');
    const after = Date.parse('2026-10-25T23:30:00Z');
    const boluses = reconcileBolusSources([
      bolus('glooko:1', 'glooko-export', at, 3),
      bolus('nightscout:bolus:same', 'nightscout', at, 3),
      bolus('nightscout:bolus:late', 'nightscout', after, 1),
    ]).boluses;
    const summary = summarizeInsulinRange([], boluses, DST_DAY);
    expect(DST_DAY.end - DST_DAY.start).toBe(25 * 60 * minute);
    expect(summary.stats.bolusUnits).toBe(4);
    expect(summary.stats.basalUnits).toBe(0);
  });
});
