import type { DailyMetricRecord } from './dailyHealthMetrics';

export interface WorkoutHeartRateSummary {
  averageBpm: number;
  maximumBpm: number;
  minimumBpm: number;
  sampleCount: number;
  sourceLabels: string[];
}

function overlapsWorkout(
  workoutStart: number,
  workoutEnd: number,
  recordStart: number,
  recordEnd: number,
) {
  // Health Connect heart-rate samples are points. Include exact workout
  // boundaries, while interval records that merely touch do not overlap.
  if (recordStart === recordEnd) {
    return recordStart >= workoutStart && recordStart <= workoutEnd;
  }
  return recordStart < workoutEnd && recordEnd > workoutStart;
}

/** Summarises only Health Connect heart-rate samples inside a workout interval. */
export function summarizeWorkoutHeartRate(
  workout: { start: number; end: number },
  records: readonly DailyMetricRecord[],
): WorkoutHeartRateSummary | undefined {
  if (!Number.isFinite(workout.start) || !Number.isFinite(workout.end)) {
    return undefined;
  }
  const start = Math.min(workout.start, workout.end);
  const end = Math.max(workout.start, workout.end);
  const matching = records.filter(
    (record) =>
      record.kind === 'heart_rate' &&
      Number.isFinite(record.value) &&
      overlapsWorkout(start, end, record.start, record.end),
  );
  if (!matching.length) return undefined;

  const values = matching.map((record) => record.value);
  return {
    averageBpm: values.reduce((total, value) => total + value, 0) / values.length,
    maximumBpm: Math.max(...values),
    minimumBpm: Math.min(...values),
    sampleCount: values.length,
    sourceLabels: [...new Set(matching.map((record) => record.sourceLabel.trim()).filter(Boolean))],
  };
}
