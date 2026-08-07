import type { HealthConnectCategoryId } from '../../../modules/daymark-health-connect';

import type { HealthContextEvent } from '@/domain/models';

const HEALTH_CONNECT_SOURCE_PREFIX = 'health-connect:';

export interface HealthConnectContextPreference {
  category: HealthConnectCategoryId;
  preferredSourcePackage?: string;
}

export type HealthConnectContextCategory =
  | 'workouts'
  | 'sleep'
  | 'weight'
  | 'nutrition'
  | 'cycle';

export interface HealthConnectContextSelection {
  events: HealthContextEvent[];
  needsSource: HealthConnectContextCategory[];
}

function contextCategory(
  event: HealthContextEvent,
): HealthConnectContextCategory | undefined {
  if (event.kind === 'activity') return 'workouts';
  if (event.kind === 'sleep') return 'sleep';
  if (event.kind === 'weight') return 'weight';
  if (event.kind === 'meal') return 'nutrition';
  if (event.kind === 'note' && event.category === 'hormones') {
    return 'cycle';
  }
  return undefined;
}

function healthConnectSourcePackage(event: HealthContextEvent) {
  if (!event.sourceId.startsWith(HEALTH_CONNECT_SOURCE_PREFIX)) {
    return undefined;
  }
  const packageName = event.sourceId.slice(
    HEALTH_CONNECT_SOURCE_PREFIX.length,
  );
  return packageName || undefined;
}

/**
 * Health Connect keeps every source's raw records. Context summaries only use
 * one source per category so two providers cannot silently double count the
 * same sleep, workout, meal, weight or cycle event.
 */
export function selectHealthConnectContext(
  events: HealthContextEvent[],
  preferences: HealthConnectContextPreference[],
): HealthConnectContextSelection {
  const preferredByCategory = new Map(
    preferences.flatMap((preference) =>
      preference.preferredSourcePackage
        ? [[preference.category, preference.preferredSourcePackage] as const]
        : [],
    ),
  );
  const sourcesByCategory = new Map<
    HealthConnectContextCategory,
    Set<string>
  >();

  for (const event of events) {
    const category = contextCategory(event);
    const sourcePackage = healthConnectSourcePackage(event);
    if (!category || !sourcePackage) continue;
    const sources = sourcesByCategory.get(category) ?? new Set<string>();
    sources.add(sourcePackage);
    sourcesByCategory.set(category, sources);
  }

  const needsSource = [...sourcesByCategory.entries()]
    .filter(
      ([category, sources]) =>
        sources.size > 1 && !preferredByCategory.has(category),
    )
    .map(([category]) => category);

  return {
    events: events.filter((event) => {
      const category = contextCategory(event);
      const sourcePackage = healthConnectSourcePackage(event);
      if (!category || !sourcePackage) return true;
      const preferred = preferredByCategory.get(category);
      if (preferred) return sourcePackage === preferred;
      return (sourcesByCategory.get(category)?.size ?? 0) <= 1;
    }),
    needsSource,
  };
}
