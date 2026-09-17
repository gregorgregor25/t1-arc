import { describe, expect, it } from 'vitest';
import { customFoodFormFromLabelDraft } from '@/components/foodLogger/labelPresentation';
import { customFoodDraftFromForm, EMPTY_CUSTOM_FOOD } from '@/components/foodLogger/myFoodPresentation';
import type { FoodLabelDraft } from '@/data/food/foodLabelCapture';

const draft: FoodLabelDraft = { fields: { serving: 100, unit: 'g', carbs: 23.5, energyKcal: 112.345 }, basisLabel: 'per 100 g', confidence: { basis: 'clear', carbs: 'clear' }, warnings: [] };
describe('reviewed nutrition-label application', () => {
  it('retains the identity but replaces, rather than merges, previous label values', () => {
    const form = customFoodFormFromLabelDraft({ ...EMPTY_CUSTOM_FOOD, name: 'Oats', brand: 'Example', fat: '99', protein: '99' }, draft, { locale: 'en-GB', energyUnit: 'kcal' });
    expect(form).toMatchObject({ name: 'Oats', brand: 'Example', serving: '100', carbs: '23.5', fat: '', protein: '' });
    expect(form.canonicalBaseline?.nutritionPerServing.energyKcal).toBe(112.345);
  });
  it('retains exact source energy across a regional kJ display', () => {
    const regional = { locale: 'de-DE', energyUnit: 'kJ' as const, countryCode: 'DE', measurementSystem: 'metric' as const };
    const form = customFoodFormFromLabelDraft({ ...EMPTY_CUSTOM_FOOD, name: 'Example' }, draft, regional);
    expect(form.energy).toContain(',');
    const food = customFoodDraftFromForm(form, '123456789012', regional);
    expect(food.nutritionPerServing.energyKcal).toBe(112.345);
    expect(food.barcode).toBe('123456789012');
  });
  it('does not invent a basis or turn unreadable nutrients into zero', () => {
    const form = customFoodFormFromLabelDraft(EMPTY_CUSTOM_FOOD, { ...draft, fields: {}, confidence: { basis: 'missing', carbs: 'missing' } }, { locale: 'en-GB', energyUnit: 'kcal' });
    expect(form.serving).toBe('');
    expect(form.carbs).toBe('');
    expect(form.energy).toBe('');
    expect(form.canonicalBaseline).toBeUndefined();
  });
});
