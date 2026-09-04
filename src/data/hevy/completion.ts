import type { HevyWorkout } from './types';
import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

export function isCompletedHevyWorkout(
  workout: HevyWorkout,
  now = Date.now(),
) {
  const start = parseExternalAbsoluteTimestamp(workout.start_time);
  const end = parseExternalAbsoluteTimestamp(workout.end_time);
  return start !== undefined && end !== undefined && end > start && end <= now;
}
