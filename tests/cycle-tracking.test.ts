import { describe, expect, it } from 'vitest';
import {
  addCycleDays, cycleDayDifference, estimateNextPeriod,
  mergeCyclePeriods, parseCycleDate, periodsOverlap, validatePeriodDates,
  type CyclePeriod,
} from '@/domain/cycleTracking';

function period(startDate: string, endDate?: string, source: CyclePeriod['source'] = 'manual'): CyclePeriod {
  return { id: `${source}:${startDate}`, startDate, endDate, source, readOnly: source === 'health-connect' };
}

describe('cycle calendar logic', () => {
  it('uses calendar days across month and daylight-saving boundaries', () => {
    expect(cycleDayDifference('2026-03-28', '2026-03-30')).toBe(2);
    expect(addCycleDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(() => parseCycleDate('2026-02-30')).toThrow(/valid calendar date/);
    expect(() => validatePeriodDates('2026-04-03', '2026-04-02')).toThrow(/before/);
  });

  it('treats an open period as ongoing and hides overlapping imported copies', () => {
    expect(periodsOverlap(period('2026-04-01'), period('2026-04-28'))).toBe(true);
    expect(mergeCyclePeriods(
      [period('2026-04-01', '2026-04-05')],
      [period('2026-04-01', '2026-04-05', 'health-connect'), period('2026-03-01', '2026-03-05', 'health-connect')],
    ).map((entry) => entry.startDate)).toEqual(['2026-04-01', '2026-03-01']);
  });

  it('estimates only from enough stable past cycles', () => {
    const stable = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26'].map((date) => period(date));
    expect(estimateNextPeriod(stable, '2026-04-01')).toEqual({
      startDate: '2026-04-23', basedOnCycles: 3, typicalLengthDays: 28,
    });
    expect(estimateNextPeriod(stable, '2026-04-24')).toBeUndefined();
    expect(estimateNextPeriod([...stable.slice(0, 3), period('2026-04-20')], '2026-04-21')).toBeUndefined();
    expect(estimateNextPeriod([...stable, period('2026-05-15')], '2026-04-01'))
      .toEqual(estimateNextPeriod(stable, '2026-04-01'));
  });
});
