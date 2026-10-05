import type { HealthContextEvent, MealEvent, TimeRange } from './models';
import {
  inspectionTimestampForRange,
  retainedTimelineInspection,
} from './timelinePresentation';

const MINUTE = 60_000;

/** Keeps inspection pinned within a live rolling window as its end advances. */
export function retainedChartInspection(
  selection: { rangeStart: number; rangeEnd: number; timestamp: number } | undefined,
  range: TimeRange,
): number | undefined {
  const fixedStart = retainedTimelineInspection(selection, range);
  if (fixedStart !== undefined) return fixedStart;
  if (!selection) return undefined;
  const previousDuration = selection.rangeEnd - selection.rangeStart;
  const nextDuration = range.end - range.start;
  if (
    previousDuration <= 0 ||
    previousDuration !== nextDuration ||
    range.start < selection.rangeStart ||
    range.end < selection.rangeEnd
  ) {
    return undefined;
  }
  return inspectionTimestampForRange(selection.timestamp, range);
}

function contextEnd(event: HealthContextEvent) {
  if (event.end !== undefined) return Math.max(event.start, event.end);
  if (event.kind === 'activity') {
    return event.start + event.durationMinutes * MINUTE;
  }
  return event.start;
}

/** Records around a selected point are nearby observations, not causes. */
export function nearbyTimelineContext(
  events: readonly HealthContextEvent[],
  timestamp: number,
  windowMs = 45 * MINUTE,
  limit = 4,
): HealthContextEvent[] {
  const boundedWindow = Math.max(0, windowMs);
  const distance = (event: HealthContextEvent) =>
    Math.max(event.start - timestamp, timestamp - contextEnd(event), 0);
  return events
    .filter((event) =>
      !(event.kind === 'meal' && event.excludedFoodSource) &&
      distance(event) <= boundedWindow,
    )
    .sort((first, second) =>
      distance(first) - distance(second) ||
      Math.abs(first.start - timestamp) - Math.abs(second.start - timestamp) ||
      first.start - second.start ||
      first.id.localeCompare(second.id),
    )
    .slice(0, Math.max(0, limit));
}

export interface TimelineMealMarker {
  event: MealEvent;
  count: number;
  events: MealEvent[];
  x: number;
}

/** Groups overlapping meal marks at the current chart width. */
export function timelineMealMarkers(
  events: readonly HealthContextEvent[],
  range: TimeRange,
  plotWidth: number,
  minSpacing = 30,
): TimelineMealMarker[] {
  const duration = Math.max(1, range.end - range.start);
  const meals = events
    .filter((event): event is MealEvent =>
      event.kind === 'meal' &&
      event.start >= range.start &&
      event.start < range.end &&
      !event.excludedFoodSource,
    )
    .sort((a, b) => a.start - b.start);
  const markers: TimelineMealMarker[] = [];
  for (const meal of meals) {
    const position = ((meal.start - range.start) / duration) * Math.max(1, plotWidth);
    const previous = markers.at(-1);
    if (previous && position - previous.x < minSpacing) {
      previous.count += 1;
      previous.events.push(meal);
      continue;
    }
    markers.push({ event: meal, count: 1, events: [meal], x: position });
  }
  return markers;
}
