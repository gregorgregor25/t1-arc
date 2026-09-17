import type { HealthContextEvent } from './models';

export const NUTRITION_SOURCE_KEY = 'nutrition-display-source-v1';
export const NATIVE_NUTRITION_SOURCE = 't1arc';
export function validateNutritionSource(value: unknown): string {
  if (value === NATIVE_NUTRITION_SOURCE || (typeof value === 'string' && /^health-connect:[a-zA-Z0-9_.]{1,200}$/.test(value))) return value;
  throw new Error('Choose T1 Arc or one Health Connect food source.');
}
export function selectNutritionSource(events: readonly HealthContextEvent[], selected = NATIVE_NUTRITION_SOURCE): HealthContextEvent[] {
  return events.map((event): HealthContextEvent => {
    if (event.kind !== 'meal' || event.purpose === 'hypo-treatment') return event;
    const native = event.origin === 'manual' || event.origin === 'synthetic';
    if ((selected === NATIVE_NUTRITION_SOURCE && native) || (selected !== NATIVE_NUTRITION_SOURCE && event.sourceId === selected)) return event;
    return {
      excludedFoodSource: true,
      id: event.id, kind: 'note', start: event.start, end: event.end, sourceId: event.sourceId,
      sourceLabel: event.sourceLabel, origin: event.origin, recordedAt: event.recordedAt,
      sourceFile: event.sourceFile, sourceRow: event.sourceRow,
      title: event.sourceId === 'glooko-export' ? 'Pump carbohydrate entry' : `Food record · ${event.sourceLabel ?? event.sourceId}`,
      category: event.sourceId === 'glooko-export' ? 'pump' : 'other',
      detail: `${event.carbsGrams === undefined ? 'Carbohydrate not supplied' : `${event.carbsGrams} g carbohydrate recorded by source`}. Excluded from food totals because another food source is selected.${event.sourceId === 'glooko-export' ? ' A pump carbohydrate input does not confirm food consumed.' : ''} Original record retained.`,
    };
  });
}
