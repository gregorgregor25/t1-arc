import { GLANCE_METRIC_IDS } from '@/domain/displayPreferences';

/** How many large priority cards Health shows before the grouped list. */
export const HEALTH_PRIORITY_COUNT = 4;

/**
 * The Today "at a glance" priorities use their own ids. These are the Health
 * metric ids that show the same measure. Time in range and insulin have no
 * Health metric, so they are skipped.
 */
const GLANCE_TO_HEALTH_METRIC: Readonly<Record<string, string>> = {
  nutrition: 'nutrition',
  sleep: 'sleep',
  'blood-pressure': 'blood-pressure',
  'heart-rate': 'heart-rate',
  steps: 'steps',
  activity: 'workouts',
  weight: 'weight',
};

export type HealthMetricGroupId = 'body' | 'heart' | 'activity' | 'sleep' | 'food';

export const HEALTH_METRIC_GROUPS: readonly { id: HealthMetricGroupId; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'heart', label: 'Heart and breathing' },
  { id: 'activity', label: 'Activity' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'food', label: 'Food' },
];

const METRIC_GROUP: Readonly<Record<string, HealthMetricGroupId>> = {
  weight: 'body',
  'blood-pressure': 'body',
  'body-composition': 'body',
  temperature: 'body',
  'health-glucose': 'body',
  'cycle-context': 'body',
  'heart-rate': 'heart',
  hrv: 'heart',
  oxygen: 'heart',
  'respiratory-rate': 'heart',
  'vo2-max': 'heart',
  steps: 'activity',
  distance: 'activity',
  energy: 'activity',
  workouts: 'activity',
  sleep: 'sleep',
  nutrition: 'food',
  hydration: 'food',
};

/** Group for a Health metric id. Unknown ids fall back to "Body" so nothing is dropped. */
export function healthMetricGroup(id: string): HealthMetricGroupId {
  return METRIC_GROUP[id] ?? 'body';
}

/**
 * Picks the large priority cards. It follows the order the person chose for
 * Today at a glance (the existing setting), skips measures without data or
 * hidden from Health, and then fills any free places in the usual Health
 * order. `metrics` must already exclude unavailable and hidden metrics.
 */
export function healthPriorityIds<T extends { id: string }>(
  metrics: readonly T[],
  glanceOrder: readonly string[],
  count = HEALTH_PRIORITY_COUNT,
): string[] {
  const shown = new Set(metrics.map((metric) => metric.id));
  const ordered = [...new Set([...glanceOrder, ...GLANCE_METRIC_IDS])]
    .map((id) => GLANCE_TO_HEALTH_METRIC[id])
    .filter((id): id is string => id !== undefined && shown.has(id));
  const chosen = [...new Set(ordered)];
  for (const metric of metrics) {
    if (chosen.length >= count) break;
    if (!chosen.includes(metric.id)) chosen.push(metric.id);
  }
  return chosen.slice(0, count);
}

/** The remaining metrics, grouped in a fixed order, skipping empty groups. */
export function groupRemainingHealthMetrics<T extends { id: string }>(
  metrics: readonly T[],
  priorityIds: readonly string[],
): { id: HealthMetricGroupId; label: string; metrics: T[] }[] {
  const rest = metrics.filter((metric) => !priorityIds.includes(metric.id));
  return HEALTH_METRIC_GROUPS.map((group) => ({
    ...group,
    metrics: rest.filter((metric) => healthMetricGroup(metric.id) === group.id),
  })).filter((group) => group.metrics.length > 0);
}
