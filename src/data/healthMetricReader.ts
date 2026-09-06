import {
  getDailyHealthMetricSnapshot,
  getHealthTrendSnapshot,
} from './healthConnect/dailyHealthMetrics';
import {
  getDemoHealthMetricSnapshot,
  getDemoHealthTrendSnapshot,
} from './synthetic/demoHealthMetrics';
import type { TimeRange } from '@/domain/models';
import type { DateKey } from '@/domain/time';

// Keep mode selection in one place for cards, trends and exact detail panels.
// Importing a live reader must not be confused with invoking it in demo mode.
export function readHealthMetricSnapshot(
  mode: 'live' | 'demo',
  range: TimeRange,
  now = Date.now(),
) {
  return mode === 'demo'
    ? getDemoHealthMetricSnapshot(range, now)
    : getDailyHealthMetricSnapshot(range);
}

export function readHealthTrendSnapshot(
  mode: 'live' | 'demo',
  endDate: DateKey,
  days: number,
  now: number,
) {
  return mode === 'demo'
    ? getDemoHealthTrendSnapshot(endDate, days, now)
    : getHealthTrendSnapshot(endDate, days, now);
}
