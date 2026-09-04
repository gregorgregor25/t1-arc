import { describe, expect, it } from 'vitest';

import {
  GLOOKO_MAX_EXPORT_DAYS,
  glookoRangeDays,
  isDateKey,
  planNextGlookoBackfill,
} from '@/data/glooko/glookoBackfill';
import { addDays } from '@/domain/time';

describe('Glooko historical backfill planning', () => {
  it('requests the next non-overlapping 90 inclusive calendar days', () => {
    const range = planNextGlookoBackfill({
      earliestKnownDate: '2026-07-01',
    });

    expect(range).toEqual({
      startDate: '2026-04-02',
      endDate: '2026-06-30',
      days: 90,
    });
    expect(addDays(range!.startDate, GLOOKO_MAX_EXPORT_DAYS - 1)).toBe(
      range!.endDate,
    );
    expect(glookoRangeDays(range!.startDate, range!.endDate)).toBe(90);
  });

  it('continues from a successful empty-export cursor', () => {
    expect(
      planNextGlookoBackfill({
        earliestKnownDate: '2026-07-01',
        backfilledBeforeDate: '2026-04-02',
      }),
    ).toEqual({
      startDate: '2026-01-02',
      endDate: '2026-04-01',
      days: 90,
    });
  });

  it('uses older imported records when they precede the saved cursor', () => {
    expect(
      planNextGlookoBackfill({
        earliestKnownDate: '2025-12-15',
        backfilledBeforeDate: '2026-01-02',
      })?.endDate,
    ).toBe('2025-12-14');
  });

  it('clamps the final export to the chosen earliest date', () => {
    expect(
      planNextGlookoBackfill({
        backfilledBeforeDate: '2026-04-02',
        targetDate: '2026-03-15',
      }),
    ).toEqual({
      startDate: '2026-03-15',
      endDate: '2026-04-01',
      days: 18,
    });
    expect(
      planNextGlookoBackfill({
        backfilledBeforeDate: '2026-03-15',
        targetDate: '2026-03-15',
      }),
    ).toBeUndefined();
  });

  it('requires a known boundary and validates persisted date keys', () => {
    expect(planNextGlookoBackfill({})).toBeUndefined();
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('not-a-date')).toBe(false);
    expect(glookoRangeDays('2026-03-01', '2026-03-29')).toBe(29);
  });
});
