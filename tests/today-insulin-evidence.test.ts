import { describe, expect, it } from 'vitest';

import {
  describeInsulinTimelineFidelity,
  hasInsulinDeliveryEvidence,
} from '@/domain/timelineInsulinSummary';
import { zonedDateTimeToTimestamp } from '@/domain/time';
import type { TimelineData } from '@/domain/models';

const start = zonedDateTimeToTimestamp('2026-11-01');
const end = start + 12 * 60 * 60_000;

function data(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    range: { start, end },
    basal: [],
    boluses: [],
    dailyInsulinTotals: [],
    glucose: [],
    context: [],
    sources: [{
      id: 'glooko-export',
      label: 'Insulin',
      detail: 'Historical Glooko import',
      freshness: 'stale',
      origin: 'imported',
      isLive: false,
    }],
    ...overrides,
  };
}

describe('insulin evidence on Today and timelines', () => {
  it('does not report a measured zero merely because historical Glooko is still configured', () => {
    const current = data();
    expect(hasInsulinDeliveryEvidence(current)).toBe(false);
    expect(describeInsulinTimelineFidelity(current)).toMatchObject({
      kind: 'no-records',
      detail: 'No insulin delivery amounts are recorded for these dates.',
    });
  });

  it('ignores a daily total from a previous date and report-only pump states', () => {
    expect(hasInsulinDeliveryEvidence(data({
      dailyInsulinTotals: [{
        id: 'old', dateKey: '2026-10-31', timestamp: start - 1,
        totalUnits: 21, sourceId: 'glooko-export',
      }],
      pumpStates: [{
        id: 'state', kind: 'activity-mode', start, end: start + 60_000,
        sourceId: 'glooko-export',
      }],
    }))).toBe(false);
  });

  it('accepts an actual source-reported zero for this date as recorded evidence', () => {
    expect(hasInsulinDeliveryEvidence(data({
      dailyInsulinTotals: [{
        id: 'today-zero', dateKey: '2026-11-01', timestamp: start + 60_000,
        importedAt: start + 60_000,
        totalUnits: 0, basalUnits: 0, bolusUnits: 0,
        sourceId: 'glooko-export',
      }],
    }))).toBe(true);
  });

  it('accepts timed bolus and overlapping basal delivery records', () => {
    expect(hasInsulinDeliveryEvidence(data({
      boluses: [{ id: 'bolus', timestamp: start + 60_000, units: 1, sourceId: 'manual' }],
    }))).toBe(true);
    expect(hasInsulinDeliveryEvidence(data({
      basal: [{
        id: 'basal', start: start - 60_000, end: start + 60_000,
        units: 0.1, rateUnitsPerHour: 0.1, sourceId: 'pump',
      }],
    }))).toBe(true);
  });
});
