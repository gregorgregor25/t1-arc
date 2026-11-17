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

  it('prefers the Nightscout copy over the unverified copy received on this phone', () => {
    const at = Date.parse('2026-11-10T12:00:00Z');
    const result = reconcileBolusSources([
      bolus('aaps-local:bolus:x', 'aaps-local', at, 0.3),
      bolus('nightscout:bolus:x', 'nightscout', at, 0.3),
    ]);
    expect(result.boluses.map((record) => record.sourceId)).toEqual(['nightscout']);
  });

  it('keeps an on-phone record that Nightscout does not have yet, filling the gap', () => {
    const at = Date.parse('2026-11-10T12:00:00Z');
    const result = reconcileBolusSources([
      bolus('nightscout:bolus:x', 'nightscout', at, 0.3),
      bolus('aaps-local:bolus:x', 'aaps-local', at, 0.3),
      bolus('aaps-local:bolus:y', 'aaps-local', at + 4 * minute, 0.2),
    ]);
    expect(result.boluses.map((record) => record.id)).toEqual([
      'nightscout:bolus:x',
      'aaps-local:bolus:y',
    ]);
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

describe('one delivery recorded by several sources', () => {
  const at = Date.parse('2026-11-12T12:00:00Z');
  const ids = (records: readonly BolusDelivery[]) => records.map((record) => record.id);
  const total = (records: readonly BolusDelivery[]) =>
    Math.round(records.reduce((sum, record) => sum + record.units, 0) * 100) / 100;
  const sources = {
    glooko: bolus('glooko:1', 'glooko-export', at, 1),
    local: bolus('aaps-local:bolus:1', 'aaps-local', at, 1),
    nightscout: bolus('nightscout:bolus:1', 'nightscout', at, 1),
  };

  it.each([
    [['glooko', 'local', 'nightscout'], 'glooko:1'],
    [['nightscout', 'local', 'glooko'], 'glooko:1'],
    [['glooko', 'local'], 'glooko:1'],
    [['glooko', 'nightscout'], 'glooko:1'],
    [['local', 'nightscout'], 'nightscout:bolus:1'],
    [['glooko'], 'glooko:1'],
    [['local'], 'aaps-local:bolus:1'],
    [['nightscout'], 'nightscout:bolus:1'],
  ] as const)('counts %j once, keeping %s', (names, keptId) => {
    const result = reconcileBolusSources(names.map((name) => sources[name]));
    expect(ids(result.boluses)).toEqual([keptId]);
    expect(total(result.boluses)).toBe(1);
    expect(result.hidden).toHaveLength(names.length - 1);
    expect(result.hidden.every((item) => item.keptId === keptId)).toBe(true);
  });

  it('keeps two real boluses three minutes apart in one source, with each copy matched to its own', () => {
    const later = at + 3 * minute;
    const result = reconcileBolusSources([
      bolus('glooko:a', 'glooko-export', at, 1),
      bolus('glooko:b', 'glooko-export', later, 1),
      bolus('aaps-local:bolus:a', 'aaps-local', at, 1),
      bolus('aaps-local:bolus:b', 'aaps-local', later, 1),
      bolus('nightscout:bolus:a', 'nightscout', at, 1),
      bolus('nightscout:bolus:b', 'nightscout', later, 1),
    ]);
    expect(ids(result.boluses)).toEqual(['glooko:a', 'glooko:b']);
    expect(total(result.boluses)).toBe(2);
    expect(
      result.hidden.map(({ record, keptId }) => [record.id, keptId]).sort(),
    ).toEqual([
      ['aaps-local:bolus:a', 'glooko:a'],
      ['aaps-local:bolus:b', 'glooko:b'],
      ['nightscout:bolus:a', 'glooko:a'],
      ['nightscout:bolus:b', 'glooko:b'],
    ]);
  });

  it('keeps two real boluses one minute apart when only one source recorded both', () => {
    const result = reconcileBolusSources([
      bolus('nightscout:bolus:a', 'nightscout', at, 1),
      bolus('nightscout:bolus:b', 'nightscout', at + minute, 1),
      bolus('aaps-local:bolus:a', 'aaps-local', at, 1),
    ]);
    expect(total(result.boluses)).toBe(2);
    expect(result.hidden).toHaveLength(1);
  });

  it('does not let one source hide two copies of a single delivery from another', () => {
    const result = reconcileBolusSources([
      bolus('glooko:1', 'glooko-export', at, 1),
      bolus('nightscout:bolus:a', 'nightscout', at, 1),
      bolus('nightscout:bolus:b', 'nightscout', at + 30_000, 1),
    ]);
    expect(ids(result.boluses)).toEqual(['glooko:1', 'nightscout:bolus:b']);
  });

  it('matches within 2 minutes and 0.05 U, and keeps records just outside', () => {
    const glooko = bolus('glooko:1', 'glooko-export', at, 1);
    const near = (id: string, offset: number, units: number) =>
      reconcileBolusSources([glooko, bolus(id, 'nightscout', at + offset, units)]).boluses.length;
    expect(near('in-time', 2 * minute, 1)).toBe(1);
    expect(near('in-time-before', -2 * minute, 1)).toBe(1);
    expect(near('late', 2 * minute + 1_000, 1)).toBe(2);
    expect(near('in-amount', 0, 1.04)).toBe(1);
    expect(near('out-amount', 0, 1.06)).toBe(2);
    expect(near('smaller', 0, 0.94)).toBe(2);
  });

  it('matches a copy to the nearest delivery when two could match', () => {
    const result = reconcileBolusSources([
      bolus('glooko:a', 'glooko-export', at, 1),
      bolus('glooko:b', 'glooko-export', at + 90_000, 1),
      bolus('nightscout:bolus:b', 'nightscout', at + 80_000, 1),
      bolus('nightscout:bolus:a', 'nightscout', at + 10_000, 1),
    ]);
    expect(ids(result.boluses)).toEqual(['glooko:a', 'glooko:b']);
    expect(
      Object.fromEntries(result.hidden.map(({ record, keptId }) => [record.id, keptId])),
    ).toEqual({ 'nightscout:bolus:a': 'glooko:a', 'nightscout:bolus:b': 'glooko:b' });
  });

  it('counts an SMB sent locally and to Nightscout once, and keeps separate SMBs', () => {
    const smb = (id: string, sourceId: string, timestamp: number): BolusDelivery => ({
      ...bolus(id, sourceId, timestamp, 0.4),
      deliveryType: 'SMB',
    });
    const result = reconcileBolusSources([
      smb('aaps-local:bolus:1', 'aaps-local', at),
      smb('aaps-local:bolus:2', 'aaps-local', at + 5 * minute),
      smb('nightscout:bolus:1', 'nightscout', at),
      smb('nightscout:bolus:2', 'nightscout', at + 5 * minute),
    ]);
    expect(result.boluses).toHaveLength(2);
    expect(total(result.boluses)).toBe(0.8);
  });

  it('counts an extended bolus from three sources once without absorbing the separate normal bolus', () => {
    const extended = (id: string, sourceId: string): BolusDelivery => ({
      ...bolus(id, sourceId, at, 3),
      deliveryType: 'Combo Bolus (extended over 60 min)',
      initialUnits: 1,
      extendedUnits: 2,
    });
    const result = reconcileBolusSources([
      extended('glooko:combo', 'glooko-export'),
      extended('aaps-local:bolus:combo', 'aaps-local'),
      extended('nightscout:bolus:combo', 'nightscout'),
      bolus('nightscout:bolus:meal', 'nightscout', at, 1),
    ]);
    expect(ids(result.boluses)).toEqual(['glooko:combo', 'nightscout:bolus:meal']);
    expect(total(result.boluses)).toBe(4);
  });

  it('never hides or matches manual entries', () => {
    const result = reconcileBolusSources([
      bolus('manual:1', 'manual-context', at, 1),
      bolus('manual:2', 'manual-context', at, 1),
      sources.local,
      sources.nightscout,
    ]);
    expect(ids(result.boluses)).toEqual(['manual:1', 'manual:2', 'nightscout:bolus:1']);
  });
});
