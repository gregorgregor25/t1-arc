import type { ActivityEvent, HealthContextEvent } from '@/domain/models';

import { HEVY_SOURCE_ID } from './mapping';

export const HEVY_HEALTH_CONNECT_START_TOLERANCE_MS = 5 * 60_000;
export const HEVY_HEALTH_CONNECT_END_TOLERANCE_MS = 10 * 60_000;

const HEALTH_CONNECT_SOURCE_PREFIX = 'health-connect:';
const STRENGTH_TITLE_PATTERN =
  /\b(?:strength|weight(?:lifting| training)?|resistance|gym|hevy)\b/i;

function activityEnd(event: ActivityEvent) {
  return event.end ?? event.start + event.durationMinutes * 60_000;
}

function isHevyActivity(
  event: HealthContextEvent,
): event is ActivityEvent & {
  strengthWorkout: NonNullable<ActivityEvent['strengthWorkout']>;
} {
  return (
    event.kind === 'activity' &&
    event.sourceId === HEVY_SOURCE_ID &&
    event.strengthWorkout?.provider === 'hevy'
  );
}

function isStrengthCompatibleHealthConnectActivity(
  event: HealthContextEvent,
): event is ActivityEvent {
  return (
    event.kind === 'activity' &&
    event.sourceId.startsWith(HEALTH_CONNECT_SOURCE_PREFIX) &&
    (event.activityType === 'strength' ||
      (event.activityType === 'other' &&
        STRENGTH_TITLE_PATTERN.test(event.title)))
  );
}

interface CandidateMatch {
  hevy: ActivityEvent & {
    strengthWorkout: NonNullable<ActivityEvent['strengthWorkout']>;
  };
  healthConnect: ActivityEvent;
  startDifference: number;
  endDifference: number;
}

function compareCandidates(left: CandidateMatch, right: CandidateMatch) {
  const scoreDifference =
    left.startDifference +
    left.endDifference -
    (right.startDifference + right.endDifference);
  if (scoreDifference) return scoreDifference;
  if (left.startDifference !== right.startDifference) {
    return left.startDifference - right.startDifference;
  }
  if (left.endDifference !== right.endDifference) {
    return left.endDifference - right.endDifference;
  }
  const hevyDifference = left.hevy.id.localeCompare(right.hevy.id);
  return hevyDifference ||
    left.healthConnect.id.localeCompare(right.healthConnect.id);
}

/**
 * Collapses a source-selected Health Connect strength session and its Hevy
 * counterpart into one logical workout. Hevy remains the canonical workout
 * (identity, exact timing, title, exercises and sets); Health Connect's raw
 * records remain untouched and can still supply sensor metrics such as heart
 * rate. Calories are copied only when Health Connect has an explicit value,
 * with their source retained on the derived event.
 */
export function mergeHevyHealthConnectActivities(
  events: HealthContextEvent[],
): HealthContextEvent[] {
  const hevy = events.filter(isHevyActivity);
  const healthConnect = events.filter(
    isStrengthCompatibleHealthConnectActivity,
  );
  if (!hevy.length || !healthConnect.length) return events;

  const candidates: CandidateMatch[] = [];
  for (const hevyEvent of hevy) {
    for (const healthConnectEvent of healthConnect) {
      const startDifference = Math.abs(
        hevyEvent.start - healthConnectEvent.start,
      );
      const endDifference = Math.abs(
        activityEnd(hevyEvent) - activityEnd(healthConnectEvent),
      );
      if (
        startDifference <= HEVY_HEALTH_CONNECT_START_TOLERANCE_MS &&
        endDifference <= HEVY_HEALTH_CONNECT_END_TOLERANCE_MS
      ) {
        candidates.push({
          hevy: hevyEvent,
          healthConnect: healthConnectEvent,
          startDifference,
          endDifference,
        });
      }
    }
  }
  candidates.sort(compareCandidates);

  const matchedHevy = new Map<string, ActivityEvent>();
  const matchedHealthConnect = new Set<string>();
  for (const candidate of candidates) {
    if (
      matchedHevy.has(candidate.hevy.id) ||
      matchedHealthConnect.has(candidate.healthConnect.id)
    ) {
      continue;
    }
    const caloriesBurned = candidate.healthConnect.caloriesBurned;
    matchedHevy.set(candidate.hevy.id, {
      ...candidate.hevy,
      caloriesBurned:
        caloriesBurned ?? candidate.hevy.caloriesBurned,
      corroboratingSourceIds: [candidate.healthConnect.sourceId],
      caloriesBurnedSourceId:
        caloriesBurned === undefined
          ? candidate.hevy.caloriesBurnedSourceId
          : candidate.healthConnect.sourceId,
    });
    matchedHealthConnect.add(candidate.healthConnect.id);
  }

  if (!matchedHevy.size) return events;
  return events.flatMap((event) => {
    if (matchedHealthConnect.has(event.id)) return [];
    const merged = matchedHevy.get(event.id);
    return [merged ?? event];
  });
}
