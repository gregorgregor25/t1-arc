import type { HealthContextEvent, TimeRange } from './models';

export interface HealthTrendContextSummary {
  mealCount: number;
  mealCarbsGrams: number;
  medicationCount: number;
  hormoneRecordCount: number;
}

function eventEnd(event: HealthContextEvent) {
  return (
    event.end ??
    ('durationMinutes' in event
      ? event.start + event.durationMinutes * 60_000
      : event.start)
  );
}

function overlapsRange(event: HealthContextEvent, range: TimeRange) {
  const end = eventEnd(event);
  if (end === event.start) {
    return event.start >= range.start && event.start < range.end;
  }
  return event.start < range.end && end >= range.start;
}

/**
 * Summarises only records that were actually logged. Zero means no matching
 * record was present, not that food, medication or hormone context was absent
 * from the person's day.
 */
export function summarizeHealthTrendContext(
  events: HealthContextEvent[],
  range: TimeRange,
): HealthTrendContextSummary {
  const inRange = events.filter((event) => overlapsRange(event, range));
  const meals = inRange.filter(
    (event): event is Extract<HealthContextEvent, { kind: 'meal' }> =>
      event.kind === 'meal' &&
      event.start >= range.start &&
      event.start < range.end,
  );
  return {
    mealCount: meals.length,
    mealCarbsGrams: meals.reduce(
      (total, event) => total + event.carbsGrams,
      0,
    ),
    medicationCount: inRange.filter(
      (event) =>
        event.kind === 'medication' &&
        event.start >= range.start &&
        event.start < range.end,
    ).length,
    hormoneRecordCount: inRange.filter(
      (event) =>
        event.kind === 'note' && event.category === 'hormones',
    ).length,
  };
}
