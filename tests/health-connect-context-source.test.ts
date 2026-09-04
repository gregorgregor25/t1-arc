import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectHealthConnectContext } from '@/data/healthConnect/healthConnectContextSelection';
import { healthConnectContextConflicts } from '@/data/healthConnect/healthConnectContextConflicts';
import { mergeHevyHealthConnectActivities } from '@/data/hevy/contextMerge';
import type { HealthContextEvent } from '@/domain/models';

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

const { database, openT1ArcDatabase } = vi.hoisted(() => {
  const database = {
    getAllAsync: vi.fn(),
  };
  return {
    database,
    openT1ArcDatabase: vi.fn(async () => database),
  };
});

vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase,
  withT1ArcTransaction: vi.fn(),
}));

describe('Health Connect context source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.getAllAsync.mockResolvedValue([]);
  });

  it('loads source preferences alongside events and cycle notes', async () => {
    const store = new SqliteHealthRecordStore();
    await store.getContextEvents({ start: 100, end: 200 });

    const eventQuery = database.getAllAsync.mock.calls[0]?.[0] as string;
    const noteQuery = database.getAllAsync.mock.calls[1]?.[0] as string;
    const mealItemQuery = database.getAllAsync.mock.calls[2]?.[0] as string;
    const preferenceQuery = database.getAllAsync.mock.calls[3]?.[0] as string;

    expect(eventQuery).toContain('FROM context_events c');
    expect(eventQuery).toContain('LEFT JOIN hevy_workouts');
    expect(noteQuery).toContain('SELECT * FROM context_notes');
    expect(mealItemQuery).toContain('FROM food_log_items');
    expect(mealItemQuery).toContain('context_event_id');
    expect(preferenceQuery).toContain('preferred_source_package');
    expect(preferenceQuery).toContain("'nutrition'");
    expect(preferenceQuery).toContain("'cycle'");
  });

  it('hydrates exact native food items but leaves imported summaries item-free', async () => {
    database.getAllAsync
      .mockResolvedValueOnce([
        {
          id: 'native-meal',
          source_id: 't1arc-food',
          origin: 'manual',
          kind: 'meal',
          start_ms: 120,
          end_ms: null,
          title: 'Lunch',
          meal_type: 'lunch',
          carbs_grams: 42,
          energy_kcal: 510,
          protein_grams: 28,
          fat_grams: 16,
          fibre_grams: 7,
          sugars_grams: 5,
          saturated_fat_grams: 3,
          serving_quantity: null,
          serving_count: null,
          activity_type: null,
          duration_minutes: null,
          intensity: null,
          calories_burned: null,
          quality_percent: null,
          kilograms: null,
          amount: null,
          unit: null,
          medication_type: null,
          recorded_at_ms: 130,
          source_file: 'Food log',
          source_row: null,
          hevy_payload_json: null,
          health_connect_display_name: null,
        },
        {
          id: 'imported-meal',
          source_id: 'health-connect:com.example.nutrition',
          origin: 'imported',
          kind: 'meal',
          start_ms: 140,
          end_ms: 150,
          title: 'Meal summary',
          meal_type: 'lunch',
          carbs_grams: null,
          energy_kcal: 430,
          protein_grams: 31,
          fat_grams: null,
          fibre_grams: null,
          sugars_grams: null,
          saturated_fat_grams: null,
          serving_quantity: null,
          serving_count: null,
          activity_type: null,
          duration_minutes: null,
          intensity: null,
          calories_burned: null,
          quality_percent: null,
          kilograms: null,
          amount: null,
          unit: null,
          medication_type: null,
          recorded_at_ms: 160,
          source_file: 'Health Connect',
          source_row: null,
          hevy_payload_json: null,
          health_connect_display_name: 'Example Nutrition',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          context_event_id: 'native-meal',
          id: 'native-item',
          name_snapshot: 'Chicken wrap',
          brand_snapshot: 'Kitchen',
          amount: 250,
          unit: 'g',
          carbohydrate_grams: 42,
          energy_kcal: 510,
          protein_grams: 28,
          fat_grams: 16,
          fibre_grams: 7,
          sugars_grams: 5,
          saturated_fat_grams: 3,
          source_label: 'My foods',
        },
      ])
      .mockResolvedValueOnce([]);

    const events = await new SqliteHealthRecordStore().getContextEvents({
      start: 100,
      end: 200,
    });

    expect(events).toEqual([
      expect.objectContaining({
        id: 'native-meal',
        sourceLabel: 'T1 Arc food log',
        nutritionDetail: 'itemized',
        fibreGrams: 7,
        items: [
          expect.objectContaining({
            id: 'native-item',
            name: 'Chicken wrap',
            carbohydrateGrams: 42,
            sourceLabel: 'My foods',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'imported-meal',
        sourceLabel: 'Example Nutrition',
        nutritionDetail: 'summary',
        carbsGrams: undefined,
        energyKcal: 430,
        items: undefined,
      }),
    ]);
  });
});

function activity(
  id: string,
  sourceId: string,
): HealthContextEvent {
  return {
    id,
    sourceId,
    origin: 'imported',
    kind: 'activity',
    start: 100,
    end: 200,
    title: 'Walk',
    activityType: 'walk',
    durationMinutes: 1,
    intensity: 'light',
  };
}

describe('selectHealthConnectContext', () => {
  it('withholds an overlapping category until a source is chosen', () => {
    const manual = activity('manual', 'manual');
    const selected = selectHealthConnectContext(
      [
        activity('samsung', 'health-connect:com.sec.android.app.shealth'),
        activity('fitbit', 'health-connect:com.fitbit.FitbitMobile'),
        manual,
      ],
      [],
    );

    expect(selected.needsSource).toEqual(['workouts']);
    expect(selected.events).toEqual([manual]);
  });

  it('uses the chosen source without deleting other raw records', () => {
    const samsung = activity(
      'samsung',
      'health-connect:com.sec.android.app.shealth',
    );
    const fitbit = activity(
      'fitbit',
      'health-connect:com.fitbit.FitbitMobile',
    );
    const selected = selectHealthConnectContext(
      [samsung, fitbit],
      [
        {
          category: 'workouts',
          preferredSourcePackage: 'com.sec.android.app.shealth',
        },
      ],
    );

    expect(selected.needsSource).toEqual([]);
    expect(selected.events).toEqual([samsung]);
  });

  it('keeps a single provider and non-Health Connect context', () => {
    const samsung = activity(
      'samsung',
      'health-connect:com.sec.android.app.shealth',
    );
    const manual = activity('manual', 'manual');
    const selected = selectHealthConnectContext(
      [samsung, manual],
      [],
    );

    expect(selected.needsSource).toEqual([]);
    expect(selected.events).toEqual([samsung, manual]);
  });
});

function hevyActivity(
  id: string,
  start = 100_000,
  end = 3_700_000,
): HealthContextEvent {
  return {
    id,
    sourceId: 'hevy',
    origin: 'imported',
    kind: 'activity',
    start,
    end,
    title: 'Upper body',
    activityType: 'strength',
    durationMinutes: (end - start) / 60_000,
    intensity: 'vigorous',
    strengthWorkout: {
      provider: 'hevy',
      workoutId: id.replace('hevy:', ''),
      exercises: [{ index: 0, title: 'Bench press', sets: [] }],
    },
  };
}

function healthConnectActivity(
  id: string,
  sourcePackage: string,
  overrides: Partial<Extract<HealthContextEvent, { kind: 'activity' }>> = {},
): HealthContextEvent {
  return {
    id,
    sourceId: `health-connect:${sourcePackage}`,
    origin: 'imported',
    kind: 'activity',
    start: 100_500,
    end: 3_699_500,
    title: 'Weightlifting',
    activityType: 'strength',
    durationMinutes: 60,
    intensity: 'moderate',
    caloriesBurned: 420,
    ...overrides,
  };
}

describe('Hevy and selected Health Connect workout merging', () => {
  it('keeps one Hevy-owned logical workout with exact detail and HC calorie provenance', () => {
    const hevy = hevyActivity('hevy:workout-one');
    const healthConnect = healthConnectActivity(
      'health-connect:workout:samsung:one',
      'samsung',
    );

    const merged = mergeHevyHealthConnectActivities([healthConnect, hevy]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'hevy:workout-one',
      sourceId: 'hevy',
      start: 100_000,
      end: 3_700_000,
      title: 'Upper body',
      caloriesBurned: 420,
      caloriesBurnedSourceId: 'health-connect:samsung',
      corroboratingSourceIds: ['health-connect:samsung'],
      strengthWorkout: {
        provider: 'hevy',
        workoutId: 'workout-one',
      },
    });
  });

  it('merges only the chosen HC provider and leaves the Hevy detail visible when none is chosen', () => {
    const hevy = hevyActivity('hevy:workout-one');
    const samsung = healthConnectActivity('samsung', 'samsung');
    const fitbit = healthConnectActivity('fitbit', 'fitbit', {
      caloriesBurned: 390,
    });

    const unresolved = selectHealthConnectContext(
      [samsung, fitbit, hevy],
      [],
    );
    expect(unresolved.needsSource).toEqual(['workouts']);
    expect(mergeHevyHealthConnectActivities(unresolved.events)).toEqual([
      hevy,
    ]);

    const selected = selectHealthConnectContext(
      [samsung, fitbit, hevy],
      [{ category: 'workouts', preferredSourcePackage: 'fitbit' }],
    );
    expect(mergeHevyHealthConnectActivities(selected.events)).toEqual([
      expect.objectContaining({
        id: hevy.id,
        caloriesBurned: 390,
        corroboratingSourceIds: ['health-connect:fitbit'],
      }),
    ]);
  });

  it('does not match a walk and assigns an ambiguous strength session to only its closest Hevy workout', () => {
    const closest = hevyActivity('hevy:closest');
    const other = hevyActivity('hevy:other', 160_000, 3_760_000);
    const strength = healthConnectActivity('strength', 'samsung');
    const walk = healthConnectActivity('walk', 'samsung', {
      title: 'Walk',
      activityType: 'walk',
    });

    const merged = mergeHevyHealthConnectActivities([
      other,
      walk,
      strength,
      closest,
    ]);

    expect(merged.map(({ id }) => id)).toEqual([
      'hevy:other',
      'walk',
      'hevy:closest',
    ]);
    expect(
      merged.find(({ id }) => id === 'hevy:closest'),
    ).toMatchObject({ caloriesBurned: 420 });
    expect(
      merged.find(({ id }) => id === 'hevy:other'),
    ).not.toHaveProperty('caloriesBurned');
  });
});

describe('healthConnectContextConflicts', () => {
  const sources = [
    { category: 'sleep' as const, sourcePackage: 'samsung' },
    { category: 'sleep' as const, sourcePackage: 'fitbit' },
    { category: 'nutrition' as const, sourcePackage: 'samsung' },
  ];

  it('reports only categories with multiple unselected providers', () => {
    expect(healthConnectContextConflicts(sources, [])).toEqual(['sleep']);
  });

  it('clears the warning after a provider is selected', () => {
    expect(
      healthConnectContextConflicts(sources, [
        { category: 'sleep', preferredSourcePackage: 'samsung' },
      ]),
    ).toEqual([]);
  });
});
