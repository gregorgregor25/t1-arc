import { reconcileContextSources } from './insulinSourceReconciliation';
import type { HealthContextEvent } from './models';

export const NUTRITION_SOURCE_KEY = 'nutrition-display-source-v1';
export const NATIVE_NUTRITION_SOURCE = 't1arc';
/**
 * Carbohydrate entered for boluses: AAPS on this phone, the Nightscout site
 * AAPS uploads to, or a pump export. One entry can arrive by several of these
 * routes, so all of them belong to this choice and copies are counted once.
 */
export const AAPS_NUTRITION_SOURCE = 'aaps';
const AAPS_CARB_SOURCES = new Set(['aaps-local', 'nightscout', 'glooko-export']);

export function validateNutritionSource(value: unknown): string {
  if (
    value === NATIVE_NUTRITION_SOURCE ||
    value === AAPS_NUTRITION_SOURCE ||
    (typeof value === 'string' && /^health-connect:[a-zA-Z0-9_.]{1,200}$/.test(value))
  ) {
    return value;
  }
  throw new Error('Choose T1 Arc, AAPS or one Health Connect food source.');
}

function isSelectedFood(event: HealthContextEvent, selected: string) {
  if (selected === NATIVE_NUTRITION_SOURCE) return event.origin === 'manual' || event.origin === 'synthetic';
  if (selected === AAPS_NUTRITION_SOURCE) return event.origin === 'imported' && AAPS_CARB_SOURCES.has(event.sourceId);
  return event.sourceId === selected;
}

/** Pump and AAPS carbohydrate inputs record what was entered for a bolus, not food eaten. */
function treatmentCarbTitle(sourceId: string) {
  if (sourceId === 'glooko-export') return 'Pump carbohydrate entry';
  if (sourceId === 'aaps-local') return 'AAPS carbohydrate entry';
  if (sourceId === 'nightscout') return 'Nightscout carbohydrate entry';
  return undefined;
}

/**
 * Keeps one food diary in food totals. Entries from other food sources stay
 * as read-only notes. Copies of one imported carbohydrate entry (AAPS on this
 * phone and Nightscout, for example) are reconciled first, so an excluded
 * entry is shown once. Hypo treatments always count.
 */
export function selectNutritionSource(events: readonly HealthContextEvent[], selected = NATIVE_NUTRITION_SOURCE): HealthContextEvent[] {
  return reconcileContextSources(events).map((event): HealthContextEvent => {
    if (event.kind !== 'meal' || event.purpose === 'hypo-treatment') return event;
    if (isSelectedFood(event, selected)) return event;
    const treatmentTitle = event.origin === 'imported' ? treatmentCarbTitle(event.sourceId) : undefined;
    const native = event.origin === 'manual' || event.origin === 'synthetic';
    return {
      excludedFoodSource: true,
      id: event.id, kind: 'note', start: event.start, end: event.end, sourceId: event.sourceId,
      sourceLabel: event.sourceLabel, origin: event.origin, recordedAt: event.recordedAt,
      sourceFile: event.sourceFile, sourceRow: event.sourceRow,
      title: treatmentTitle ?? (native ? `Food logged in T1 Arc · ${event.title}` : `Food record · ${event.sourceLabel ?? event.sourceId}`),
      category: treatmentTitle ? 'pump' : 'other',
      detail: `${event.carbsGrams === undefined ? 'Carbohydrate not supplied' : `${event.carbsGrams} g carbohydrate recorded by source`}. Excluded from food totals because another food source is selected.${treatmentTitle ? ' A carbohydrate entry made for a bolus does not confirm food eaten.' : ''} Original record retained.`,
    };
  });
}
