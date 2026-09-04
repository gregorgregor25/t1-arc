import { describe, expect, it } from 'vitest';

import {
  buildInsightComparisonRanges,
  InsightPeriodDays,
} from '@/domain/insightRanges';
import { addDays, toDateKey } from '@/domain/time';

describe('insight comparison ranges', () => {
  it.each<InsightPeriodDays>([3, 7, 14, 30, 90])(
    'builds adjacent %i-day London calendar windows',
    (days) => {
      const now = Date.parse('2026-07-26T12:00:00+01:00');
      const endDate = '2026-07-25';
      const ranges = buildInsightComparisonRanges(endDate, days, now);

      expect(ranges.previous.end).toBe(ranges.current.start);
      expect(toDateKey(ranges.current.start)).toBe(
        addDays(endDate, -(days - 1)),
      );
      expect(toDateKey(ranges.current.end - 1)).toBe(endDate);
      expect(toDateKey(ranges.previous.start)).toBe(
        addDays(endDate, -(days * 2 - 1)),
      );
      expect(toDateKey(ranges.previous.end - 1)).toBe(
        addDays(endDate, -days),
      );
    },
  );

  it('uses calendar boundaries across the spring clock change', () => {
    const ranges = buildInsightComparisonRanges(
      '2026-03-29',
      3,
      Date.parse('2026-04-01T12:00:00+01:00'),
    );

    expect(toDateKey(ranges.current.start)).toBe('2026-03-27');
    expect(toDateKey(ranges.current.end - 1)).toBe('2026-03-29');
    expect(ranges.current.end - ranges.current.start).toBe(71 * 60 * 60_000);
    expect(ranges.previous.end).toBe(ranges.current.start);
  });
});
