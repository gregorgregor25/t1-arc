import { describe, expect, it } from 'vitest';

import { summarizeHealthTrendContext } from '@/domain/healthTrendContext';
import type { HealthContextEvent, MealEvent } from '@/domain/models';
import { AAPS_NUTRITION_SOURCE, selectNutritionSource, validateNutritionSource } from '@/domain/nutritionSource';

const at = Date.parse('2026-11-17T12:30:00Z');
const range = { start: at - 3_600_000, end: at + 3_600_000 };

function meal(id: string, sourceId: string, carbsGrams: number, origin: MealEvent['origin'], offset = 0): MealEvent {
  return { id, kind: 'meal', start: at + offset, title: 'Lunch', mealType: 'lunch', carbsGrams, sourceId, origin };
}

const scanned = meal('scan', 't1arc-manual', 45, 'manual');
const local = meal('aaps-local:meal:1', 'aaps-local', 45, 'imported');
const nightscout = meal('nightscout:meal:1', 'nightscout', 45, 'imported', 10_000);
const carbs = (events: readonly HealthContextEvent[]) => summarizeHealthTrendContext([...events], range).mealCarbsGrams;
const excluded = (events: readonly HealthContextEvent[]) => events.filter((event) => event.kind === 'note' && event.excludedFoodSource);

describe('food logged in T1 Arc alongside carbohydrate entered in AAPS', () => {
  it('counts the scanned food once and shows the AAPS entry once, as an excluded bolus entry', () => {
    const shown = selectNutritionSource([scanned, local, nightscout]);
    expect(carbs(shown)).toBe(45);
    const notes = excluded(shown);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: 'nightscout:meal:1', title: 'Nightscout carbohydrate entry', category: 'pump' });
    expect(notes[0]?.kind === 'note' && notes[0].detail).toMatch(/does not confirm food eaten/);
  });

  it('labels an AAPS-only entry as an AAPS carbohydrate entry', () => {
    const notes = excluded(selectNutritionSource([scanned, local]));
    expect(notes).toEqual([expect.objectContaining({ id: 'aaps-local:meal:1', title: 'AAPS carbohydrate entry' })]);
  });

  it('can count AAPS carbohydrate instead, once across this phone, Nightscout and a pump export', () => {
    const glooko = meal('glooko:meal:1', 'glooko-export', 45, 'imported', -30_000);
    const shown = selectNutritionSource([scanned, local, nightscout, glooko], AAPS_NUTRITION_SOURCE);
    expect(carbs(shown)).toBe(45);
    expect(shown.filter((event) => event.kind === 'meal').map((event) => event.id)).toEqual(['glooko:meal:1']);
    expect(excluded(shown)).toEqual([expect.objectContaining({ id: 'scan', title: 'Food logged in T1 Arc · Lunch' })]);
  });

  it('keeps two different AAPS entries close together', () => {
    const second = meal('aaps-local:meal:2', 'aaps-local', 20, 'imported', 60_000);
    expect(carbs(selectNutritionSource([local, second], AAPS_NUTRITION_SOURCE))).toBe(65);
  });

  it('always counts hypo treatments logged in T1 Arc', () => {
    const hypo: MealEvent = { ...meal('hypo', 't1arc-manual', 15, 'manual'), purpose: 'hypo-treatment' };
    expect(carbs(selectNutritionSource([hypo, local], AAPS_NUTRITION_SOURCE))).toBe(60);
  });

  it('accepts the AAPS choice and still rejects unknown choices', () => {
    expect(validateNutritionSource(AAPS_NUTRITION_SOURCE)).toBe('aaps');
    expect(() => validateNutritionSource('aaps-local')).toThrow();
  });
});
