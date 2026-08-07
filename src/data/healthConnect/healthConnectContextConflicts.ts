import type { TimeRange } from '@/domain/models';
import { openDaymarkDatabase } from '@/data/persistence/daymarkDatabase';

import type {
  HealthConnectContextCategory,
  HealthConnectContextPreference,
} from './healthConnectContextSelection';

interface ContextSourceRow {
  category: HealthConnectContextCategory;
  source_package: string;
}

interface ContextPreferenceRow {
  category: HealthConnectContextPreference['category'];
  preferred_source_package: string | null;
}

export function healthConnectContextConflicts(
  sources: Array<{
    category: HealthConnectContextCategory;
    sourcePackage: string;
  }>,
  preferences: HealthConnectContextPreference[],
) {
  const preferred = new Set(
    preferences.flatMap((preference) =>
      preference.preferredSourcePackage ? [preference.category] : [],
    ),
  );
  const packagesByCategory = new Map<
    HealthConnectContextCategory,
    Set<string>
  >();
  for (const source of sources) {
    const packages =
      packagesByCategory.get(source.category) ?? new Set<string>();
    packages.add(source.sourcePackage);
    packagesByCategory.set(source.category, packages);
  }
  return [...packagesByCategory.entries()]
    .filter(
      ([category, packages]) =>
        packages.size > 1 && !preferred.has(category),
    )
    .map(([category]) => category);
}

export async function getHealthConnectContextSourceConflicts(
  range: TimeRange,
) {
  const database = await openDaymarkDatabase();
  const [sources, preferences] = await Promise.all([
    database.getAllAsync<ContextSourceRow>(
      `SELECT DISTINCT
         CASE kind
           WHEN 'activity' THEN 'workouts'
           WHEN 'sleep' THEN 'sleep'
           WHEN 'weight' THEN 'weight'
           WHEN 'meal' THEN 'nutrition'
         END AS category,
         SUBSTR(source_id, LENGTH('health-connect:') + 1) AS source_package
       FROM context_events
       WHERE source_id LIKE 'health-connect:%'
         AND kind IN ('activity', 'sleep', 'weight', 'meal')
         AND start_ms < ?
         AND COALESCE(end_ms, start_ms) >= ?
       UNION
       SELECT DISTINCT
         'cycle' AS category,
         SUBSTR(source_id, LENGTH('health-connect:') + 1) AS source_package
       FROM context_notes
       WHERE source_id LIKE 'health-connect:%'
         AND category = 'hormones'
         AND start_ms < ?
         AND COALESCE(end_ms, start_ms) >= ?`,
      range.end,
      range.start,
      range.end,
      range.start,
    ),
    database.getAllAsync<ContextPreferenceRow>(
      `SELECT category, preferred_source_package
       FROM health_connect_preferences
       WHERE category IN (
         'workouts', 'sleep', 'weight', 'nutrition', 'cycle'
       )`,
    ),
  ]);
  return healthConnectContextConflicts(
    sources.map((source) => ({
      category: source.category,
      sourcePackage: source.source_package,
    })),
    preferences.map((preference) => ({
      category: preference.category,
      preferredSourcePackage:
        preference.preferred_source_package ?? undefined,
    })),
  );
}
