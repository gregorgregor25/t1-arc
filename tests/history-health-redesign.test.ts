import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { HISTORY_GMI_LIMITED, presentHistoryGmi } from '@/components/history/historyGmi';
import { historyRecordFilterOptions, resolveHistoryRecordFilter } from '@/components/history/historyRecordFilters';
import {
  groupRemainingHealthMetrics,
  healthMetricGroup,
  healthPriorityIds,
} from '@/components/healthMetrics/healthLayout';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/domain/displayPreferences';
import type { GlucoseReading } from '@/domain/models';

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
  it('offers Insulin doses only when insulin is connected', () => {
    expect(historyRecordFilterOptions(false).map(({ label }) => label)).toEqual(['Around the timeline', 'Insulin doses', 'Glucose + insulin']);
    expect(historyRecordFilterOptions(true).map(({ label }) => label)).toEqual(['Around the timeline', 'Glucose + insulin']);
  });

  it('falls back to the first chip when the chosen one disappears', () => {
    expect(resolveHistoryRecordFilter('insulin', historyRecordFilterOptions(true))).toBe('context');
    expect(resolveHistoryRecordFilter('summary', historyRecordFilterOptions(true))).toBe('summary');
  });
});

describe('History GMI', () => {
  const start = Date.UTC(2026, 10, 1);
  const readings = (days: number): GlucoseReading[] =>
    Array.from({ length: days * 288 }, (_, index) => ({
      id: `g${index}`,
      sourceId: 'test',
      timestamp: start + index * 300_000,
      mmolL: 7,
    }) as GlucoseReading);

  it('shows the estimate with coverage and says when the period is too short', () => {
    const result = presentHistoryGmi(readings(1), { start, end: start + 86_400_000 }, 'en-GB');
    expect(result.value).toMatch(/^\d+\.\d% · \d+ mmol\/mol$/);
    expect(result.coverage).toMatch(/% sensor coverage$/);
    expect(result.limitedNotice).toBe(HISTORY_GMI_LIMITED);
  });

  it('drops the limited-data note for 14 well-covered days', () => {
    const result = presentHistoryGmi(readings(14), { start, end: start + 14 * 86_400_000 }, 'en-GB');
    expect(result.limitedNotice).toBeUndefined();
  });

  it('shows a dash and coverage when there are no readings', () => {
    const result = presentHistoryGmi([], { start, end: start + 86_400_000 }, 'en-GB');
    expect(result.value).toBe('—');
    expect(result.accessibilityLabel).toContain('not available');
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
    expect(history).toContain('<HistoryShareCard data={timeline.data} />');
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
