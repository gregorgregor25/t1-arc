import type {
  HevyExercise,
  HevySet,
  HevyUser,
  HevyWorkout,
  HevyWorkoutEvent,
} from './types';
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hevy returned an unexpected response.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`Hevy returned an invalid ${field}.`);
  }
  return value;
}

function finiteOrNull(value: unknown, field: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Hevy returned an invalid ${field}.`);
  }
  return value;
}

function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Hevy returned an invalid ${field}.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string) {
  const result = integer(value, field);
  if (result < 0) {
    throw new Error(`Hevy returned an invalid ${field}.`);
  }
  return result;
}

function valueType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function safePaginationDiagnostic(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    ? String(value)
    : valueType(value);
}

function eventPageDiagnostic(row: Record<string, unknown>) {
  const fields = Object.keys(row)
    .sort()
    .map((key) => `${key}:${valueType(row[key])}`)
    .join(', ');
  return `page=${safePaginationDiagnostic(row.page)}, page_count=${safePaginationDiagnostic(row.page_count)}; fields=${fields || 'none'}`;
}

function iso(value: unknown, field: string) {
  const result = text(value, field);
  if (parseExternalAbsoluteTimestamp(result) === undefined) {
    throw new Error(`Hevy returned an invalid ${field}.`);
  }
  return result;
}

function parseSet(value: unknown): HevySet {
  const row = object(value);
  return {
    index: integer(row.index, 'set index'),
    type: text(row.type, 'set type'),
    weight_kg: finiteOrNull(row.weight_kg, 'set weight'),
    reps: finiteOrNull(row.reps, 'set repetitions'),
    distance_meters: finiteOrNull(row.distance_meters, 'set distance'),
    duration_seconds: finiteOrNull(row.duration_seconds, 'set duration'),
    rpe: finiteOrNull(row.rpe, 'set RPE'),
    custom_metric: finiteOrNull(row.custom_metric, 'set custom metric'),
  };
}

function parseExercise(value: unknown): HevyExercise {
  const row = object(value);
  if (!Array.isArray(row.sets)) {
    throw new Error('Hevy returned an exercise without a sets list.');
  }
  return {
    index: integer(row.index, 'exercise index'),
    title: text(row.title, 'exercise title'),
    notes: typeof row.notes === 'string' ? row.notes : '',
    exercise_template_id:
      typeof row.exercise_template_id === 'string'
        ? row.exercise_template_id
        : '',
    supersets_id:
      row.supersets_id === null || row.supersets_id === undefined
        ? null
        : finiteOrNull(row.supersets_id, 'superset id'),
    sets: row.sets.map(parseSet),
  };
}

export function parseHevyWorkout(value: unknown): HevyWorkout {
  const row = object(value);
  if (!Array.isArray(row.exercises)) {
    throw new Error('Hevy returned a workout without an exercises list.');
  }
  const workout: HevyWorkout = {
    id: text(row.id, 'workout id'),
    title: text(row.title, 'workout title'),
    description: typeof row.description === 'string' ? row.description : '',
    start_time: iso(row.start_time, 'workout start time'),
    end_time: iso(row.end_time, 'workout end time'),
    updated_at: iso(row.updated_at, 'workout update time'),
    created_at: iso(row.created_at, 'workout creation time'),
    exercises: row.exercises.map(parseExercise),
  };
  if (typeof row.routine_id === 'string') workout.routine_id = row.routine_id;
  if (
    parseExternalAbsoluteTimestamp(workout.end_time)! <=
    parseExternalAbsoluteTimestamp(workout.start_time)!
  ) {
    throw new Error('Hevy returned a workout whose end is before its start.');
  }
  return workout;
}

export function parseHevyUser(value: unknown): HevyUser {
  const row = object(value);
  const data = object(row.data);
  return {
    id: text(data.id, 'user id'),
    name: text(data.name, 'user name'),
    url: typeof data.url === 'string' ? data.url : undefined,
  };
}

export function parseHevyWorkoutPage(value: unknown) {
  const row = object(value);
  if (!Array.isArray(row.workouts)) {
    throw new Error('Hevy returned a workout page without workouts.');
  }
  return {
    page: nonNegativeInteger(row.page, 'page number'),
    pageCount: nonNegativeInteger(row.page_count, 'page count'),
    workouts: row.workouts.map(parseHevyWorkout),
  };
}

export function parseHevyWorkoutCount(value: unknown) {
  const row = object(value);
  return nonNegativeInteger(row.workout_count, 'workout count');
}

function parseHevyWorkoutEvent(value: unknown): HevyWorkoutEvent {
  const event = object(value);
  if (event.type === 'updated') {
    return { type: 'updated', workout: parseHevyWorkout(event.workout) };
  }
  if (event.type === 'deleted') {
    return {
      type: 'deleted',
      id: text(event.id, 'deleted workout id'),
      ...(event.deleted_at === undefined || event.deleted_at === null
        ? {}
        : {
            deleted_at: iso(event.deleted_at, 'workout deletion time'),
          }),
    };
  }
  throw new Error('Hevy returned an unknown workout event.');
}

export function parseHevyEventPage(value: unknown) {
  const row = object(value);
  const page = nonNegativeInteger(row.page, 'event page number');
  const pageCount = nonNegativeInteger(row.page_count, 'event page count');
  if (
    row.events === undefined &&
    row.workouts === undefined &&
    pageCount === 0
  ) {
    return { page, pageCount, events: [] as HevyWorkoutEvent[] };
  }
  // Hevy's live events endpoint sometimes names the event array `workouts`.
  // The documented `events` field remains canonical whenever both are present.
  const rawEvents = row.events === undefined ? row.workouts : row.events;
  if (!Array.isArray(rawEvents)) {
    throw new Error(
      `Hevy returned an event page without events (${eventPageDiagnostic(row)}).`,
    );
  }
  const events = rawEvents.map(parseHevyWorkoutEvent);
  return {
    page,
    pageCount,
    events,
  };
}
