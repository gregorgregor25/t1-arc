import { describe, expect, it } from 'vitest';

import type { DailyHealthMetrics } from '@/domain/dailyHealthMetrics';
import { buildHealthContextCoverage } from '@/domain/healthContextCoverage';
import type { HealthContextEvent, TimeRange } from '@/domain/models';

const range: TimeRange = {
  start: Date.parse('2026-07-28T00:00:00Z'),
  end: Date.parse('2026-07-29T00:00:00Z'),
};

function metrics(
  overrides: Partial<DailyHealthMetrics> = {},
): DailyHealthMetrics {
  return {
    sourceLabels: [],
    needsSource: [],
    recordCount: 0,
    selectedRecordIds: [],
    ...overrides,
  };
}

describe('health context coverage', () => {
  it('distinguishes recorded context from categories with no received record', () => {
    const events: HealthContextEvent[] = [
      {
        id: 'sleep-1',
        kind: 'sleep',
        start: range.start,
        end: range.start + 7 * 60 * 60 * 1000,
        durationMinutes: 420,
        title: 'Sleep',
        sourceId: 'health-connect',
        origin: 'imported',
        recordedAt: range.end,
      },
      {
        id: 'cycle-1',
        kind: 'note',
        start: range.start + 8 * 60 * 60 * 1000,
        title: 'Menstrual period',
        category: 'hormones',
        sourceId: 'health-connect',
        origin: 'imported',
        recordedAt: range.end,
      },
    ];
    const result = buildHealthContextCoverage(
      metrics({ steps: 5_432, restingHeartRateBpm: 58 }),
      events,
      range,
    );

    expect(
      Object.fromEntries(result.map((item) => [item.id, item.status])),
    ).toMatchObject({
      movement: 'recorded',
      sleep: 'recorded',
      heart: 'recorded',
      hormones: 'recorded',
      workouts: 'missing',
      hydration: 'missing',
    });
  });

  it('surfaces source ambiguity instead of presenting it as missing', () => {
    const result = buildHealthContextCoverage(
      metrics({
        needsSource: ['steps', 'body_composition', 'vitals'],
      }),
      [],
      range,
    );

    expect(
      Object.fromEntries(result.map((item) => [item.id, item.status])),
    ).toMatchObject({
      movement: 'source-needed',
      body: 'source-needed',
      vitals: 'source-needed',
      heart: 'missing',
    });
  });

  it('ignores sleep and workout events outside the selected day', () => {
    const events: HealthContextEvent[] = [
      {
        id: 'workout-before',
        kind: 'activity',
        start: range.start - 2 * 60 * 60 * 1000,
        end: range.start - 60 * 60 * 1000,
        durationMinutes: 60,
        title: 'Walk',
        activityType: 'walk',
        intensity: 'moderate',
        sourceId: 'health-connect',
        origin: 'imported',
        recordedAt: range.end,
      },
    ];
    const result = buildHealthContextCoverage(metrics(), events, range);

    expect(result.find((item) => item.id === 'workouts')?.status).toBe(
      'missing',
    );
  });
});
