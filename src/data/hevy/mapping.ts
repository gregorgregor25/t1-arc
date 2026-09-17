import type { ActivityEvent, StrengthWorkoutDetail } from '@/domain/models';
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

import type { HevyWorkout } from './types';

export const HEVY_SOURCE_ID = 'hevy';

function intensity(workout: HevyWorkout): ActivityEvent['intensity'] {
  const rpeValues = workout.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      typeof set.rpe === 'number' ? [set.rpe] : [],
    ),
  );
  if (!rpeValues.length) return 'unspecified';
  const average =
    rpeValues.reduce((total, value) => total + value, 0) / rpeValues.length;
  if (average >= 8) return 'vigorous';
  if (average <= 4) return 'light';
  return 'moderate';
}

export function hevyWorkoutDetail(workout: HevyWorkout): StrengthWorkoutDetail {
  return {
    provider: 'hevy',
    workoutId: workout.id,
    description: workout.description || undefined,
    exercises: workout.exercises.map((exercise) => ({
      index: exercise.index,
      title: exercise.title,
      notes: exercise.notes || undefined,
      exerciseTemplateId: exercise.exercise_template_id || undefined,
      supersetId: exercise.supersets_id ?? undefined,
      sets: exercise.sets.map((set) => ({
        index: set.index,
        type: set.type,
        weightKilograms: set.weight_kg ?? undefined,
        reps: set.reps ?? undefined,
        distanceMetres: set.distance_meters ?? undefined,
        durationSeconds: set.duration_seconds ?? undefined,
        rpe: set.rpe ?? undefined,
        customMetric: set.custom_metric ?? undefined,
      })),
    })),
  };
}

export function hevyWorkoutToActivity(
  workout: HevyWorkout,
  importedAt: number,
): ActivityEvent {
  const start = parseExternalAbsoluteTimestamp(workout.start_time);
  const end = parseExternalAbsoluteTimestamp(workout.end_time);
  if (start === undefined || end === undefined || end <= start) {
    throw new Error('Cannot map a Hevy workout without absolute time bounds.');
  }
  return {
    id: `hevy:${workout.id}`,
    kind: 'activity',
    title: workout.title,
    start,
    end,
    activityType: 'strength',
    durationMinutes: (end - start) / 60_000,
    intensity: intensity(workout),
    sourceId: HEVY_SOURCE_ID,
    origin: 'imported',
    recordedAt: importedAt,
    strengthWorkout: hevyWorkoutDetail(workout),
  };
}
