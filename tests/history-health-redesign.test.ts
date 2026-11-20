import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  HISTORY_GMI_EXPLANATION,
  HISTORY_GMI_LOW_COVERAGE,
  HISTORY_GMI_SHORT_PERIOD,
  presentHistoryGmi,
} from '@/components/history/historyGmi';
import {
  DEFAULT_HISTORY_RECORD_FILTER,
  historyRecordFilterOptions,
  historyRecordListsFor,
  resolveHistoryRecordFilter,
} from '@/components/history/historyRecordFilters';
import {
  timelineAddActionLabel,
  timelineAddRecordIds,
  timelineSavedConfirmation,
  visibleTimelineActionError,
} from '@/components/history/historyTimelineActions';
import { gmiSummary } from '@/domain/gmiSummary';
import {
  groupRemainingHealthMetrics,
  healthMetricGroup,
  healthPriorityIds,
} from '@/components/healthMetrics/healthLayout';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/domain/displayPreferences';
import type { GlucoseReading, HealthContextEvent } from '@/domain/models';

const metric = (id: string) => ({ id });

describe('Health priorities and groups', () => {
  const all = ['weight', 'blood-pressure', 'heart-rate', 'sleep', 'nutrition', 'steps', 'hydration', 'distance', 'workouts', 'hrv', 'cycle-context'].map(metric);

  it('follows the saved Today priority order and maps Activity to Workouts', () => {
    expect(healthPriorityIds(all, ['activity', 'steps', 'time-in-range', 'insulin', 'weight'])).toEqual(['workouts', 'steps', 'weight', 'nutrition']);
  });

  it('uses the default order when nothing was chosen', () => {
    expect(healthPriorityIds(all, DEFAULT_DISPLAY_PREFERENCES.glanceOrder)).toEqual(['nutrition', 'sleep', 'blood-pressure', 'heart-rate']);
  });

  it('skips measures with no data and fills free places in Health order', () => {
    expect(healthPriorityIds([metric('hydration'), metric('steps'), metric('hrv')], ['sleep', 'steps'])).toEqual(['steps', 'hydration', 'hrv']);
    expect(healthPriorityIds([], ['sleep'])).toEqual([]);
  });

  it('lists every other measure exactly once in body, heart, activity, sleep and food groups', () => {
    const priorities = healthPriorityIds(all, DEFAULT_DISPLAY_PREFERENCES.glanceOrder);
    const groups = groupRemainingHealthMetrics(all, priorities);
    expect(groups.map((group) => group.label)).toEqual(['Body', 'Heart and breathing', 'Activity', 'Food']);
    const listed = groups.flatMap((group) => group.metrics.map(({ id }) => id));
    expect([...listed, ...priorities].sort()).toEqual(all.map(({ id }) => id).sort());
    expect(healthMetricGroup('something-new')).toBe('body');
  });
});

describe('History records filter', () => {
  it('starts on All and offers Insulin doses only when insulin is connected', () => {
    expect(DEFAULT_HISTORY_RECORD_FILTER).toBe('all');
    expect(historyRecordFilterOptions(false).map(({ label }) => label)).toEqual(['All', 'Around the timeline', 'Insulin doses', 'Glucose + insulin']);
    expect(historyRecordFilterOptions(true).map(({ label }) => label)).toEqual(['All', 'Around the timeline', 'Glucose + insulin']);
  });

  it('shows every list under All, so duplicate-dose warnings and reconciliation notes stay visible', () => {
    expect(historyRecordListsFor('all', false)).toEqual({ context: true, insulin: true, summary: true });
    expect(historyRecordListsFor('all', true)).toEqual({ context: true, insulin: false, summary: true });
    expect(historyRecordListsFor('insulin', false)).toEqual({ context: false, insulin: true, summary: false });
    expect(historyRecordListsFor('summary', false)).toEqual({ context: false, insulin: false, summary: true });
    expect(historyRecordListsFor('context', false)).toEqual({ context: true, insulin: false, summary: false });
  });

  it('keeps the chosen chip across periods and brings it back when it is offered again', () => {
    const chosen = 'insulin' as const;
    // Period with insulin, then one without, then with again: the saved
    // choice is unchanged; only the displayed chip falls back to All.
    expect(resolveHistoryRecordFilter(chosen, historyRecordFilterOptions(false))).toBe('insulin');
    expect(resolveHistoryRecordFilter(chosen, historyRecordFilterOptions(true))).toBe('all');
    expect(resolveHistoryRecordFilter(chosen, historyRecordFilterOptions(false))).toBe('insulin');
    expect(resolveHistoryRecordFilter('summary', historyRecordFilterOptions(true))).toBe('summary');
  });
});

describe('History GMI', () => {
  const day = 86_400_000;
  const start = Date.UTC(2026, 10, 1);
  const readings = (count: number): GlucoseReading[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `g${index}`,
      sourceId: 'test',
      timestamp: start + index * 300_000,
      mmolL: 7,
    }) as GlucoseReading);
  const fullDays = (days: number) => readings(days * 288);

  it('keeps the estimate for a short well-covered period and says it is not comparable with a lab HbA1c', () => {
    const result = presentHistoryGmi(fullDays(1), { start, end: start + day }, 'en-GB');
    expect(result.value).toMatch(/^\d+\.\d% · \d+ mmol\/mol$/);
    expect(result.coverage).toMatch(/% sensor coverage$/);
    expect(result.limitedNotice).toBe(HISTORY_GMI_SHORT_PERIOD);
    expect(result.limitedNotice).toBe('This period is shorter than 14 days, so this is not comparable with a lab HbA1c.');
    expect(result.limitedNotice).not.toContain('aim for');
  });

  it('treats exactly 14 days as long enough, and one millisecond less as short', () => {
    const exact = presentHistoryGmi(fullDays(14), { start, end: start + 14 * day }, 'en-GB');
    expect(exact.limitedNotice).toBeUndefined();
    expect(exact.value).not.toBe('—');
    const short = presentHistoryGmi(fullDays(14), { start, end: start + 14 * day - 1 }, 'en-GB');
    expect(short.limitedNotice).toBe(HISTORY_GMI_SHORT_PERIOD);
  });

  it('shows the estimate at 70% coverage and a dash with the coverage at 69%', () => {
    const range = { start, end: start + 14 * day };
    // Each reading covers 5 minutes; the last one up to the 12-minute gap cap.
    const at70 = readings(2821);
    const at69 = readings(2781);
    expect(gmiSummary(at70, range).coveragePercent).toBe(70);
    expect(gmiSummary(at69, range).coveragePercent).toBe(69);

    const shown = presentHistoryGmi(at70, range, 'en-GB');
    expect(shown.value).not.toBe('—');
    expect(shown.coverage).toBe('70% sensor coverage');
    expect(shown.limitedNotice).toBeUndefined();

    const hidden = presentHistoryGmi(at69, range, 'en-GB');
    expect(hidden.value).toBe('—');
    expect(hidden.coverage).toBe('69% sensor coverage');
    expect(hidden.limitedNotice).toBe(HISTORY_GMI_LOW_COVERAGE);
    expect(hidden.accessibilityLabel).toContain('69% sensor coverage');
  });

  it('says in the spoken label that GMI can differ from a laboratory result', () => {
    const shown = presentHistoryGmi(fullDays(14), { start, end: start + 14 * day }, 'en-GB');
    expect(shown.accessibilityLabel).toContain('It can differ from a measured laboratory result');
    expect(shown.accessibilityLabel).not.toContain('..');
    expect(HISTORY_GMI_EXPLANATION).toContain('laboratory result');
    const empty = presentHistoryGmi([], { start, end: start + day }, 'en-GB');
    expect(empty.accessibilityLabel).toContain('laboratory result');
  });

  it('shows a dash and coverage when there are no readings', () => {
    const result = presentHistoryGmi([], { start, end: start + day }, 'en-GB');
    expect(result.value).toBe('—');
    expect(result.accessibilityLabel).toContain('not available');
    expect(result.accessibilityLabel).toContain('0% sensor coverage');
  });
});

describe('History timeline actions', () => {
  const event = (id: string, kind: 'meal' | 'note', sourceId: string, origin: 'manual' | 'import' = 'manual') =>
    ({ id, kind, sourceId, origin, start: 0, end: 0, title: id }) as unknown as HealthContextEvent;

  it('includes the date in the spoken add labels only when the chart covers more than one day', () => {
    const format = { time: () => '14:05', day: () => 'Tuesday 17 November' };
    const hour = 3_600_000;
    expect(timelineAddActionLabel('meal', 0, { start: 0, end: 24 * hour }, format)).toBe('Add meal at 14:05');
    // A 25-hour day when clocks change is still one day.
    expect(timelineAddActionLabel('note', 0, { start: 0, end: 25 * hour }, format)).toBe('Add note at 14:05');
    expect(timelineAddActionLabel('meal', 0, { start: 0, end: 3 * 24 * hour }, format)).toBe('Add meal on Tuesday 17 November at 14:05');
    expect(timelineAddActionLabel('note', 0, { start: 0, end: 7 * 24 * hour }, format)).toBe('Add note on Tuesday 17 November at 14:05');
  });

  it('clears a timeline message when the period changes or food details finish loading', () => {
    const loading = { message: 'Meal details are still loading. Try again in a moment.', rangeKey: 'a', whileFoodLoading: true };
    expect(visibleTimelineActionError(loading, 'a', true)).toBe(loading.message);
    expect(visibleTimelineActionError(loading, 'a', false)).toBeUndefined();
    expect(visibleTimelineActionError(loading, 'b', true)).toBeUndefined();
    const other = { message: 'This meal could not be opened for editing.', rangeKey: 'a', whileFoodLoading: false };
    expect(visibleTimelineActionError(other, 'a', false)).toBe(other.message);
    expect(visibleTimelineActionError(other, 'b', false)).toBeUndefined();
    expect(visibleTimelineActionError(undefined, 'a', false)).toBeUndefined();
  });

  it('confirms a timeline add only after a new record of that kind appears in the same period', () => {
    // Literal ids keep this test free of the database modules.
    const FOOD_LOG_SOURCE_ID = 't1arc-food';
    const MANUAL_CONTEXT_SOURCE_ID = 't1arc-manual';
    const mealSources = [FOOD_LOG_SOURCE_ID, MANUAL_CONTEXT_SOURCE_ID];
    const noteSources = [MANUAL_CONTEXT_SOURCE_ID];
    const before = [
      event('m1', 'meal', FOOD_LOG_SOURCE_ID),
      event('n1', 'note', MANUAL_CONTEXT_SOURCE_ID),
      event('imported', 'meal', 'health-connect', 'import'),
    ];
    expect(timelineAddRecordIds(before, 'meal', mealSources)).toEqual(['m1']);
    expect(timelineAddRecordIds(before, 'note', noteSources)).toEqual(['n1']);

    const pendingMeal = { kind: 'meal' as const, rangeKey: 'a', sourceIds: mealSources, knownIds: timelineAddRecordIds(before, 'meal', mealSources) };
    expect(timelineSavedConfirmation(pendingMeal, 'a', before)).toBeUndefined();
    // A new note or an imported meal is not the meal that was being added.
    expect(timelineSavedConfirmation(pendingMeal, 'a', [...before, event('n2', 'note', MANUAL_CONTEXT_SOURCE_ID)])).toBeUndefined();
    expect(timelineSavedConfirmation(pendingMeal, 'a', [...before, event('i2', 'meal', 'health-connect', 'import')])).toBeUndefined();
    const after = [...before, event('m2', 'meal', FOOD_LOG_SOURCE_ID)];
    expect(timelineSavedConfirmation(pendingMeal, 'a', after)).toBe('Saved. The meal now appears on the timeline.');
    expect(timelineSavedConfirmation(pendingMeal, 'b', after)).toBeUndefined();
    expect(timelineSavedConfirmation(undefined, 'a', after)).toBeUndefined();

    const pendingNote = { kind: 'note' as const, rangeKey: 'a', sourceIds: noteSources, knownIds: timelineAddRecordIds(before, 'note', noteSources) };
    expect(timelineSavedConfirmation(pendingNote, 'a', [...before, event('n2', 'note', MANUAL_CONTEXT_SOURCE_ID)])).toBe('Saved. The note now appears on the timeline.');
  });
});

describe('History and Health layout contracts', () => {
  const history = readFileSync('src/screens/HistoryScreen.tsx', 'utf8');
  const health = readFileSync('src/components/HealthMetricCards.tsx', 'utf8');
  const records = readFileSync('src/screens/RecordsScreen.tsx', 'utf8');

  it('keeps every History element: summary, timeline with add and edit, food, records and share', () => {
    expect(history).toContain('<GlucoseRangeStatisticsCard');
    expect(history).toContain('onAddContext={onAddFromTimeline}');
    expect(history).toContain('onEditContext={onEditFromTimeline}');
    expect(history).toContain('title="Food and treatments"');
    expect(history).toContain('<FoodCompletenessAction');
    expect(history).toContain('<HypoTreatmentReviewCard');
    expect(history).toContain('<HistoryRecordsSection');
    expect(history).toContain("label: 'Share or export'");
    expect(history).toContain('<HistoryShareCard data={timeline.data} showHeading={false} />');
    expect(history).toContain('<GlucoseProfileCard');
    expect(history).toContain('<DailySummaryCard');
  });

  it('keeps the AAPS timeline lane and its toggle', () => {
    const timeline = readFileSync('src/components/CombinedTimeline.tsx', 'utf8');
    expect(timeline).toContain('therapy: "AAPS"');
    expect(timeline).toContain('therapy: true');
  });

  it('moves Health editing behind one Edit button and keeps Lab results and Cycle tracking at the end', () => {
    expect(health).toContain('accessibilityLabel="Edit Health view"');
    expect(health).toContain('title="Edit view"');
    expect(health).toContain('title="Show all sections"');
    expect(health).toContain('<StepGoalEditor');
    expect(health).toContain('Everything else');
    expect(records.indexOf('<LabResultsCard />')).toBeLessThan(records.indexOf('title="Cycle tracking"'));
    expect(records).not.toContain('FeatureEntry');
  });
});
