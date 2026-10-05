import { describe, expect, it } from 'vitest';

import type { HealthContextEvent, MealEvent } from '@/domain/models';
import { nearbyTimelineContext, retainedChartInspection, timelineMealMarkers } from '@/domain/timelineContext';

const minute = 60_000;

function meal(id: string, start: number): MealEvent {
  return {
    id,
    kind: 'meal',
    start,
    title: id,
    mealType: 'snack',
    origin: 'manual',
    sourceId: 't1arc-food',
  };
}

describe('timeline context', () => {
  it('retains a selected point through repeated live rolling-window updates', () => {
    const fourHours = 4 * 60 * minute;
    const selection = { rangeStart: 0, rangeEnd: fourHours, timestamp: 2 * 60 * minute };
    expect(retainedChartInspection(selection, { start: 6 * minute, end: fourHours + 6 * minute }))
      .toBe(selection.timestamp);
    expect(retainedChartInspection(selection, { start: 90 * minute, end: fourHours + 90 * minute }))
      .toBe(selection.timestamp);
  });

  it('clears selection after its point leaves the window or the window choice changes', () => {
    const fourHours = 4 * 60 * minute;
    const selection = { rangeStart: 0, rangeEnd: fourHours, timestamp: 30 * minute };
    expect(retainedChartInspection(selection, { start: 31 * minute, end: fourHours + 31 * minute }))
      .toBeUndefined();
    expect(retainedChartInspection(selection, { start: -fourHours, end: fourHours }))
      .toBeUndefined();
    expect(retainedChartInspection(selection, { start: -minute, end: fourHours - minute }))
      .toBeUndefined();
  });

  it('preserves the existing fixed-start live-day inspection behavior', () => {
    const selection = { rangeStart: 0, rangeEnd: 10 * minute, timestamp: 5 * minute };
    expect(retainedChartInspection(selection, { start: 0, end: 12 * minute }))
      .toBe(selection.timestamp);
  });

  it('includes recorded point events at the 45 minute boundary and excludes more distant ones', () => {
    const events = [meal('before', 55 * minute), meal('edge', 60 * minute), meal('after', 150 * minute)];
    expect(nearbyTimelineContext(events, 105 * minute).map((event) => event.id))
      .toEqual(['edge', 'after']);
    expect(nearbyTimelineContext(events, 105 * minute, 44 * minute).map((event) => event.id))
      .toEqual([]);
  });

  it('includes a selected point during a recorded interval without assigning causality', () => {
    const sleep: HealthContextEvent = {
      id: 'sleep', kind: 'sleep', start: 10 * minute, end: 100 * minute,
      title: 'Sleep', durationMinutes: 90, origin: 'manual', sourceId: 'manual',
    };
    const activity: HealthContextEvent = {
      id: 'activity', kind: 'activity', start: 80 * minute,
      title: 'Walk', activityType: 'walk', durationMinutes: 40,
      intensity: 'light', origin: 'manual', sourceId: 'manual',
    };
    expect(nearbyTimelineContext([meal('earlier', 40 * minute), activity, sleep], 110 * minute)
      .map((event) => event.id)).toEqual(['activity', 'sleep']);
  });

  it('groups crowded meal markers but keeps each original meal reachable', () => {
    const events = [meal('first', 10 * minute), meal('second', 12 * minute), meal('later', 70 * minute)];
    const markers = timelineMealMarkers(events, { start: 0, end: 2 * 60 * minute }, 240, 30);
    expect(markers).toHaveLength(2);
    expect(markers[0]?.events.map((event) => event.id)).toEqual(['first', 'second']);
    expect(markers[0]?.count).toBe(2);
    expect(markers[1]?.event.id).toBe('later');
  });

  it('does not plot excluded food or a meal at the exclusive range end', () => {
    const excluded = { ...meal('excluded', 10 * minute), excludedFoodSource: true };
    expect(nearbyTimelineContext([excluded], 10 * minute)).toEqual([]);
    const markers = timelineMealMarkers(
      [excluded, meal('visible', 20 * minute), meal('end', 60 * minute)],
      { start: 0, end: 60 * minute },
      200,
    );
    expect(markers.map((marker) => marker.event.id)).toEqual(['visible']);
  });
});
