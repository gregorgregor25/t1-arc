import type { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import type { TimeRange } from '@/domain/models';
import {
  addDays,
  dayRange,
  multiDayRange,
  toDateKey,
  zonedDateTimeToTimestamp,
  type DateKey,
} from '@/domain/time';
import {
  buildHealthMetricSnapshot,
  buildHealthTrendSnapshot,
} from '../healthConnect/healthMetricSnapshot';
import { SyntheticContextSource } from './SyntheticContextSource';
import { hashString, seededBetween } from './random';

const SOURCE = 'demo-t1arc-health';

/** Synthetic only. No preferences, databases, connected accounts or writes. */
async function demoHealthInput(range: TimeRange, now: number) {
  const context = await new SyntheticContextSource(now).getEvents(range);
  const records: DailyMetricRecord[] = [];
  const today = toDateKey(now);
  for (let daysAgo = 20; daysAgo >= 0; daysAgo -= 1) {
    const date = addDays(today, -daysAgo);
    const bounds = dayRange(date, now);
    if (bounds.end <= range.start || bounds.start >= range.end) continue;
    const seed = hashString(`${date}:health`);
    const add = (
      kind: DailyMetricRecord['kind'],
      hour: number,
      value: number,
      unit: DailyMetricRecord['unit'],
      endHour = hour,
    ) => {
      const start = zonedDateTimeToTimestamp(date, hour, 0);
      const end = zonedDateTimeToTimestamp(date, endHour, 0);
      // Completed sample intervals only: no invented future totals today.
      if (start >= range.end || end > now || end < range.start) return;
      records.push({
        id: `${SOURCE}:${date}:${kind}:${hour}`,
        kind,
        sourcePackage: SOURCE,
        sourceLabel: 'Demo · example data',
        start,
        end,
        value: Math.round(value * 100) / 100,
        unit,
      });
    };
    for (const hour of [6, 10, 14, 18]) {
      const steps = Math.round(seededBetween(seed + hour, 900, 2400));
      add('steps', hour, steps, 'count', hour + 2);
      add('distance', hour, steps * 0.72, 'm', hour + 2);
      add('active_calories', hour, steps * 0.045, 'kcal', hour + 2);
      add('heart_rate', hour, seededBetween(seed + hour * 3, 62, 95), 'bpm');
      add('hydration', hour, 0.35, 'litre');
    }
    add('resting_heart_rate', 6, seededBetween(seed + 1, 56, 64), 'bpm');
  }
  // Use the same weights shown on the synthetic timeline, never a second set.
  for (const event of context) {
    if (event.kind !== 'weight' || event.start > now) continue;
    records.push({
      id: `${SOURCE}:${event.id}`,
      kind: 'weight',
      sourcePackage: SOURCE,
      sourceLabel: 'Demo · example data',
      start: event.start,
      end: event.start,
      value: event.kilograms,
      unit: 'kg',
    });
  }
  return { records, context: context.filter((event) => event.start <= now) };
}

export async function getDemoHealthMetricSnapshot(
  range: TimeRange,
  now = Date.now(),
) {
  return buildHealthMetricSnapshot(await demoHealthInput(range, now), range);
}

export async function getDemoHealthTrendSnapshot(
  endDate: DateKey,
  days: number,
  now: number,
) {
  const range = multiDayRange(
    endDate,
    Math.max(1, Math.min(90, Math.floor(days))),
    now,
  );
  return buildHealthTrendSnapshot(
    await demoHealthInput(range, now),
    endDate,
    days,
    now,
  );
}
