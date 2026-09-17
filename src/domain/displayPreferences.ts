export const DISPLAY_PREFERENCES_STORAGE_KEY = 'display-preferences-v1';
export const GLANCE_METRIC_IDS = ['time-in-range', 'insulin', 'nutrition', 'sleep', 'blood-pressure', 'heart-rate', 'steps', 'activity', 'weight'] as const;
export interface DisplayPreferences {
  version: 1;
  glanceOrder: string[];
  hiddenHealthMetrics: string[];
}
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  version: 1, glanceOrder: [...GLANCE_METRIC_IDS], hiddenHealthMetrics: [],
};

export function parseDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Display preferences could not be read.');
  const record = value as Record<string, unknown>;
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 50 && ids.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,60}$/.test(id)) && new Set(ids).size === ids.length;
  if (record.version !== 1 || !validIds(record.glanceOrder) || !validIds(record.hiddenHealthMetrics) || record.glanceOrder.some(id => !GLANCE_METRIC_IDS.includes(id as typeof GLANCE_METRIC_IDS[number]))) throw new Error('Display preferences could not be read.');
  return { version: 1, glanceOrder: [...record.glanceOrder], hiddenHealthMetrics: [...record.hiddenHealthMetrics] };
}

export function validateSerializedDisplayPreferences(value: string): string {
  return JSON.stringify(parseDisplayPreferences(JSON.parse(value)));
}

/** Unavailable priorities are skipped without changing their saved order. */
export function prioritiseGlanceMetrics<T extends { id: string }>(metrics: readonly T[], order: readonly string[]): T[] {
  const ids = [...new Set([...order, ...GLANCE_METRIC_IDS])];
  return ids.flatMap(id => metrics.filter(metric => metric.id === id)).slice(0, 3);
}

export function moveDisplayPriority(ids: readonly string[], id: string, offset: -1 | 1): string[] {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
